import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, newNode, projectSchema, type Project, type StoryNode } from '../src/core/model';
import { expandEffect, applyTextScript, projectToText, textCommandAction, textReference } from '../src/core/text-script';
import { extractDocxText } from '../src/desktop/text-import';
import { compileProject } from '../src/runtime/compiler';
import { endingPerformanceNodes } from '../src/core/ending-migration';

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build the smallest valid, stored (uncompressed) DOCX-like ZIP for the extractor fixture. */
function minimalDocx(documentXml: string): Buffer {
  const name = Buffer.from('word/document.xml', 'utf8');
  const data = Buffer.from(documentXml, 'utf8');
  const crc = crc32(data);
  const local = Buffer.alloc(30 + name.length + data.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); // stored
  local.writeUInt32LE(0, 10);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  name.copy(local, 30);
  data.copy(local, 30 + name.length);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10); // stored
  central.writeUInt32LE(0, 12);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

function fixtureProject(): Project {
  const project = createProject('文本导入测试');
  project.assets.push(
    { id: 'asset_bg', name: '校门', kind: 'image', path: 'assets/school.png' },
    { id: 'asset_bgm', name: '雨声', kind: 'audio', path: 'assets/rain.ogg' },
    { id: 'asset_sfx', name: '铃声', kind: 'audio', path: 'assets/bell.ogg' },
  );
  return project;
}

test('conditions declare readable branches and survive editing and a round trip', () => {
  const project = fixtureProject();
  project.variables.push({ id: 'caution', name: 'Caution', type: 'number', initial: 0, persistent: false });
  const source = '# 段落：Decision\n@条件：Caution >= 1\n@满足：Safe\n@不满足：Dream\n# 段落：Safe\n旁白：Safe route.\n@返回标题界面\n# 段落：Dream\n旁白：Dream route.\n@返回标题界面';
  const parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues, []);
  const node = parsed.project.nodes.find(node => node.name === 'Decision');
  assert.ok(node?.kind === 'condition');
  assert.deepEqual(node.condition, { kind: 'compare', variableId: 'caution', operator: 'gte', value: 1 });
  assert.equal(parsed.project.nodes.find(item => item.id === node.yes)?.name, 'Safe');
  assert.equal(parsed.project.nodes.find(item => item.id === node.no)?.name, 'Dream');
  const serialized = projectToText(parsed.project);
  assert.doesNotMatch(serialized, /@实例/);
  assert.match(serialized, /@条件：Caution【caution】 >= 1/);
  const reopened = applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(parsed.project))), serialized);
  assert.deepEqual(reopened.issues, []);
  assert.deepEqual(reopened.project.nodes, parsed.project.nodes);
  const edited = applyTextScript(reopened.project, serialized.replace('>= 1', '>= 2'));
  assert.deepEqual(edited.issues, []);
  const updated = edited.project.nodes.find(item => item.id === node.id);
  assert.ok(updated?.kind === 'condition');
  assert.equal(updated.condition.kind === 'compare' && updated.condition.value, 2);
  assert.equal(updated.yes, node.yes); assert.equal(updated.no, node.no);
  assert.deepEqual(compileProject(edited.project).diagnostics.filter(issue => issue.severity === 'error'), []);
});

test('compound conditions and empty branches round trip without losing configuration', () => {
  const project = fixtureProject();
  project.variables.push({ id: 'known', name: 'Known', type: 'boolean', initial: false, persistent: false });
  project.nodes = [{ id: 'decision', name: 'Decision', sceneId: project.scenes[0].id, x: 0, y: 0, kind: 'condition', condition: { kind: 'not', condition: { kind: 'compare', variableId: 'known', operator: 'eq', value: true } } }];
  project.entryId = 'decision';
  const parsed = applyTextScript(project, projectToText(project));
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.project.nodes, project.nodes);
  const invalid = applyTextScript(project, '@满足：Decision\n@条件：Missing >= 1');
  assert.ok(invalid.issues.some(issue => issue.sourceLine === 1 && issue.message.includes('@条件')));
  assert.ok(invalid.issues.some(issue => issue.sourceLine === 2 && issue.message.includes('Missing')));
});

const SOURCE = "@效果定义：入场\n@动作：震动：横向\n@动作：等待：0.2\n@效果结束\n\n# 小章节：校门\n# 段落：序幕\n@开始\n@跳转：相遇\n# 段落：相遇\n@背景：校门\n/背景音乐：雨声 循环\n@音效：铃声\n@效果：入场\n旁白：雨后的空气很清澈。\n小雨：你来了。\n---\n# 小章节：图书室\n# 段落：阅读\n旁白：我们翻开书页。\n# 段落：结束\n@返回标题界面";

