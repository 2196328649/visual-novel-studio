import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type Project } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { compileProject } from '../src/runtime/compiler';

const json = (value: unknown) => JSON.parse(JSON.stringify(value));
function parse(source: string, input = createProject()) {
  const result = applyTextScript(input, source);
  assert.deepEqual(result.issues, []);
  return result.project;
}
function roundTrip(project: Project) {
  const source = projectToText(project);
  for (const heading of source.split('\n').filter(line => line.startsWith('#'))) assert.match(heading, /^# (章节|小章节|段落)：/);
  assert.doesNotMatch(source, /^@(接下来|目标|切换场景|场景-切换)[:：]/m);
  const restored = parse(source, project);
  assert.deepEqual(json(restored.nodes), json(project.nodes));
  assert.deepEqual(restored.scenes, project.scenes);
  assert.deepEqual(restored.chapters, project.chapters);
  assert.equal(restored.entryId, project.entryId);
  assert.deepEqual(compileProject(restored).files, compileProject(project).files);
}

test('a cleared story graph preserves its protected entry without synthesizing an ending', () => {
  const project = createProject('清空流程');
  project.nodes = project.nodes.filter(node => node.id === project.entryId);
  const start = project.nodes[0];
  assert.ok(start.kind === 'start'); delete start.next;
  const source = projectToText(project), restored = parse(source, project);
  assert.equal(projectToText(restored), source);
  roundTrip(project);
});

test('authored paragraph entries and return-only routes roundtrip without extra story nodes', () => {
  const project = createProject('自定义入口');
  project.nodes = project.nodes.filter(node => node.kind === 'passage');
  const passage = project.nodes[0]; assert.ok(passage.kind === 'passage');
  passage.lines[0].text = '还未连接下一段。'; delete passage.next; project.entryId = passage.id;
  roundTrip(project);
  project.nodes.push({ id:'return_node', name:'返回', kind:'return', sceneId:passage.sceneId, x:600, y:120 });
  passage.next = 'return_node';
  roundTrip(project);
});

test('plain text imports still create an implicit start and ending when no entry is declared', () => {
  const project = parse('旁白：独立导入的正文。');
  const start = project.nodes[0], passage = project.nodes[1], ending = project.nodes.at(-1)!;
  assert.equal(start.kind, 'start'); assert.equal(passage.kind, 'passage'); assert.equal(ending.kind, 'end');
  assert.equal(start.kind === 'start' && start.next, passage.id);
  assert.equal(passage.kind === 'passage' && passage.next, ending.id);
  roundTrip(project);
});

test('three headings only name directory entries; their names do not trigger operations', () => {
  const project = parse(`# 章节：章节标题
# 小章节：背景
# 段落：开始
旁白：这是一段对白。
# 段落：选择
旁白：这里没有选项。
# 小章节：跳转
# 段落：结局
旁白：这里仍然只是对白。`);
  assert.deepEqual(project.scenes.map(scene => scene.name), ['背景', '跳转']);
  const passages = project.nodes.filter(node => node.kind === 'passage');
  assert.deepEqual(passages.map(node => node.name), ['开始', '选择', '结局']);
  assert.ok(passages.every(node => node.lines.every(line => line.actions.length === 0)));
  assert.ok(!project.nodes.some(node => ['chapterTitle', 'choice', 'jump', 'set', 'call'].includes(node.kind)));
  roundTrip(project);
});

test('显式章节改名或移动已有小章节后，旧的归属不能把标题恢复回来', () => {
  const project = createProject('章节归属'), original = project.chapters[0], scene = project.scenes[0];
  const source = projectToText(project).replace(`第一章【${original.id}】`, '归');
  const renamed = parse(source, project);
  assert.deepEqual(renamed.chapters.map(chapter => chapter.name), ['归']);
  assert.equal(renamed.scenes.find(item => item.id === scene.id)?.chapterId, renamed.chapters[0].id);
  const moved = parse(source.replace('# 章节：归', '# 章节：另一章【chapter_elsewhere】'), project);
  assert.equal(moved.scenes.find(item => item.id === scene.id)?.chapterId, 'chapter_elsewhere');
  assert.deepEqual(moved.nodes.map(node => node.id), project.nodes.map(node => node.id));
});

test('没有显式章节标题的片段仍可恢复已有小章节的归属', () => {
  const project = createProject('小章节片段');
  project.chapters.push({ id: 'chapter_second', name: '第二章' });
  project.scenes[0].chapterId = 'chapter_second';
  const source = projectToText(project).split('\n').filter(line => !/^# 章节/.test(line)).join('\n');
  const restored = parse(source, project);
  assert.equal(restored.scenes[0].chapterId, 'chapter_second');
});

test('目录参数与标题中的引号、括号和冒号分别解析', () => {
  const source = '#章节(显示名称="酒醒, A)B: C",流程图=否):归(上):第一章【chapter_home】\n#小章节（流程图=是）：开场【scene_home】\n旁白：保留正文。';
  const project = parse(source);
  assert.equal(project.chapters[0].name, '归(上):第一章');
  assert.deepEqual(project.chapters[0].flowchart, { visible: false, name: '酒醒, A)B: C' });
  assert.equal(project.scenes[0].flowchart?.visible, true);
  assert.deepEqual(parse(projectToText(project), project).chapters, project.chapters);
});

test('entry can name an ordinary paragraph and is not overridden by a separate start node', () => {
  const project = parse("@入口：开始【opening】\n# 小章节：序章【scene】\n# 段落：蓝图起点【routing】\n@开始\n@跳转：开始【opening】\n# 段落：开始【opening】\n旁白：段落名称可以叫开始，但这一段仍然是对白。\n@返回标题界面");
  assert.equal(project.entryId, 'opening');
  assert.equal(project.nodes.find(node => node.id === 'opening')?.kind, 'passage');
  assert.equal(project.nodes.find(node => node.id === 'routing')?.kind, 'start');
  roundTrip(project);
});

test('neutral labels infer operation types while keeping each label ID and all flow links', () => {
  const project = parse("@入口：启动【entry】\n# 章节：第一章【chapter】\n# 小章节：夜宴【scene】\n# 段落：启动【entry】\n@开始\n@跳转：过场【title】\n# 段落：过场【title】\n@章节进入演出文字版：归，右侧字=\"\"，时长=0.3\n@独立演出\n# 段落：记住线索【state】\n@设置：谨慎 += 1\n# 段落：打听消息【call】\n@调用：回忆【memory】\n@跳转：抉择【choice】\n# 段落：抉择【choice】\n@选择：去哪里？\n@选项：留下 -> 留下【ending】\n@选项：出城 -> 离开【jump】\n# 段落：回忆【memory】\n旁白：前面的路已经封住了。\n# 段落：回到问路处【back】\n@返回\n# 段落：离开【jump】\n@跳转：留下【ending】\n# 段落：留下【ending】\n@返回标题界面");
  assert.deepEqual(project.nodes.map(node => [node.id, node.kind]), [
    ['entry', 'start'], ['title', 'passage'], ['state', 'set'], ['call', 'call'], ['choice', 'choice'], ['memory', 'passage'], ['back', 'return'], ['jump', 'jump'], ['ending', 'end'],
  ]);
  const call = project.nodes.find(node => node.id === 'call');
  assert.ok(call?.kind === 'call'); assert.equal(call.target, 'memory'); assert.equal(call.next, 'choice');
  const memory = project.nodes.find(node => node.id === 'memory');
  assert.ok(memory?.kind === 'passage'); assert.equal(memory.next, 'back');
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.match(compiled.files['game/story.rpy'], /call vn_node_memory[\s\S]*?jump vn_node_choice/);
  assert.match(compiled.files['game/story.rpy'], /label vn_node_back:[\s\S]*?return/);
  roundTrip(project);
  const endingAsDialogue = parse(projectToText(project).replace("@返回标题界面", '旁白：我们先等到天亮。'), project);
  const renamedType = endingAsDialogue.nodes.find(node => node.id === 'ending');
  assert.equal(renamedType?.kind, 'passage');
  assert.deepEqual([renamedType?.x, renamedType?.y], [project.nodes.at(-1)!.x, project.nodes.at(-1)!.y]);
});

test('consecutive state and title commands execute separately in written order', () => {
  const source = "# 段落：准备\n@设置：勇气 += 1\n@设置：勇气 += 2\n@章节进入演出文字版：标题=相遇，右侧字=\"\"，时长=0.2\n@独立演出\n@章节进入演出文字版：标题=相遇，右侧字=第二次，时长=0.4\n@独立演出\n旁白：我记住了。\n@返回标题界面";
  const project = parse(source);
  assert.deepEqual(project.nodes.map(node => node.kind), ['start', 'set', 'set', 'passage', 'passage', 'passage', 'end']);
  assert.deepEqual(project.nodes.filter(node => node.kind === 'set').map(node => node.value), [1, 2]);
  assert.deepEqual(project.nodes.flatMap(node => node.kind === 'passage' ? node.lines.flatMap(line => line.actions.filter(action => action.kind === 'blueprint').map(action => [action.inputs?.right_text, action.inputs?.duration])) : []), [['', 0.2], ['第二次', 0.4]]);
  assert.deepEqual(parse(source, project).nodes, project.nodes);
  roundTrip(project);
});

test('jump accepts paragraph, subchapter and chapter names or stable references, independent of declaration order', () => {
  const source = "@入口：出发【departure】\n# 章节：第一章【chapter_first】\n# 小章节：门外【outside】\n# 段落：出发【departure】\n旁白：我们出发了。\n@跳转：DESTINATION\n# 章节：第二章【chapter_home】\n# 小章节：回家【home】\n# 段落：备用【unused】\n旁白：不应进入这里。\n# 段落：入口【home_start】\n@开始\n@跳转：归途【arrival】\n# 段落：仍非入口【also_unused】\n旁白：不应进入这里。\n# 段落：归途【arrival】\n旁白：终于回家了。\n@返回标题界面";
  for (const target of ['归途', '回家', '第二章', '第二章/回家', '第二章/回家/归途', '归途【arrival】', '回家【home】', '第二章【chapter_home】', 'home', 'chapter_home']) {
    const project = parse(source.replace('DESTINATION', target));
    const departure = project.nodes.find(node => node.id === 'departure');
    assert.ok(departure?.kind === 'passage');
    assert.equal(departure.next, 'arrival', target);
    const block = compileProject(project).files['game/story.rpy'].split(`label vn_line_${departure.id}_${departure.lines.at(-1)!.id}:`)[1].split('\nlabel ')[0];
    assert.match(block, /jump vn_node_arrival/);
    roundTrip(project);
  }
});

test('a jump closes the previous passage, including when more dialogue follows', () => {
  const project = parse("# 段落：出发【departure】\n旁白：先说这句。\n@跳转：终点【arrival】\n旁白：这是后面新写的内容。\n# 段落：终点【arrival】\n旁白：跳到这里。\n@返回标题界面");
  const departure = project.nodes.find(node => node.id === 'departure');
  assert.ok(departure?.kind === 'passage');
  assert.deepEqual(departure.lines.map(line => line.text), ['先说这句。']);
  assert.equal(departure.next, 'arrival');
  assert.ok(project.nodes.some(node => node.kind === 'passage' && node.id !== 'departure' && node.lines.some(line => line.text === '这是后面新写的内容。')));
});

test('directory locations include unlabeled commands as well as named operations', () => {
  const source = "# 段落：正文\n旁白：开始。\n@设置：勇气 += 1\n@选择：继续吗？\n@选项：继续 -> 结尾\n# 段落：结尾\n@返回标题界面";
  const parsed = applyTextScript(createProject(), source);
  assert.deepEqual(parsed.issues, []);
  const located = (kind: string) => parsed.nodeLocations.find(location => parsed.project.nodes.find(node => node.id === location.nodeId)?.kind === kind)?.sourceLine;
  assert.equal(located('passage'), 1);
  assert.equal(located('set'), 3);
  assert.equal(located('choice'), 4);
  assert.equal(located('end'), 6);
});

test('standalone performance stays before the following flow operation', () => {
  for (const command of ['@设置：勇气 += 1', '@选择：选择？\n@选项：好 -> 结束', '@选项：好 -> 结束']) {
    const project = parse(`# 段落：准备\n@等待：0.2\n${command}\n# 段落：结束\n@返回标题界面`);
    const passage = project.nodes.find(node => node.kind === 'passage');
    assert.ok(passage?.kind === 'passage');
    assert.deepEqual(passage.lines[0].actions, [{ kind: 'pause', seconds: 0.2 }]);
    assert.equal(project.nodes.findIndex(node => node.id === passage.next), project.nodes.indexOf(passage) + 1);
  }
});

test('unsupported old declarations and routing commands report their source line', () => {
  for (const old of ['# 场景：旧', '# 开始：旧', '# 选择：旧', '# 章节标题：旧', '# 跳转：旧', '# 调用：旧', '# 返回：旧', '# 修改状态：旧', '# 结局：旧', '# 实例：旧', '@接下来：结束', '@目标：结束', '@切换场景：旧', '@场景-切换：旧', '@章节：旧', '@场景：旧', '@提示：旧', '@结局文字：旧']) {
    const result = applyTextScript(createProject(), `${old}\n# 段落：结束\n@返回标题界面`);
    assert.equal(result.issues.length, 1, old);
    assert.equal(result.issues[0].sourceLine, 1, old);
    assert.equal(result.issues[0].severity, 'error');
  }
});

test('cyclic directory entrances are diagnosed instead of overflowing, while playable loops remain valid', () => {
  const source = "# 小章节：甲\n# 段落：甲入口\n@开始\n@跳转：乙\n# 小章节：乙\n# 段落：乙入口\n@开始\n@跳转：甲\n@返回标题界面";
  const result = applyTextScript(createProject(), source);
  assert.ok(result.issues.some(issue => /入口/.test(issue.message)));
  const loop = applyTextScript(createProject(), '# 段落：空转【empty】\n旁白：\n@跳转：空转【empty】');
  assert.ok(loop.issues.some(issue => issue.sourceLine === 3 && /空循环/.test(issue.message)));
  assert.deepEqual(applyTextScript(createProject(), '# 段落：等待【wait】\n@等待：1\n旁白：\n@跳转：等待【wait】').issues, []);
});
