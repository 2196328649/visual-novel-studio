import { endingPerformanceNodes } from '../../src/core/ending-migration';
import { createProject, projectSchema, type BlueprintGraph, type BlueprintNode, type Project, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, blueprintPin, callablePins, connectBlueprintPins, synchronizeBlueprintSignatures } from '../../src/core/blueprint';

export function blueprintVerificationProject(sample: Project): Project {
  const project = createProject('中文蓝图运行验收');
  project.id = 'blueprint_verification';
  project.assets = structuredClone(sample.assets);
  const images = project.assets.filter(asset => asset.kind === 'image');
  const audio = project.assets.find(asset => asset.kind === 'audio')!;
  if (images.length < 2 || !audio) throw new Error('Blueprint verification needs two images and one audio asset.');
  const portrait = sample.characters[0]?.expressions[0]?.assetId ?? images[0].id;
  project.characters = [
    { id: 'bp_actor_base', name: '基础角色', color: '#bd947a', expressions: [{ id: 'bp_expression', name: '平静', assetId: portrait }] },
    { id: 'bp_actor', name: '继承角色', color: '#bd947a', baseCharacterId: 'bp_actor_base', expressions: [] },
  ];
  project.variables = ['score', 'nested_count', 'first_result', 'second_result'].map(id => ({ id, name: id === 'score' ? '累计分数' : id === 'nested_count' ? '嵌套次数' : id === 'first_result' ? '第一次结果' : '第二次结果', type: 'number', initial: 0, persistent: false }));
  project.variables.push({ id: 'received_flag', name: '传入开关', type: 'boolean', initial: true, persistent: false }, { id: 'received_word', name: '传入文字', type: 'string', initial: '初始', persistent: false }, { id: 'menu_returned', name: '已关闭设置', type: 'boolean', initial: false, persistent: false });
  project.chapters = [{ id: 'bp_chapter', name: '蓝图验收' }];
  project.scenes = [
    { id: 'bp_scene', chapterId: 'bp_chapter', name: '起始场景' },
    { id: 'bp_after_scene', chapterId: 'bp_chapter', name: '目标场景', parameters: { 天气: '晴' }, entryActions: [{ kind: 'background', assetId: images[1].id, transition: 'none' }] },
  ];
  project.effects = [{ id: 'bp_effect', name: '轻微入场动画', commands: [], actions: [{ kind: 'animate', characterId: 'bp_actor', wait: true, repeat: false, keyframes: [{ x: 0.5, y: 1, scale: 0.7, opacity: 1, rotation: 0, duration: 0.05, easing: 'linear' }] }] }];
  project.blueprints = [];
  const graph = (id: string, name: string, kind: BlueprintGraph['kind'] = 'function') => {
    const result: BlueprintGraph = { id, name, kind, nodes: [], links: [], exposedInputs: [], exposedOutputs: [] };
    project.blueprints!.push(result); return result;
  };
  const node = (graph: BlueprintGraph, type: BlueprintNode['type'], id: string, properties: Record<string, VariableValue> = {}) => {
    const result = blueprintNodeDefaults(type, graph.nodes.length); result.id = id; Object.assign(result.properties, properties); graph.nodes.push(result); return result;
  };
  const link = (graph: BlueprintGraph, from: BlueprintNode, fromPin: string, to: BlueprintNode, toPin: string) => {
    const error = connectBlueprintPins(graph, from.id, fromPin, to.id, toPin); if (error) throw new Error(error);
  };
  const chain = (graph: BlueprintGraph, ...nodes: BlueprintNode[]) => {
    nodes.slice(1).forEach((next, index) => link(graph, nodes[index], nodes[index].type === 'event' ? 'exec' : 'exec_out', next, 'exec_in'));
  };

  const values = graph('bp_values', '带类型参数与结果', 'macro');
  values.exposedInputs = [blueprintPin('amount', '数量', 'input', 'number', 2), blueprintPin('enabled', '启用', 'input', 'boolean', false), blueprintPin('word', '文字', 'input', 'string', '')];
  values.exposedOutputs = [blueprintPin('doubled', '双倍数量', 'output', 'number', 0), blueprintPin('flag', '开关结果', 'output', 'boolean', false), blueprintPin('word_result', '文字结果', 'output', 'string', '')];
  const valueEvent = node(values, 'event', 'bp_value_event');
  const amount = node(values, 'getInput', 'bp_amount', { inputId: 'amount' });
  const enabled = node(values, 'getInput', 'bp_enabled', { inputId: 'enabled' });
  const word = node(values, 'getInput', 'bp_word', { inputId: 'word' });
  const doubled = node(values, 'math', 'bp_doubled', { operation: 'multiply', b: 2 });
  const output = node(values, 'setOutput', 'bp_output_number', { outputId: 'doubled' });
  const outputFlag = node(values, 'setOutput', 'bp_output_flag', { outputId: 'flag' });
  const outputWord = node(values, 'setOutput', 'bp_output_word', { outputId: 'word_result' });
  const valueReturn = node(values, 'return', 'bp_value_return');
  synchronizeBlueprintSignatures(project);
  link(values, amount, 'value', doubled, 'a'); link(values, doubled, 'result', output, 'value'); link(values, enabled, 'value', outputFlag, 'value'); link(values, word, 'value', outputWord, 'value');
  chain(values, valueEvent, output, outputFlag, outputWord, valueReturn);

  const main = graph('bp_main', '入场与计算');
  const event = node(main, 'event', 'bp_main_event');
  const background = node(main, 'showBackground', 'bp_background', { transition: 'none' });
  const backgroundValue = node(main, 'literal', 'bp_background_value', { value: images[0].id }); backgroundValue.pins[0].dataType = 'asset';
  link(main, backgroundValue, 'value', background, 'assetId');
  const show = node(main, 'showCharacter', 'bp_show', { characterId: 'bp_actor', expressionId: 'bp_expression', x: 0.5, scale: 0.7, transition: 'none' });
  const effect = node(main, 'effect', 'bp_play_effect', { effectId: 'bp_effect' });
  const music = node(main, 'playMusic', 'bp_music', { fade: 0, loop: true });
  const musicValue = node(main, 'literal', 'bp_music_value', { value: audio.id }); musicValue.pins[0].dataType = 'asset';
  link(main, musicValue, 'value', music, 'assetId');
  const sound = node(main, 'playSound', 'bp_sound', { assetId: audio.id });
  const wait = node(main, 'delay', 'bp_wait', { seconds: 0.02 });
  const firstCall = node(main, 'callMacro', 'bp_call_first', { graphId: values.id, arg_amount: 2, arg_enabled: false, arg_word: '雨夜' }); firstCall.pins = callablePins(values);
  const secondCall = node(main, 'callMacro', 'bp_call_second', { graphId: values.id, arg_amount: 5, arg_enabled: true, arg_word: '' }); secondCall.pins = callablePins(values);
  const firstResult = node(main, 'setVariable', 'bp_set_first', { variableId: 'first_result' });
  const secondResult = node(main, 'setVariable', 'bp_set_second', { variableId: 'second_result' });
  const flagResult = node(main, 'setVariable', 'bp_set_flag', { variableId: 'received_flag' });
  const wordResult = node(main, 'setVariable', 'bp_set_word', { variableId: 'received_word' });
  const loop = node(main, 'forLoop', 'bp_sum_loop', { firstIndex: 1, lastIndex: 3 });
  const score = node(main, 'getVariable', 'bp_get_score', { variableId: 'score' });
  const add = node(main, 'math', 'bp_add_score');
  const setScore = node(main, 'setVariable', 'bp_set_score', { variableId: 'score' });
  const sequence = node(main, 'sequence', 'bp_loop_sequence');
  const emptyBranch = node(main, 'branch', 'bp_empty_branch', { condition: false });
  const wrongScore = node(main, 'setVariable', 'bp_wrong_score', { variableId: 'score', value: 999 });
  const outer = node(main, 'forLoop', 'bp_outer', { firstIndex: 1, lastIndex: 2 });
  const inner = node(main, 'forLoop', 'bp_inner', { firstIndex: 1, lastIndex: 3 });
  const nestedCount = node(main, 'getVariable', 'bp_get_nested', { variableId: 'nested_count' });
  const plusOne = node(main, 'math', 'bp_plus_one', { b: 1 });
  const setNested = node(main, 'setVariable', 'bp_set_nested', { variableId: 'nested_count' });
  const finish = node(main, 'return', 'bp_main_return');
  synchronizeBlueprintSignatures(project);
  chain(main, event, background, show, effect, music, sound, wait, firstCall, secondCall, firstResult, secondResult, flagResult, wordResult, loop);
  link(main, firstCall, 'out_doubled', firstResult, 'value'); link(main, secondCall, 'out_doubled', secondResult, 'value'); link(main, firstCall, 'out_flag', flagResult, 'value'); link(main, firstCall, 'out_word_result', wordResult, 'value');
  link(main, score, 'value', add, 'a'); link(main, loop, 'index', add, 'b'); link(main, add, 'result', setScore, 'value');
  link(main, loop, 'loop_body', sequence, 'exec_in'); link(main, sequence, 'then_0', setScore, 'exec_in'); link(main, sequence, 'then_1', emptyBranch, 'exec_in'); link(main, emptyBranch, 'true', wrongScore, 'exec_in');
  link(main, loop, 'completed', outer, 'exec_in'); link(main, outer, 'loop_body', inner, 'exec_in'); link(main, inner, 'loop_body', setNested, 'exec_in'); link(main, outer, 'completed', finish, 'exec_in');
  link(main, nestedCount, 'value', plusOne, 'a'); link(main, plusOne, 'result', setNested, 'value');

  const menu = graph('bp_menu', '打开设置并返回');
  chain(menu, node(menu, 'event', 'bp_menu_event'), node(menu, 'uiAction', 'bp_open_menu', { screen: 'preferences' }), node(menu, 'setVariable', 'bp_menu_flag', { variableId: 'menu_returned', value: true }), node(menu, 'return', 'bp_menu_return'));
  const cleanup = graph('bp_cleanup', '角色与音乐离场');
  chain(cleanup, node(cleanup, 'event', 'bp_cleanup_event'), node(cleanup, 'hideCharacter', 'bp_hide', { characterId: 'bp_actor', transition: 'none' }), node(cleanup, 'stopMusic', 'bp_stop', { fade: 0 }), node(cleanup, 'delay', 'bp_stop_wait', { seconds: 0.01 }), node(cleanup, 'return', 'bp_cleanup_return'));
  const transfer = graph('bp_transfer', '转场到目标剧情');
  chain(transfer, node(transfer, 'event', 'bp_transfer_event'), node(transfer, 'switchScene', 'bp_transfer_scene', { sceneId: 'bp_after_scene', mode: 'fade', duration: 0.1, color: '#182436' }));
  const base = { sceneId: 'bp_scene', x: 0, y: 0 };
  project.entryId = 'bp_story_start';
  project.nodes = [
    { ...base, id: 'bp_story_start', name: '开始', kind: 'start', next: 'bp_story' },
    { ...base, id: 'bp_story', name: '蓝图验收', kind: 'passage', next: 'bp_finish', lines: [
      { id: 'bp_line_main', text: '蓝图演出与计算已完成。', actions: [{ kind: 'blueprint', blueprintId: main.id }] },
      { id: 'bp_line_menu', text: '设置菜单关闭后继续。', actions: [{ kind: 'blueprint', blueprintId: menu.id }] },
      { id: 'bp_line_cleanup', text: '角色和音乐已经离场。', actions: [{ kind: 'blueprint', blueprintId: cleanup.id }] },
      { id: 'bp_line_transfer', text: '这句话应被场景跳转跳过。', actions: [{ kind: 'blueprint', blueprintId: transfer.id }] },
    ] },
    { ...base, sceneId: 'bp_after_scene', id: 'bp_after', name: '目标剧情', kind: 'passage', lines: [{ id: 'bp_line_after', text: '已进入目标场景。', actions: [] }], next: 'bp_finish' },
    ...endingPerformanceNodes(project, { ...base, sceneId: 'bp_after_scene', id: 'bp_finish', name: '结束' }, '蓝图验收结束。'),
  ];
  synchronizeBlueprintSignatures(project);
  return projectSchema.parse(project);
}