function nodeSignature(project: Project): unknown {
  return project.nodes.map(node => ({
    id: node.id,
    kind: node.kind,
    name: node.name,
    sceneId: node.sceneId,
    lines: node.kind === 'passage' ? node.lines.map(line => ({ id: line.id, speakerId: line.speakerId, text: line.text })) : undefined,
  }));
}

test('中文文本可建立角色对白、旁白、场景和舞台动作', () => {
  const result = applyTextScript(fixtureProject(), SOURCE, 'story.txt');
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.project.scenes.map(scene => scene.name), ['校门', '图书室']);

  const passage = result.project.nodes.find(node => node.name === '相遇');
  assert.ok(passage && passage.kind === 'passage');
  if (!passage || passage.kind !== 'passage') return;
  assert.equal(passage.lines.length, 2);
  assert.equal(passage.lines[0].speakerId, undefined, '旁白不应创建角色');
  const rain = result.project.characters.find(character => character.name === '小雨');
  assert.ok(rain, '角色行应自动建立角色记录');
  assert.equal(passage.lines[1].speakerId, rain?.id);
  assert.deepEqual(passage.lines[0].actions.slice(0, 3), [
    { kind: 'background', assetId: 'asset_bg', transition: 'dissolve' },
    { kind: 'music', assetId: 'asset_bgm', loop: true, fade: 0.5 },
    { kind: 'sound', assetId: 'asset_sfx' },
  ]);
  const effectAction = passage.lines[0].actions.find(action => action.kind === 'effect');
  assert.ok(effectAction && effectAction.kind === 'effect');
  assert.deepEqual(expandEffect(result.project, effectAction.effectId), [
    { kind: 'shake', direction: 'horizontal' },
    { kind: 'pause', seconds: 0.2 },
  ]);
  assert.match(projectToText(result.project), /@背景：校门/);
  assert.match(projectToText(result.project), /@背景音乐：雨声 循环/);
  assert.match(projectToText(result.project), /@效果：入场/);
});

test('重复导入同一文本保留场景、节点和对白稳定 ID', () => {
  const first = applyTextScript(fixtureProject(), SOURCE, 'story.txt');
  const second = applyTextScript(first.project, SOURCE, 'story.txt');
  assert.deepEqual(nodeSignature(second.project), nodeSignature(first.project));
  assert.deepEqual(second.project.scenes.map(scene => scene.id), first.project.scenes.map(scene => scene.id));
  assert.deepEqual(second.project.characters.map(character => character.id), first.project.characters.map(character => character.id));
  assert.deepEqual(second.project.effects.map(effect => effect.id), first.project.effects.map(effect => effect.id));
});

test('在连续对白前插入内容不会挪用原有对白的 ID', () => {
  const oldSource = '# 小章节：校门\n# 段落：相遇\n旁白：第一句。\n小雨：第二句。\n旁白：第三句。';
  const first = applyTextScript(fixtureProject(), oldSource);
  const firstPassage = first.project.nodes.find(node => node.name === '相遇');
  assert.ok(firstPassage?.kind === 'passage');
  const oldIds = new Map(firstPassage.lines.map(line => [line.text, line.id]));
  const inserted = applyTextScript(first.project, oldSource.replace('旁白：第一句。', '旁白：新的一句。\n旁白：第一句。'));
  const nextPassage = inserted.project.nodes.find(node => node.name === '相遇');
  assert.ok(nextPassage?.kind === 'passage');
  for (const line of nextPassage.lines.filter(line => oldIds.has(line.text))) assert.equal(line.id, oldIds.get(line.text));
  assert.equal(new Set(nextPassage.lines.map(line => line.id)).size, nextPassage.lines.length);
  assert.ok(!new Set(oldIds.values()).has(nextPassage.lines[0].id));
});

test('修改对白与段内换行后仍保留对应行身份', () => {
  const source = '# 小章节：校门\n# 段落：相遇\n小雨：这句话在同一段里\n继续。\n\n旁白：下一段。';
  const first = applyTextScript(fixtureProject(), source);
  const original = first.project.nodes.find(node => node.name === '相遇');
  assert.ok(original?.kind === 'passage');
  const unchanged = applyTextScript(first.project, source);
  const unchangedNode = unchanged.project.nodes.find(node => node.name === '相遇');
  assert.ok(unchangedNode?.kind === 'passage');
  assert.deepEqual(unchangedNode.lines.map(line => line.id), original.lines.map(line => line.id));
  const edited = applyTextScript(first.project, source.replace('继续。', '继续讲述。'));
  const editedNode = edited.project.nodes.find(node => node.name === '相遇');
  assert.ok(editedNode?.kind === 'passage');
  assert.deepEqual(editedNode.lines.map(line => line.id), original.lines.map(line => line.id));
});

