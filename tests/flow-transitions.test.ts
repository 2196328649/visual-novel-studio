import assert from 'node:assert/strict';
import test from 'node:test';
import { connectNode, createProject, newNode, projectSchema, type Project, type StoryNode } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { mutateProject } from '../src/core/project-mutation';
import { defaultFlowTransition, flowTransitionDuration, flowTransitionName, flowTransitionSchema, flowTransitionSecondsText, flowTransitionSummary, flowTransitionWithDuration, setStoryTransition, storyTransition, storyTransitionPorts, type FlowTransition } from '../src/core/flow-transitions';
import { copyStoryModule } from '../src/core/story-modules';
import { createStoryGroup, ungroupStoryGroup } from '../src/core/story-groups';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { editTextDocument, refreshTextReferenceNames, textDocument } from '../src/core/text-document';
import { textAssistance } from '../src/core/text-completion';
import { textChapters } from '../src/core/text-chapters';

const dissolve: FlowTransition = { mode: 'dissolve', duration: 0.8 };
const color: FlowTransition = { mode: 'color', outDuration: 0.3, hold: 0.2, inDuration: 0.5, color: '#18304F' };

function fixture(): Project {
  const project = createProject('连线过渡');
  project.chapters = [{ id: 'chapter', name: '第一章' }];
  project.scenes = [{ id: 'scene', name: '开场', chapterId: 'chapter' }];
  project.variables = [{ id: 'score', name: '得分', type: 'number', initial: 0, persistent: false }];
  project.entryId = 'start';
  const base = { sceneId: 'scene', x: 0, y: 0 };
  project.nodes = [
    { ...base, kind: 'start', id: 'start', name: '开始', next: 'first' },
    { ...base, kind: 'passage', id: 'first', name: '对白', next: 'choice', lines: [{ id: 'first_line', text: '从这里开始。', actions: [] }] },
    { ...base, kind: 'choice', id: 'choice', name: '岔路', prompt: '怎么走？', choices: [{ id: 'option_left', text: '左边', target: 'decision' }, { id: 'option_right', text: '右边', target: 'operation' }] },
    { ...base, kind: 'condition', id: 'decision', name: '检查得分', condition: { kind: 'compare', variableId: 'score', operator: 'gte', value: 1 }, yes: 'destination', no: 'ending' },
    { ...base, kind: 'set', id: 'operation', name: '增加得分', variableId: 'score', operation: 'add', value: 1, next: 'call' },
    { ...base, kind: 'call', id: 'call', name: '调用共同剧情', target: 'destination', next: 'jump' },
    { ...base, kind: 'jump', id: 'jump', name: '跳到结束', target: 'ending' },
    { ...base, kind: 'passage', id: 'destination', name: '共同剧情', next: 'return', lines: [{ id: 'destination_line', text: '到达共同剧情。', actions: [] }] },
    { ...base, kind: 'return', id: 'return', name: '返回调用' },
    { ...base, kind: 'end', id: 'ending', name: '结束' },
  ];
  return project;
}

function transitionSnapshot(project: Project) {
  return Object.fromEntries(project.nodes.filter(node => node.transitions).map(node => [node.id, node.transitions]));
}

function noParseErrors(result: ReturnType<typeof applyTextScript>) {
  assert.deepEqual(result.issues.filter(issue => issue.severity === 'error'), []);
  return result.project;
}

