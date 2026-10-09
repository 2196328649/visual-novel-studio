import { projectGraphs, addProjectGraphs } from './project-resources';
import { makeId, type BlueprintGraph, type BlueprintNode, type Project, type UiComponent, type VariableValue } from './model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures, type BlueprintNodeType } from './blueprint';
import { assignBlueprintGroup } from './blueprint-authoring';

const uniqueName = (project: Project, base: string) => { let name = base, index = 2; while (projectGraphs(project).some(graph => graph.name === name || graph.callName === name)) name = `${base} ${index++}`; return name; };
function builder(graph: BlueprintGraph) {
  let index = 0;
  const node = (type: BlueprintNodeType, properties: Record<string, VariableValue> = {}, name?: string) => {
    const item = blueprintNodeDefaults(type); item.properties = { ...item.properties, ...properties }; if (name) item.name = name;
    item.x = 80 + (index % 6) * 410; item.y = 280 + Math.floor(index++ / 6) * 470; graph.nodes.push(item); return item;
  };
  const link = (from: BlueprintNode, out: string, to: BlueprintNode, input: string) => { const error = connectBlueprintPins(graph, from.id, out, to.id, input); if (error) throw new Error(error); };
  const chain = (...nodes: BlueprintNode[]) => { for (let i = 1; i < nodes.length; i++) link(nodes[i - 1], nodes[i - 1].pins.find(pin => pin.direction === 'output' && pin.dataType === 'exec')!.id, nodes[i], 'exec_in'); return nodes.at(-1)!; };
  return { node, link, chain };
}