test('不同场景的同名段落按所属场景匹配原有身份', () => {
  const source = '# 小章节：校门\n# 段落：相遇\n旁白：门外。\n# 小章节：图书室\n# 段落：相遇\n旁白：窗边。';
  const first = applyTextScript(fixtureProject(), source);
  const repeated = applyTextScript(first.project, source);
  assert.deepEqual(nodeSignature(repeated.project), nodeSignature(first.project));
});

test('带冒号的中文章节标题与段内换行可直接识别', () => {
  const result = applyTextScript(fixtureProject(), '琼.第一回：归（崇祯五年）\n\n琼华：这句话在同一段里\n继续。\n\n旁白：新的旁白。');
  assert.equal(result.project.name, '琼.第一回：归（崇祯五年）');
  assert.deepEqual(result.project.characters.map(character => character.name), ['琼华']);
  const passage = result.project.nodes.find(node => node.kind === 'passage');
  assert.ok(passage?.kind === 'passage');
  assert.deepEqual(passage.lines.map(line => line.text), ['这句话在同一段里继续。', '新的旁白。']);
  const narration = applyTextScript(fixtureProject(), '旁白：第一回见到她，我有些紧张。');
  assert.equal(narration.project.name, '文本导入测试');
  assert.equal(narration.project.characters.length, 0);
});

test('复杂演出保持逐行对白可编辑，往返保留动画与结局数据', () => {
  const project = fixtureProject();
  const passage = project.nodes.find(node => node.kind === 'passage');
  assert.ok(passage?.kind === 'passage');
  passage.lines[0].text = '保留这段演出。';
  passage.lines[0].actions.push({ kind: 'animate', characterId: 'hero', wait: false, repeat: true, keyframes: [{ x: 0.3, y: 1, scale: 1, rotation: 0, opacity: 1, duration: 0.5, easing: 'ease' }] });
  const returnTitle = project.nodes.find(node => node.kind === 'end');
  assert.ok(returnTitle?.kind === 'end');
  const endings = endingPerformanceNodes(project, returnTitle, '画廊结局。', ['asset_bg']);
  project.nodes.splice(project.nodes.indexOf(returnTitle), 1, ...endings);
  const ending = endings[0];
  const serialized = projectToText(project);
  assert.match(serialized, /# 段落：第一段/);
  assert.match(serialized, /@演出实例：/);
  assert.match(serialized, /旁白：保留这段演出。/);
  assert.doesNotMatch(serialized, /@实例：第一段/);
  assert.match(serialized, /@结局演出.*画廊结局。/);
  assert.match(serialized, /@解锁素材：校门/);
  assert.match(serialized, /@返回标题界面/);
  assert.doesNotMatch(serialized, /@实例：结局/);
  const parsed = applyTextScript(project, serialized);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.project.nodes.find(node => node.id === passage.id), passage);
  assert.deepEqual(parsed.project.nodes.find(node => node.id === ending.id), ending);
  const edited = applyTextScript(parsed.project, serialized.replace('保留这段演出。', '对白可以直接修改。'));
  const editedPassage = edited.project.nodes.find(node => node.id === passage.id);
  assert.ok(editedPassage?.kind === 'passage');
  assert.equal(editedPassage.lines[0].text, '对白可以直接修改。');
  assert.equal(editedPassage.lines[0].id, passage.lines[0].id);
  assert.deepEqual(editedPassage.lines[0].actions, passage.lines[0].actions);
});

test('配音与非默认舞台参数直接往返，保留零值参数', () => {
  const project = fixtureProject();
  const passage = project.nodes.find(node => node.kind === 'passage');
  assert.ok(passage?.kind === 'passage');
  passage.lines[0].voiceId = 'asset_bgm';
  passage.lines[0].actions.push({ kind: 'background', assetId: 'asset_bg', transition: 'fade' });
  const text = projectToText(project);
  assert.match(text, /@背景：校门，转场=淡入淡出/);
  assert.match(text, /@配音：雨声【asset_bgm】/);
  assert.doesNotMatch(text, /@实例：第一段/);
  assert.deepEqual(applyTextScript(project, text).project.nodes.find(node => node.id === passage.id), passage);
  project.characters.push({ id: 'hero', name: '小雨', color: '#112233', expressions: [{ id: 'expression', name: '平静', assetId: 'asset_bg' }] });
  const show = textCommandAction(project, '@显示角色：小雨，平静，0，1');
  assert.ok(show?.kind === 'show');
  assert.equal(show.x, 0);
  assert.deepEqual(textCommandAction(project, '@停止音乐：0'), { kind: 'stopMusic', fade: 0 });
});