function closeTime(actual: number, expected: number): void {
  const tolerance = Math.max(Number.MIN_VALUE, Math.abs(expected) * Number.EPSILON * 16);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} 与 ${expected} 的误差超出数值精度`);
}

test('过渡schema区分沿用与明确切换，拒绝非法时长、溢出和颜色', () => {
  for (const mode of ['none', 'dissolve', 'color'] as const) assert.equal(flowTransitionSchema.safeParse(defaultFlowTransition(mode)).success, true);
  for (const duration of [-1, Infinity, -Infinity, NaN]) assert.equal(flowTransitionSchema.safeParse({ mode: 'dissolve', duration }).success, false);
  for (const phase of ['outDuration', 'hold', 'inDuration']) assert.equal(flowTransitionSchema.safeParse({ ...color, [phase]: -0.1 }).success, false);
  assert.equal(flowTransitionSchema.safeParse({ ...color, outDuration: Number.MAX_VALUE, inDuration: Number.MAX_VALUE }).success, false);
  for (const invalidColor of ['red', '#000', '#00000000', '#zzzzzz']) assert.equal(flowTransitionSchema.safeParse({ ...color, color: invalidColor }).success, false);
  assert.equal(flowTransitionSchema.safeParse({ mode: 'unknown' }).success, false);
  const project = fixture(), before = structuredClone(project);
  assert.deepEqual(projectSchema.parse(project), before);
  assert.equal('transitions' in project.nodes[0], false);
  assert.equal(storyTransition(project.nodes[0], 'next'), undefined);
  assert.equal(flowTransitionSummary(undefined), '不单独设置');
  assert.equal(flowTransitionSummary({ mode: 'none' }), '直接切换');
});

test('总时长保持纯色三阶段比例，零总长分配到淡出淡入而不改变颜色', () => {
  assert.equal(flowTransitionDuration(undefined), 0);
  assert.equal(flowTransitionDuration({ mode: 'none' }), 0);
  assert.equal(flowTransitionDuration(defaultFlowTransition('color')), 0.8);
  for (const duration of [2, 0.1, 1 / 3, 1e-200, 1e200]) {
    const scaled = flowTransitionWithDuration(color, duration);
    assert.ok(scaled.mode === 'color');
    assert.equal(scaled.color, color.color);
    closeTime(flowTransitionDuration(scaled), duration);
    closeTime(scaled.outDuration, duration * 0.3);
    closeTime(scaled.hold, duration * 0.2);
    closeTime(scaled.inDuration, duration * 0.5);
  }
  assert.deepEqual(flowTransitionWithDuration({ ...color, outDuration: 0, hold: 0, inDuration: 0 }, 2), { ...color, outDuration: 1, hold: 0, inDuration: 1 });
  assert.deepEqual(flowTransitionWithDuration(color, 0), { ...color, outDuration: 0, hold: 0, inDuration: 0 });
  assert.deepEqual(flowTransitionWithDuration(dissolve, 0.25), { mode: 'dissolve', duration: 0.25 });
  assert.equal(flowTransitionName({ ...color, color: '#000000' }), '淡黑');
  assert.equal(flowTransitionName({ ...color, color: '#FFFFFF' }), '淡白');
  assert.equal(flowTransitionName(color), '经过颜色');
  for (const duration of [-1, Infinity, NaN]) assert.throws(() => flowTransitionWithDuration(color, duration), /时长/);
});

test('时长缩放保留很短的正阶段，补差不吞掉淡入或淡出', () => {
  for (const tinyPhase of ['outDuration', 'inDuration'] as const) {
    const largePhase = tinyPhase === 'outDuration' ? 'inDuration' : 'outDuration';
    const original = { ...color, outDuration: 0, hold: 0, inDuration: 0, [tinyPhase]: 1e-300, [largePhase]: 1e300 };
    const scaled = flowTransitionWithDuration(original, 1e300);
    assert.ok(scaled.mode === 'color');
    assert.equal(scaled[tinyPhase], 1e-300);
    assert.equal(flowTransitionDuration(scaled), 1e300);
  }
  const tinyTail = flowTransitionWithDuration({ ...color, inDuration: 1e-200 }, 2);
  assert.ok(tinyTail.mode === 'color');
  assert.ok(tinyTail.inDuration > 0);
  closeTime(tinyTail.inDuration, 4e-200);
  closeTime(flowTransitionDuration(tinyTail), 2);
  const fromZero = flowTransitionWithDuration({ ...color, outDuration: 0, hold: 0, inDuration: 0 }, Number.MIN_VALUE);
  assert.equal(flowTransitionDuration(fromZero), Number.MIN_VALUE);
  for (const [scale, duration] of [[1e300, 1e-20], [1e-300, 1e300]]) {
    const scaled = flowTransitionWithDuration({ ...color, outDuration: 0.3 * scale, hold: 0.2 * scale, inDuration: 0.5 * scale }, duration);
    assert.ok(scaled.mode === 'color');
    closeTime(scaled.outDuration, duration * 0.3);
    closeTime(scaled.hold, duration * 0.2);
    closeTime(scaled.inDuration, duration * 0.5);
    closeTime(flowTransitionDuration(scaled), duration);
  }
});

test('秒数显示去除浮点长尾但不把极小正时长显示成零', () => {
  assert.equal(flowTransitionSecondsText(0.1 + 0.2), '0.3');
  assert.equal(flowTransitionSecondsText(0.9999999999999999), '1');
  assert.equal(flowTransitionSecondsText(1 / 3), '0.333333333333');
  assert.equal(flowTransitionSecondsText(0), '0');
  assert.equal(flowTransitionSecondsText(1e-12), '1e-12');
  assert.equal(Number(flowTransitionSecondsText(Number.MIN_VALUE)), Number.MIN_VALUE);
  const largestDisplayed = Number(flowTransitionSecondsText(Number.MAX_VALUE));
  assert.ok(Number.isFinite(largestDisplayed) && largestDisplayed > 0);
  assert.ok(Math.abs(largestDisplayed / Number.MAX_VALUE - 1) <= 5e-12);
  assert.equal(flowTransitionSchema.safeParse({ mode: 'dissolve', duration: largestDisplayed }).success, true);
  const precise: FlowTransition = { mode: 'dissolve', duration: 0.1 + 0.2 };
  assert.equal(flowTransitionSummary(precise), '叠化 · 0.3 秒');
  assert.equal(precise.duration, 0.1 + 0.2);
  assert.equal(flowTransitionSummary({ mode: 'dissolve', duration: 1e-12 }), '叠化 · 1e-12 秒');
});

test('真实端口按节点类型提供，断开保留、返回标题继承值禁止新设置', () => {
  const project = fixture();
  const expected: Partial<Record<StoryNode['kind'], string[]>> = { start: ['next'], passage: ['next'], choice: ['option_left', 'option_right'], condition: ['yes', 'no'], set: ['next'], call: ['target', 'next'], jump: ['target'], return: [], end: [] };
  for (const node of project.nodes) assert.deepEqual(storyTransitionPorts(node).map(item => item.port), expected[node.kind]);
  const interaction = newNode('interaction', 'scene'), minigame = newNode('minigame', 'scene');
  assert.ok(interaction.kind === 'interaction');
  assert.deepEqual(storyTransitionPorts(interaction).map(item => item.port), [interaction.hotspots[0].id, 'timeout', 'cancel']);
  assert.deepEqual(storyTransitionPorts(minigame).map(item => item.port), ['success', 'failure', 'cancel']);
  const chapter = newNode('chapterTitle', 'scene');
  assert.ok(chapter.kind === 'chapterTitle');
  assert.deepEqual(storyTransitionPorts(chapter), [{ port: 'next', target: undefined }]);
  chapter.playback = { onComplete: 'title' };
  assert.deepEqual(storyTransitionPorts(chapter), []);
  const graph = createBlueprintGraph('effect', '返回标题演出');
  graph.playback = { onComplete: 'title' }; project.blueprints.push(graph);
  const passage = project.nodes.find(node => node.id === 'first')!;
  assert.ok(passage.kind === 'passage');
  passage.lines = [{ id: 'silent', silent: true, text: '', actions: [{ kind: 'blueprint', blueprintId: graph.id }] }];
  assert.equal(storyTransitionPorts(passage).length, 1);
  assert.deepEqual(storyTransitionPorts(passage, project), []);
  assert.throws(() => setStoryTransition(project, passage.id, 'next', dissolve), /可用.*出口/);
});

test('设置是原子操作，重复相同值无历史变化，修复未知端口可以清除', () => {
  const project = fixture(), original = structuredClone(project);
  assert.throws(() => setStoryTransition(project, 'first', 'missing', dissolve), /出口/);
  assert.throws(() => setStoryTransition(project, 'first', 'next', { mode: 'dissolve', duration: -1 }), /无效/);
  assert.deepEqual(project, original);
  const after = mutateProject(project, draft => { assert.equal(setStoryTransition(draft, 'first', 'next', color), true); });
  assert.deepEqual(project, original);
  const beforeMap = after.nodes.find(node => node.id === 'first')!.transitions;
  const reordered = { color: '#18304F', inDuration: 0.5, hold: 0.2, outDuration: 0.3, mode: 'color' } as const;
  assert.equal(mutateProject(after, draft => { assert.equal(setStoryTransition(draft, 'first', 'next', reordered), false); }), after);
  assert.equal(after.nodes.find(node => node.id === 'first')!.transitions, beforeMap);
  const cut = mutateProject(after, draft => { setStoryTransition(draft, 'first', 'next', { mode: 'none' }); });
  assert.deepEqual(storyTransition(cut.nodes.find(node => node.id === 'first')!, 'next'), { mode: 'none' });
  assert.equal(setStoryTransition(cut, 'first', 'next', undefined), true);
  assert.equal(setStoryTransition(cut, 'first', 'next', undefined), false);
  assert.equal('transitions' in cut.nodes.find(node => node.id === 'first')!, false);
  cut.nodes[0].transitions = { removed_port: color };
  assert.equal(setStoryTransition(cut, cut.nodes[0].id, 'removed_port', undefined), true);
  assert.equal(cut.nodes[0].transitions, undefined);
});

test('改接目标和打组不迁移源出口设置，复制分支则重映射身份并独立持有设置', () => {
  const project = fixture();
  setStoryTransition(project, 'first', 'next', color);
  const first = project.nodes.find(node => node.id === 'first')!;
  for (const target of [undefined, 'ending']) {
    const changed = connectNode(first, 'next', target);
    assert.deepEqual(storyTransition(changed, 'next'), color);
    assert.equal(storyTransitionPorts(changed)[0].target, target);
  }
  const group = createStoryGroup(project, { name: '开场组', sceneId: 'scene', nodeIds: ['first', 'choice'], groupIds: [] });
  ungroupStoryGroup(project, group.id);
  assert.deepEqual(storyTransition(first, 'next'), color);
  const choice = project.nodes.find(node => node.id === 'choice')!;
  assert.ok(choice.kind === 'choice');
  choice.transitions = { option_left: color, option_right: { mode: 'none' } };
  const choiceCopy = copyStoryModule(choice);
  assert.ok(choiceCopy.kind === 'choice');
  assert.notEqual(choiceCopy.id, choice.id);
  assert.deepEqual(Object.keys(choiceCopy.transitions!).sort(), choiceCopy.choices.map(item => item.id).sort());
  assert.deepEqual(storyTransition(choiceCopy, choiceCopy.choices[0].id), color);
  assert.notEqual(storyTransition(choiceCopy, choiceCopy.choices[0].id), color);
  const interaction = newNode('interaction', 'scene');
  assert.ok(interaction.kind === 'interaction');
  interaction.transitions = { [interaction.hotspots[0].id]: dissolve, timeout: color, cancel: { mode: 'none' } };
  const interactionCopy = copyStoryModule(interaction);
  assert.ok(interactionCopy.kind === 'interaction');
  assert.deepEqual(Object.keys(interactionCopy.transitions!).sort(), [interactionCopy.hotspots[0].id, 'timeout', 'cancel'].sort());
  assert.deepEqual(storyTransition(interactionCopy, interactionCopy.hotspots[0].id), dissolve);
  assert.notEqual(interactionCopy.hotspots[0].id, interaction.hotspots[0].id);
});

test('各类可声明出口的过渡从文本恢复，简单选择可导入空图且保留分支ID', () => {
  const project = fixture();
  let count = 0;
  for (const node of project.nodes) for (const { port } of storyTransitionPorts(node, project)) setStoryTransition(project, node.id, port, count++ % 3 === 0 ? { mode: 'none' } : count % 2 ? color : dissolve);
  const source = projectToText(project);
  assert.match(source, /@选项标记：option_left\n@选项：左边/);
  assert.match(source, /@连线过渡：模块=岔路【choice】，出口=左边【option_left】/);
  const empty = structuredClone(project); empty.nodes = [];
  const restored = noParseErrors(applyTextScript(empty, source));
  assert.deepEqual(transitionSnapshot(restored), transitionSnapshot(project));
  const choices = restored.nodes.find(node => node.id === 'choice');
  assert.ok(choices?.kind === 'choice');
  assert.deepEqual(choices.choices.map(item => item.id), ['option_left', 'option_right']);
  assert.equal(projectSchema.safeParse(restored).success, true);
  const stripped = source.split('\n').filter(line => !line.startsWith('@连线过渡：')).join('\n');
  assert.deepEqual(transitionSnapshot(noParseErrors(applyTextScript(project, stripped))), {});
});

test('复杂实例保留既有资源依赖，过渡只由可删文本声明恢复', () => {
  const project = fixture();
  const complexChoice = project.nodes.find(node => node.id === 'choice')!;
  assert.ok(complexChoice.kind === 'choice');
  complexChoice.choices[0].condition = { kind: 'all', conditions: [] };
  complexChoice.choices[0].text = '多行\n选项';
  const interaction = newNode('interaction', 'scene'), minigame = newNode('minigame', 'scene');
  interaction.id = 'interaction'; minigame.id = 'minigame';
  project.nodes.splice(-1, 0, interaction, minigame);
  for (const node of [complexChoice, interaction, minigame]) for (const { port } of storyTransitionPorts(node)) setStoryTransition(project, node.id, port, color);
  const source = projectToText(project);
  assert.match(source, /@实例：岔路【choice】/);
  assert.match(source, /出口="多行\\n选项【option_left】"/);
  const withoutHidden = structuredClone(project);
  for (const node of withoutHidden.nodes) delete node.transitions;
  const restored = noParseErrors(applyTextScript(withoutHidden, source));
  assert.deepEqual(transitionSnapshot(restored), transitionSnapshot(project));
  assert.deepEqual(transitionSnapshot(noParseErrors(applyTextScript(project, source.split('\n').filter(line => !line.startsWith('@连线过渡：')).join('\n')))), {});
});

test('文本节点复用保留设置并将选择和热点端口重映射到副本', () => {
  const project = fixture();
  const choice = project.nodes.find(node => node.id === 'choice')!;
  assert.ok(choice.kind === 'choice');
  choice.transitions = { option_left: color, option_right: dissolve };
  const interaction = newNode('interaction', 'scene');
  interaction.id = 'interaction';
  assert.ok(interaction.kind === 'interaction');
  interaction.transitions = { [interaction.hotspots[0].id]: color, timeout: dissolve };
  project.nodes.push(interaction);
  const parsed = noParseErrors(applyTextScript(project, `${projectToText(project)}\n@复用节点：岔路【choice】\n@复用节点：点击互动【interaction】`));
  const choiceCopy = parsed.nodes.find(node => node.kind === 'choice' && node.id !== 'choice');
  assert.ok(choiceCopy?.kind === 'choice');
  assert.deepEqual(Object.keys(choiceCopy.transitions!).sort(), choiceCopy.choices.map(item => item.id).sort());
  assert.deepEqual(storyTransition(choiceCopy, choiceCopy.choices[0].id), color);
  const interactionCopy = parsed.nodes.find(node => node.kind === 'interaction' && node.id !== interaction.id);
  assert.ok(interactionCopy?.kind === 'interaction');
  assert.deepEqual(storyTransition(interactionCopy, interactionCopy.hotspots[0].id), color);
  assert.equal(storyTransition(interactionCopy, interaction.hotspots[0].id), undefined);
  assert.deepEqual(storyTransition(interactionCopy, 'timeout'), dissolve);
});

test('独立演出边界、隐藏节点标记及跳转后的过渡不会生成新台词或模块', () => {
  const project = fixture();
  const first = project.nodes.find(node => node.id === 'first')!;
  assert.ok(first.kind === 'passage');
  first.textHeading = false;
  first.lines = [{ id: 'performance_line', text: '', silent: true, actions: [{ kind: 'pause', seconds: 0.2 }] }];
  setStoryTransition(project, 'first', 'next', color);
  setStoryTransition(project, 'jump', 'target', dissolve);
  const restored = noParseErrors(applyTextScript(project, projectToText(project)));
  assert.equal(restored.nodes.length, project.nodes.length);
  assert.deepEqual(transitionSnapshot(restored), transitionSnapshot(project));
  const performance = restored.nodes.find(node => node.id === 'first');
  assert.ok(performance?.kind === 'passage');
  assert.equal(performance.lines.length, 1);
  assert.equal(performance.lines[0].silent, true);
  assert.deepEqual(performance.lines[0].actions, first.lines[0].actions);
});

test('隐藏选项身份仍保留可编辑转场，改字和章节范围编辑不会丢失端口绑定', () => {
  const project = fixture(); setStoryTransition(project, 'choice', 'option_left', color);
  const source = projectToText(project), parse = applyTextScript(project, source), document = textDocument(source, parse.sourceMap);
  assert.doesNotMatch(document.text, /选项标记|对白标记|节点标记|【choice】|【option_left】/);
  assert.match(document.text, /@连线过渡：模块=岔路，出口=左边，方式=纯色/);
  const at = document.text.indexOf('@选项：左边') + '@选项：'.length;
  const edited = editTextDocument(document, { start: at, end: at + 2, text: '西边' });
  const result = noParseErrors(applyTextScript(project, edited));
  const choice = result.nodes.find(node => node.id === 'choice');
  assert.ok(choice?.kind === 'choice');
  assert.equal(choice.choices[0].id, 'option_left');
  assert.equal(choice.choices[0].text, '西边');
  assert.deepEqual(storyTransition(choice, 'option_left'), color);
  const refreshed = refreshTextReferenceNames(result, edited);
  assert.match(refreshed, /出口=西边【option_left】/);
  choice.choices[0].text = '西边，先等等';
  const quoted = refreshTextReferenceNames(result, refreshed);
  assert.match(quoted, /出口="西边，先等等【option_left】"/);
  assert.deepEqual(transitionSnapshot(noParseErrors(applyTextScript(result, quoted))), transitionSnapshot(project));
  const range = textChapters(source, project.chapters).find(chapter => chapter.chapterId === 'chapter')!;
  const scoped = textDocument(source, parse.sourceMap, { range });
  assert.doesNotMatch(scoped.text, /选项标记/);
  const scopedEdit = editTextDocument(scoped, { start: 0, end: 0, text: '// 章节说明\n' });
  assert.deepEqual(transitionSnapshot(noParseErrors(applyTextScript(project, scopedEdit))), transitionSnapshot(project));
  const without = document.text.indexOf('@连线过渡：'), end = document.text.indexOf('\n', without);
  const removed = editTextDocument(document, { start: without, end: end < 0 ? document.text.length : end + 1, text: '' });
  assert.deepEqual(transitionSnapshot(noParseErrors(applyTextScript(project, removed))), {});
});

test('手写出口支持可读名称和固定端口别名，重名选项需要明确引用', () => {
  const project = fixture();
  const choice = project.nodes.find(node => node.id === 'choice')!;
  assert.ok(choice.kind === 'choice');
  choice.choices[0].text = 'left';
  const source = projectToText(project);
  const readable = noParseErrors(applyTextScript(project, `${source}\n@连线过渡：模块=岔路，出口=left，方式=叠化\n@连线过渡：模块=对白，出口=继续，方式=直接切换`));
  assert.deepEqual(storyTransition(readable.nodes.find(node => node.id === 'choice')!, 'option_left'), dissolve);
  assert.deepEqual(storyTransition(readable.nodes.find(node => node.id === 'first')!, 'next'), { mode: 'none' });
  choice.choices[1].text = 'left';
  const duplicate = applyTextScript(project, `${projectToText(project)}\n@连线过渡：模块=岔路，出口=left，方式=叠化`);
  assert.ok(duplicate.issues.some(issue => issue.severity === 'error' && /歧义/.test(issue.message)));
});

test('选项删除保留可定位失效声明，错误和重复声明不悄悄覆盖', () => {
  const project = fixture(); setStoryTransition(project, 'choice', 'option_left', color);
  const source = projectToText(project), before = structuredClone(project);
  const removed = source.replace(/@选项标记：option_left\n@选项：左边[^\n]*\n/, '');
  const deletion = applyTextScript(project, removed);
  assert.ok(deletion.issues.some(issue => issue.severity === 'warning' && issue.nodeId === 'choice' && issue.sourceLine > 0 && issue.message.includes('出口')));
  assert.deepEqual(storyTransition(deletion.project.nodes.find(node => node.id === 'choice')!, 'option_left'), color);
  const repeated = applyTextScript(project, source + '\n@连线过渡：模块=岔路【choice】，出口=option_left，方式=直接切换');
  assert.ok(repeated.issues.some(issue => issue.severity === 'error' && /重复/.test(issue.message)));
  assert.deepEqual(storyTransition(repeated.project.nodes.find(node => node.id === 'choice')!, 'option_left'), color);
  for (const suffix of ['方式=叠化，时长=-1', '方式=叠化，时长=Infinity', '方式=纯色，颜色=#000', '方式=未知', '方式=直接切换，时长=1', '方式=叠化，时长=1，时长=2']) {
    const parsed = applyTextScript(project, `${source}\n@连线过渡：模块=对白【first】，出口=next，${suffix}`);
    assert.ok(parsed.issues.some(issue => issue.severity === 'error'), suffix);
    assert.equal(storyTransition(parsed.project.nodes.find(node => node.id === 'first')!, 'next'), undefined);
  }
  assert.deepEqual(project, before);
});

test('补全只给来源模块的真实出口，结构标记不会出现在作者指令菜单', () => {
  const project = fixture();
  const line = '@连线过渡：模块=岔路【choice】，出口=';
  const completion = textAssistance(project, line, line.length)!;
  assert.ok(completion.items.some(item => item.insertText === '左边【option_left】'));
  assert.ok(completion.items.some(item => item.insertText === '右边【option_right】'));
  assert.equal(completion.items.some(item => item.insertText.includes('next')), false);
  const commands = textAssistance(project, '@选项标记', '@选项标记'.length);
  assert.equal(commands?.items.some(item => item.label === '选项标记') ?? false, false);
});
