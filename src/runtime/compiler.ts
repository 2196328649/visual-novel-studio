import { uiGameOverEnabled } from '../core/ui-pages';
import { uiMenuShortcutScreen } from '../core/ui-availability';
import { uiControlOptionEditExpression } from './ui-control-options-runtime';
import { uiPropertyWriteExpression } from './ui-property-batch-runtime';
import { blueprintDebugRuntime } from './blueprint-debug-runtime';
import { createBlueprintPlaybackOrigins } from '../core/blueprint-playback-origins';
import { pythonBlockLiteral } from './literals';
import { createUiPageInterfaceRuntime } from './ui-page-interface-runtime';
import { uiPageNodeContractId, uiPageNodePageId, uiPageClosedOperationProblem } from '../core/ui-page-interface';
import { blueprintAsyncRuntime } from './blueprint-async-runtime';
import { createBlueprintAsyncProgram } from './blueprint-async-program';
import { blueprintTaskScope, blueprintTaskPageId, isBlueprintTaskLaunch } from '../core/blueprint-tasks';
import { blueprintChoiceDefinition, blueprintChoicePinId } from '../core/blueprint-choice';
import { blueprintChoiceRuntime } from './blueprint-choice-runtime';
import { blueprintNumericInputs } from '../core/blueprint-numeric';
import { blueprintNumericRuntime } from './blueprint-numeric-runtime';
import { blueprintExecutionOutputs } from '../core/blueprint-execution-ports';
import { blueprintFlowControlRuntime } from './blueprint-flow-control-runtime';
import { blueprintFlowControlInitial, blueprintFlowControlPageId, blueprintFlowControlScope, isBlueprintFlowControl } from '../core/blueprint-flow-control';
import { createBlueprintStateRuntime } from './blueprint-state-runtime';
import { blueprintStatePageId, blueprintStateScope, blueprintStateVariable } from '../core/blueprint-state';
import { projectGraphs } from '../core/project-resources';
import { timelinePlaybackLayout } from '../core/performance-timeline';
import { performancePlayback } from '../core/standalone-performance';
import { actionTiming } from '../core/performance-timing';
import { createActorTransitionsRuntime } from './actor-transitions';
import { createPerformancePlaybackRuntime } from './performance-playback';
import { createFlowTransitionLookahead, createFlowTransitionRuntime } from './flow-transition-runtime';
import { storyTransition } from '../core/flow-transitions';
import { earlyDialogueRuntime } from './early-dialogue';
import { createAudioClipRuntime } from './audio-clip-runtime';
import { audioClipFields } from '../core/audio-clip';
import { interleaveProjectTimelines } from '../core/timeline-interleave';
import { canLaunchTimeline } from '../core/timeline-launch';
import { nodeMoveOffsets, nodeAfterOffsets, afterOffsetDuration } from '../core/move-offsets';
import { applyVisualInputs, visualInputFields } from '../core/visual-object';
import { materializeVisualCompositions } from '../core/visual-composition';
import { actorAnimationDuration, actorCurveProperties } from '../core/actor-animation';
import { cameraAnimationDuration, cameraCurveProperties } from '../core/camera-animation';
import { normalizeChapterCompositions } from '../core/chapter-composition';
import { effectiveCharacter, effectiveScene, effectiveUiComponents, effectiveUiTheme, projectSchema, type BlueprintGraph, type BlueprintNode, type Condition, type Diagnostic, type Project, type StageAction, type VariableValue } from '../core/model';
import { savedBlueprintAction, rawSavedBlueprintAction } from '../core/blueprint-authoring';
import { validateProject } from '../core/validate';
import { createScreens, pythonLiteral, renpyText } from './screens';
import { expandStageAction, textCommandAction } from '../core/text-script';
import { blueprintInputValue } from '../core/blueprint';
import { createBlueprintRuntime } from './blueprint-runtime';
import { blueprintTaskRuntime } from './blueprint-task-runtime';
import { blueprintInvocationDefaults, blueprintInvocationRuntime } from './blueprint-invocation-runtime';
import { createUiRuntime } from './ui-runtime';
import { createSpineRuntime } from './spine-runtime';
import { createPreferencesRuntime } from './preferences-runtime';
import { createParameterRuntime } from './parameter-runtime';
import { createChapterRuntime } from './chapter-runtime';
import { createWindowRuntime } from './window-runtime';
import { resolveShowAction } from '../core/character-presets';
import { actorTag } from '../core/actor-instance';
import { createStoryMenuRuntime } from './story-menu-runtime';
import { voiceVisitKey } from '../core/story-menu';
import { conditionExpression, variableReference } from './expressions';
import { exportSettings } from '../core/export-settings';
import { createGameFlowRuntime } from './game-flow-runtime';
import { flowEntry, gameFlowConnections } from '../core/game-flow-graph';
import { gameFlowTransition } from '../core/game-flow-transitions';
import { compiledDialogueText, effectiveTextStyle, textRuntimeLook } from '../core/text-presentation';
import { lineMarks } from '../core/text-spans';
export { conditionExpression, variableReference } from './expressions';

export interface CompileOptions {
  development?: boolean;
  blueprintDebug?: boolean;
  preview?: { entryId?: string; variables?: Record<string, VariableValue>; flowStart?: 'launch' | 'title' };
}

export interface CompileResult {
  files: Record<string, string>;
  sourceMap: Record<string, { nodeId: string; lineId?: string }>;
  diagnostics: Diagnostic[];
}

const nodeLabel = (id: string) => `vn_node_${id}`;
const appearanceTransition = (mode: string, duration: string) => mode === 'fade' ? `Fade((${duration}) / 2.0, 0.0, (${duration}) / 2.0)` : mode === 'move' ? `MoveTransition(${duration})` : `Dissolve(${duration})`;
function continueIndicator(project: Project): string {
  const ui = effectiveUiTheme(project.ui);
  const image = project.assets.find(asset => asset.id === ui.continueIndicatorId && asset.kind === 'image');
  if (!image) return '';
  const width = Math.round(ui.continueIndicatorWidth ?? image.width ?? 32);
  const height = Math.max(1, Math.round(width * (image.height ?? 32) / (image.width ?? 32)));
  return `, ctc=Transform(${pythonLiteral(image.path.replaceAll('\\', '/'))}, xysize=(${width}, ${height}), fit="contain"), ctc_position="nestled-close"`;
}
const lineLabel = (nodeId: string, lineId: string) => `vn_line_${nodeId}_${lineId}`;
// Ren'Py names easein/easeout opposite to the editor's slow-start/slow-end curves.
const atlEasing = (easing: string) => easing === 'easein' ? 'easeout' : easing === 'easeout' ? 'easein' : easing === 'outquad' ? 'warp (lambda t: 1 - (1 - t) ** 2)' : easing;
const transformName = (action: StageAction) => {
  const data = JSON.stringify(action);
  let hash = 2166136261;
  for (let index = 0; index < data.length; index++) hash = Math.imul(hash ^ data.charCodeAt(index), 16777619);
  return `vn_${action.kind}_${(hash >>> 0).toString(16)}`;
};