test('多章节与同名场景、段落通过稳定引用完整往返', () => {
  const project = fixtureProject();
  const firstChapter = project.chapters[0];
  const firstScene = project.scenes[0];
  const first = project.nodes.find(node => node.kind === 'passage');
  assert.ok(first?.kind === 'passage');
  first.name = '相遇';
  firstScene.name = '归家';
  project.chapters.push({ id: 'chapter_second', name: '第二章' }, { id: 'chapter_empty', name: '番外' });
  project.scenes.push({ id: 'scene_second', name: '归家', chapterId: 'chapter_second' }, { id: 'scene_empty', name: '待续', chapterId: 'chapter_empty' });
  const second = { ...structuredClone(first), id: 'node_second', sceneId: 'scene_second', lines: [{ id: 'line_second', text: '第二章的相遇。', actions: [] }] };
  project.nodes.push(second);
  first.next = second.id;
  const source = projectToText(project);
  assert.match(source, /# 章节：第二章/);
  const parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.project.chapters, project.chapters);
  assert.deepEqual(parsed.project.scenes, project.scenes);
  assert.equal(parsed.project.scenes[0].chapterId, firstChapter.id);
  assert.equal((parsed.project.nodes.find(node => node.id === first.id) as typeof first).next, second.id);
  assert.equal(parsed.project.nodes.find(node => node.id === second.id)?.sceneId, 'scene_second');
  assert.equal(parsed.project.entryId, project.entryId);
  projectSchema.parse(parsed.project);
  const repeated = applyTextScript(parsed.project, source);
  assert.deepEqual(repeated.project.nodes, parsed.project.nodes);
});

test('节点改名后原有稳定连接仍然指向正确的同名节点', () => {
  const project = applyTextScript(fixtureProject(), '# 小章节：甲\n# 段落：相遇\n旁白：甲。\n# 小章节：乙\n# 段落：相遇\n旁白：乙。').project;
  const passages = project.nodes.filter(node => node.kind === 'passage');
  passages[0].next = passages[1].id;
  const source = projectToText(project).replace(`# 段落：${textReference('相遇', passages[1].id)}`, `# 段落：${textReference('再次相遇', passages[1].id)}`);
  const parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.project.nodes.find(node => node.id === passages[1].id)?.name, '再次相遇');
  const first = parsed.project.nodes.find(node => node.id === passages[0].id);
  assert.ok(first?.kind === 'passage');
  assert.equal(first.next, passages[1].id);
});

test('纯名称连接只使用本场景唯一目标，跨场景重名会报告源行错误', () => {
  const local = applyTextScript(fixtureProject(), '# 小章节：甲\n# 段落：起点\n旁白：甲。\n@跳转：相遇\n# 段落：相遇\n旁白：甲的相遇。\n# 小章节：乙\n# 段落：相遇\n旁白：乙的相遇。');
  assert.deepEqual(local.issues, []);
  const start = local.project.nodes.find(node => node.name === '起点');
  assert.ok(start?.kind === 'passage');
  assert.equal(start.next, local.project.nodes.find(node => node.sceneId === start.sceneId && node.name === '相遇')?.id);
  const ambiguous = applyTextScript(fixtureProject(), '# 小章节：甲\n# 段落：相遇\n旁白：甲。\n# 小章节：乙\n# 段落：相遇\n旁白：乙。\n# 小章节：丙\n# 段落：前往\n@跳转：相遇');
  assert.equal(ambiguous.issues.length, 1);
  assert.equal(ambiguous.issues[0].severity, 'error');
  assert.equal(ambiguous.issues[0].sourceLine, 9);
  assert.match(ambiguous.issues[0].message, /歧义/);
  const jump = ambiguous.project.nodes.find(node => node.kind === 'jump');
  assert.ok(jump?.kind === 'jump');
  assert.equal(jump.target, undefined);
});