/** An ordinary callable graph owns the game, UI callbacks and timer logic. */
export function addInteractionBlueprintExample(project: Project) {
  const graph = createBlueprintGraph('function', uniqueName(project, '限时点亮'));
  const pageId = makeId('custom_page');
  const component = (kind: UiComponent['kind'], name: string, text: string, x: number, y: number, width: number, height: number): UiComponent => ({ id: makeId('ui'), page: 'custom', kind, name, text, x, y, width, height, layer: 1, style: { textColor: '#e8edf3', background: kind === 'button' ? '#317960' : undefined, align: 'center', fontSize: kind === 'button' ? 26 : 24 } });
  const title = component('text', '玩法说明', '限时点亮：点击按钮或按空格', 0.16, 0.08, 0.68, 0.08);
  const scoreLabel = component('text', '计分文字', '命中 0', 0.18, 0.21, 0.25, 0.07);
  const timeLabel = component('text', '倒计时文字', '剩余时间', 0.55, 0.21, 0.27, 0.07);
  const target = component('button', '点亮按钮', '点亮', 0.42, 0.43, 0.16, 0.15);
  const status = component('text', '结果文字', '在倒计时结束前达到目标次数。', 0.15, 0.75, 0.7, 0.07);
  const close = component('button', '关闭按钮', '关闭并返回剧情', 0.34, 0.86, 0.32, 0.075);
  project.ui.customPages.push({ id: pageId, name: `${graph.name}界面`, components: [title, scoreLabel, timeLabel, target, status, close], background: '#17212d', modal: true });
  addProjectGraphs(project, graph);
  const state = (name: string, initial: VariableValue) => { const id = makeId('var'); project.variables.push({ id, name: `${graph.name}·${name}`, type: typeof initial as 'number' | 'boolean' | 'string', initial, persistent: false }); return id; };
  const score = state('得分', 0), remaining = state('剩余秒数', 8), goal = state('目标次数', 5), playing = state('进行中', false), result = state('结果', '取消');
  const countInput = blueprintPin(makeId('input'), '目标次数', 'input', 'number', 5), timeInput = blueprintPin(makeId('input'), '限时秒数', 'input', 'number', 8);
  const resultOutput = blueprintPin(makeId('output'), '结果', 'output', 'string', '取消');
  graph.exposedInputs.push(countInput, timeInput); graph.exposedOutputs.push(resultOutput);
  const { node, link, chain } = builder(graph);
  const read = (id: string) => node('getVariable', { variableId: id });
  const write = (id: string, value: VariableValue) => node('setVariable', { variableId: id, value });
  const ui = (componentId: string, property: string, value: VariableValue) => node('setUiProperty', { componentId, property, value });
  const valueLink = (from: BlueprintNode, to: BlueprintNode, input = 'value', output = 'value') => { synchronizeBlueprintSignatures(project); link(from, output, to, input); };
  const scoreRead = read(score), timeRead = read(remaining), goalRead = read(goal), playingRead = read(playing), resultRead = read(result);
  const scoreText = node('formatText', { format: '命中 {value}' }); valueLink(scoreRead, scoreText);
  const timeText = node('formatText', { format: '剩余 {value} 秒' }); valueLink(timeRead, timeText);
  const updateScore = ui(scoreLabel.id, 'text', ''), updateTime = ui(timeLabel.id, 'text', '');
  valueLink(scoreText, updateScore, 'value', 'text'); valueLink(timeText, updateTime, 'value', 'text');
  const initScore = write(score, 0), initGoal = write(goal, 5), initTime = write(remaining, 8), initPlaying = write(playing, true), initResult = write(result, '取消');
  valueLink(node('getInput', { inputId: countInput.id }), initGoal); valueLink(node('getInput', { inputId: timeInput.id }), initTime);
  const resets = [scoreLabel, timeLabel, target, status].map(component => node('resetUiComponent', { componentId: component.id }));
  const initScoreText = ui(scoreLabel.id, 'text', ''), initTimeText = ui(timeLabel.id, 'text', ''); valueLink(scoreText, initScoreText, 'value', 'text'); valueLink(timeText, initTimeText, 'value', 'text');
  const open = node('showUiPage', { pageId, wait: true }), output = node('setOutput', { outputId: resultOutput.id, value: '' }); valueLink(open, output, 'value', 'result');
  chain(graph.nodes[0], initScore, initGoal, initTime, initPlaying, initResult, ...resets, initScoreText, initTimeText, open, output);
  const click = node('eventClick', { componentId: target.id }), key = node('eventKey', { pageId, key: 'K_SPACE' });
  const canScore = node('branch'); valueLink(playingRead, canScore, 'condition'); link(click, 'exec', canScore, 'exec_in'); link(key, 'exec', canScore, 'exec_in');
  const add = node('math', { operation: 'add', b: 1 }); valueLink(scoreRead, add, 'a');
  const increment = write(score, 0); valueLink(add, increment, 'value', 'result'); link(canScore, 'true', increment, 'exec_in');
  const reached = node('compare', { operator: 'gte' }); valueLink(scoreRead, reached, 'a'); valueLink(goalRead, reached, 'b');
  const won = node('branch'); valueLink(reached, won, 'condition', 'result'); chain(increment, updateScore, won);
  const succeed = write(result, '成功'), successText = ui(status.id, 'text', '挑战成功！点击关闭返回剧情。');
  link(won, 'true', succeed, 'exec_in'); chain(succeed, write(playing, false), successText, ui(target.id, 'enabled', false));
  const x = node('random', { min: 0.15, max: 0.69 }), y = node('random', { min: 0.34, max: 0.55 });
  const moveX = ui(target.id, 'x', 0.4), moveY = ui(target.id, 'y', 0.4); valueLink(x, moveX); valueLink(y, moveY); link(won, 'false', moveX, 'exec_in'); chain(moveX, moveY);
  const tick = node('eventTimer', { pageId, interval: 1, repeat: true }), ticking = node('branch'); valueLink(playingRead, ticking, 'condition'); chain(tick, ticking);
  const subtract = node('math', { operation: 'subtract', b: 1 }); valueLink(timeRead, subtract, 'a');
  const countdown = write(remaining, 0); valueLink(subtract, countdown, 'value', 'result'); link(ticking, 'true', countdown, 'exec_in');
  const expired = node('compare', { operator: 'lte', b: 0 }); valueLink(timeRead, expired, 'a');
  const timeUp = node('branch'); valueLink(expired, timeUp, 'condition', 'result'); chain(countdown, updateTime, timeUp);
  const fail = write(result, '失败'); link(timeUp, 'true', fail, 'exec_in'); chain(fail, write(playing, false), ui(status.id, 'text', '时间到了。点击关闭返回剧情。'), ui(target.id, 'enabled', false));
  const closing = node('eventClick', { componentId: close.id }), finish = node('closeUiPage', { pageId, result: '取消' }); valueLink(resultRead, finish, 'result'); chain(closing, finish);
  synchronizeBlueprintSignatures(project); assignBlueprintGroup(project, graph.id, '交互示例');
  return { graphId: graph.id, pageId, scoreId: score, remainingId: remaining, resultId: result, targetId: target.id, closeId: close.id };
}

export function addParallelMotionExample(project: Project) {
  const graph = createBlueprintGraph('effect', uniqueName(project, '镜头震动同播'));
  const { node, chain } = builder(graph);
  const camera = node('camera', { x: 0.06, y: 0, zoom: 1.15, rotation: 0, duration: 1, easing: 'ease', wait: false });
  const shake = node('shake', { direction: 'horizontal', duration: 1, amplitude: 20, wait: true });
  camera.x = 470; camera.y = 80; shake.x = 860; shake.y = 80;
  chain(graph.nodes[0], camera, shake);
  const note = node('comment', { text: '移动镜头：等待完成=否 → 画面震动：等待完成=是。两者同时开始，1 秒后继续剧情。' }); note.x = 80; note.y = 330;
  addProjectGraphs(project, graph); assignBlueprintGroup(project, graph.id, '演出示例');
  return graph.id;
}