export function compileProject(input: Project, options: CompileOptions = {}): CompileResult {
  const debug = options.development === true && options.blueprintDebug === true;
  const result: CompileResult = { files: {}, sourceMap: {}, diagnostics: [] };
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    result.diagnostics = parsed.error.issues.map(issue => ({
      severity: 'error', message: `项目格式无效 (${issue.path.join('.')}): ${issue.message}`,
    }));
    return result;
  }
  let project = parsed.data;
  normalizeChapterCompositions(project);
  result.diagnostics = validateProject(project);
  if (options.preview?.entryId && !project.nodes.some(node => node.id === options.preview?.entryId)) {
    result.diagnostics.push({ severity: 'error', message: '预览起点不存在。', nodeId: options.preview.entryId });
  }
  for (const [id, value] of Object.entries(options.preview?.variables ?? {})) {
    const variable = project.variables.find(item => item.id === id);
    const expected = variable?.type === 'number' ? 'number' : variable?.type === 'boolean' ? 'boolean' : 'string';
    if (!variable || typeof value !== expected || (typeof value === 'number' && !Number.isFinite(value))) {
      result.diagnostics.push({ severity: 'error', message: `预览变量 ${id} 不存在或类型不匹配。` });
    }
  }
  if (result.diagnostics.some(item => item.severity === 'error')) return result;

  const authoredBlueprints = project;
  project = interleaveProjectTimelines(timelinePlaybackLayout(project), (_, message, nodeId) => {
    result.diagnostics.push({ severity: 'error', message, nodeId });
  });
  if (result.diagnostics.some(item => item.severity === 'error')) return result;
  const storyNodes = new Map(project.nodes.map(node => [node.id, node]));
  const mayFollowFlowTransition = createFlowTransitionLookahead(project);
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const statements: string[] = ['# Generated by Visual Novel Studio. Edit the project data, not this file.'];
  const emit = (text: string, origin?: { nodeId: string; lineId?: string }) => {
    statements.push(text);
    if (origin) {
      result.sourceMap[`game/story.rpy:${statements.length}`] = { ...origin };
      result.sourceMap[`story.rpy:${statements.length}`] = { ...origin };
    }
  };
  const assetPath = (id: string) => pythonLiteral(assets.get(id)!.path.replaceAll('\\', '/'));
  const callSites = new Map<string, number>();
  const callSite = (id: string) => { const count = callSites.get(id) ?? 0; callSites.set(id, count + 1); return count ? `${id}_${count}` : id; };
  const queueTransition = (target: string | undefined, origin: { nodeId: string; lineId?: string }, port: string, indent = '    ') => {
    const node = storyNodes.get(origin.nodeId);
    const transition = node && storyTransition(node, port);
    if (target && transition !== undefined) emit(`${indent}$ vn_flow_transition_queue(${pythonLiteral(transition)}, ${pythonLiteral(origin.nodeId)}, ${pythonLiteral(port)})`, origin);
  };
  const go = (target: string | undefined, origin: { nodeId: string; lineId?: string }, indent = '    ', port: string | null = 'next') => {
    if (port !== null) queueTransition(target, origin, port, indent);
    emit(`${indent}jump ${target ? nodeLabel(target) : 'vn_finish'}`, origin);
  };
  const flushTransition = (origin: { nodeId: string; lineId?: string }, indent = '    ') => {
    emit(`${indent}$ vn_actor_flush()`, origin);
    emit(`${indent}if vn_game_flow_transition_holding():`, origin);
    emit(`${indent}    $ renpy.checkpoint(hard=False)`, origin);
    emit(`${indent}$ vn_flow_transition_flush()`, origin);
    emit(`${indent}$ vn_performance_reveal()`, origin);
    emit(`${indent}$ vn_apply_scene_transition()`, origin);
  };
  const pause = (seconds: string | number, origin: { nodeId: string; lineId?: string }, indent = '    ') => {
    emit(`${indent}$ vn_actor_flush()`, origin);
    emit(`${indent}if vn_game_flow_transition_holding():`, origin);
    emit(`${indent}    $ renpy.checkpoint(hard=False)`, origin);
    emit(`${indent}$ vn_flow_transition_flush()`, origin);
    // Record the wait as the resume point, not the earlier story/graph entry.
    // Retained interaction state must not replay pre-wait side effects on load.
    emit(`${indent}$ renpy.checkpoint(hard=False)`, origin);
    emit(`${indent}if vn_performance_active or vn_performance_transition:`, origin);
    emit(`${indent}    $ vn_performance_pause(${seconds})`, origin);
    emit(`${indent}elif vn_bp_task is not None:`, origin);
    emit(`${indent}    $ vn_bp_pause(${seconds})`, origin);
    emit(`${indent}else:`, origin);
    emit(`${indent}    pause ${seconds}`, origin);
  };
  const stage = (action: StageAction, origin: { nodeId: string; lineId?: string }, indent = '    ', layerExpression?: string) => {
    const write = (text: string) => emit(`${indent}${text}`, origin);
    if (!['show', 'hide', 'background', 'blueprint', 'effect', 'characterFeature'].includes(action.kind)) write('$ vn_actor_flush()');
    const timing = actionTiming(action);
    if (timing.duration > 0 && !['pause', 'music', 'stopMusic'].includes(action.kind)) write(`$ vn_performance_extend(${timing.duration + (action.kind === 'show' ? afterOffsetDuration(action.afterOffsets) : 0)})`);
    switch (action.kind) {
      case 'hideVisual':
        write(`$ vn_visual_wait = vn_hide_visual(${pythonLiteral(action.instanceId)}, ${pythonLiteral(action.exitTransition ?? null)})`);
        if (action.wait !== false) { write('if vn_visual_wait:'); pause('vn_visual_wait', origin, indent + '    '); }
        break;
      case 'visual': {
        const expanded = applyVisualInputs(materializeVisualCompositions(project, action), {});
        const data = { ...expanded, path: project.assets.find(asset => asset.id === expanded.assetId)?.path.replaceAll('\\', '/'), fontPath: project.assets.find(asset => asset.id === (expanded.fontAssetId ?? project.ui.fontAssetId))?.path.replaceAll('\\', '/') ?? 'fonts/SourceHanSansLite.ttf' };
        write(`$ vn_visual_wait = vn_show_visual(${pythonLiteral(data)})`);
        if (action.wait || action.transitionWait) { write('if vn_visual_wait:'); flushTransition(origin, indent + '    '); pause('vn_visual_wait', origin, indent + '    '); }
        break;
      }
      case 'background':
        write('if vn_has_persistent_actors():');
        write(`    $ vn_bp_background(${pythonLiteral(action.assetId)})`);
        write('else:');
        write(`    scene vn_background_${action.assetId}`);
        write('    $ vn_actor_instances.clear()');
        write('    $ vn_actor_reset_transitions(keep_overrides=True)');
        write(`$ vn_unlock(${pythonLiteral(action.assetId)})`);
        break;
      case 'show': {
        if (!action.characterId || !action.expressionId) {
          const duration = action.duration ?? (action.transition === 'fade' ? 1 : .5);
          write(`if vn_bp_show_speaker(${pythonLiteral(action.expressionId)}, ${action.x}, ${action.y}, ${action.scale}, ${layerExpression ?? action.layer}, preset_id=${pythonLiteral(action.presetId ?? '')}, instance_id=${pythonLiteral(action.instanceId ?? '')}, lifetime=${pythonLiteral(action.lifetime ?? '')}, move_duration=${action.transition === 'move' ? duration : 'None'}, offset_duration=${action.transition === 'none' ? 0 : duration}, move_offsets=${pythonLiteral(action.moveOffsets)}, after_offsets=${pythonLiteral(action.afterOffsets)}, transitions=${pythonLiteral(action.actorTransitions)}, wait=${pythonLiteral(action.wait !== false)}, transition_mode=${pythonLiteral(action.transition)}, transition_duration=${duration}, character_id=${pythonLiteral(action.characterId)}):`);
          write('    if vn_bp_character_label(' + (action.characterId ? pythonLiteral(action.characterId) : 'vn_current_speaker') + '):');
          write(`        call expression vn_bp_character_label(${action.characterId ? pythonLiteral(action.characterId) : 'vn_current_speaker'}) from ${callSite('vn_show_current_character')}`);
          if (action.transition === 'move' && action.wait !== false && duration > 0) { write('    if not vn_actor_last_modern:'); flushTransition(origin, indent + '        '); pause(duration, origin, indent + '        '); }
          else if (action.transition !== 'none' && action.transition !== 'move') {
            write('    if vn_pending_scene_transition is None and vn_performance_transition is None and not vn_flow_transition_pending() and not vn_actor_last_modern:');
            const transition = appearanceTransition(action.transition, String(duration));
            write(action.wait === false ? `        $ renpy.transition(${transition}, layer="master")` : `        $ vn_actor_legacy_transition(${transition}, ${duration})`);
          }
          return;
        }
        const character = effectiveCharacter(project, action.characterId)!;
        const expression = character.expressions.find(item => item.id === action.expressionId)!;
        const placement = resolveShowAction(project, action);
        write('$ vn_actor_last_modern = False');
        write(`$ vn_actor_pending_exit.pop(${pythonLiteral(actorTag(action))}, None)`);
        write(`if vn_actor_rules(${pythonLiteral(action.characterId)}, ${pythonLiteral(action.actorTransitions)}, ${pythonLiteral(action.transition)}, ${action.duration ?? (action.transition === 'fade' ? 1 : .5)}, ${pythonLiteral(action.lifetime ?? '')} or vn_actor_instances.get(${pythonLiteral(actorTag(action))}, {}).get("lifetime", "")) is not None:`);
        write(`    $ vn_bp_show(${pythonLiteral(action.characterId)}, ${pythonLiteral(action.expressionId)}, ${placement.x}, ${placement.y}, ${placement.scale}, ${layerExpression ?? action.layer}, instance_id=${pythonLiteral(action.instanceId ?? '')}, lifetime=${pythonLiteral(action.lifetime ?? '')}, move_offsets=${pythonLiteral(action.moveOffsets)}, after_offsets=${pythonLiteral(action.afterOffsets)}, transitions=${pythonLiteral(action.actorTransitions)}, wait=${pythonLiteral(action.wait !== false)}, transition_mode=${pythonLiteral(action.transition)}, transition_duration=${action.duration ?? (action.transition === 'fade' ? 1 : .5)})`);
        write('else:');
        write(`    show vn_actor_${action.characterId} ${action.expressionId}${action.instanceId ? ` as ${actorTag(action)}` : ''} at ${action.transition === 'move' && (action.moveOffsets || action.afterOffsets) ? `vn_move_offsets(${pythonLiteral(actorTag(action))}, ${placement.x}, ${placement.y}, ${placement.scale}, ${action.duration ?? .5}, ${pythonLiteral(action.moveOffsets ?? {})}, ${pythonLiteral(action.afterOffsets ?? {})})` : action.transition === 'move' ? `vn_move_stage(${placement.x}, ${placement.y}, ${placement.scale}, ${action.duration ?? .5})` : (action.moveOffsets || action.afterOffsets) ? `vn_show_offsets(${placement.x}, ${placement.y}, ${placement.scale}, ${action.transition === 'none' ? 0 : action.duration ?? (action.transition === 'fade' ? 1 : .5)}, ${pythonLiteral(action.moveOffsets ?? {})}, ${pythonLiteral(action.afterOffsets ?? {})})` : `vn_stage(${placement.x}, ${placement.y}, ${placement.scale})`} zorder ${layerExpression ? '(' + layerExpression + ')' : action.layer}`);
        write(`    $ vn_track_actor(${pythonLiteral(action.characterId)}, ${pythonLiteral(action.expressionId)}, ${layerExpression ?? action.layer}, ${pythonLiteral(action.instanceId ?? '')}, ${pythonLiteral(action.lifetime ?? '')})`);
        write(`$ vn_unlock(${pythonLiteral(expression.assetId)})`);
        if (character.blueprintId) write(`call vn_blueprint_${character.blueprintId} from ${callSite(`vn_character_blueprint_${action.characterId}`)}`);
        break;
      }
      case 'hide': write(`$ vn_bp_hide(${pythonLiteral(action.characterId)}, ${pythonLiteral(action.instanceId ?? '')}, ${pythonLiteral({ mode: action.transition, duration: action.duration ?? (action.transition === 'fade' ? 1 : .5) })}, ${pythonLiteral(action.wait !== false)})`); break;
      case 'audioClip': write(`$ vn_audio_clip_play(${pythonLiteral(action)})`); if (action.wait) pause(action.duration, origin, indent); break;
      case 'music': write(`play music ${assetPath(action.assetId)} ${action.loop ? 'loop' : 'noloop'} fadein ${action.fade}`); break;
      case 'sound': write(`play sound ${assetPath(action.assetId)}`); break;
      case 'unlock': write(`$ vn_unlock(${pythonLiteral(action.assetId)})`); break;
      case 'stopMusic': write(`stop music fadeout ${action.fade}`); break;
      case 'pause': flushTransition(origin, indent); pause(action.seconds, origin, indent); break;
      case 'hideInterface': write('$ vn_set_interface_visible(False)'); break;
      case 'showInterface': write('$ vn_set_interface_visible(True)'); break;
      case 'startDialogue': flushTransition(origin, indent); write('$ vn_start_dialogue()'); break;
      case 'animate': {
        write('$ vn_flow_transition_flush()');
        const transform = transformName(action);
        if (action.instanceId) write(`$ vn_animate_instance(${pythonLiteral(action.characterId)}, ${pythonLiteral(action.instanceId)}, ${transform})`);
        else {
          write(`if vn_actor_instances.get(${pythonLiteral(actorTag(action))}, {}).get("transitions") is not None:`);
          write(`    $ vn_animate_instance(${pythonLiteral(action.characterId)}, "", ${transform})`);
          write('else:');
          write(`    show vn_actor_${action.characterId} at ${transform}`);
        }
        if (action.wait && !action.repeat) { flushTransition(origin, indent); pause(actorAnimationDuration(action), origin, indent); }
        break;
      }
      case 'camera': {
        write('$ vn_flow_transition_flush()');
        const transform = transformName(action);
        write(`camera master at ${transform}`);
        if (action.wait && cameraAnimationDuration(action)) { flushTransition(origin, indent); pause(cameraAnimationDuration(action), origin, indent); }
        break;
      }
      case 'shake':
        flushTransition(origin, indent);
        write(`show layer master at vn_blueprint_shake(${pythonLiteral(action.direction)}, ${action.duration ?? 0.6}, ${action.amplitude ?? 20})`);
        if (action.wait !== false) pause(action.duration ?? 0.6, origin, indent);
        break;
      case 'effect':
      case 'characterFeature':
        for (const nested of expandStageAction(project, action)) stage(nested, origin, indent);
        break;
      case 'blueprint': {
        const args = Object.entries((action.inputs ?? {})).map(([id, value]) => `vn_bp_in_${action.blueprintId}_${id}=${pythonLiteral(value)}`).join(', ');
        if (action.actorTransitions) write(`$ vn_actor_transition_overrides.append(${pythonLiteral(action.actorTransitions)})`);
        write(`call vn_blueprint_${action.blueprintId}${args ? `(${args})` : ''} from ${callSite(`vn_blueprint_call_${action.blueprintId}`)}`);
        if (action.actorTransitions) write('$ vn_actor_transition_overrides.pop()');
        break;
      }
      case 'chapter':
        if (action.soundId) write(`$ renpy.music.play(${assetPath(action.soundId)}, channel="sound", loop=False)`);
        write('if not renpy.is_skipping() and not (vn_performance_active and vn_performance_skipped):');
        {
          const args = `title=${renpyText(action.title)}, subtitle=${renpyText(action.subtitle)}, duration=${action.duration}, effect=${pythonLiteral(action.effect)}, background=${action.backgroundId ? assetPath(action.backgroundId) : 'None'}, title_image=${action.titleImageId ? assetPath(action.titleImageId) : 'None'}`;
          const show = `$ renpy.show_screen("vn_chapter_title", ${args}, _vn_wait=False, _vn_layer="master", _layer="master", _zorder=${layerExpression ?? action.layer ?? 80})`;
          if (action.wait === false) { write(`    ${show}`); flushTransition(origin, indent + '    '); }
          else {
            write('    if vn_performance_active or vn_performance_transition or vn_flow_transition_holding():');
            write(`        ${show}`);
            flushTransition(origin, indent + '        ');
            write(`        $ vn_performance_pause(${action.duration})`);
            write('        hide screen vn_chapter_title onlayer master');
            write('    else:');
            write(`        call screen vn_chapter_title(${args})`);
          }
        }
        break;
    }
    if (action.kind === 'show' && action.transition === 'move') {
      if (action.wait !== false && (action.duration ?? .5) > 0) { write('if not vn_actor_last_modern:'); flushTransition(origin, indent + '    '); pause(action.duration ?? .5, origin, indent + '    '); }
    } else if ('transition' in action && action.transition !== 'none') {
      write('if vn_pending_scene_transition is None and vn_performance_transition is None and not vn_flow_transition_pending()' + (action.kind === 'show' || action.kind === 'hide' ? ' and not vn_actor_last_modern' : '') + ':');
      const expression = action.duration === undefined ? action.transition : appearanceTransition(action.transition, String(action.duration));
      write(action.wait === false ? `    $ renpy.transition(${expression}, layer="master")` : `    $ vn_actor_legacy_transition(${expression}, ${action.duration ?? (action.transition === 'fade' ? 1 : .5)})`);
    }
  };

  for (const variable of project.variables) emit(`default ${variableReference(project, variable.id)} = ${pythonLiteral(variable.initial)}`);
  emit('default persistent.vn_unlocks = []');
  emit('default vn_current_node = None');
  emit('default vn_current_line = None');
  emit('default vn_current_speaker = None');
  emit('default vn_interaction_remaining = 0.0');
  emit('default vn_interaction_result = None');
  emit('default vn_minigame_answer = ""');
  emit('default vn_minigame_remaining = 0');
  emit('default vn_minigame_clicks = 0');
  emit('default vn_minigame_time_left = 0.0');
  emit('default vn_minigame_result = None');
  emit('default vn_pending_scene_transition = None');
  emit('default vn_current_scene = None');
  emit('default vn_scene_parameters = {}');
  // Exposed blueprint outputs live in the Ren'Py store so a call node can
  // expose typed data pins to the rest of the caller graph. They are reset at
  // every graph invocation below, which also makes an unconnected output
  // deterministic instead of leaking the previous call's value.
  for (const graph of projectGraphs(project) ?? []) {
    for (const pin of graph.exposedOutputs) emit(`default vn_bp_out_${graph.id}_${pin.id} = ${pythonLiteral(pin.defaultValue)}`);
    for (const node of graph.nodes) {
      if (node.type === 'callFunction' || node.type === 'callMacro') {
        const called = projectGraphs(project)?.find(item => item.id === node.properties.graphId);
        for (const pin of called?.exposedOutputs ?? []) emit(`default vn_bp_result_${node.id}_${pin.id} = ${pythonLiteral(pin.defaultValue)}`);
      }
    }
  }
  emit('');
  emit(`define narrator = Character(None, voice_tag="vn_voice_other"${continueIndicator(project)})`);
  const speakerColor = effectiveUiComponents(project.ui).find(component => component.binding === 'speaker')?.style?.textColor;
  for (const character of project.characters) {
    const effective = effectiveCharacter(project, character.id)!;
    emit(`define vn_character_${character.id} = Character(${renpyText(character.name)}, color=${pythonLiteral(speakerColor ?? character.color)}, voice_tag=${pythonLiteral(`vn_voice_${character.id}`)}${continueIndicator(project)})`);
    for (const expression of effective.expressions) emit(`image vn_actor_${character.id} ${expression.id} = ${assetPath(expression.assetId)}`);
  }
  for (const asset of project.assets.filter(item => item.kind === 'image')) {
    emit(`image vn_background_${asset.id} = Transform(${assetPath(asset.id)}, xysize=(${project.width}, ${project.height}), fit="cover")`);
  }
  emit('');
  emit('transform vn_stage(x, y, scale):');
  emit('    xpos float(x)');
  emit('    ypos float(y)');
  emit('    xanchor 0.5');
  emit('    yanchor 1.0');
  emit('    rotate_pad False transform_anchor True');
  emit('    zoom scale');
  emit('');
  const transforms = new Set<string>();
  emit('transform vn_move_stage(x, y, scale, duration):');
  emit('    subpixel True');
  emit('    xanchor 0.5 yanchor 1.0');
  emit('    rotate_pad False transform_anchor True');
  emit('    on show:');
  emit('        xpos (float(x) - 0.15) ypos float(y) zoom float(scale) rotate 0 alpha 0.0');
  emit('        function vn_flow_transition_atl_gate');
  emit('        easein duration xpos float(x) ypos float(y) zoom float(scale) alpha 1.0');
  emit('    on replace:');
  emit('        rotate 0');
  emit('        function vn_flow_transition_atl_gate');
  emit('        easein duration xpos float(x) ypos float(y) zoom float(scale) alpha 1.0');
  emit('');
  const allActions = [
    ...project.scenes.flatMap(scene => effectiveScene(project, scene.id)?.entryActions ?? []),
    ...project.nodes.flatMap(node => node.kind === 'passage' ? node.lines.flatMap(line => line.actions) : []),
    ...(projectGraphs(project) ?? []).flatMap(graph => graph.nodes.flatMap(node => {
      if (node.type === 'effect' && typeof node.properties.effectId === 'string') return [{ kind: 'effect' as const, effectId: node.properties.effectId }];
      const action = node.type === 'savedAction' ? savedBlueprintAction(node) : node.type === 'sceneAction' ? textCommandAction(project, String(node.properties.command ?? '')) : undefined;
      return action ? [action] : [];
    })),
  ].flatMap(action => expandStageAction(project, action));
  for (const action of allActions) {
    const transform = transformName(action);
    if (transforms.has(transform)) continue;
    transforms.add(transform);
    if (action.kind === 'animate') {
      emit(`transform ${transform}:`);
      emit('    subpixel True');
      emit('    xanchor 0.5 yanchor 1.0');
      emit('    rotate_pad False transform_anchor True');
      if (!Object.keys(action.curves ?? {}).length) {
        for (const frame of action.keyframes) emit(`    ${atlEasing(frame.easing)} ${frame.duration} xpos ${Number(frame.x).toFixed(6)} ypos ${Number(frame.y).toFixed(6)} zoom ${frame.scale} rotate ${frame.rotation} alpha ${frame.opacity}`);
      } else {
        const properties = { x: 'xpos', y: 'ypos', scale: 'zoom', rotation: 'rotate', opacity: 'alpha' }, duration = actorAnimationDuration(action);
        emit('    parallel:');
        for (const frame of action.keyframes) {
          const values = actorCurveProperties.filter(key => !action.curves?.[key]?.length).map(key => `${properties[key]} ${key === 'x' || key === 'y' ? Number(frame[key]).toFixed(6) : frame[key]}`).join(' ');
          emit(values ? `        ${atlEasing(frame.easing)} ${frame.duration} ${values}` : `        pause ${frame.duration}`);
        }
        const baseDuration = action.keyframes.reduce((sum, frame) => sum + frame.duration, 0);
        if (baseDuration < duration) emit(`        pause ${duration - baseDuration}`);
        for (const property of actorCurveProperties) {
          const frames = [...(action.curves?.[property] ?? [])].sort((a, b) => a.at - b.at); if (!frames.length) continue;
          emit('    parallel:'); emit(`        ${properties[property]} ${property === 'x' || property === 'y' ? Number(frames[0].value).toFixed(6) : frames[0].value}`);
          if (frames[0].at) emit(`        pause ${frames[0].at}`);
          frames.slice(1).forEach((frame, index) => emit(`        ${atlEasing(frame.easing)} ${frame.at - frames[index].at} ${properties[property]} ${property === 'x' || property === 'y' ? Number(frame.value).toFixed(6) : frame.value}`));
          if (frames.at(-1)!.at < duration) emit(`        pause ${duration - frames.at(-1)!.at}`);
        }
      }
      if (action.repeat) emit('    repeat');
      emit('');
    }
    if (action.kind === 'camera') {
      emit(`transform ${transform}:`);
      emit('    subpixel True');
      emit('    align (0.5, 0.5)');
      if (!Object.keys(action.curves ?? {}).length) emit(`    ${atlEasing(action.easing)} ${action.duration} xoffset ${action.x * project.width} yoffset ${action.y * project.height} zoom ${action.zoom} rotate ${action.rotation}`);
      else {
        const properties = { x: 'xoffset', y: 'yoffset', zoom: 'zoom', rotation: 'rotate' };
        const units = { x: project.width, y: project.height, zoom: 1, rotation: 1 }, duration = cameraAnimationDuration(action);
        emit('    parallel:');
        const values = cameraCurveProperties.filter(key => !action.curves?.[key]?.length).map(key => `${properties[key]} ${action[key] * units[key]}`).join(' ');
        emit(values ? `        ${atlEasing(action.easing)} ${action.duration} ${values}` : `        pause ${action.duration}`);
        if (action.duration < duration) emit(`        pause ${duration - action.duration}`);
        for (const key of cameraCurveProperties) {
          const frames = [...(action.curves?.[key] ?? [])].sort((a, b) => a.at - b.at); if (!frames.length) continue;
          emit('    parallel:'); emit(`        ${properties[key]} ${frames[0].value * units[key]}`);
          if (frames[0].at) emit(`        pause ${frames[0].at}`);
          frames.slice(1).forEach((frame, index) => emit(`        ${atlEasing(frame.easing)} ${frame.at - frames[index].at} ${properties[key]} ${frame.value * units[key]}`));
          if (frames.at(-1)!.at < duration) emit(`        pause ${duration - frames.at(-1)!.at}`);
        }
      }
      emit('');
    }
  }
  emit('init python:');
  emit('    def vn_apply_scene_transition():');
  emit('        global vn_pending_scene_transition');
  emit('        if vn_pending_scene_transition is None:');
  emit('            return');
  emit('        transition = vn_pending_scene_transition');
  emit('        vn_pending_scene_transition = None');
  emit('        if vn_flow_transition_legacy_pending:');
  emit('            renpy.retain_after_load()');
  emit('        duration = transition["duration"]');
  emit('        if transition["mode"] == "dissolve" and duration > 0:');
  emit('            vn_stage_transition(Dissolve(duration), duration)');
  emit('        elif transition["mode"] == "fade" and duration > 0:');
  emit('            vn_stage_transition(Fade(duration / 2.0, 0.0, duration / 2.0, color=transition["color"]), duration)');
  emit('        else:');
  emit('            renpy.with_statement(None)');
  emit('');
  emit('    def vn_unlock(asset_id):');
  emit('        if asset_id not in persistent.vn_unlocks:');
  emit('            persistent.vn_unlocks = persistent.vn_unlocks + [asset_id]');
  emit('            renpy.save_persistent()');
  emit('');
  // Running events map to the task that owns them. An ordinary event stays busy
  // while its owner lives, so a page its own handler opened (such as a second
  // confirmation) cannot run it again; a closed page's run does not block a new page.
  // Page-show callbacks belong to their page, like lifecycle callbacks, so two pages
  // that share a show graph each run it.
  emit('    vn_running_blueprint_events = {}');
  emit('    def vn_run_blueprint(blueprint_id, event_id=None, event_values=None, page_id=None, lifecycle_context=None, show=False):');
  emit('        label = str(blueprint_id) + ("__" + str(event_id) if event_id else "")');
  emit('        task = dict(page=None, pageToken=None, minigame=None, flow=None) if (lifecycle_context or {}).get("phase") == "closed" else vn_bp_task_create(page_id)');
  emit('        key = (label, task.get("page"), task.get("pageToken"), task.get("minigame"), (task.get("flow") or {}).get("token"), (lifecycle_context or {}).get("phase") or ("show" if show else None), (lifecycle_context or {}).get("key"))');
  emit('        busy = not lifecycle_context and not show and any(other[0] == label and other[5] is None and vn_bp_task_alive(owner) for other, owner in vn_running_blueprint_events.items())');
  emit('        if key in vn_running_blueprint_events or busy or not vn_bp_task_alive(task):');
  emit('            return');
  emit('        focus = vn_ui_focus_snapshot()');
  emit('        parents = list(renpy.game.contexts)');
  emit('        audio_changes = {}');
  emit('        vn_running_blueprint_events[key] = task');
  emit('        frame_ids = set(vn_bp_live_frames)');
  emit('        try:');
  emit('            renpy.call_in_new_context("vn_ui_blueprint_call", label, audio_changes, event_values or {}, vn_bp_task=task, vn_ui_lifecycle_context=lifecycle_context, _clear_layers=False)');
  emit('        finally:');
  emit('            vn_running_blueprint_events.pop(key, None)');
  emit('            vn_bp_close_label_frames_since(frame_ids)');
  emit('        for context in parents:');
  emit('            context.music = dict(context.music, **audio_changes)');
  emit('        renpy.restart_interaction()');
  emit('        if vn_bp_task_alive(task):');
  emit('            vn_ui_restore_focus(focus)');
  emit('        return vn_ui_native_dispatch_navigation() if (lifecycle_context or {}).get("phase") != "closed" else None');
  if (options.development) {
    const variables = project.variables.map(variable => `${pythonLiteral(variable.id)}: ${variableReference(project, variable.id)}`).join(', ');
    emit('');
    emit('    def _vn_debug_emit():');
    emit('        import json');
    emit('        if "vn_current_node" not in globals() or "vn_current_line" not in globals():');
    emit('            return');
    emit(`        state = {"nodeId": vn_current_node, "lineId": vn_current_line, "variables": {${variables}}}`);
    emit('        message = json.dumps(state, ensure_ascii=True, sort_keys=True, separators=(",", ":"))');
    emit('        if message != getattr(_vn_debug_emit, "_last", None):');
    // Function attributes are outside Ren'Py store rollback, so restored states emit again.
    emit('            _vn_debug_emit._last = message');
    emit('            print("VNS_EVENT:" + message, flush=True)');
    emit('');
    emit('    config.interact_callbacks.append(_vn_debug_emit)');
  }
  emit('');
  // Compile reusable UE-style graphs into callable Ren'Py labels. The graph
  // editor stores typed links; the exporter follows execution pins and emits
  // the small set of side effects that are meaningful to a visual novel.
  const blueprintGraphs = projectGraphs(project) ?? [];
  // A UI callback needs a second interaction context for dialogs and waits.
  // Preserve authored audio changes when that context and its menu return.
  // Voice is excluded: Ren'Py stops dialogue voice while opening menus itself.
  emit('label vn_ui_blueprint_call(vn_ui_graph_id, vn_ui_audio_changes, vn_ui_event_values=None, vn_ui_audio_before=None, vn_bp_task=None, vn_bp_wait=None, vn_ui_lifecycle_context=None):');
  emit('    $ vn_ui_audio_before = dict(renpy.game.context().music)');
  emit('    call expression "vn_blueprint_" + vn_ui_graph_id pass (**({"vn_bp_event_values": vn_ui_event_values} if vn_ui_event_values else {}))');
  emit('    $ vn_ui_audio_changes.update({key: value for key, value in renpy.game.context().music.items() if key in ("music", "sound", "ambient") and value is not vn_ui_audio_before.get(key)})');
  emit('    return');
  emit('');
  for (const line of createBlueprintRuntime(project).split('\n')) emit(line);
  for (const line of blueprintTaskRuntime.split('\n')) emit(line);
  for (const line of blueprintInvocationRuntime.split('\n')) emit(line);
  for (const line of blueprintAsyncRuntime.split('\n')) emit(line);
  for (const line of createBlueprintStateRuntime(project).split('\n')) emit(line);
  for (const line of createUiPageInterfaceRuntime(project).split('\n')) emit(line);
  for (const line of blueprintFlowControlRuntime.split('\n')) emit(line);
  for (const line of blueprintNumericRuntime.split('\n')) emit(line);
  for (const line of blueprintChoiceRuntime.split('\n')) emit(line);
  for (const line of createPerformancePlaybackRuntime().split('\n')) emit(line);
  for (const line of createFlowTransitionRuntime().split('\n')) emit(line);
  for (const line of createActorTransitionsRuntime().split('\n')) emit(line);
  const blueprintById = new Map(blueprintGraphs.map(graph => [graph.id, graph]));
  if (debug) {
    const sources = createBlueprintPlaybackOrigins(authoredBlueprints, project);
    const metadata = blueprintGraphs.flatMap(graph => graph.nodes.map(node => {
      const variable = node.type === 'setVariable' ? blueprintStateVariable(project, graph, node) : undefined;
      return '(' + pythonLiteral(graph.id) + ', ' + pythonLiteral(node.id) + '): ' + pythonLiteral({ type: node.type, event: node.type.startsWith('event'), componentId: node.properties.componentId, trigger: node.properties.event ?? node.properties.trigger ?? node.type, scope: variable ? blueprintStateScope(project, node) : undefined, variableId: variable?.id });
    }));
    const slots: Record<string, string[]> = {};
    for (const graph of blueprintGraphs) for (const node of graph.nodes) {
      if (node.type === 'forLoop') slots['vn_bp_index_' + node.id] = [graph.id, node.id, 'index'];
      if (isBlueprintTaskLaunch(node.type)) slots['vn_bp_task_handle_' + node.id] = [graph.id, node.id, 'handle'];
      if (node.type === 'focusUiComponent') slots['vn_bp_focus_accepted_' + node.id] = [graph.id, node.id, 'accepted'];
      if (node.type === 'cancelTask') slots['vn_bp_task_cancelled_' + node.id] = [graph.id, node.id, 'cancelled'];
      if (node.type === 'setOutput') slots['vn_bp_out_' + graph.id + '_' + node.properties.outputId] = [graph.id, '', String(node.properties.outputId)];
      for (const pin of node.pins.filter(pin => pin.direction === 'output' && pin.dataType !== 'exec')) {
        if (node.type === 'showUiPage') slots['vn_bp_page_' + pin.id + '_' + node.id] = [graph.id, node.id, pin.id];
        if (['callFunction', 'callMacro', 'waitTask'].includes(node.type) && pin.id.startsWith('out_')) slots['vn_bp_result_' + node.id + '_' + pin.id.slice(4)] = [graph.id, node.id, pin.id];
      }
    }
    emit('init python:'); emit('    vn_bp_debug_nodes = {' + metadata.join(', ') + '}'); emit('    vn_bp_debug_slots = ' + pythonLiteral(slots));
    const originLines = pythonBlockLiteral({ graphs: sources.graphs, nodes: sources.nodes }, 1).split('\n');
    emit('    vn_bp_debug_origins = ' + originLines[0]);
    originLines.slice(1).forEach(line => emit(line));
    result.files['game/98-blueprint-debug.rpy'] = blueprintDebugRuntime;
  }
  const observeInput = (graph: BlueprintGraph, node: BlueprintNode, pin: string, expression: string, source?: { node: string; pin: string }) => debug
    ? 'vn_bp_debug_value(' + [pythonLiteral(graph.id), pythonLiteral(node.id), pythonLiteral(pin), expression, ...(source ? [pythonLiteral(source.node), pythonLiteral(source.pin)] : [])].join(', ') + ')'
    : expression;
  const nextBlueprint = (graph: BlueprintGraph, node: BlueprintNode, pinId?: string) => {
    const link = graph.links.find(item => item.fromNodeId === node.id && (!pinId || item.fromPinId === pinId)
      && node.pins.some(pin => pin.id === item.fromPinId && pin.direction === 'output' && pin.dataType === 'exec'));
    const target = link && graph.nodes.find(item => item.id === link.toNodeId);
    return link && target ? { node: target, pin: link.toPinId, fromPin: link.fromPinId } : undefined;
  };

  const invocationValue = (name: string) => `vn_bp_local(${pythonLiteral(name)})`;
  // Data links are evaluated separately from execution links. Keeping this
  // resolver small and pure makes linked literals, variables, and math nodes
  // usable by executable nodes without introducing a second runtime graph.
  const blueprintDataExpression = (graph: BlueprintGraph, node: BlueprintNode, pinId: string, visited = new Set<string>()): string | undefined => {
    const incoming = graph.links.find(link => link.toNodeId === node.id && link.toPinId === pinId);
    if (!incoming) {
      const value = blueprintInputValue(node, pinId);
      return value === undefined ? undefined : observeInput(graph, node, pinId, pythonLiteral(value));
    }
    const source = graph.nodes.find(item => item.id === incoming.fromNodeId);
    if (!source || visited.has(`${source.id}:${incoming.fromPinId}`)) return undefined;
    const nextVisited = new Set(visited).add(`${source.id}:${incoming.fromPinId}`);
    const expression = (() => { switch (source.type) {
      case 'eventPage': case 'eventValueChanged': case 'eventTextCommitted': case 'eventImage': case 'eventVideo': case 'eventSpine': return `((vn_bp_event_values or {}).get(${pythonLiteral(source.id)}, {}).get(${pythonLiteral(incoming.fromPinId)}, ${pythonLiteral(source.pins.find(p=>p.id===incoming.fromPinId)?.defaultValue)}))`;
      case 'literal': return pythonLiteral(source.properties.value ?? source.properties.text ?? source.pins.find(pin => pin.id === incoming.fromPinId)?.defaultValue);
      case 'getPageInput': case 'getPageOutput': return `vn_ui_interface_get(${blueprintDataExpression(graph, source, 'pageId', nextVisited) ?? pythonLiteral(uiPageNodePageId(graph, source))}, ${pythonLiteral(source.type === 'getPageInput' ? 'inputs' : 'outputs')}, ${pythonLiteral(source.properties.parameterId)}, ${pythonLiteral(source.pins.find(pin => pin.id === 'value')?.dataType)})`;
      case 'getVariable': {
        const variable = blueprintStateVariable(project, graph, source), scope = blueprintStateScope(project, source);
        if (!variable) return undefined;
        if (scope === 'call') return `vn_bp_state_get(${pythonLiteral(graph.id)}, ${pythonLiteral(variable.id)})`;
        if (scope === 'page') return `vn_ui_state_get(${blueprintDataExpression(graph, source, 'pageId', nextVisited) ?? pythonLiteral(blueprintStatePageId(graph, source))}, ${pythonLiteral(variable.id)}, ${pythonLiteral(variable.type)})`;
        return variableReference(project, variable.id);
      }
      case 'getInput': {
        const inputId = typeof source.properties.inputId === 'string' ? source.properties.inputId : undefined;
        return inputId && graph.exposedInputs.some(pin => pin.id === inputId) ? `vn_bp_in_${graph.id}_${inputId}` : undefined;
      }
      case 'startTask': case 'debounce': return invocationValue('vn_bp_task_handle_' + source.id);
      case 'focusUiComponent': return invocationValue('vn_bp_focus_accepted_' + source.id);
      case 'cancelTask': return invocationValue('vn_bp_task_cancelled_' + source.id);
      case 'taskStatus': return 'vn_bp_async_result(' + (blueprintDataExpression(graph, source, 'handle', nextVisited) ?? pythonLiteral('')) + ')[' + pythonLiteral(incoming.fromPinId === 'reason' ? 'reason' : 'status') + ']';
      // Typed task results have the same frame-local slots as module results.
      case 'waitTask': case 'callFunction': case 'callMacro': {
        if (source.type === 'waitTask' && incoming.fromPinId === 'reason') return invocationValue('vn_bp_task_reason_' + source.id);
        const graphId = typeof source.properties.graphId === 'string' ? source.properties.graphId : undefined;
        const calledGraph = graphId ? blueprintById.get(graphId) : undefined;
        const outputId = incoming.fromPinId.startsWith('out_') ? incoming.fromPinId.slice(4) : undefined;
        return calledGraph && outputId && calledGraph.exposedOutputs.some(pin => pin.id === outputId)
          ? invocationValue(`vn_bp_result_${source.id}_${outputId}`)
          : undefined;
      }
      case 'clamp': case 'abs': case 'round': case 'inRange': case 'nearlyEqual': case 'mapRange': case 'lerp': {
        const values = blueprintNumericInputs[source.type].map(pin => {
          const value = blueprintDataExpression(graph, source, pin.id, nextVisited) ?? 'None';
          const name = pythonLiteral(source.name + ' · ' + pin.name);
          const checked = pin.dataType === 'number' ? 'vn_bp_number(' + value + ', None, None, ' + name + ')' : 'vn_bp_boolean(' + value + ', ' + name + ')';
          return pythonLiteral(pin.id) + ': ' + checked;
        }).join(', ');
        return 'vn_bp_numeric(' + pythonLiteral(source.type) + ', {' + values + '}, ' + pythonLiteral(source.properties.mode ?? 'nearest') + ')';
      }
      case 'selectByKey': {
        const definition = blueprintChoiceDefinition(source), cases = definition.cases ?? [];
        const key = blueprintDataExpression(graph, source, 'key', nextVisited) ?? 'None';
        const values = [...cases.map(item => blueprintChoicePinId(item.id)), 'default'].map(pin => pythonLiteral(pin) + ': (lambda: ' + (blueprintDataExpression(graph, source, pin, nextVisited) ?? 'None') + ')').join(', ');
        return 'vn_bp_choice_value(' + key + ', ' + pythonLiteral(definition.keyType) + ', ' + pythonLiteral(cases.map(item => [item.id, item.key])) + ', ' + pythonLiteral(definition.valueType) + ', {' + values + '})';
      }
      case 'math': {
        const left = blueprintDataExpression(graph, source, 'a', nextVisited) ?? pythonLiteral(source.properties.a ?? 0);
        const right = blueprintDataExpression(graph, source, 'b', nextVisited) ?? pythonLiteral(source.properties.b ?? 0);
        const operation = String(source.properties.operation ?? source.properties.operator ?? 'add');
        if (operation === 'min' || operation === 'max') return `${operation}(${left}, ${right})`;
        const operator = ({ add: '+', '+': '+', subtract: '-', sub: '-', '-': '-', multiply: '*', mul: '*', '*': '*', divide: '/', div: '/', '/': '/', modulo: '%', mod: '%' } as Record<string, string>)[operation] ?? '+';
        return `(${left} ${operator} ${right})`;
      }
      case 'not': case 'and': case 'or': case 'xor': {
        const boolean = (pin: string) => `vn_bp_boolean(${blueprintDataExpression(graph, source, pin, nextVisited) ?? pythonLiteral(false)}, ${pythonLiteral(source.name)})`;
        if (source.type === 'not') return `(not ${boolean('a')})`;
        return `(${boolean('a')} ${source.type === 'xor' ? '!=' : source.type} ${boolean('b')})`;
      }
      case 'compare': {
        const left = blueprintDataExpression(graph, source, 'a', nextVisited) ?? pythonLiteral(source.properties.a);
        const right = blueprintDataExpression(graph, source, 'b', nextVisited) ?? pythonLiteral(source.properties.b);
        const operator = ({ eq: '==', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' } as Record<string, string>)[String(source.properties.operator ?? 'eq')] ?? '==';
        return `(${left} ${operator} ${right})`;
      }
      case 'select': {
        const condition = blueprintDataExpression(graph, source, 'condition', nextVisited) ?? pythonLiteral(source.properties.condition ?? false);
        const yes = blueprintDataExpression(graph, source, 'true_value', nextVisited) ?? pythonLiteral(source.properties.true_value);
        const no = blueprintDataExpression(graph, source, 'false_value', nextVisited) ?? pythonLiteral(source.properties.false_value);
        return `(${yes} if ${condition} else ${no})`;
      }
      case 'forLoop': return invocationValue(`vn_bp_index_${source.id}`);
      case 'random': return `renpy.random.uniform(${blueprintDataExpression(graph, source, 'min', nextVisited) ?? '0'}, ${blueprintDataExpression(graph, source, 'max', nextVisited) ?? '1'})`;
      case 'formatText': return `str(${blueprintDataExpression(graph, source, 'format', nextVisited) ?? '"{value}"'}).replace("{value}", str(${blueprintDataExpression(graph, source, 'value', nextVisited) ?? '""'}))`;
      case 'showUiPage': return invocationValue(incoming.fromPinId.startsWith('out_') ? `vn_bp_page_${incoming.fromPinId}_${source.id}` : `vn_bp_page_${incoming.fromPinId === 'reason' ? 'reason' : 'result'}_${source.id}`);
      case 'getUiDefault': return `vn_ui_default(${blueprintDataExpression(graph, source, 'componentId', nextVisited) ?? 'None'}, ${pythonLiteral(source.properties.property ?? 'visible')})`;
      case 'getUiControlOption': return 'vn_ui_control_option(' + [blueprintDataExpression(graph, source, 'componentId', nextVisited) ?? pythonLiteral(''), blueprintDataExpression(graph, source, 'index', nextVisited) ?? '0', pythonLiteral(source.properties.valueType ?? 'string'), pythonLiteral(source.properties.optionsVersion ?? 1)].join(', ') + ')[' + pythonLiteral(incoming.fromPinId) + ']';
      case 'getUiProperty': return `vn_ui_get(${blueprintDataExpression(graph, source, 'componentId', nextVisited) ?? 'None'}, ${pythonLiteral(source.properties.property ?? 'visible')})`;
      case 'getPlayerPreference': return `vn_preference_get(${pythonLiteral(source.properties.preference)}, ${blueprintDataExpression(graph, source, 'characterId', nextVisited) ?? 'None'})`;
      case 'getMinigameValue': return `vn_minigame_get(${pythonLiteral(source.properties.key ?? 'value')}, ${pythonLiteral(source.properties.defaultValue)})`;
      default: return undefined;
    } })();
    // Guard before evaluating the value, including lazy data inputs in a nested
    // module. Reading a released control is no safer than writing one.
    const checked = expression !== undefined && uiPageClosedOperationProblem(source)
      ? `(vn_ui_lifecycle_require_operation(${pythonLiteral(source.type)}, ${pythonLiteral(source.properties.scope)}), ${expression})[1]`
      : expression;
    return checked === undefined ? undefined : observeInput(graph, node, pinId, checked, { node: source.id, pin: incoming.fromPinId });
  };

  for (const line of createBlueprintAsyncProgram(project, blueprintDataExpression).split('\n')) emit(line);

  const emitBlueprintNode = (graph: BlueprintGraph, node: BlueprintNode, visited: Set<string>, indent = '    ', entryPin = 'exec_in'): void => {
    const visitKey = node.id + ':' + entryPin;
    const origin = { nodeId: typeof node.properties.__timelineNode === 'string' ? node.properties.__timelineNode : node.id };
    if (visited.has(visitKey)) { emit(`${indent}# 蓝图循环路径在此停止。`, origin); return; }
    visited.add(visitKey);
    const nextExec = (pinId?: string) => nextBlueprint(graph, node, pinId);
    const emitNext = (target: ReturnType<typeof nextBlueprint>, seen: Set<string>, nested: string): void => { if (target) { if (debug) emit(nested + '$ vn_bp_debug_record("branch", ' + pythonLiteral(graph.id) + ', ' + pythonLiteral(node.id) + ', pinId=' + pythonLiteral(target.fromPin) + ')', origin); emitBlueprintNode(graph, target.node, seen, nested, target.pin); } };
    const layer = typeof node.properties.__timelineLayerOffset === 'number' ? `vn_bp_layer_base_${graph.id} + ${node.properties.__timelineLayerOffset}` : undefined;
    const value = (pinId: string, fallback?: VariableValue) => pinId === 'layer' && layer ? layer : blueprintDataExpression(graph, node, pinId) ?? observeInput(graph, node, pinId, pythonLiteral(fallback));
    const write = (text: string) => emit(`${indent}${text}`, origin);
    const captureLocal = (name: string, value: string, nested = '') => {
      write(`${nested}$ ${name} = ${value}`);
      write(`${nested}$ vn_bp_capture_local(${pythonLiteral(name)}, ${name})`);
    };
    const checkpoint = (nested = '') => {
      write(`${nested}if not vn_bp_task_alive(vn_bp_task):`);
      // Timeline callers consume a numeric deadline, including cancelled calls.
      write(`${nested}    $ vn_bp_leave_frame()`);
      write(`${nested}    return${graph.timeline?.tailNodeId ? ' vn_stage_clock()' : ''}`);
    };
    checkpoint();
    if (debug) write('$ vn_bp_debug_checkpoint(' + [pythonLiteral(graph.id), pythonLiteral(node.id), pythonLiteral(entryPin)].join(', ') + ')');
    write(`$ vn_ui_lifecycle_require_operation(${pythonLiteral(node.type)}, ${pythonLiteral(node.properties.scope)})`);
    if (['playMusic', 'playSound', 'stopMusic', 'uiAction', 'showUiPage', 'closeUiPage', 'setUiProperty', 'animateUiProperty', 'playUiAnimation', 'showChapter', 'camera', 'shake'].includes(node.type)) write('$ vn_actor_flush()');
    const appearance = (nested = '') => {
      const modern = ['showCharacter', 'hideCharacter'].includes(node.type);
      if (modern) { write(nested + 'if not vn_actor_last_modern:'); write(nested + '    pass'); }
      const appearanceWrite = (text: string) => write(nested + (modern ? '    ' : '') + text);
      const transition = String(node.properties.transition ?? 'none');
      if (transition === 'move' && ['showCharacter'].includes(node.type)) {
        appearanceWrite(`if ${value('wait', true)} and ${value('duration', .5)} > 0:`);
        appearanceWrite('    $ vn_flow_transition_flush()');
        appearanceWrite('    $ vn_apply_scene_transition()');
        pause(value('duration', .5), origin, indent + nested + (modern ? '        ' : '    ')); return;
      }
      const customDuration = node.properties.duration !== undefined || graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'duration');
      const duration = customDuration ? value('duration', transition === 'fade' ? 1 : .5) : String(transition === 'fade' ? 1 : .5);
      const expression = customDuration ? appearanceTransition(transition, duration) : transition;
      if (transition !== 'none') {
        appearanceWrite('if vn_pending_scene_transition is None and vn_performance_transition is None and not vn_flow_transition_pending():');
        appearanceWrite(`    if ${value('wait', true)}:`); appearanceWrite(`        $ vn_actor_legacy_transition(${expression}, ${duration})`);
        appearanceWrite('    else:'); appearanceWrite(`        $ renpy.transition(${expression}, layer="master")`);
      }
    };
    let savedAction = node.type === 'savedAction' ? rawSavedBlueprintAction(node) : undefined;
    const timelineOverrides = (node.type === 'showCharacter' || savedAction?.kind === 'show') && node.properties.__timelineActorTransitions;
    if (savedAction?.kind === 'visual') savedAction = materializeVisualCompositions(project, savedAction);
    const visualDataName = savedAction?.kind === 'visual' ? `vn_bp_visual_${node.id}` : undefined;
    const visualData = visualDataName ? invocationValue(visualDataName) : undefined;
    if (savedAction?.kind === 'visual') {
      const fields = visualInputFields(savedAction);
      const paths = Object.fromEntries(fields.map(field => [field.key, field.path]));
      const values = fields.map(field => `${pythonLiteral(field.key)}: ${value('object_' + field.key, field.value)}`).join(', ');
      captureLocal(visualDataName!, `vn_visual_with_inputs(${pythonLiteral({ ...savedAction, fontAssetId: savedAction.fontAssetId ?? project.ui.fontAssetId })}, ${pythonLiteral(paths)}, {${values}})`);
    }
    if (graph.timeline?.tailNodeId && node.id !== graph.timeline.tailNodeId) {
      const appearance = ['showBackground', 'showCharacter', 'hideCharacter'].includes(node.type);
      const saved = node.type === 'savedAction' ? savedBlueprintAction(node) : undefined;
      const seconds = appearance ? node.properties.transition === 'none' ? '0' : value('duration', node.properties.transition === 'fade' ? 1 : .5)
        : node.type === 'showChapter' ? value('duration', 4.2) : node.type === 'camera' ? value('duration', .5) : node.type === 'shake' ? value('duration', .6)
        : ['playMusic', 'stopMusic'].includes(node.type) ? value('fade', .3)
        : saved?.kind === 'audioClip' ? `vn_audio_clip_inputs(${pythonLiteral(saved)}, {${audioClipFields(saved).map(field => `${pythonLiteral(field.key)}: ${value('clip_' + field.key, field.value)}`).join(', ')}})["duration"]` : saved?.kind === 'show' ? String(saved.transition === 'none' ? 0 : saved.duration ?? (saved.transition === 'fade' ? 1 : .5)) : saved?.kind === 'visual' ? `${visualData}["duration"]` : saved?.kind === 'animate' ? String(actorAnimationDuration(saved)) : saved?.kind === 'camera' ? String(cameraAnimationDuration(saved)) : undefined;
      if (seconds) {
        write(`$ vn_bp_timeline_end_${graph.id} = max(vn_bp_timeline_end_${graph.id}, vn_stage_clock() + max(0.0, float(${seconds})) + ${saved?.kind === 'show' ? afterOffsetDuration(saved.afterOffsets) : ['showCharacter'].includes(node.type) ? afterOffsetDuration(nodeAfterOffsets(node)) : 0})`);
        write(`$ vn_game_flow_source_extend(vn_bp_timeline_end_${graph.id})`);
      }
    }
    if (node.type === 'throttle') {
      const slot = 'vn_bp_throttle_' + node.id;
      captureLocal(slot, 'vn_bp_throttle(' + [pythonLiteral(node.properties.scope), blueprintTaskScope(node) === 'page' ? value('pageId', blueprintTaskPageId(graph, node)) : 'None', pythonLiteral(graph.id), pythonLiteral(node.id), pythonLiteral(entryPin), value('seconds', .3)].join(', ') + ')');
      for (const [index, pin] of blueprintExecutionOutputs(node, entryPin).entries()) { write((index ? 'elif' : 'if') + ' ' + invocationValue(slot) + ' == ' + pythonLiteral(pin) + ':'); emitNext(nextExec(pin), new Set(visited), indent + '    '); write('    pass'); }
      return;
    }
    if (isBlueprintTaskLaunch(node.type)) {
      const target = blueprintById.get(String(node.properties.graphId)), slot = 'vn_bp_task_submit_' + node.id;
      const args = '{' + (target?.exposedInputs ?? []).map(pin => pythonLiteral(pin.id) + ': ' + value('arg_' + pin.id, pin.defaultValue)).join(', ') + '}';
      captureLocal(slot, 'vn_bp_async_start(' + [pythonLiteral(node.properties.scope), blueprintTaskScope(node) === 'page' ? value('pageId', blueprintTaskPageId(graph, node)) : 'None', pythonLiteral(graph.id), pythonLiteral(node.id), pythonLiteral(node.properties.graphId), args, value('seconds', node.type === 'debounce' ? .3 : 0), pythonLiteral(node.type === 'debounce' ? 'replace' : node.properties.conflict)].join(', ') + ')');
      captureLocal('vn_bp_task_handle_' + node.id, invocationValue(slot) + '["handle"]');
      for (const [index, pin] of ['exec_out', 'blocked'].entries()) { write((index ? 'elif' : 'if') + ' ' + invocationValue(slot) + '["output"] == ' + pythonLiteral(pin) + ':'); emitNext(nextExec(pin), new Set(visited), indent + '    '); write('    pass'); }
      return;
    }
    if (node.type === 'cancelTask') captureLocal('vn_bp_task_cancelled_' + node.id, 'vn_bp_async_cancel(' + value('handle', '') + ')');
    if (node.type === 'waitTask') {
      const slot = 'vn_bp_await_result_' + node.id, handle = 'vn_bp_await_handle_' + node.id, target = blueprintById.get(String(node.properties.graphId));
      captureLocal(handle, value('handle', ''));
      const result = 'vn_bp_async_result(' + invocationValue(handle) + ', ' + pythonLiteral(node.properties.graphId || '') + ')';
      write('$ vn_actor_flush()');
      write('$ vn_flow_transition_flush()');
      write('$ renpy.checkpoint(hard=False)');
      write('$ vn_bp_async_wait(' + invocationValue(handle) + ', ' + pythonLiteral(node.properties.graphId || '') + ')');
      checkpoint(); captureLocal(slot, result); captureLocal('vn_bp_task_reason_' + node.id, invocationValue(slot) + '["reason"]');
      for (const pin of target?.exposedOutputs ?? []) captureLocal('vn_bp_result_' + node.id + '_' + pin.id, '(' + invocationValue(slot) + '["outputs"].get(' + pythonLiteral(pin.id) + ', ' + pythonLiteral(pin.defaultValue) + ') if ' + invocationValue(slot) + '["status"] == "completed" else ' + pythonLiteral(pin.defaultValue) + ')');
      for (const [index, pin] of ['completed', 'cancelled', 'failed', 'missing'].entries()) { write((index ? 'elif' : 'if') + ' ' + invocationValue(slot) + '["status"] == ' + pythonLiteral(pin) + ':'); emitNext(nextExec(pin), new Set(visited), indent + '    '); write('    pass'); }
      return;
    }
    if (node.type === 'switchValue') {
      const definition = blueprintChoiceDefinition(node), cases = definition.cases ?? [], slot = 'vn_bp_choice_' + node.id;
      captureLocal(slot, 'vn_bp_choice_match(' + value('key') + ', ' + pythonLiteral(definition.keyType) + ', ' + pythonLiteral(cases.map(item => [item.id, item.key])) + ')');
      for (const [index, pin] of [...cases.map(item => blueprintChoicePinId(item.id)), 'default'].entries()) {
        write((index ? 'elif' : 'if') + ' ' + invocationValue(slot) + ' == ' + pythonLiteral(pin) + ':');
        emitNext(nextExec(pin), new Set(visited), indent + '    '); write('    pass');
      }
      return;
    }
    if (isBlueprintFlowControl(node.type)) {
      const stateSlot = 'vn_bp_control_' + node.id;
      const pageId = blueprintFlowControlScope(node) === 'page' ? value('pageId', blueprintFlowControlPageId(graph, node)) : 'None';
      captureLocal(stateSlot, `vn_bp_control_step(${pythonLiteral(node.properties.scope ?? 'call')}, ${pageId}, ${pythonLiteral(graph.id)}, ${pythonLiteral(node.id)}, ${pythonLiteral(node.type)}, ${pythonLiteral(entryPin)}, ${pythonLiteral(node.properties.initiallyClosed ?? blueprintFlowControlInitial(node))})`);
      for (const [index, pin] of blueprintExecutionOutputs(node, entryPin).entries()) {
        write(`${index ? 'elif' : 'if'} ${invocationValue(stateSlot)} == ${pythonLiteral(pin)}:`);
        emitNext(nextExec(pin), new Set(visited), indent + '    ');
        write('    pass');
      }
      return;
    }
    if (node.type === 'delay') {
      const seconds = blueprintDataExpression(graph, node, 'seconds') ?? pythonLiteral(node.properties.seconds ?? 0);
      if (node.id === graph.timeline?.tailNodeId) {
        write(`if not vn_bp_launch_${graph.id}:`);
        write('    $ vn_actor_flush()');
        // A timed pause resumes immediately after loading. Recheck the saved
        // deadline, while retaining ordinary click-to-dismiss and skipping.
        write(`while vn_bp_task_alive(vn_bp_task) and not vn_bp_launch_${graph.id} and not renpy.is_skipping() and vn_stage_clock() < vn_bp_timeline_end_${graph.id}:`);
        write('    $ renpy.checkpoint(hard=False)');
        captureLocal(`vn_bp_dismissed_${graph.id}`, `vn_performance_pause(max(0.0, vn_bp_timeline_end_${graph.id} - vn_stage_clock()))`, '    ');
        write(`    if vn_bp_dismissed_${graph.id}:`);
        write(`        $ vn_bp_timeline_end_${graph.id} = vn_stage_clock()`);
      } else if (graph.timeline?.tailNodeId) {
        write('$ vn_actor_flush()');
        const deadline=`vn_bp_gap_${node.id}`;
        captureLocal(deadline, `vn_stage_clock() + vn_bp_number(${seconds}, 0, None, "等待秒数")`);
        write(`while vn_bp_task_alive(vn_bp_task) and not renpy.is_skipping() and vn_stage_clock() < ${invocationValue(deadline)}:`);
        write('    $ renpy.checkpoint(hard=False)');
        captureLocal(`vn_bp_gap_dismissed_${node.id}`, `vn_performance_pause(max(0.0, ${invocationValue(deadline)} - vn_stage_clock()))`, '    ');
        write(`    if vn_bp_gap_dismissed_${node.id}:`);
        captureLocal(deadline, 'vn_stage_clock()', '        ');
      } else pause(seconds, origin, indent);
    }
    else if (node.type === 'setVariable') {
      const variable = blueprintStateVariable(project, graph, node), scope = blueprintStateScope(project, node);
      if (variable) {
        const value = blueprintDataExpression(graph, node, 'value') ?? observeInput(graph, node, 'value', pythonLiteral(node.properties.value ?? variable.initial));
        if (scope === 'call') write(`$ vn_bp_state_set(${pythonLiteral(graph.id)}, ${pythonLiteral(variable.id)}, ${value})`);
        else if (scope === 'page') write(`$ vn_ui_state_set(${blueprintDataExpression(graph, node, 'pageId') ?? pythonLiteral(blueprintStatePageId(graph, node))}, ${pythonLiteral(variable.id)}, ${value}, ${pythonLiteral(variable.type)})`);
        else write(`$ vn_parameter_set(${pythonLiteral(variable.id)}, ${value}, False)`);
        if (debug) write('$ vn_bp_debug_written(' + pythonLiteral(graph.id) + ', ' + pythonLiteral(node.id) + ')');
      }
    } else if (node.type === 'showBackground') {
      write(`$ vn_bp_background(${value('assetId')})`);
      appearance();
    } else if (node.type === 'showCharacter') {
      if (timelineOverrides) write(`$ vn_actor_transition_overrides = vn_actor_transition_overrides + [${pythonLiteral(timelineOverrides)}]`);
      const character = node.type === 'showCharacter' ? `(${value('characterId', '')} or vn_current_speaker)` : 'vn_current_speaker';
      write(`if vn_bp_show_speaker(${value('expressionId', '')}, ${value('x', 0.5)}, ${value('y', 1)}, ${value('scale', 1)}, ${value('layer', 10)}, ${value('hideOthers', false)}, ${value('useDefaultFraming', false)}, ${value('presetId', '')}, ${value('instanceId', '')}, ${value('lifetime', '')}${node.properties.transition === 'move' ? ', move_duration=' + value('duration', .5) + (nodeMoveOffsets(node) ? ', move_offsets=' + pythonLiteral(nodeMoveOffsets(node)) : '') : (nodeMoveOffsets(node) || nodeAfterOffsets(node)) ? ', offset_duration=' + (node.properties.transition === 'none' ? '0' : value('duration', node.properties.transition === 'fade' ? 1 : .5)) + ', move_offsets=' + pythonLiteral(nodeMoveOffsets(node) ?? {}) : ''}${nodeAfterOffsets(node) ? ', after_offsets=' + pythonLiteral(nodeAfterOffsets(node)) : ''}, transitions=${pythonLiteral(node.properties.actorTransitions ?? "")}, wait=${value("wait", true)}, transition_mode=${pythonLiteral(node.properties.transition ?? "none")}, transition_duration=${value("duration", node.properties.transition === "fade" ? 1 : .5)}, character_id=${node.type === 'showCharacter' ? value('characterId', '') : 'None'}):`);
      write(`    if vn_bp_character_label(${character}):`);
      write(`        call expression vn_bp_character_label(${character}) from ${callSite(`vn_bp_speaker_${node.id}`)}`);
      checkpoint('    ');
      appearance('    ');
      if (timelineOverrides) write('$ vn_actor_transition_overrides = vn_actor_transition_overrides[:-1]');
    } else if (node.type === 'startDialogue') {
      flushTransition(origin, indent); write('$ vn_start_dialogue()');
    } else if (node.type === 'showChapter') {
      write(`if ${value('soundId', '')}:`);
      write(`    $ renpy.music.play(vn_bp_asset(${value('soundId')}, "audio"), channel="sound", loop=False)`);
      const chapterArgs = `title=${value('title', '第一章')}, subtitle=${value('subtitle', '')}, duration=vn_bp_number(${value('duration', 4.2)}, 0, None, "章节时长"), effect=(${value('effect', '')} or None), background=vn_bp_optional_asset(${value('backgroundId', '')}, "image"), title_image=vn_bp_optional_asset(${value('titleImageId', '')}, "image")`;
      write(`$ vn_performance_extend(${value('duration', 4.2)})`);
      write('if not renpy.is_skipping() and not (vn_performance_active and vn_performance_skipped):');
      write(`    if ${value('wait', true)} and not vn_performance_active and not vn_performance_transition and not vn_flow_transition_holding():`); write(`        call screen vn_chapter_title(${chapterArgs})`);
      write('    else:'); write(`        $ renpy.show_screen("vn_chapter_title", ${chapterArgs}, _vn_wait=False, _vn_layer="master", _layer="master", _zorder=${layer ?? 80})`);
      flushTransition(origin, indent + '        ');
      write(`        if ${value('wait', true)}:`); write(`            $ vn_performance_pause(${value('duration', 4.2)})`); write('            hide screen vn_chapter_title onlayer master');
    } else if (node.type === 'camera') {
      write('$ vn_flow_transition_flush()');
      write(`camera master at vn_blueprint_camera(${value('x', 0)}, ${value('y', 0)}, ${value('zoom', 1)}, ${value('rotation', 0)}, ${value('duration', 0.5)}, ${value('easing', 'ease')})`);
      write(`$ vn_performance_extend(${value('duration', .5)})`);
      write(`if ${value('wait', true)}:`); pause(value('duration', .5), origin, indent + '    ');
    } else if (node.type === 'shake') {
      flushTransition(origin, indent); write(`show layer master at vn_blueprint_shake(${value('direction', 'vertical')}, ${value('duration', 0.6)}, ${value('amplitude', 20)})`);
      write(`$ vn_performance_extend(${value('duration', .6)})`);
      write(`if ${value('wait', true)}:`); pause(value('duration', .6), origin, indent + '    ');
    } else if (node.type === 'savedAction') {
      const action = savedAction;
      if (timelineOverrides) write(`$ vn_actor_transition_overrides = vn_actor_transition_overrides + [${pythonLiteral(timelineOverrides)}]`);
      if (action?.kind === 'visual') {
        write('$ vn_actor_flush()');
        write(`$ vn_visual_wait = vn_show_visual(${layer ? `dict(${visualData}, layer=${layer})` : visualData})`);
        if (action.wait || action.transitionWait) { write('if vn_visual_wait:'); flushTransition(origin, indent + '    '); pause('vn_visual_wait', origin, indent + '    '); }
      } else if (action?.kind === 'audioClip') {
        write('$ vn_actor_flush()');
        const data = `vn_audio_clip_inputs(${pythonLiteral(action)}, {${audioClipFields(action).map(field => `${pythonLiteral(field.key)}: ${value('clip_' + field.key, field.value)}`).join(', ')}})`;
        write(`$ vn_audio_clip_play(${data})`);
        write(`$ vn_performance_extend(${data}["duration"])`);
        if (action.wait) pause(`(${data}["duration"])`, origin, indent);
      } else if (action) stage(action, origin, indent, layer);
      if (timelineOverrides) write('$ vn_actor_transition_overrides = vn_actor_transition_overrides[:-1]');
    } else if (node.type === 'hideCharacter') {
      write(`$ vn_bp_hide(${value('characterId')}, ${value('instanceId', '')}, {"mode": ${pythonLiteral(node.properties.transition ?? 'none')}, "duration": ${value('duration', node.properties.transition === 'fade' ? 1 : .5)}}, ${value('wait', true)})`);
      appearance();
    } else if (node.type === 'playMusic') {
      // An empty music parameter means "no track": keep whatever is playing.
      write(`if ${value('assetId')}:`);
      write(`    $ renpy.music.play(vn_bp_asset(${value('assetId')}, "audio"), channel="music", loop=${value('loop', true)}, fadein=vn_bp_number(${value('fade', 0.3)}, 0, None, "音乐淡入秒数"))`);
    } else if (node.type === 'playSound') {
      write(`if ${value('assetId')}:`);
      write(`    $ renpy.music.play(vn_bp_asset(${value('assetId')}, "audio"), channel=${pythonLiteral(node.properties.channel ?? 'sound')}, loop=${value('loop', false)})`);
    } else if (node.type === 'stopMusic') {
      write(`$ renpy.music.stop(channel=${pythonLiteral(node.properties.channel ?? 'music')}, fadeout=vn_bp_number(${value('fade', 0.3)}, 0, None, "声音淡出秒数"))`);
    } else if (node.type === 'switchScene') {
      write('if vn_pending_scene_transition is None and not vn_flow_transition_source_preserved():');
      write('    with None');
      write(`$ vn_pending_scene_transition = {"mode": ${pythonLiteral(node.properties.mode ?? 'none')}, "duration": vn_bp_number(${value('duration', 0.5)}, 0, None, "转场秒数"), "color": ${pythonLiteral(node.properties.color ?? '#000000')}, "toSceneId": ${value('sceneId')}}`);
      write('$ vn_bp_close_label_frames_since(set())');
      write('$ vn_current_scene = None');
      write('$ renpy.set_return_stack([])');
      write(`jump expression vn_bp_scene_label(${value('sceneId')})`);
      return;
    } else if (node.type === 'sceneAction') {
      const command = typeof node.properties.command === 'string' ? textCommandAction(project, node.properties.command) : undefined;
      if (command) stage(command, origin, indent);
    } else if (node.type === 'uiAction') {
      write('$ vn_flow_transition_flush()');
      write(`call expression vn_bp_menu_label(${value('screen', 'pause_menu')}) from ${callSite(`vn_bp_menu_call_${node.id}`)}`);
    } else if (node.type === 'showUiPage') {
      const settings = invocationValue('vn_bp_page_opening_' + node.id);
      const modal = `${settings}["input"] == "block"`;
      const target = invocationValue('vn_bp_page_target_' + node.id), inputs = invocationValue('vn_bp_page_inputs_' + node.id);
      const arguments_ = node.pins.filter(pin => pin.direction === 'input' && pin.id.startsWith('arg_')).flatMap(pin => { const expression = blueprintDataExpression(graph, node, pin.id); return expression === undefined ? [] : [pythonLiteral(pin.id.slice(4)) + ': ' + expression]; });
      captureLocal('vn_bp_page_target_' + node.id, `vn_ui_interface_check(${value('pageId')}, ${pythonLiteral(uiPageNodeContractId(graph, node))})`);
      captureLocal('vn_bp_page_inputs_' + node.id, `vn_ui_interface_inputs(${target}, {${arguments_.join(', ')}})`);
      const waitOverride = Object.hasOwn(node.properties, 'wait') || graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'wait') ? value('wait', true) : 'None';
      captureLocal('vn_bp_page_opening_' + node.id, `vn_ui_opening(${target}, ${pythonLiteral(node.pageOpening ?? {})}, ${waitOverride}, ${value('modalMode', 'page')})`);
      write(`if ${settings}["wait"]:`);
      write('    $ vn_flow_transition_flush()');
      write(`    call expression vn_bp_page_label(${target}, True, ${modal}, ${value('saveMode', 'load')}) pass (_vn_modal=${modal}, _vn_inputs=${inputs}, _vn_opening=${settings}) from ${callSite('vn_bp_page_' + node.id)}`);
      captureLocal(`vn_bp_page_result_${node.id}`, 'str(_return) if _return is not None else ""', '    ');
      captureLocal(`vn_bp_page_reason_${node.id}`, 'vn_ui_last_page_reason', '    ');
      write('else:');
      captureLocal(`vn_bp_page_reason_${node.id}`, `"alreadyOpen" if ${target} in vn_ui_open_pages else "shown"`, '    ');
      write(`    $ vn_ui_open_page(${target}, ${modal}, ${inputs}, opening=${settings})`);
      captureLocal(`vn_bp_page_result_${node.id}`, '""', '    ');
      write(`    $ vn_ui_last_page_completion = vn_ui_interface_completion(${target}, "", ${invocationValue('vn_bp_page_reason_' + node.id)})`);
      for (const pin of node.pins.filter(pin => pin.direction === 'output' && pin.id.startsWith('out_'))) captureLocal(`vn_bp_page_${pin.id}_${node.id}`, `vn_ui_interface_result(${target}, vn_ui_last_page_completion)["outputs"].get(${pythonLiteral(pin.id.slice(4))}, ${pythonLiteral(pin.defaultValue)})`);
    } else if (node.type === 'closeUiPage') {
      const outputs = node.pins.filter(pin => pin.direction === 'input' && pin.id.startsWith('out_')).flatMap(pin => { const explicit = Object.hasOwn(node.properties, pin.id) || graph.links.some(link => link.toNodeId === node.id && link.toPinId === pin.id); const expression = explicit ? blueprintDataExpression(graph, node, pin.id) : undefined; return expression === undefined ? [] : [pythonLiteral(pin.id.slice(4)) + ': ' + expression]; });
      write(`$ vn_ui_close_page(vn_ui_interface_check(${value('pageId')}, ${pythonLiteral(uiPageNodeContractId(graph, node))}), ${value('result', '完成')}, ${value('reason', 'completed')}, outputs={${outputs.join(', ')}})`);
    } else if (node.type === 'setPageOutput') {
      write(`$ vn_ui_interface_set_output(${value('pageId')}, ${pythonLiteral(node.properties.parameterId)}, ${value('value')}, ${pythonLiteral(node.pins.find(pin => pin.id === 'value')?.dataType)})`);
    } else if (node.type === 'preventPageClose') {
      write(`$ vn_ui_prevent_page_close(${value('pageId')})`);
    } else if (node.type === 'editUiControlOptions') {
      write('$ ' + uiControlOptionEditExpression(node, value));
    } else if (node.type === 'focusUiComponent') {
      captureLocal('vn_bp_focus_accepted_' + node.id, 'vn_input_request_focus(' + value('componentId') + ', ' + value('focused', true) + ')');
    } else if (node.type === 'setUiControlRange') {
      write(`$ vn_ui_control_set_range(${value('componentId')}, ${value('minimum', 0)}, ${value('maximum', 1)}, ${value('step', .01)})`);
    } else if (node.type === 'resetUiControlRange') {
      write(`$ vn_ui_control_reset_range(${value('componentId')})`);
    } else if (node.type === 'setUiProperty') {
      write('$ ' + uiPropertyWriteExpression(node, value));
    } else if (node.type === 'animateUiProperty' || node.type === 'playUiAnimation') {
      if(node.type === 'playUiAnimation') write(`$ vn_bp_animation_${node.id} = vn_ui_play_animation(${pythonLiteral(node.properties.animationId ?? '')}, ${pythonLiteral(node.properties.playMode ?? 'forward')}, ${value('loops', 1)}, ${value('speed', 1)}, ${value('fromCurrent', false)})`);
      else
      write(`$ vn_bp_animation_${node.id} = vn_ui_animate(${value('componentId')}, ${pythonLiteral(node.properties.property ?? 'opacity')}, ${value('value', 0)}, ${value('duration', .3)}, ${pythonLiteral(node.properties.easing ?? 'ease')})`);
      write(`if ${value('wait', true)}:`);
      write('    $ vn_flow_transition_flush()');
      write('    $ renpy.checkpoint(hard=False)');
      write(`    while vn_bp_task_alive(vn_bp_task) and vn_ui_animation_active(vn_bp_animation_${node.id}):`);
      write(`        if renpy.is_skipping():`);
      write(`            $ vn_ui_finish_animation(vn_bp_animation_${node.id})`);
      write(`        else:`);
      write(`            $ renpy.pause(0.016, hard=True)`);
      write(`            $ vn_ui_animation_tick()`);
    } else if (node.type === 'stopUiAnimationPlayback') {
      write(`$ vn_ui_stop_playback(${pythonLiteral(node.properties.animationId ?? '')}, ${value('finish', false)})`);
    } else if (node.type === 'stopUiAnimation') {
      write(`$ vn_ui_stop_animation(${value('componentId')}, ${pythonLiteral(node.properties.property ?? 'all')}, ${value('finish', false)})`);
    } else if (node.type === 'setPlayerPreference') {
      write(`$ vn_preference_set(${pythonLiteral(node.properties.preference)}, ${value('value')}, ${value('characterId')})`);
    } else if (node.type === 'setMinigameValue') {
      write(`$ vn_minigame_set(${pythonLiteral(node.properties.key ?? 'value')}, ${value('value')})`);
    } else if (node.type === 'finishMinigame') {
      write(`$ vn_finish_minigame(${pythonLiteral(node.properties.result ?? 'success')})`);
      write('$ vn_bp_leave_frame()');
      write('return');
      return;
    } else if (node.type === 'confirmMessage') {
      write('$ vn_actor_flush()');
      write('$ vn_flow_transition_flush()');
      write(`call vn_confirm_prompt(vn_ui_literal(${value('message', '确认继续吗？')}).replace("[", "[[")) from ${callSite(`vn_bp_confirm_${node.id}`)}`);
      checkpoint();
      write('if _return:');
      const yes = nextExec('yes'); if (yes) emitNext(yes, new Set(visited), `${indent}    `);
      write('    pass');
      write('else:');
      const no = nextExec('no'); if (no) emitNext(no, new Set(visited), `${indent}    `);
      write('    pass');
      return;
    } else if (node.type === 'resetUiProperty') {
      write(`$ vn_ui_reset_property(${value('componentId')}, ${pythonLiteral(node.properties.property ?? 'visible')})`);
    } else if (node.type === 'resetUiComponent') {
      write(`$ vn_ui_reset(${value('componentId')})`);
    } else if (['playUiVideo', 'pauseUiVideo', 'stopUiVideo'].includes(node.type)) {
      const operation = node.type === 'playUiVideo' ? 'play' : node.type === 'pauseUiVideo' ? 'pause' : 'stop';
      write('$ vn_ui_video_control(' + value('componentId') + ', ' + pythonLiteral(operation) + ', ' + (operation === 'play' ? value('restart', false) : operation === 'pause' ? value('paused', true) : 'None') + ')');
    } else if (node.type === 'playSpine') {
      write(`$ vns_spine.play(${value('componentId')}, ${value('animation', '')}, ${value('loop', true)}, ${value('restart', true)})`);
    } else if (node.type === 'pauseSpine') {
      write(`$ vns_spine.pause(${value('componentId')}, ${value('paused', true)})`);
    } else if (node.type === 'setSpineSpeed') {
      write(`$ vns_spine.speed(${value('componentId')}, ${value('speed', 1)})`);
    } else if (node.type === 'effect') {
      const effectId = typeof node.properties.effectId === 'string' ? node.properties.effectId : undefined;
      if (effectId) stage({ kind: 'effect', effectId }, origin, indent);
    } else if (node.type === 'callFunction' || node.type === 'callMacro') {
      const graphId = typeof node.properties.graphId === 'string' ? node.properties.graphId : undefined;
      const calledGraph = graphId ? blueprintById.get(graphId) : undefined;
      if (calledGraph) {
        const args = calledGraph.exposedInputs.map((pin, index) => {
          const argument = blueprintDataExpression(graph, node, `arg_${pin.id}`) ?? blueprintDataExpression(graph, node, `arg_${index}`) ?? pythonLiteral(node.properties[`arg_${pin.id}`] ?? node.properties[`arg_${index}`] ?? pin.defaultValue);
          return argument;
        });
        const launch = node.properties.wait === false && canLaunchTimeline(project, calledGraph);
        if (layer && calledGraph.timeline) args.push(`vn_bp_layer_base_${calledGraph.id}=${layer}`);
        if (launch) args.push(`vn_bp_launch_${calledGraph.id}=True`);
        const suffix = args.length ? `(${args.join(', ')})` : '';
        if (node.properties.actorTransitions) write(`$ vn_actor_transition_overrides.append(${pythonLiteral(node.properties.actorTransitions)})`);
        emit(`${indent}call vn_blueprint_${graphId}${suffix} from ${callSite(`vn_blueprint_nested_${node.id}`)}`, origin);
        if (node.properties.actorTransitions) write('$ vn_actor_transition_overrides.pop()');
        checkpoint();
        if (launch && graph.timeline?.tailNodeId) write(`$ vn_bp_timeline_end_${graph.id} = max(vn_bp_timeline_end_${graph.id}, float(_return))`);
        for (const pin of calledGraph.exposedOutputs) captureLocal(`vn_bp_result_${node.id}_${pin.id}`, `vn_bp_out_${calledGraph.id}_${pin.id}`);
      }
    } else if (node.type === 'setOutput') {
      const outputId = typeof node.properties.outputId === 'string' ? node.properties.outputId : undefined;
      if (outputId && graph.exposedOutputs.some(pin => pin.id === outputId)) {
        const value = blueprintDataExpression(graph, node, 'value') ?? pythonLiteral(node.properties.value);
        captureLocal(`vn_bp_out_${graph.id}_${outputId}`, value);
      }
    } else if (node.type === 'branch') {
      const variableId = typeof node.properties.variableId === 'string' ? node.properties.variableId : undefined;
      const variable = variableId ? project.variables.find(item => item.id === variableId) : undefined;
      const linkedCondition = blueprintDataExpression(graph, node, 'condition');
      const test = linkedCondition ?? (variable ? `${variableReference(project, variable.id)} == ${pythonLiteral(node.properties.value ?? variable.initial)}` : pythonLiteral(node.properties.condition ?? true));
      emit(`${indent}if ${test}:`, origin);
      const yes = nextExec('true'); if (yes) emitNext(yes, new Set(visited), `${indent}    `);
      emit(`${indent}    pass`, origin);
      emit(`${indent}else:`, origin);
      const no = nextExec('false'); if (no) emitNext(no, new Set(visited), `${indent}    `);
      emit(`${indent}    pass`, origin);
      return;
    } else if (node.type === 'return') { write('$ vn_bp_publish_frame()'); write('$ vn_bp_leave_frame()'); emit(`${indent}return${graph.timeline?.tailNodeId ? ` vn_bp_timeline_end_${graph.id}` : ''}`, origin); return; }
    else if (node.type === 'forLoop') {
      const indexVariable = `vn_bp_index_${node.id}`;
      const firstExpression = blueprintDataExpression(graph, node, 'first_index') ?? blueprintDataExpression(graph, node, 'firstIndex') ?? pythonLiteral(node.properties.firstIndex ?? 0);
      const lastExpression = blueprintDataExpression(graph, node, 'last_index') ?? blueprintDataExpression(graph, node, 'lastIndex') ?? pythonLiteral(node.properties.lastIndex ?? 0);
      captureLocal(indexVariable, `vn_bp_loop_bound(${firstExpression}, "循环起始数")`);
      captureLocal(`vn_bp_last_${node.id}`, `vn_bp_loop_bound(${lastExpression}, "循环结束数")`);
      emit(`${indent}if ${invocationValue(`vn_bp_last_${node.id}`)} - ${invocationValue(indexVariable)} >= 100000:`, origin);
      emit(`${indent}    $ renpy.error("单次计数循环最多执行 100000 次；持续玩法请使用定时事件。")`, origin);
      emit(`${indent}while vn_bp_task_alive(vn_bp_task) and ${invocationValue(indexVariable)} <= ${invocationValue(`vn_bp_last_${node.id}`)}:`, origin);
      if (debug) emit(indent + '    $ vn_bp_debug_checkpoint(' + [pythonLiteral(graph.id), pythonLiteral(node.id), pythonLiteral('__loop')].join(', ') + ')', origin);
      const body = nextExec('loop_body') ?? nextExec('loopBody');
      if (body) emitNext(body, new Set(visited), `${indent}    `);
      captureLocal(indexVariable, `${invocationValue(indexVariable)} + 1`, '    ');
      const completed = nextExec('completed');
      if (completed) emitNext(completed, new Set(visited), indent);
      return;
    }
    if (node.type === 'sequence') {
      for (const pinId of node.pins.filter(pin => pin.direction === 'output' && pin.dataType === 'exec').map(pin => pin.id)) {
        const next = nextExec(pinId);
        if (next) emitNext(next, new Set(visited), indent);
      }
      return;
    }
    const next = nextExec();
    if (next) emitNext(next, visited, indent);
  };
  for (const graph of blueprintGraphs) {
    // Label parameters keep wait tokens local when another UI callback calls the same graph.
    const inputParameters = [...graph.exposedInputs.map(pin => `vn_bp_in_${graph.id}_${pin.id}=${pythonLiteral(pin.defaultValue)}`), ...(graph.timeline ? [`vn_bp_layer_base_${graph.id}=10`] : []), ...(graph.timeline?.tailNodeId ? [`vn_bp_timeline_end_${graph.id}=0.0`, `vn_bp_launch_${graph.id}=False`] : []), ...graph.nodes.filter(node => ['animateUiProperty','playUiAnimation'].includes(node.type)).map(node => `vn_bp_animation_${node.id}=None`), ...(graph.nodes.some(n=>['eventPage','eventValueChanged','eventTextCommitted','eventImage', 'eventVideo', 'eventSpine'].includes(n.type))?['vn_bp_event_values=None']:[])].join(', ');
    const roots = [graph.nodes.find(node => node.type === 'event'), ...graph.nodes.filter(node => ['eventClick', 'eventButton', 'eventValueChanged', 'eventTextCommitted', 'eventImage', 'eventVideo', 'eventSpine', 'eventKey', 'eventTimer', 'eventPage'].includes(node.type))];
    for (const event of roots) {
    emit(`label vn_blueprint_${graph.id}${event && event.type !== 'event' ? `__${event.id}` : ''}${inputParameters ? `(${inputParameters})` : ''}:`);
    // Dynamic scope inherits through nested calls but restores on return. UI
    // callbacks explicitly replace it with their own source-page instance.
    emit('    $ renpy.dynamic("vn_bp_task", "vn_bp_wait")');
    // Flattened inner calls still override real outer callers. Copy-on-write
    // plus dynamic scope restores the outer stack even on a cancelled return.
    if (graph.nodes.some(node => node.properties.__timelineActorTransitions)) emit('    $ renpy.dynamic("vn_actor_transition_overrides")');
    emit('    $ renpy.dynamic("vn_bp_frame")');
    const frame = `vn_bp_enter_frame(${pythonLiteral(graph.id)}, ${pythonLiteral(blueprintInvocationDefaults(graph, blueprintById))})`;
    emit(`    $ vn_bp_frame = ${debug ? 'vn_bp_debug_frame(' + frame + ', vn_bp_frame, ' + pythonLiteral(event?.id) + ')' : frame}`);
    emit('    $ vn_bp_task = vn_bp_task or vn_bp_task_create()');
    emit('    $ vn_bp_protect_flow_skip(vn_bp_task)');
    emit('    $ vn_bp_wait = None');
    if (graph.timeline?.tailNodeId) emit(`    $ vn_bp_timeline_end_${graph.id} = vn_stage_clock()`);
    for (const pin of graph.exposedOutputs) emit(`    $ vn_bp_out_${graph.id}_${pin.id} = ${pythonLiteral(pin.defaultValue)}`);
    for (const node of graph.nodes) {
      if (node.type === 'showUiPage') { emit(`    $ vn_bp_page_result_${node.id} = ""`); emit(`    $ vn_bp_page_reason_${node.id} = ""`); for (const pin of node.pins.filter(pin => pin.direction === 'output' && pin.id.startsWith('out_'))) emit(`    $ vn_bp_page_${pin.id}_${node.id} = ${pythonLiteral(pin.defaultValue)}`); }
      if (node.type === 'callFunction' || node.type === 'callMacro') {
        const called = blueprintById.get(String(node.properties.graphId));
        for (const pin of called?.exposedOutputs ?? []) emit(`    $ vn_bp_result_${node.id}_${pin.id} = ${pythonLiteral(pin.defaultValue)}`);
      }
    }
    if (event) emitBlueprintNode(graph, event, new Set());
    emit('    $ vn_bp_publish_frame()');
    emit('    $ vn_bp_leave_frame()');
    emit(graph.timeline?.tailNodeId ? `    return vn_bp_timeline_end_${graph.id}` : '    return');
    emit('');
    }
  }
  // Load resumes the saved statement; ordinary player rollback remains greedy.
  emit('default _greedy_rollback = False');
  emit('label start:');
  emit('    $ vn_flow_start_game()');
  emit('    $ vn_bp_async_clear()');
  emit('    $ vn_ui_clear_pages()');
  emit('    stop music fadeout 0');
  emit('    $ vn_performance_reset()');
  emit('    $ vn_actor_reset_transitions()');
  emit('    $ vn_ui_animations.clear()');
  emit('    $ vn_parameter_flush_animations()');
  // Start() can carry values changed by main-menu callbacks into the story.
  // Reset only this game's variables, before setup graphs and test overrides;
  // loading a save resumes its statement and never passes through this label.
  for (const variable of project.variables.filter(variable => !variable.persistent)) emit(`    $ ${variableReference(project, variable.id)} = ${pythonLiteral(variable.initial)}`);
  for (const [id, value] of Object.entries(options.preview?.variables ?? {})) emit(`    $ ${variableReference(project, id)} = ${pythonLiteral(value)}`);
  if (project.gameFlow?.beforeNewGame.length || gameFlowConnections(project)[flowEntry.beforeNewGame] && gameFlowTransition(project, flowEntry.beforeNewGame) !== undefined) {
    emit('    call vn_game_flow_before_new_game from vn_game_flow_new_game_entry');
    emit('    if _return == "title":');
    emit('        $ vn_ui_clear_pages()');
    emit('        $ renpy.full_restart()');
  }
  emit(`    jump ${nodeLabel(options.preview?.entryId ?? project.entryId)}`);
  emit('');

  for (const node of project.nodes) {
    const origin = { nodeId: node.id };
    emit(`label ${nodeLabel(node.id)}:`, origin);
    emit(`    $ vn_current_node = ${pythonLiteral(node.id)}`, origin);
    emit(`    $ vn_mark_story_visit(${pythonLiteral(node.id)})`, origin);
    emit('    $ vn_current_line = None', origin);
    emit('    $ vn_current_speaker = None', origin);
    const scene = effectiveScene(project, node.sceneId)!;
    emit(`    if vn_current_scene != ${pythonLiteral(scene.id)}:`, origin);
    emit(`        $ vn_ui_pages_enter_scene(${pythonLiteral(scene.id)})`, origin);
    emit(`        $ vn_current_scene = ${pythonLiteral(scene.id)}`, origin);
    emit(`        $ vn_scene_parameters = dict(${pythonLiteral(scene.parameters ?? {})}, **((vn_pending_scene_transition or {}).get("parameters") or {}))`, origin);
    for (const action of scene.entryActions ?? []) stage(action, origin, '        ');
    if (scene.blueprintId) stage({ kind: 'blueprint', blueprintId: scene.blueprintId }, origin, '        ');
    switch (node.kind) {
      case 'start': go(node.next, origin); break;
      case 'passage': {
        if (!node.lines.length) { go(node.next, origin); break; }
        emit(`    jump ${lineLabel(node.id, node.lines[0].id)}`, origin);
        node.lines.forEach((line, index) => {
          const lineOrigin = { nodeId: node.id, lineId: line.id };
          emit('', lineOrigin);
          emit(`label ${lineLabel(node.id, line.id)}:`, lineOrigin);
          emit(`    $ vn_current_line = ${pythonLiteral(line.id)}`, lineOrigin);
          emit(`    $ vn_current_speaker = ${pythonLiteral(line.speakerId)}`, lineOrigin);
          const settings = line.silent ? performancePlayback(project, line) : undefined;
          const defer = !!settings && index === node.lines.length - 1 && settings.onComplete === 'next' && mayFollowFlowTransition(node);
          if (line.silent) {
            emit(`    $ vn_performance_begin(${pythonLiteral(settings)}${defer ? ', keep_final_frame=True' : ''})`, lineOrigin);
          }
          const voiceAsset = project.assets.find(a => a.id === line.voiceId && a.kind === 'audio');
          // The line's text look (font, colour, speed, effects, placement) rides with its dialogue data.
          const look = line.silent ? undefined : textRuntimeLook(project, effectiveTextStyle(project, line), line.text, lineMarks(line));
          const words = line.silent ? '' : compiledDialogueText(project, line);
          const voiceLog = voiceAsset ? { id: voiceVisitKey(node.id, line.id), assetId: voiceAsset.id, filename: voiceAsset.path.replaceAll('\\', '/'), speakerId: line.speakerId ?? '' } : null;
          emit(`    $ vn_line_dialogue = ${pythonLiteral(line.silent ? null : { speaker: line.speakerId ?? '', text: words, voice: line.voiceId ?? '', voiceLog, ...(look ? { presentation: look } : {}) })}`, lineOrigin);
          line.actions.forEach(action => stage(action, lineOrigin));
          flushTransition(lineOrigin);
          if (line.voiceId) {
            emit('    if not vn_line_dialogue or vn_line_dialogue.get("started") is None:', lineOrigin);
            emit(`        $ vn_unlock(${pythonLiteral(line.voiceId)})`, lineOrigin);
            emit(`        voice ${assetPath(line.voiceId)}`, lineOrigin);
          }
          if (!line.silent) {
            emit(`    $ vn_current_voice_log = ${pythonLiteral(voiceLog)}`, lineOrigin);
            // Before the first completed interaction, Ren'Py may still keep
            // the rollback record at label start. Loading from a native menu
            // must resume this line, not replay new-game initialization over
            // the retained UI values. A soft boundary adds no player back step.
            // From here the say screen shows this line's own words and look.
            emit('    $ vn_showing_retained = False', lineOrigin);
            emit('    $ renpy.checkpoint(hard=False)', lineOrigin);
            emit(`    ${line.speakerId ? `vn_character_${line.speakerId} ` : ''}${pythonLiteral(words)} id vn_say_${node.id}_${line.id}`, lineOrigin);
            emit('    $ vn_keep_dialogue()', lineOrigin);
            emit('    $ vn_current_voice_log = None', lineOrigin);
            emit('    $ vn_line_dialogue = None', lineOrigin);
            if (look?.exit) emit('    $ vn_text_play_exit()', lineOrigin);
            emit('    $ vn_finish_line_actors()', lineOrigin);
            emit('    $ vn_finish_line_visuals()', lineOrigin);
          } else {
            emit('    $ vn_performance_pause(max(0.0, vn_performance_until - vn_stage_clock()))', lineOrigin);
            emit(`    $ vn_performance_finish(${pythonLiteral(settings)}${defer ? `, defer_transition=True, node_id=${pythonLiteral(node.id)}, port="next"` : ''})`, lineOrigin);
            if (settings!.onComplete === 'title') emit('    jump vn_end_return', lineOrigin);
          }
          const following = node.lines[index + 1];
          if (following) emit(`    jump ${lineLabel(node.id, following.id)}`, lineOrigin);
          else go(node.next, lineOrigin);
        });
        break;
      }
      case 'choice':
        flushTransition(origin);
        emit('    menu:', origin);
        if (node.prompt) emit(`        ${renpyText(node.prompt)}`, origin);
        for (const choice of node.choices) {
          emit(`        ${renpyText(choice.text)}${choice.condition ? ` if ${conditionExpression(project, choice.condition)}` : ''}:`, origin);
          go(choice.target, origin, '            ', choice.id);
        }
        go(undefined, origin);
        break;
      case 'condition':
        emit(`    if ${conditionExpression(project, node.condition)}:`, origin);
        go(node.yes, origin, '        ', 'yes');
        emit('    else:', origin);
        go(node.no, origin, '        ', 'no');
        break;
      case 'set':
        if (node.when) emit(`    if ${conditionExpression(project, node.when)}:`, origin);
        emit(`${node.when ? '        ' : '    '}$ vn_parameter_set(${pythonLiteral(node.variableId)}, ${node.operation === 'add' ? variableReference(project, node.variableId) + ' + ' : ''}${pythonLiteral(node.value)}, False)`, origin);
        go(node.next, origin);
        break;
      case 'chapterTitle': {
        const chapterArgs = `title=${renpyText(node.title)}, subtitle=${renpyText(node.subtitle)}, duration=${node.duration}, effect=${pythonLiteral(node.effect)}, background=${node.backgroundId ? assetPath(node.backgroundId) : 'None'}, title_image=${node.titleImageId ? assetPath(node.titleImageId) : 'None'}`;
        if (node.soundId) emit(`    $ renpy.music.play(${assetPath(node.soundId)}, channel="sound", loop=False)`, origin);
        emit('    if vn_flow_transition_holding():', origin);
        emit(`        $ renpy.show_screen("vn_chapter_title", ${chapterArgs}, _vn_wait=False, _vn_layer="master", _layer="master", _zorder=80)`, origin);
        flushTransition(origin, '        ');
        pause(node.duration, origin, '        ');
        emit('        hide screen vn_chapter_title onlayer master', origin);
        emit('    else:', origin);
        flushTransition(origin, '        ');
        emit('        if not renpy.is_skipping():', origin);
        emit(`            call screen vn_chapter_title(${chapterArgs})`, origin);
        if (node.playback?.onComplete === 'title') emit('    jump vn_end_return', origin);
        else go(node.next, origin);
        break;
      }
      case 'jump':
        queueTransition(node.target, origin, 'target');
        if (node.sceneTransition) {
          emit('    if vn_pending_scene_transition is None and not vn_flow_transition_source_preserved():', origin);
          emit('        with None', origin);
          emit(`    $ vn_pending_scene_transition = ${pythonLiteral(node.sceneTransition)}`, origin);
          emit('    $ vn_current_scene = None', origin);
        }
        go(node.target, origin, '    ', null);
        break;
      case 'call':
        queueTransition(node.target, origin, 'target');
        emit(`    call ${nodeLabel(node.target!)} from vn_return_${node.id}`, origin);
        go(node.next, origin);
        break;
      case 'return': emit('    return', origin); break;
      case 'end':
        emit('    jump vn_end_return', origin);
        break;
      case 'interaction': {
        flushTransition(origin);
        const hotspotData = node.hotspots.map(hotspot => {
          const data = pythonLiteral({ id: hotspot.id, name: hotspot.name.replaceAll('{', '{{'), x: hotspot.x, y: hotspot.y, width: hotspot.width, height: hotspot.height });
          const guards = [hotspot.condition ? conditionExpression(project, hotspot.condition) : '', hotspot.characterId ? `vn_character_showing(${pythonLiteral(hotspot.characterId)})` : ''].filter(Boolean);
          return guards.length ? `(${data} if ${guards.join(' and ')} else None)` : data;
        }).join(', ');
        emit('    $ vn_interaction_result = None', origin);
        emit(`    $ vn_interaction_remaining = ${node.timeoutSeconds}`, origin);
        // A loaded call screen restarts its statement; retain changes made inside it.
        emit('    $ renpy.retain_after_load()', origin);
        emit(`    call screen vn_interaction(prompt=${renpyText(node.prompt)}, hotspots=[item for item in [${hotspotData}] if item is not None], timeout_seconds=${node.timeoutSeconds}, show_hints=${node.showHints ? 'True' : 'False'})`, origin);
        emit('    $ vn_interaction_result = _return', origin);
        for (const hotspot of node.hotspots) {
          emit(`    if vn_interaction_result == ${pythonLiteral(hotspot.id)}:`, origin);
          go(hotspot.target, origin, '        ', hotspot.id);
        }
        if (node.timeout) {
          emit(`    if vn_interaction_result == "timeout":`, origin);
          go(node.timeout, origin, '        ', 'timeout');
        }
        if (node.cancel) {
          emit(`    if vn_interaction_result == "cancel":`, origin);
          go(node.cancel, origin, '        ', 'cancel');
        }
        go(undefined, origin);
        break;
      }
      case 'minigame': {
        flushTransition(origin);
        const screen = node.template === 'password' ? 'vn_minigame_password' : node.template === 'custom' ? 'vn_minigame_custom' : 'vn_minigame_timed_clicks';
        emit('    $ vn_minigame_result = None', origin);
        emit('    $ vn_minigame_answer = ""', origin);
        emit(`    $ vn_minigame_remaining = ${node.attempts}`, origin);
        emit('    $ vn_minigame_clicks = 0', origin);
        emit(`    $ vn_minigame_time_left = ${node.timeLimit}`, origin);
        const args = node.template === 'password'
          ? `title=${renpyText(node.title)}, prompt=${renpyText(node.prompt)}, password=${pythonLiteral(node.password)}, case_sensitive=${node.caseSensitive ? 'True' : 'False'}`
          : node.template === 'custom'
            ? `minigame_id=${pythonLiteral(node.minigameId ?? '')}, title=${renpyText(node.title)}, prompt=${renpyText(node.prompt)}`
            : `title=${renpyText(node.title)}, prompt=${renpyText(node.prompt)}, target_clicks=${node.targetClicks}`;
        emit('    $ renpy.retain_after_load()', origin);
        if (node.template === 'custom') {
          const definition = project.minigames?.find(item => item.id === node.minigameId);
          emit(`    $ vn_minigame_definition_current = vn_minigame_begin(${pythonLiteral(node.id)}, ${pythonLiteral(node.minigameId ?? '')}, ${renpyText(node.title)}, ${renpyText(node.prompt)})`, origin);
          emit('    if vn_minigame_should_start():', origin);
          if (definition?.mode === 'blueprint' && definition.blueprintId) {
            emit(`        call vn_blueprint_${definition.blueprintId} from ${callSite(`vn_minigame_blueprint_${node.id}`)}`, origin);
          } else if (definition?.mode === 'script' && definition.script) {
            emit(`        call expression ${pythonLiteral(definition.script.entry)} pass (**${pythonLiteral(definition.script.args)}) from ${callSite(`vn_minigame_script_${node.id}`)}`, origin);
            emit('        if _return in ("success", "failure", "cancel"):', origin);
            emit('            $ vn_finish_minigame(_return)', origin);
          } else emit('        pass', origin);
          emit('    if vn_minigame_finished is None:', origin);
          emit(`        call screen ${screen}(${args})`, origin);
          emit('        $ vn_minigame_result = vn_minigame_result_value(_return)', origin);
          emit('    else:', origin);
          emit('        $ vn_minigame_result = vn_minigame_result_value()', origin);
          emit('    $ vn_minigame_close()', origin);
        } else {
          emit(`    call screen ${screen}(${args})`, origin);
          emit('    $ vn_minigame_result = _return', origin);
        }
        for (const [port, target] of [['success', node.success], ['failure', node.failure], ['cancel', node.cancel] as const]) {
          if (!target) continue;
          emit(`    if vn_minigame_result == ${pythonLiteral(port)}:`, origin);
          go(target, origin, '        ', port);
        }
        go(undefined, origin);
        break;
      }
    }
    emit('');
  }
  emit('label vn_finish:');
  emit('    jump vn_end_return');
  emit('label vn_end_return:');
  emit('    $ vn_flow_transition_prepare_finish()');
  emit('    $ vn_flow_transition_finish()');
  emit('    $ vn_performance_reset(keep_terminal=True)');
  emit('    $ vn_actor_reset_transitions()');
  emit('    $ renpy.set_return_stack([])');
  if (uiGameOverEnabled(project)) emit('    call screen vn_game_over');
  emit('    return');
  emit('');

  result.files['game/story.rpy'] = statements.join('\n');
  const theme = effectiveUiTheme(project.ui);
  const menuMusic = project.assets.find(asset => asset.id === theme.menuMusicId && asset.kind === 'audio');
  result.files['game/options.rpy'] = [
    '# Generated project settings.',
    'init -2 python:',
    `    gui.init(${project.width}, ${project.height})`,
    `define config.name = ${pythonLiteral(project.name)}`,
    `define config.version = ${pythonLiteral(project.version)}`,
    `define build.name = ${pythonLiteral(exportSettings(project).platform === 'windows' ? exportSettings(project).fileName : project.id)}`,
    'define build.include_i686 = False',
    ...(project.assets.some(a => a.kind === 'script') ? [] : ['define build.include_old_themes = False']),
    ...(project.exportSettings?.iconAssetId ? [`define config.window_icon = ${pythonLiteral('gui/studio-window-icon.png')}`] : []),
    `define config.developer = ${options.development ? 'True' : 'False'}`,
    `define config.save_directory = ${pythonLiteral(`vns_${project.id}${options.preview ? '_preview' : ''}`)}`,
    'define config.default_language = "schinese"',
    'define config.history_length = 250',
    'define config.rollback_enabled = True',
    'define config.allow_skipping = True',
    'define config.has_sound = True',
    'define config.has_music = True',
    'define config.has_voice = True',
    // The SDK starts config.main_menu_music before before_main_menu. Our title
    // host owns that boundary so an opening never inherits the title's music.
    'define config.main_menu_music = None',
    `define vn_main_menu_music = ${pythonLiteral(menuMusic?.path.replaceAll('\\', '/'))}`,
    `define vn_main_menu_music_fadein = ${theme.menuMusicFade ?? 0.3}`,
    `define _game_menu_screen = ${pythonLiteral(uiMenuShortcutScreen(theme) ?? null)}`,
    'define config.window = "auto"',
    'define config.window_auto_hide = []',
    `define config.thumbnail_width = ${Math.min(project.width, 960)}`,
    `define config.thumbnail_height = ${Math.round(Math.min(project.width, 960) * project.height / project.width)}`,
    'init python:',
    '    config.keymap["game_menu"] = [key for key in config.keymap["game_menu"] if key != "mouseup_3"]',
    '    config.keymap["hide_windows"] = list(dict.fromkeys(config.keymap["hide_windows"] + ["mouseup_3"]))',
    '    build.classify("game/testcases.rpy", None)',
    '    build.classify("game/testcases.rpyc", None)',
    '    build.classify("tests/**", None)',
    '    build.classify("verification/", None)',
    '    build.classify("verification-report.json", None)',
    '    build.classify("source-map.json", None)',
    '    build.classify("studio-source-map.json", None)',
    '    build.classify("build-manifest.json", None)',
    '    build.classify("game/**.rpy", None)',
    '    build.classify("game/python-packages/vns_spine.dll", "windows")',
    '    build.classify("*.keystore", None)',
    '    build.classify("*.keystore.*", None)',
    '    build.classify("signing-manifest.json", None)',
    '',
  ].join('\n');
  result.files['game/screens.rpy'] = createScreens(project);
  result.files['game/00-vn-ui.rpy'] = createUiRuntime(project);
  result.files['game/00-vn-dialogue.rpy'] = earlyDialogueRuntime;
  result.files['game/00-vn-preferences.rpy'] = createPreferencesRuntime(project);
  result.files['game/00-vn-parameters.rpy'] = createParameterRuntime(project);
  result.files['game/01-vn-spine.rpy'] = createSpineRuntime(project);
  result.files['game/01-vn-chapter.rpy'] = createChapterRuntime(project);
  result.files['game/01-vn-window.rpy'] = createWindowRuntime(project);
  result.files['game/01-vn-audio-clips.rpy'] = createAudioClipRuntime();
  result.files['game/01-vn-story-menu.rpy'] = createStoryMenuRuntime(project);
  result.files['game/01-vn-game-flow.rpy'] = createGameFlowRuntime(project, options.preview);
  result.files['studio-source-map.json'] = JSON.stringify(result.sourceMap, null, 2) + '\n';
  return result;
}