test('复杂行文本中新增动作在连续应用和重新导出后均不会叠加', () => {
  const project = fixtureProject();
  const passage = project.nodes.find(node => node.kind === 'passage');
  assert.ok(passage?.kind === 'passage');
  passage.lines[0].text = '准备播放。';
  passage.lines[0].voiceId = 'asset_bgm';
  passage.lines[0].actions = [{ kind: 'background', assetId: 'asset_bg', transition: 'fade' }];
  const source = projectToText(project).replace('旁白：准备播放。', '@等待：0.2\n旁白：修改后的对白。');
  const first = applyTextScript(project, source);
  const repeated = applyTextScript(first.project, source);
  const afterExport = applyTextScript(repeated.project, projectToText(repeated.project));
  for (const parsed of [first, repeated, afterExport]) {
    assert.deepEqual(parsed.issues, []);
    const line: Extract<StoryNode, { kind: 'passage' }>['lines'][number] = (parsed.project.nodes.find(node => node.id === passage.id) as typeof passage).lines[0];
    assert.equal(line.id, passage.lines[0].id);
    assert.equal(line.voiceId, 'asset_bgm');
    assert.equal(line.text, '修改后的对白。');
    assert.deepEqual(line.actions, [...passage.lines[0].actions, { kind: 'pause', seconds: 0.2 }]);
  }
  const silent = applyTextScript(first.project, source.replace(/^@配音：.*\n/m, ''));
  assert.equal((silent.project.nodes.find(node => node.id === passage.id) as typeof passage).lines[0].voiceId, undefined);
});

test('对白稳定标记保留多行文本与插入后的配音归属', () => {
  const project = fixtureProject();
  const passage = project.nodes.find(node => node.kind === 'passage');
  assert.ok(passage?.kind === 'passage');
  passage.lines[0].text = '第一行。\n\n第三行。';
  passage.lines[0].voiceId = 'asset_bgm';
  const source = projectToText(project);
  const inserted = source.replace(`@对白标记：${passage.lines[0].id}`, `旁白：插入的新对白。\n@对白标记：${passage.lines[0].id}`);
  const parsed = applyTextScript(project, inserted);
  assert.deepEqual(parsed.issues, []);
  const changed = parsed.project.nodes.find(node => node.id === passage.id);
  assert.ok(changed?.kind === 'passage');
  assert.equal(changed.lines.length, 2);
  assert.notEqual(changed.lines[0].id, passage.lines[0].id);
  assert.equal(changed.lines[0].voiceId, undefined);
  assert.deepEqual(changed.lines[1], passage.lines[0]);
});

test('斜杠实例指令复制互动与小游戏的配置，并为副本生成独立热点身份', () => {
  const project = fixtureProject();
  const sceneId = project.scenes[0].id;
  const interaction = newNode('interaction', sceneId);
  assert.equal(interaction.kind, 'interaction');
  if (interaction.kind !== 'interaction') return;
  interaction.name = '查看窗外'; interaction.timeoutSeconds = 9;
  interaction.hotspots[0].name = '窗户'; interaction.hotspots[0].target = project.entryId;
  const game = newNode('minigame', sceneId);
  assert.equal(game.kind, 'minigame');
  if (game.kind !== 'minigame') return;
  game.name = '门口密码'; game.password = '归家'; game.success = project.entryId;
  project.nodes.push(interaction, game);
  const source = `${projectToText(project)}\n/互动实例：${textReference(interaction.name, interaction.id)}\n/小游戏实例：${textReference(game.name, game.id)}`;
  const parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues, []);
  const duplicate = parsed.project.nodes.find(node => node.kind === 'interaction' && node.id !== interaction.id);
  assert.ok(duplicate?.kind === 'interaction');
  assert.equal(duplicate.timeoutSeconds, interaction.timeoutSeconds);
  assert.equal(duplicate.hotspots[0].target, interaction.hotspots[0].target);
  assert.notEqual(duplicate.hotspots[0].id, interaction.hotspots[0].id);
  const gameCopy = parsed.project.nodes.find(node => node.kind === 'minigame' && node.id !== game.id);
  assert.ok(gameCopy?.kind === 'minigame');
  assert.equal(gameCopy.password, '归家');
  assert.equal(gameCopy.success, project.entryId);
  projectSchema.parse(parsed.project);
});

