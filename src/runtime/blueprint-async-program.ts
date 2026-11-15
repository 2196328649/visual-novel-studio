import { uiControlOptionExecutionPin } from '../core/ui-control-options';
import { uiControlOptionEditExpression } from './ui-control-options-runtime';
import { uiPropertyWriteExpression } from './ui-property-batch-runtime';
import type { BlueprintGraph, BlueprintNode, BlueprintPin, Project, VariableValue } from '../core/model';
import { projectGraphs } from '../core/project-resources';
import { blueprintTaskProblems, isBlueprintTaskLaunch, isBlueprintModuleCall, blueprintTaskScope, blueprintTaskPageId, blueprintTaskOperationSupported } from '../core/blueprint-tasks';
import { blueprintFlowControlInitial, blueprintFlowControlScope, blueprintFlowControlPageId, isBlueprintFlowControl } from '../core/blueprint-flow-control';
import { blueprintChoiceDefinition } from '../core/blueprint-choice';
import { blueprintStateVariable, blueprintStateScope, blueprintStatePageId } from '../core/blueprint-state';
import { blueprintInvocationDefaults } from './blueprint-invocation-runtime';
import { variableReference } from './expressions';
import { pythonLiteral as py, pythonBlockLiteral } from './literals';

type Expression = (graph: BlueprintGraph, node: BlueprintNode, pin: string) => string | undefined;
/** The normal compiler supplies its data resolver, so lazy logic and typed
 * numeric/reference reads cannot diverge in tasks. Only exec suspension differs. */