test('稳定资源引用可区分中文同名素材，未知显式指令会阻止应用', () => {
  const project = fixtureProject();
  project.assets.push({ id: 'asset_bg_second', name: '校门', kind: 'image', path: 'assets/second.png' });
  assert.equal(textCommandAction(project, '@背景：校门'), undefined);
  assert.deepEqual(textCommandAction(project, `@背景：${textReference('校门', 'asset_bg_second')}`), { kind: 'background', assetId: 'asset_bg_second', transition: 'dissolve' });
  const parsed = applyTextScript(project, '旁白：开始。\n@未知指令：内容\n@背景：不存在的背景');
  assert.deepEqual(parsed.issues.map(issue => [issue.severity, issue.sourceLine]), [['error', 2], ['error', 3]]);
});

test('自定义效果与内置指令同名时按稳定引用调用原效果', () => {
  const project = fixtureProject();
  project.effects.push({ id: 'effect_custom_camera', name: '镜头推进', commands: ['等待：2'] }, { id: 'effect_custom_shake', name: '震动', commands: ['等待：3'] }, { id: 'effect_same_name', name: '镜头推进', commands: ['等待：4'] });
  const passage = project.nodes.find(node => node.kind === 'passage');
  assert.ok(passage?.kind === 'passage');
  passage.lines[0].actions = [{ kind: 'effect', effectId: 'effect_custom_camera' }, { kind: 'effect', effectId: 'effect_custom_shake' }, { kind: 'effect', effectId: 'effect_same_name' }];
  const source = projectToText(project);
  assert.match(source, /@效果：镜头推进【effect_custom_camera】/);
  assert.match(source, /@效果：震动【effect_custom_shake】/);
  const parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues, []);
  const restored = parsed.project.nodes.find(node => node.id === passage.id);
  assert.ok(restored?.kind === 'passage');
  assert.deepEqual(restored.lines[0].actions, passage.lines[0].actions);
  assert.deepEqual(expandEffect(parsed.project, 'effect_custom_camera'), [{ kind: 'pause', seconds: 2 }]);
  assert.deepEqual(expandEffect(parsed.project, 'effect_same_name'), [{ kind: 'pause', seconds: 4 }]);
});

test('统一跳转跨章节选择小章节入口且保留后续正文声明', () => {
  const source = "# 章节：上篇【chapter_departure】\n# 小章节：出发【scene_departure】\n# 段落：门前【node_door】\n旁白：推开大门。\n@跳转：归家【scene_home】\n# 章节：下篇【chapter_home】\n# 小章节：归家【scene_home】\n# 段落：备用段落【node_unused】\n旁白：这不是场景入口。\n# 段落：入场【node_scene_start】\n@开始\n@跳转：正式入口【node_arrival】\n# 段落：正式入口【node_arrival】\n旁白：终于回家了。\n# 段落：结束【node_finish】\n@返回标题界面";
  const parsed = applyTextScript(fixtureProject(), source);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.project.entryId, 'node_door');
  const before = parsed.project.nodes.find(node => node.id === 'node_door');
  assert.ok(before?.kind === 'passage');
  assert.equal(before.next, 'node_arrival');
  assert.ok(parsed.project.nodes.some(node => node.id === 'node_unused'));
  assert.equal(parsed.project.scenes.find(scene => scene.id === 'scene_home')?.chapterId, 'chapter_home');
  const compiled = compileProject(parsed.project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const block = compiled.files['game/story.rpy'].split(`label vn_line_${before.id}_${before.lines.at(-1)!.id}:`)[1].split('\nlabel ')[0];
  assert.match(block, /jump vn_node_node_arrival/);
  assert.doesNotMatch(block, /jump vn_node_node_unused/);
  const repeated = applyTextScript(parsed.project, projectToText(parsed.project));
  assert.equal((repeated.project.nodes.find(node => node.id === before.id) as typeof before).next, 'node_arrival');
});

test('导入正文可跳转既有场景，只保留入口可达依赖并保持重复应用稳定', () => {
  const original = applyTextScript(fixtureProject(), "# 章节：旧章【chapter_old】\n# 小章节：旧稿【scene_unused】\n# 段落：旧对白【old_dialogue】\n旁白：不应保留的旧正文。\n@跳转：无\n# 章节：演出章【chapter_show】\n# 小章节：演出【scene_show】\n# 段落：演出入口【show_start】\n@开始\n@跳转：演出正文【show_dialogue】\n# 段落：未连接内容【unused_show】\n旁白：没有连接的草稿。\n@跳转：无\n# 段落：演出正文【show_dialogue】\n@背景：校门\n旁白：导入后选定的场景。\n@跳转：演出结局【show_end】\n# 小章节：结局场景【scene_end】\n# 段落：演出结局【show_end】\n@返回标题界面").project;
  const source = '旁白：新的导入正文。\n@跳转：演出【scene_show】';
  const result = applyTextScript(original, source);
  assert.deepEqual(result.issues, []);
  const imported = result.project.nodes.find(node => node.kind === 'passage' && node.lines.some(line => line.text === '新的导入正文。'));
  assert.equal(imported?.kind === 'passage' ? imported.next : undefined, 'show_dialogue');
  assert.ok(result.project.nodes.some(node => node.id === 'show_end'));
  assert.ok(result.project.scenes.some(scene => scene.id === 'scene_end'));
  assert.ok(result.project.chapters.some(chapter => chapter.id === 'chapter_show'));
  assert.ok(!result.project.nodes.some(node => ['old_dialogue', 'unused_show', 'show_start'].includes(node.id)));
  const destination = original.nodes.find(node => node.id === 'show_dialogue') as Extract<StoryNode, { kind: 'passage' }>;
  assert.deepEqual(result.sourceMap.find(location => location.sourceLine === 2), { sourceLine: 2, nodeId: 'show_dialogue', lineId: destination.lines[0].id, reference: true });
  const second = applyTextScript(result.project, source);
  assert.deepEqual(second.issues, []);
  assert.deepEqual(second.project.nodes, result.project.nodes);
  projectSchema.parse(second.project);
  assert.deepEqual(compileProject(second.project).diagnostics.filter(issue => issue.severity === 'error'), []);
});

test('源行映射使用最终稳定对白身份，并记录各动作指令的预览边界', () => {
  const first = applyTextScript(fixtureProject(), '# 段落：正文\n旁白：原对白。\n旁白：第二行。').project;
  const edited = applyTextScript(first, '# 段落：正文\n@背景：校门\n@背景音乐：雨声\n旁白：修改对白。\n@续行：段内续行。\n旁白：第二行。');
  const passage = edited.project.nodes.find(node => node.kind === 'passage') as Extract<StoryNode, { kind: 'passage' }>;
  const original = first.nodes.find(node => node.kind === 'passage') as Extract<StoryNode, { kind: 'passage' }>;
  assert.equal(passage.lines[0].id, original.lines[0].id);
  assert.deepEqual(edited.sourceMap.map(location => [location.sourceLine, location.lineId, location.actionCount]), [
    [2, passage.lines[0].id, 1],
    [3, passage.lines[0].id, 2],
    [4, passage.lines[0].id, undefined],
    [5, passage.lines[0].id, undefined],
    [6, passage.lines[1].id, undefined],
  ]);
});

test('跳转目标缺失、歧义、空入口与无对白循环定位到源行，正常循环可用', () => {
  const missing = applyTextScript(fixtureProject(), "# 小章节：出发\n@跳转：未配置\n# 段落：结束\n@返回标题界面");
  assert.deepEqual(missing.issues.map(issue => [issue.severity, issue.sourceLine]), [['error', 2]]);
  const empty = applyTextScript(fixtureProject(), "# 小章节：出发\n@跳转：空房间\n# 段落：结束\n@返回标题界面\n# 小章节：空房间");
  assert.match(empty.issues[0].message, /没有可执行入口/);
  assert.equal(empty.issues[0].sourceLine, 2);
  const ambiguous = applyTextScript(fixtureProject(), '# 章节：出发篇\n# 小章节：出发\n@跳转：归家\n# 章节：甲篇\n# 小章节：归家\n旁白：甲。\n# 章节：乙篇\n# 小章节：归家\n旁白：乙。');
  assert.match(ambiguous.issues[0].message, /歧义/);
  assert.equal(ambiguous.issues[0].sourceLine, 3);
  const cycle = applyTextScript(fixtureProject(), "# 小章节：循环\n@跳转：循环\n# 段落：结束\n@返回标题界面");
  assert.match(cycle.issues[0].message, /空循环/);
  assert.equal(cycle.issues[0].sourceLine, 2);
  const interactiveLoop = applyTextScript(fixtureProject(), "# 小章节：回忆\n# 段落：回忆开端\n旁白：想起那一天。\n@跳转：回忆\n# 段落：结束\n@返回标题界面");
  assert.deepEqual(interactiveLoop.issues, []);
  const loop = interactiveLoop.project.nodes.find(node => node.name === '回忆开端');
  assert.ok(loop?.kind === 'passage');
  assert.equal(loop.next, loop.id);
});