export function createBlueprintAsyncProgram(project: Project, expression: Expression): string {
  const graphs = projectGraphs(project), byId = new Map(graphs.map(graph => [graph.id, graph]));
  const selected = new Set<string>(), metadata = new Set<string>();
  const include = (id: string) => { if (selected.has(id)) return; selected.add(id); metadata.add(id); for (const node of byId.get(id)?.nodes ?? []) if (isBlueprintModuleCall(node.type)) include(String(node.properties.graphId ?? '')); };
  for (const graph of graphs) for (const node of graph.nodes) { if (['throttle','startTask','debounce'].includes(node.type)) metadata.add(graph.id); if (isBlueprintTaskLaunch(node.type)) include(String(node.properties.graphId ?? '')); if (node.type === 'waitTask' && node.properties.graphId) metadata.add(String(node.properties.graphId)); }
  const pins = (items: BlueprintPin[]) => Object.fromEntries(items.map(pin => [pin.id, { type: pin.dataType, default: pin.defaultValue, name: pin.name, required: pin.required }]));
  const definitions = Object.fromEntries(graphs.filter(graph => metadata.has(graph.id)).map(graph => {
    const links: Record<string, Record<string, string[]>> = {};
    for (const link of graph.links) if (graph.nodes.find(node => node.id === link.fromNodeId)?.pins.some(pin => pin.id === link.fromPinId && pin.dataType === 'exec')) (links[link.fromNodeId] ??= {})[link.fromPinId] = [link.toNodeId, link.toPinId];
    return [graph.id, { inputs: pins(graph.exposedInputs), outputs: pins(graph.exposedOutputs), defaults: blueprintInvocationDefaults(graph, byId), entry: graph.nodes.find(node => node.type === 'event')?.id, links, problem: selected.has(graph.id) ? blueprintTaskProblems(project, graph.id).map(problem => problem.message).join(' / ') : '此模块未用作任务入口。' }];
  }));
  const lines = ['init python:', '    vn_bp_async_graphs = ' + pythonBlockLiteral(definitions, 1), '    vn_bp_async_steps = {}'];
  const emit = (line: string) => lines.push('        ' + line);
  for (const graph of graphs.filter(graph => selected.has(graph.id))) for (const node of graph.nodes.filter(node => node.pins.some(pin => pin.dataType === 'exec'))) {
    const name = 'vn_bp_async_node_' + graph.id + '_' + node.id;
    lines.push('    def ' + name + '(entry):');
    for (const pin of graph.exposedInputs) emit('vn_bp_in_' + graph.id + '_' + pin.id + ' = vn_bp_frame.get("arguments", {}).get(' + py(pin.id) + ', ' + py(pin.defaultValue) + ')');
    emit('vn_bp_event_values = {}');
    const value = (pin: string, fallback?: VariableValue) => expression(graph, node, pin) ?? py(fallback);
    const capture = (slot: string, expression: string, prefix = '') => emit(prefix + 'vn_bp_capture_local(' + py(slot) + ', ' + expression + ')');
    const local = (slot: string) => 'vn_bp_local(' + py(slot) + ')';
    const next = (pins = [node.type === 'editUiControlOptions' ? uiControlOptionExecutionPin(node) : 'exec_out']) => emit('return ("next", ' + py(pins) + ')');
    const args = () => '{' + (byId.get(String(node.properties.graphId))?.exposedInputs ?? []).map(pin => py(pin.id) + ': ' + value('arg_' + pin.id, pin.defaultValue)).join(', ') + '}';
    if (!blueprintTaskOperationSupported(node)) emit('raise Exception(' + py('后台任务不支持：' + node.name) + ')');
    else if (node.type === 'event') next(['exec']);
    else if (node.type === 'return') emit('return ("return",)');
    else if (node.type === 'sequence') next(node.pins.filter(pin => pin.dataType === 'exec' && pin.direction === 'output').map(pin => pin.id));
    else if (node.type === 'branch') {
      const variable = project.variables.find(item => item.id === node.properties.variableId);
      const condition = expression(graph, node, 'condition') ?? (variable ? variableReference(project, variable.id) + ' == ' + py(node.properties.value ?? variable.initial) : py(node.properties.condition ?? true));
      emit('return ("next", ["true" if vn_bp_boolean(' + condition + ', "分支条件") else "false"])');
    } else if (node.type === 'switchValue') {
      const definition = blueprintChoiceDefinition(node);
      emit('return ("next", [vn_bp_choice_match(' + value('key') + ', ' + py(definition.keyType) + ', ' + py((definition.cases ?? []).map(item => [item.id, item.key])) + ')])');
    } else if (isBlueprintFlowControl(node.type)) {
      const page = blueprintFlowControlScope(node) === 'page' ? value('pageId', blueprintFlowControlPageId(graph, node)) : 'None';
      emit('return ("next", [vn_bp_control_step(' + [py(node.properties.scope ?? 'call'), page, py(graph.id), py(node.id), py(node.type), 'entry', py(node.properties.initiallyClosed ?? blueprintFlowControlInitial(node))].join(', ') + ')])');
    } else if (node.type === 'throttle') {
      emit('return ("next", [vn_bp_throttle(' + [py(node.properties.scope), blueprintTaskScope(node) === 'page' ? value('pageId', blueprintTaskPageId(graph, node)) : 'None', py(graph.id), py(node.id), 'entry', value('seconds', .3)].join(', ') + ')])');
    } else if (isBlueprintTaskLaunch(node.type)) {
      emit('result = vn_bp_async_start(' + [py(node.properties.scope), blueprintTaskScope(node) === 'page' ? value('pageId', blueprintTaskPageId(graph, node)) : 'None', py(graph.id), py(node.id), py(node.properties.graphId), args(), value('seconds', node.type === 'debounce' ? .3 : 0), py(node.type === 'debounce' ? 'replace' : node.properties.conflict)].join(', ') + ')');
      capture('vn_bp_task_handle_' + node.id, 'result["handle"]'); emit('return ("next", [result["output"]])');
    } else if (node.type === 'cancelTask') { capture('vn_bp_task_cancelled_' + node.id, 'vn_bp_async_cancel(' + value('handle', '') + ')'); next(); }
    else if (node.type === 'focusUiComponent') { capture('vn_bp_focus_accepted_' + node.id, 'vn_input_request_focus(' + value('componentId') + ', ' + value('focused', true) + ')'); next(); }
    else if (node.type === 'waitTask') {
      emit('if entry != "__resume":'); capture('vn_bp_await_handle_' + node.id, value('handle', ''), '    ');
      emit('return ("await", ' + local('vn_bp_await_handle_' + node.id) + ', ' + py(node.properties.graphId || '') + ')');
    } else if (node.type === 'delay') emit('return ("time", ["exec_out"], ' + value('seconds', 1) + ')');
    else if (node.type === 'forLoop') {
      const index = 'vn_bp_index_' + node.id, last = 'vn_bp_last_' + node.id;
      emit('if entry == "__next":'); capture(index, local(index) + ' + 1', '    ');
      emit('else:'); capture(index, 'vn_bp_loop_bound(' + value('first_index', 0) + ', "循环起始数")', '    '); capture(last, 'vn_bp_loop_bound(' + value('last_index', 3) + ', "循环结束数")', '    ');
      emit('if ' + local(last) + ' - ' + local(index) + ' >= 100000:'); emit('    raise Exception("单次循环最多执行 100000 次。")');
      emit('if ' + local(index) + ' <= ' + local(last) + ':');
      emit('    return ("walk", vn_bp_async_successors(' + py(graph.id) + ', ' + py(node.id) + ', ["loop_body"]) + [(' + py(node.id) + ', "__next")])'); next(['completed']);
    } else if (node.type === 'callFunction' || node.type === 'callMacro') emit('return ("call", ["exec_out"], ' + py(node.properties.graphId) + ', ' + args() + ')');
    else if (node.type === 'setOutput') {
      const definition = graph.exposedOutputs.find(pin => pin.id === node.properties.outputId);
      emit('value = ' + value('value'));
      emit('if not vn_bp_async_valid_value(' + py(definition?.dataType ?? '') + ', value):'); emit('    raise Exception("任务模块的输出类型与接口不匹配。")');
      capture('vn_bp_out_' + graph.id + '_' + String(node.properties.outputId), 'value'); next();
    }
    else if (node.type === 'setVariable') {
      const variable = blueprintStateVariable(project, graph, node), scope = blueprintStateScope(project, node);
      if (!variable) emit('raise Exception("状态变量不存在。")');
      else {
        emit('value = ' + value('value', variable.initial)); emit('if not vn_state_valid(' + py({ type: variable.type }) + ', value):'); emit('    raise Exception("状态值类型不匹配。")');
        if (scope === 'call') emit('vn_bp_state_set(' + py(graph.id) + ', ' + py(variable.id) + ', value)');
        else if (scope === 'page') emit('vn_ui_state_set(' + value('pageId', blueprintStatePageId(graph, node)) + ', ' + py(variable.id) + ', value, ' + py(variable.type) + ')');
        else emit('vn_parameter_set(' + py(variable.id) + ', value, False)');
        next();
      }
    } else if (node.type === 'animateUiProperty' || node.type === 'playUiAnimation') {
      emit('token = ' + (node.type === 'playUiAnimation' ? 'vn_ui_play_animation(' + [py(node.properties.animationId ?? ''), py(node.properties.playMode ?? 'forward'), value('loops', 1), value('speed', 1), value('fromCurrent', false)].join(', ') + ')' : 'vn_ui_animate(' + [value('componentId'), py(node.properties.property ?? 'opacity'), value('value', 0), value('duration', .3), py(node.properties.easing ?? 'ease')].join(', ') + ')'));
      emit('return ("animation", ["exec_out"], token) if vn_bp_boolean(' + value('wait', true) + ', "等待动画") else ("next", ["exec_out"])');
    } else if (node.type === 'setUiProperty') {
      emit(uiPropertyWriteExpression(node, value)); next();
    } else {
      const action: Partial<Record<BlueprintNode['type'], string>> = {
        setPageOutput: 'vn_ui_interface_set_output(' + [value('pageId'), py(node.properties.parameterId), value('value'), py(node.pins.find(pin => pin.id === 'value')?.dataType)].join(', ') + ')',
        editUiControlOptions: uiControlOptionEditExpression(node, value),
        setUiControlRange: 'vn_ui_control_set_range(' + [value('componentId'), value('minimum', 0), value('maximum', 1), value('step', .01)].join(', ') + ')',
        resetUiControlRange: 'vn_ui_control_reset_range(' + value('componentId') + ')',
        resetUiProperty: 'vn_ui_reset_property(' + value('componentId') + ', ' + py(node.properties.property ?? 'visible') + ')',
        resetUiComponent: 'vn_ui_reset(' + value('componentId') + ')',
        stopUiAnimation: 'vn_ui_stop_animation(' + [value('componentId'), py(node.properties.property ?? 'all'), value('finish', false)].join(', ') + ')',
        stopUiAnimationPlayback: 'vn_ui_stop_playback(' + py(node.properties.animationId ?? '') + ', ' + value('finish', false) + ')',
        setPlayerPreference: 'vn_preference_set(' + [py(node.properties.preference), value('value'), value('characterId')].join(', ') + ')',
        playSound: 'renpy.music.play(vn_bp_asset(' + value('assetId') + ', "audio"), channel=' + py(node.properties.channel ?? 'sound') + ', loop=' + value('loop', false) + ') if ' + value('assetId', '') + ' else None',
        playMusic: 'renpy.music.play(vn_bp_asset(' + value('assetId') + ', "audio"), channel="music", loop=' + value('loop', true) + ', fadein=vn_bp_number(' + value('fade', .3) + ', 0, None, "音乐淡入秒数")) if ' + value('assetId', '') + ' else None',
        stopMusic: 'renpy.music.stop(channel=' + py(node.properties.channel ?? 'music') + ', fadeout=vn_bp_number(' + value('fade', .3) + ', 0, None, "声音淡出秒数"))',
        playUiVideo: 'vn_ui_video_control(' + value('componentId') + ', "play", ' + value('restart', false) + ')',
        pauseUiVideo: 'vn_ui_video_control(' + value('componentId') + ', "pause", ' + value('paused', true) + ')',
        stopUiVideo: 'vn_ui_video_control(' + value('componentId') + ', "stop")',
        playSpine: 'vns_spine.play(' + [value('componentId'), value('animation', ''), value('loop', true), value('restart', true)].join(', ') + ')',
        pauseSpine: 'vns_spine.pause(' + value('componentId') + ', ' + value('paused', true) + ')',
        setSpineSpeed: 'vns_spine.speed(' + value('componentId') + ', ' + value('speed', 1) + ')',
      };
      emit(action[node.type] ?? 'raise Exception(' + py('任务节点未实现：' + node.name) + ')'); next();
    }
    lines.push('    vn_bp_async_steps[(' + py(graph.id) + ', ' + py(node.id) + ')] = ' + name);
  }
  return lines.join('\n') + '\n';
}