test('场景实例切换语法保留模式、时长、颜色和双场景引用', () => {
  const project = fixtureProject();
  const chapterId = project.chapters[0].id;
  project.scenes.push({ id: 'scene_next', name: '归途', chapterId: chapterId });
  project.nodes.push({ id: 'next_start', sceneId: 'scene_next', name: '入口', x: 10, y: 10, kind: 'start', next: 'next_text' });
  project.nodes.push({ id: 'next_text', sceneId: 'scene_next', name: '归途正文', x: 50, y: 10, kind: 'passage', lines: [{ id: 'next_line', text: '雨停了。', actions: [] }], next: 'next_end' });
  project.nodes.push({ id: 'next_end', sceneId: 'scene_next', name: '归途结局', x: 100, y: 10, kind: 'end' });
  const sourceSceneId = project.scenes[0].id;
  const parsed = applyTextScript(project, '# 小章节：开场\n# 段落：出发\n旁白：准备出发。\n@跳转：归途-切换方式-淡入淡出-参数：时长=1.2，颜色=#112233');
  assert.deepEqual(parsed.issues, []);
  const jump = parsed.project.nodes.find(node => node.kind === 'jump');
  assert.ok(jump?.kind === 'jump');
  assert.equal(jump.sceneTransition?.mode, 'fade');
  assert.equal(jump.sceneTransition?.duration, 1.2);
  assert.equal(jump.sceneTransition?.color, '#112233');
  assert.equal(jump.sceneTransition?.fromSceneId, sourceSceneId);
  assert.equal(jump.sceneTransition?.toSceneId, 'scene_next');
  const serialized = projectToText(parsed.project);
  assert.match(serialized, /@跳转：.*，淡入淡出，1\.2，#112233/);
  if (jump.kind === 'jump') jump.sceneTransition = {
    ...jump.sceneTransition!,
    parameters: { 标题: '雨，夜', 布尔文本: 'true', 编号: '0012' },
  };
  const lossless = projectToText(parsed.project);
  const reparsed = applyTextScript(parsed.project, lossless);
  const losslessJump = reparsed.project.nodes.find(node => node.kind === 'jump');
  assert.deepEqual(losslessJump?.kind === 'jump' ? losslessJump.sceneTransition?.parameters : undefined, { 标题: '雨，夜', 布尔文本: 'true', 编号: '0012' });
  const repeated = applyTextScript(parsed.project, serialized);
  const repeatedJump = repeated.project.nodes.find(node => node.kind === 'jump');
  assert.deepEqual(repeated.issues, []);
  assert.equal(repeatedJump?.kind === 'jump' && repeatedJump.sceneTransition?.toSceneId, 'scene_next');
  assert.equal(repeatedJump?.kind === 'jump' && repeatedJump.sceneTransition?.color, '#112233');
});

test('场景实例文本可以绑定可复用蓝图', () => {
  const project = fixtureProject();
  project.blueprints = [{ id: 'bp_scene_entry', name: '场景入场', kind: 'scene', nodes: [], links: [], exposedInputs: [], exposedOutputs: [] }];
  const parsed = applyTextScript(project, '# 小章节：开场\n@场景蓝图：场景入场\n# 段落：出发\n旁白：准备出发。');
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.project.scenes[0].blueprintId, 'bp_scene_entry');
  assert.match(projectToText(parsed.project), /@场景蓝图：场景入场/);
});

test('最小 DOCX ZIP 提取中文段落、实体、制表符和换行', () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>小雨：你好 &amp; 欢迎</w:t></w:r></w:p><w:p><w:r><w:t>旁白：</w:t><w:tab/><w:t>天亮了</w:t><w:br/><w:t>继续</w:t></w:r></w:p></w:body></w:document>';
  assert.equal(extractDocxText(minimalDocx(xml)), '小雨：你好 & 欢迎\n旁白：\t天亮了\n继续');
});

test('文本解析支持空行和场景分隔而不把连续旁白误认为角色', () => {
  const result = applyTextScript(fixtureProject(), '# 小章节：甲\n# 段落：一\n第一句旁白。\n\n第二句旁白。\n---\n# 小章节：乙\n# 段落：二\n旁白：第三句。');
  const passages = result.project.nodes.filter((node): node is Extract<StoryNode, { kind: 'passage' }> => node.kind === 'passage');
  assert.equal(result.project.scenes.length, 2);
  assert.deepEqual(passages[0]?.lines.map(line => [line.speakerId, line.text]), [[undefined, '第一句旁白。'], [undefined, '第二句旁白。']]);
  assert.equal(passages[1]?.lines[0]?.speakerId, undefined);
});
