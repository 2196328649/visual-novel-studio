import { SpecialistHarness } from './helpers/ai-specialist-harness';
import { readEditorLayouts } from '../src/core/editor-layout';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { aiContext, aiLines, defaultAiConfig, type AiRequest } from '../src/core/ai';
import { applyAiWorkflow, changedDialogueCount } from '../src/core/ai-workflow';
import { createProject, type Project } from '../src/core/model';
import { projectToText } from '../src/core/text-script';
import { voiceCandidates } from '../src/core/voice-matching';
import { AiRetryableError, AiService } from '../src/desktop/ai-service';
import { AiAuthoringService } from '../src/desktop/ai-authoring';
import { scanVoiceLibrary } from '../src/desktop/voice-library';
import { importAsset } from '../src/desktop/project-store';

async function temporary(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-workflow-'));
  t.after(async () => { assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  return root;
}
function fixture(count = 67) {
  const project = createProject('工作流测试');
  project.characters = [{ id: 'actor', name: '甲', color: '#ffffff', defaultExpressionId: 'normal', expressions: [{ id: 'normal', name: '平静', assetId: 'portrait' }, { id: 'worried', name: '担心', assetId: 'portrait' }] }, { id: 'missing', name: '乙', color: '#ffffff', expressions: [] }];
  project.assets = [{ id: 'portrait', name: '立绘', kind: 'image', path: 'assets/portrait.png' }];
  const node = project.nodes.find(node => node.kind === 'passage')!;
  node.lines = Array.from({ length: count }, (_, index) => ({ id: 'dialogue_' + index, speakerId: index === count - 1 ? 'missing' : 'actor', text: '第' + index + '句：你回来就好。', actions: [] }));
  return project;
}
async function mockProvider(root: string, respond: (body: any) => unknown | Promise<unknown>) {
  const service = new AiService({ file: path.join(root, 'ai.json'), vault: { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }, fetch: async (_input, init) => {
    const result = await respond(JSON.parse(init!.body as string));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
  } });
  await service.saveConfig({ ...defaultAiConfig, baseUrl: 'https://local-fixture.invalid/v1', model: 'mock-workflow', rememberKey: false });
  return service;
}
const dataOf = (body: any) => { const content: string = body.messages.at(-1).content; return JSON.parse(content.slice(content.indexOf('\n{') + 1)); };
const request = (project: Project, prompt: string): AiRequest => ({ id: 'workflow_test', project, prompt, lineIds: aiLines(project).map(({ line }) => line.id) });

test('explicit mixed portrait attachments replace existing roles and preserve references, draft text and unrelated characters', async t => {
  const root = await temporary(t), destination = path.join(root, 'project'), directory = path.join(root, '琼华'), image = path.join(root, '图片 2.png');
  await fs.mkdir(destination); await fs.mkdir(directory); await fs.writeFile(image, 'new-fang-image');
  for (const name of ['通常', '惊讶', '开心']) await fs.writeFile(path.join(directory, name + '.png'), 'qiong-' + name);
  const project = fixture(3);
  project.characters[0].name = '方知宥';
  project.characters[1] = { id: 'missing', name: '琼华', color: '#ffffff', defaultExpressionId: 'q_normal', expressions: [{ id: 'q_normal', name: '通常', assetId: 'portrait' }, { id: 'q_surprise', name: '惊讶', assetId: 'portrait' }, { id: 'q_think', name: '思考', assetId: 'portrait' }] };
  project.characters.push({ id: 'bystander', name: '旁人', color: '#ffffff', expressions: [] });
  aiLines(project)[0].line.actions.push({ kind: 'show', characterId: 'actor', expressionId: 'worried', x: .5, y: 1, scale: 1, layer: 0, transition: 'dissolve', actorTransitions: { enter: { mode: 'none', duration: 0 } } });
  aiLines(project)[2].line.actions.push({ kind: 'show', characterId: 'missing', expressionId: 'q_think', x: .4, y: 1, scale: 1, layer: 0, transition: 'dissolve', actorTransitions: { enter: { mode: 'none', duration: 0 } } });
  project.scriptText = { format: 'vns-text-1', content: '// 原始草稿注释\n' + projectToText(project) };
  const original = structuredClone(project);
  const service = await mockProvider(root, body => {
    assert.match(body.messages[0].content, /portraitBindings/);
    const input = JSON.parse(body.messages.at(-1).content);
    assert.deepEqual(input.characters.map((character: any) => character.name), ['方知宥', '琼华', '旁人']);
    assert.ok(input.attachments[1].entries.some((entry: any) => entry.path === '通常.png'));
    return { portraitBindings: [{ characterId: 'actor', sourcePath: image, mode: 'replace' }, { characterId: 'missing', sourcePath: directory, mode: 'replace' }] };
  });
  const author = new SpecialistHarness(service, { projectDirectory: () => destination });
  const response = await author.request({ ...request(project, '把剧本中的方知宥发立绘图片改为上传的这张，琼华使用上传文件夹中的琼华的立绘'), attachmentPaths: [image, directory], lineIds: ['dialogue_0'] });
  assert.deepEqual(project, original);
  const proposal = response.workflow!, next = applyAiWorkflow(project, proposal);
  assert.equal(proposal.summary.portraitCharacters, 2);
  assert.equal(proposal.summary.importedAssets, 4);
  assert.equal(proposal.summary.changedLines, 0);
  assert.equal(proposal.summary.portraitLines, 0);
  assert.match(response.message, /台词修改 0 句/);
  assert.equal(next.scriptText?.content, project.scriptText.content);
  assert.deepEqual(aiLines(next).map(({ line }) => line), aiLines(project).map(({ line }) => line));
  assert.deepEqual(next.characters[0].expressions.map(expression => expression.id), project.characters[0].expressions.map(expression => expression.id));
  assert.ok(next.characters.slice(0, 2).every(character => character.expressions.every(expression => expression.assetId !== 'portrait')));
  assert.deepEqual(next.characters[2], project.characters[2]);
  assert.equal(next.characters[1].defaultExpressionId, 'q_normal');
  assert.ok(next.characters[1].expressions.some(expression => expression.name === '开心'));
  assert.ok(proposal.warnings.some(warning => warning.includes('思考') && warning.includes('通常')));
  assert.equal(await fs.readFile(image, 'utf8'), 'new-fang-image');
});

test('a single image enters the workflow, can replace just one expression, and explicit paths are validated before import', async t => {
  const root = await temporary(t), image = path.join(root, 'new.png'), project = fixture(2);
  await fs.writeFile(image, 'image');
  let binding = { characterId: 'actor', sourcePath: image, mode: 'replace', expressionId: 'worried' };
  const service = await mockProvider(root, () => ({ portraitBindings: [binding] }));
  const author = new SpecialistHarness(service, { projectDirectory: () => path.join(root, 'project') });
  const ask = () => author.request({ ...request(project, '把甲的担心立绘改成这张图片'), attachmentPaths: [image] });
  const response = await ask();
  assert.equal(response.workflow!.project.characters[0].expressions[0].assetId, 'portrait');
  assert.notEqual(response.workflow!.project.characters[0].expressions[1].assetId, 'portrait');
  binding = { ...binding, sourcePath: root };
  await assert.rejects(ask(), /本次明确引用/);
  binding = { ...binding, sourcePath: image, characterId: 'invented' };
  await assert.rejects(ask(), /找不到.*角色/);
  binding = { ...binding, characterId: 'actor', expressionId: 'invented' };
  await assert.rejects(ask(), /没有指定的表情/);
});

test('replacing an inherited portrait overrides only the named character, and fillMissing does not replace existing portraits', async t => {
  const root = await temporary(t), image = path.join(root, 'image.png'), project = fixture(2);
  await fs.writeFile(image, 'image');
  project.characters.push({ id: 'child', name: '子角色', baseCharacterId: 'actor', color: '#ffffff', expressions: [] });
  let mode = 'replace';
  const service = await mockProvider(root, () => ({ portraitBindings: [{ characterId: 'child', sourcePath: image, mode }] }));
  const author = new SpecialistHarness(service, { projectDirectory: () => path.join(root, 'project') });
  const ask = () => author.request({ ...request(project, '子角色使用这张立绘'), attachmentPaths: [image] });
  const response = await ask();
  assert.deepEqual(response.workflow!.project.characters[0], project.characters[0]);
  assert.deepEqual(response.workflow!.project.characters[2].expressions.map(expression => expression.id), ['normal', 'worried']);
  mode = 'fillMissing';
  const fill = await ask();
  assert.deepEqual(fill.workflow!.project.characters, project.characters);
  assert.equal(fill.workflow!.summary.changedLines, 0);
  assert.equal(fill.workflow!.summary.importedAssets, 0);
});

test('dialogue changes count actual added, deleted, rewritten or reassigned lines, excluding portraits and performances', () => {
  const before = fixture(227), after = structuredClone(before);
  after.characters[0].expressions[0].assetId = 'different';
  aiLines(after)[0].line.actions.push({ kind: 'shake', direction: 'horizontal' });
  assert.equal(changedDialogueCount(before, after), 0);
  aiLines(after)[1].line.text = '改写';
  aiLines(after)[2].line.speakerId = 'missing';
  const node = after.nodes.find(node => node.kind === 'passage')!;
  node.lines.pop(); node.lines.push({ id: 'added', text: '新增', actions: [] });
  assert.equal(changedDialogueCount(before, after), 4);
});

test('a referenced portrait directory fills only missing roles, reuses imported images and leaves dialogue performance unchanged', async t => {
  const root = await temporary(t), directory = path.join(root, '角色 图集'), destination = path.join(root, 'project');
  await fs.mkdir(destination);
  const sourceFiles = ['乙/开心.png', '乙/通常.png', '乙/备用.png', '林翩翩/通常.png', '甲/通常.png', '丁/通常.png'];
  const sourceContent = (relative: string) => 'image-fixture-' + (relative === '乙/备用.png' ? '乙/通常.png' : relative);
  for (const relative of sourceFiles) { const file = path.join(directory, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, sourceContent(relative)); }
  const project = fixture(4);
  project.characters.push({ id: 'short_name', name: '林', color: '#ffffff', expressions: [] }, { id: 'long_name', name: '林翩翩', color: '#ffffff', expressions: [{ id: 'existing_long', name: '通常', assetId: 'portrait' }] }, { id: 'unused', name: '丁', color: '#ffffff', expressions: [] });
  aiLines(project)[1].line.speakerId = 'short_name';
  const existing = await importAsset(destination, path.join(directory, '乙/通常.png'), { category: 'portrait' }); project.assets.push(existing);
  const before = structuredClone(project);
  let calls = 0;
  const service = await mockProvider(root, body => {
    calls++; assert.match(body.messages[0].content, /规划器/);
    const input = JSON.parse(body.messages.at(-1).content);
    assert.ok(input.attachments[0].entries.some((entry: any) => entry.path === '乙/通常.png'));
    return { assetDirectory: directory, bindPortraits: !input.request.includes('只导入') };
  });
  const author = new SpecialistHarness(service, { projectDirectory: () => destination });
  const result = await author.request({ ...request(project, '这个文件夹为一些角色的立绘，为当前剧本中立绘缺失的角色补上立绘'), attachmentPaths: [directory] });
  assert.equal(calls, 1); assert.deepEqual(project, before);
  const proposal = result.workflow!, actor = proposal.project.characters.find(character => character.id === 'missing')!;
  assert.equal(proposal.summary.importedAssets, 1); assert.equal(proposal.summary.portraitCharacters, 1);
  assert.equal(proposal.summary.portraitLines, 0); assert.equal(actor.expressions.length, 2);
  const defaultExpression = actor.expressions.find(expression => expression.id === actor.defaultExpressionId)!;
  assert.equal(defaultExpression.name, '通常'); assert.equal(defaultExpression.assetId, existing.id);
  assert.equal(proposal.project.characters.find(character => character.id === 'short_name')!.expressions.length, 0);
  assert.equal(proposal.project.characters.find(character => character.id === 'unused')!.expressions.length, 0);
  assert.ok(proposal.warnings.some(warning => warning.includes('林')));
  assert.deepEqual(aiLines(proposal.project).map(({ line }) => line.actions), aiLines(before).map(({ line }) => line.actions));
  assert.deepEqual(proposal.project.characters.find(character => character.id === 'actor'), before.characters.find(character => character.id === 'actor'));
  const applied = applyAiWorkflow(project, proposal);
  assert.equal(applied.assets.length, before.assets.length + 1);
  assert.equal(applied.characters.find(character => character.id === 'missing')!.expressions.length, 2);
  for (const relative of sourceFiles) assert.equal(await fs.readFile(path.join(directory, relative), 'utf8'), sourceContent(relative));
  const importedOnly = await author.request({ ...request(project, '只导入整个立绘文件夹，不要绑定角色'), attachmentPaths: [directory] });
  assert.equal(importedOnly.workflow!.summary.importedAssets, 4);
  assert.equal(importedOnly.workflow!.summary.portraitCharacters, undefined);
  assert.deepEqual(importedOnly.workflow!.project.characters, before.characters);
});

test('external access authorizes the resolved path, not its parent or an unmentioned sibling', async t => {
  const root = await temporary(t), project = fixture(1), file = path.join(root, '明确选择的剧本.txt');
  await fs.writeFile(file, '甲：我回来了。');
  let plannedPath = file;
  const service = await mockProvider(root, () => ({ importFile: plannedPath }));
  const author = new SpecialistHarness(service, { projectDirectory: () => root });
  const prompt = `导入剧本 "${file}"`;
  await assert.rejects(author.request(request(project, prompt)), /允许访问项目外文件/);
  plannedPath = root;
  await assert.rejects(author.request({ ...request(project, prompt), allowExternalFiles: true }), /明确提供或通过附件/);
  plannedPath = file;
  const result = await author.request({ ...request(project, prompt), allowExternalFiles: true });
  assert.equal(result.workflow?.summary.lines, 1);
  assert.equal(aiLines(result.workflow!.project)[0].line.text, '我回来了。');
});

test('one-prompt story generation repairs a broken link once and creates a complete reviewable draft independent of current line scope', async t => {
  const root = await temporary(t), project = fixture(2), original = structuredClone(project);
  const story = { title: '抉择', entry: 'start', scenes: [{ key: 'home', name: '故乡' }], beats: [
    { key: 'start', sceneKey: 'home', name: '相逢', lines: [{ text: '一起走吗？', speakerId: 'actor', expressionId: 'worried', presetId: 'left' }], choices: [{ text: '是', target: 'yes' }, { text: '否', target: 'no' }] },
    { key: 'yes', sceneKey: 'home', name: '同行', lines: [{ text: '两人并肩走远。' }], ending: '同行' },
    { key: 'no', sceneKey: 'home', name: '留下', lines: [{ text: '她目送对方离去。' }], ending: '留下' },
  ] };
  let attempts = 0;
  const service = await mockProvider(root, body => {
    if (body.messages[0].content.includes('规划器')) return { createStory: true, portraits: true, expressions: true, editorCommands: ['validate','preview','save','preview'] };
    const input = JSON.parse(body.messages.at(-1).content); attempts++;
    if (attempts === 1) { const bad = structuredClone(story); bad.beats[0].choices![0].target = 'absent'; return bad; }
    assert.match(input.repair.error, /absent/); return story;
  });
  const author = new SpecialistHarness(service, { projectDirectory: () => root });
  const result = await author.request({ ...request(project, '根据一个归乡的创意生成两结局游戏框架，然后检查、试玩并保存'), lineIds: ['dialogue_0'] });
  assert.equal(attempts, 2); assert.deepEqual(project, original);
  assert.deepEqual(result.editorCommands, ['validate','preview','save']);
  assert.equal(result.workflow!.summary.lines, 3);
  assert.equal(result.workflow!.summary.endings, 2);
  assert.equal(result.workflow!.summary.expressions, 1);
  assert.ok(result.workflow!.project.scriptText?.content.includes('站位预设'));
  project.ui.accent = '#abcdef';
  assert.equal(applyAiWorkflow(project, result.workflow!).ui.accent, '#abcdef');
});

test('AI scene workflow applies background and music only within the requested dialogue scope', async t => {
  const root = await temporary(t), project = fixture(2), scene = project.scenes[0];
  project.assets.push({ id: 'night', name: '夜晚街道', kind: 'image', category: 'scene', path: 'night.png' }, { id: 'rain', name: '雨', kind: 'audio', category: 'bgm', path: 'rain.ogg' });
  const service = await mockProvider(root, body => {
    if (body.messages[0].content.includes('规划器')) return { scenes: true };
    const input = JSON.parse(body.messages.at(-1).content);
    assert.equal(input.scenes[0].id, scene.id); assert.equal(input.backgrounds[0].id, 'night');
    return { operations: [{ kind: 'setScene', sceneId: scene.id, backgroundId: 'night', musicId: 'rain' }] };
  });
  const author = new SpecialistHarness(service, { projectDirectory: () => root });
  const response = await author.request(request(project, '为已有剧情配置场景背景和配乐'));
  assert.equal(response.workflow!.summary.scenes, 1);
  assert.ok(response.workflow!.project.scenes[0].entryActions!.some(a => a.kind === 'background' && a.assetId === 'night'));
  assert.deepEqual(aiLines(response.workflow!.project).map(r => r.line.text), aiLines(project).map(r => r.line.text));
});

test('local workflow mock imports a script, batches context expressions, reserves missing portraits and preserves source until apply', async t => {
  const root = await temporary(t), project = fixture(), before = structuredClone(project);
  const source = path.join(root, '剧本.txt');
  const sourceText = aiLines(project).map(({ line }) => (line.speakerId === 'actor' ? '甲' : '乙') + '：' + line.text).join('\n');
  await fs.writeFile(source, sourceText);
  const batches: number[] = [];
  const service = await mockProvider(root, body => {
    // Real providers may use null when the otherwise valid plan has no note.
    if (body.messages[0].content.includes('规划器')) return { execute: true, importFile: source, portraits: true, expressions: true, message: null };
    const data = dataOf(body); batches.push(data.lines.length);
    assert.equal(data.assets, undefined); assert.equal(data.blueprints, undefined);
    assert.ok(data.lines.every((line: any) => !line.actions));
    assert.ok(data.lines.every((line: any) => Number.isInteger(line.order)));
    assert.ok(data.surroundingLines.every((line: any) => line.readOnly && !data.lines.some((other: any) => other.id === line.id)));
    return { message: '逐句初选', operations: data.lines.map((line: any) => ({ kind: 'setExpression', lineId: line.id, expressionId: 'worried' })) };
  });
  const author = new SpecialistHarness(service, { projectDirectory: () => root });
  const result = await author.request({ ...request(project, '导入剧本 ' + source + '，为每句角色台词添加立绘并选表情'), allowExternalFiles: true });
  assert.deepEqual(project, before);
  assert.deepEqual(batches, [16, 16, 16, 16, 2]);
  const proposal = result.workflow!;
  assert.equal(proposal.summary.lines, 67); assert.equal(proposal.summary.portraitLines, 67); assert.equal(proposal.summary.expressions, 66);
  assert.match(proposal.warnings.join('\n'), /乙（1句）/);
  assert.deepEqual(aiLines(proposal.project).map(({ line }) => line.text), aiLines(project).map(({ line }) => line.text));
  assert.ok(aiLines(proposal.project).every(({ line }) => line.actions.some(action => action.kind === 'show' && !action.characterId)));
  assert.ok(proposal.project.nodes.some(node => node.kind === 'end'));
  project.ui.textColor = '#f0e0d0';
  assert.equal(applyAiWorkflow(project, proposal).ui.textColor, '#f0e0d0');
  aiLines(project)[0].line.text = '后来修改';
  assert.throws(() => applyAiWorkflow(project, proposal), /已修改/);
});

test('workflow stops between batches, rejects invented paths and never accepts expression edits outside scope', async t => {
  const root = await temporary(t), project = fixture(), before = structuredClone(project);
  let mode = 'cancel', calls = 0;
  const service = await mockProvider(root, body => {
    if (body.messages[0].content.includes('规划器')) return mode === 'path' ? { importFile: path.join(root, 'not-authorized.txt') } : { expressions: true };
    const data = dataOf(body); calls++;
    return { message: '', operations: [{ kind: 'setExpression', lineId: mode === 'scope' ? 'outside' : data.lines[0].id, expressionId: 'normal' }] };
  });
  const author = new SpecialistHarness(service, { projectDirectory: () => root, progress: value => { if (mode === 'cancel' && value.completed === 16) author.cancel(value.id); } });
  await assert.rejects(author.request(request(project, '为所有台词选择表情')), /已停止/);
  assert.equal(calls, 1); assert.deepEqual(project, before);
  mode = 'path'; await assert.rejects(author.request(request(project, '导入剧本 ' + path.join(root, 'allowed.txt'))), /明确提供/);
  mode = 'scope'; await assert.rejects(author.request(request(project, '为所有台词选择表情')), /范围以外|不存在/);
  assert.deepEqual(project, before);
});

test('slow expression batches split without losing completed work or mutating the source', async t => {
  const root = await temporary(t), project = fixture(34), before = structuredClone(project), sizes: number[] = [];
  const service = await mockProvider(root, body => {
    if (body.messages[0].content.includes('规划器')) return { expressions: true };
    const data = dataOf(body); sizes.push(data.lines.length);
    if (sizes.length === 2) throw new AiRetryableError('AI 请求超时', 'timeout');
    return { message: '', operations: data.lines.map((line: any) => ({ kind: 'setExpression', lineId: line.id, expressionId: 'worried' })) };
  });
  const author = new SpecialistHarness(service, { projectDirectory: () => root });
  const result = await author.request(request(project, '为所有角色台词选择表情'));
  assert.deepEqual(sizes, [16, 16, 8, 8, 1]);
  assert.equal(result.workflow!.summary.expressions, 33);
  assert.equal(result.workflow!.summary.batches, 4);
  assert.equal(result.workflow!.details.length, 33);
  assert.deepEqual(project, before);
});

test('voice matching avoids ID prefix collisions, conflicting roles, stale transcripts and versions tied by exact text', async t => {
  const line = { id: 'line_1', text: '你回来就好。', speaker: '甲' };
  assert.equal(voiceCandidates(line, [{ key: 'line_10.wav', name: 'line_10' }]).length, 0);
  assert.equal(voiceCandidates(line, [{ key: 'right.wav', name: '甲_line_1' }])[0].exact, true);
  assert.equal(voiceCandidates(line, [{ key: 'wrong.wav', name: 'wrong', lineId: 'line_2', text: line.text }]).length, 0);
  assert.equal(voiceCandidates(line, [{ key: 'wrong.wav', name: 'line_1', speaker: '乙', text: line.text }]).length, 0);
  assert.ok(!voiceCandidates(line, [{ key: 'stale.wav', name: 'line_1', text: '你永远别再回来了。' }])[0]?.exact);
  const root = await temporary(t), voices = path.join(root, 'voices'), destination = path.join(root, 'project');
  await fs.mkdir(voices); await fs.mkdir(destination);
  const project = fixture(4), lines = aiLines(project).map(({ line }) => line);
  project.assets.push({ id: 'existing_voice', kind: 'audio', name: '已配音', path: 'assets/existing.ogg' }); lines[2].voiceId = 'existing_voice';
  const manifest = [{ file: 'exact.wav', lineId: lines[0].id, text: lines[0].text }, { file: 'version_a.wav', text: lines[1].text }, { file: 'version_b.wav', text: lines[1].text }];
  for (const [index, entry] of manifest.entries()) await fs.writeFile(path.join(voices, entry.file), Buffer.from('RIFF-test-wave-' + index));
  await fs.writeFile(path.join(voices, 'voices.json'), JSON.stringify(manifest));
  const scan = await scanVoiceLibrary(voices); assert.equal(scan.files.length, 3);
  const before = structuredClone(project);
  const service = await mockProvider(root, body => {
    if (body.messages[0].content.includes('规划器')) return { voiceDirectory: voices };
    const data = JSON.parse(body.messages.at(-1).content);
    assert.ok(data.lines.every((line: any) => line.lineId !== lines[1].id), 'exact ties must not be sent to a model to guess a version');
    return { matches: [] };
  });
  const result = await new SpecialistHarness(service, { projectDirectory: () => destination }).request({ ...request(project, '根据台词匹配配音目录 ' + voices), allowExternalFiles: true });
  assert.equal(result.workflow!.summary.voices, 1); assert.equal(result.workflow!.summary.importedAssets, 1);
  assert.match(result.workflow!.warnings.join('\n'), /多个同样匹配/);
  assert.deepEqual(project, before);
  const next = aiLines(result.workflow!.project).map(({ line }) => line);
  assert.ok(next[0].voiceId); assert.equal(next[1].voiceId, undefined); assert.equal(next[2].voiceId, 'existing_voice');
  const added = result.workflow!.project.assets.find(asset => asset.id === next[0].voiceId)!;
  assert.deepEqual(await fs.readFile(path.join(destination, added.path)), await fs.readFile(path.join(voices, 'exact.wav')));
});

test('ordinary edits expose paging without imposing keyword-selected dialogue batches', async t => {
  const project = fixture(127), sizes: number[] = [];
  const service = await mockProvider(await temporary(t), body => {
    const data = dataOf(body); sizes.push(data.lines.length);
    assert.equal(data.lineScope.total, 127); assert.equal(data.lineScope.partial, true);
    return { message: '兼容回复', operations: [{kind:'replaceText',lineId:'dialogue_0',text:'校对'}] };
  });
  const response = await new AiAuthoringService(service, {projectDirectory:()=>undefined}).request(request(project,'校对标点'));
  assert.deepEqual(sizes,[100]); assert.equal(response.operations.length,1);
  const context = aiContext(project, ['dialogue_125']);
  assert.equal(context.lines[0].order, 126); assert.equal(context.surroundingLines.at(-1)!.order,127);
  assert.ok(context.characters.some(character=>character.id==='missing'));
});

test('large project-level request reads schemas and executes once rather than once per dialogue batch', async t => {
 const root=await temporary(t), project=fixture(127);let calls=0;
 const service=await mockProvider(root,body=>{
  calls++;
  if(calls===1){const data=dataOf(body);assert.equal(data.lineScope.total,127);return {read:[{kind:'schema',field:'parameterSets'},{kind:'blueprintNode',type:'getVariable'}],operations:[]};}
  const results=JSON.parse(body.messages.at(-1).content.split('\n').slice(1).join('\n'));
  assert.ok(results[0].result.schema.items.properties.kind.enum.includes('settings'));assert.equal(results[1].result.template.type,'getVariable');
  return {message:'待审阅',operations:[{kind:'editProject',path:['parameterSets'],action:'set',value:[{id:'ui_params',name:'UI参数',kind:'settings'}]}]};
 });
 const response=await new AiAuthoringService(service,{projectDirectory:()=>root}).request(request(project,'添加一个界面参数集'));
 assert.equal(calls,2);assert.equal(response.operations.length,1);assert.equal(project.parameterSets,undefined);
});

test('mixed project and dialogue operations use a single scope-checked response', async t => {
  const project=fixture(127); let calls=0;
  const service=await mockProvider(await temporary(t),()=>{calls++;return {message:'',operations:[{kind:'editProject',path:['width'],action:'set',value:1600},{kind:'replaceText',lineId:'dialogue_126',text:'末句校对'}]};});
  const result=await new AiAuthoringService(service,{projectDirectory:()=>undefined}).request(request(project,'校对末句并设宽度1600'));
  assert.equal(calls,1);assert.equal(result.operations.length,2);assert.notEqual(project.width,1600);
});

test('engineering proposals repair invalid references with schema reads before offering a complete atomic result', async t => {
 const root=await temporary(t),project=fixture(2),before=structuredClone(project);
 const {createUiParameterBinding}=await import('../src/core/ui-logic');
 const {prepareAiChanges,applyAiChanges}=await import('../src/core/ai');
 const design=structuredClone(project);
 const component={id:'repair_title',kind:'text' as const,page:'main' as const,text:'联动标题',x:.1,y:.1,width:.5,height:.1};
 const variable={id:'repair_visible',name:'显示标题',type:'boolean' as const,initial:true,persistent:false};
 design.ui.components.push(component);design.variables.push(variable);
 const graph=createUiParameterBinding(design,component.id,'visible',variable.id,'ui:main');
 let calls=0;
 const service=await mockProvider(root,body=>{
  calls++;assert.deepEqual(project,before);
  if(calls===1)return {message:'创建联动',operations:[{kind:'editProject',path:['blueprints'],action:'append',value:graph}]};
  if(calls===2){assert.match(body.messages.at(-1).content,/校验未通过/);return {read:[{kind:'schema',field:'ui'}],operations:[]};}
  assert.match(body.messages.at(-1).content,/只读工程数据/);
  return {message:'完整联动方案',operations:[{kind:'editProject',path:['ui','components'],action:'append',value:component},{kind:'editProject',path:['variables'],action:'append',value:variable},{kind:'editProject',path:['blueprints'],action:'append',value:graph}]};
 });
 const response=await service.request(request(project,'添加参数驱动的标题界面'));
 assert.equal(calls,3);assert.equal(response.operations.length,3);assert.deepEqual(project,before);
 const applied=applyAiChanges(project,prepareAiChanges(project,response.operations,aiLines(project).map(({line})=>line.id)));
 assert.equal(applied.blueprints.at(-1)!.id,graph.id);assert.ok(applied.variables.some(v=>v.id===variable.id));
});

test('repair cannot expand dialogue scope and stops after two corrections without partial edits',async t=>{
 const root=await temporary(t),project=fixture(2),before=structuredClone(project);let calls=0;
 const service=await mockProvider(root,()=>{calls++;return {message:'错误范围',operations:[{kind:'replaceText',lineId:'dialogue_1',text:'越界'}]};});
 await assert.rejects(service.request({...request(project,'只改第一句'),lineIds:['dialogue_0']}),/范围以外/);
 assert.equal(calls,3);assert.deepEqual(project,before);
});

test('cancel during proposal repair discards the late valid response',async t=>{
 const root=await temporary(t),project=fixture(2),before=structuredClone(project);let calls=0;
 const service=await mockProvider(root,()=>{
  if(++calls===1)return {message:'无效',operations:[{kind:'editProject',path:['width'],action:'set',value:-1}]};
  service.cancel('workflow_test');return {message:'有效',operations:[{kind:'editProject',path:['width'],action:'set',value:1600}]};
 });
 await assert.rejects(service.request(request(project,'设置作品尺寸')),/已停止/);
 assert.equal(calls,2);assert.deepEqual(project,before);
});

test('large engineering edits stage over 200 operations, read staged IDs and return one complete proposal',async t=>{
 const root=await temporary(t),project=fixture(2),before=structuredClone(project);let calls=0;
 const edits=Array.from({length:240},(_,i)=>({kind:'editProject',path:['variables'],action:'append',value:{id:'batch_var_'+i,name:'参数 '+i,type:'number',initial:i,persistent:false}}));
 const service=await mockProvider(root,body=>{
  calls++;assert.deepEqual(project,before);
  if(calls===1)return {message:'第一批参数',operations:edits.slice(0,200),more:true};
  if(calls===2){assert.match(body.messages.at(-1).content,/已接收 1 批、200 项/);return {read:[{kind:'project',path:['variables',{id:'batch_var_199'}]}],operations:[]};}
  const data=JSON.parse(body.messages.at(-1).content.split('\n').slice(1).join('\n'));assert.equal(data[0].result.value.initial,199);
  return {message:'剩余参数与台词',operations:[...edits.slice(200),{kind:'replaceText',lineId:'dialogue_0',text:'修改完成'}],more:false};
 });
 const response=await service.request(request(project,'创建240个参数并修改第一句台词'));
 assert.equal(calls,3);assert.equal(response.operations.length,241);assert.equal(response.more,undefined);assert.deepEqual(project,before);
 const {prepareAiChanges,applyAiChanges}=await import('../src/core/ai');
 const result=applyAiChanges(project,prepareAiChanges(project,response.operations,aiLines(project).map(({line})=>line.id)));
 assert.equal(result.variables.filter(v=>v.id.startsWith('batch_var_')).length,240);assert.equal(result.nodes.find(n=>n.kind==='passage')!.lines[0].text,'修改完成');
});

test('failed or cancelled later batches never return earlier staged operations as a partial success',async t=>{
 for(const cancel of [false,true]) {
  const root=await temporary(t),project=fixture(2),before=structuredClone(project);let calls=0;
  const service=await mockProvider(root,()=>{
   if(++calls===1)return {message:'尺寸',operations:[{kind:'editProject',path:['width'],action:'set',value:1600}],more:true};
   if(cancel)service.cancel('workflow_test');
   return {message:'失败',operations:[{kind:'editProject',path:['height'],action:'set',value:-10}],more:false};
  });
  await assert.rejects(service.request(request(project,'批量修改工程')));
  assert.equal(calls,cancel?2:4);assert.deepEqual(project,before);
 }
});

test('AI editor commands are explicit final-response actions and never execute while generating proposals',async t=>{
 const root=await temporary(t),project=fixture(2),before=structuredClone(project);
 const service=await mockProvider(root,()=>({message:'检查并试玩',operations:[],editorCommands:['validate','preview','preview','openUi','undo','redo']}));
 const response=await service.request(request(project,'检查并试玩当前作品'));
 assert.deepEqual(response.editorCommands,['validate','preview','openUi','undo','redo']);assert.deepEqual(project,before);
 const readOnly=await mockProvider(await temporary(t),()=>({message:'查看',operations:[],editorCommands:['validate','openBlueprint','openAssets','openCharacters','openSettings','openUiPreview','closeUiPreview']}));
 assert.deepEqual((await readOnly.request({...request(project,'查看蓝图与本机UI预览'),readOnly:true})).editorCommands,['validate','openBlueprint','openAssets','openCharacters','openSettings','openUiPreview','closeUiPreview']);
 const forbidden=await mockProvider(await temporary(t),()=>({message:'保存',operations:[],editorCommands:['save']}));
 await assert.rejects(forbidden.request({...request(project,'保存'),readOnly:true}),/只读/);
 for(const command of ['undo','redo','discardUiDraft','arrangeBlueprint','importAssetFolder','importSpine','importText','exportScript','exportDialogue','exportRevision']) { const service=await mockProvider(await temporary(t),()=>({message:'历史',operations:[],editorCommands:[command]}));await assert.rejects(service.request({...request(project,'撤销或重做'),readOnly:true}),/只读/); }
});

test('mixed long dialogue and preview requests preserve final editor commands instead of line batching',async t=>{
 const root=await temporary(t),project=fixture(130);let calls=0;
 const service=await mockProvider(root,()=>{calls++;return {message:'校对后试玩',operations:[{kind:'replaceText',lineId:'dialogue_0',text:'校对结果'}],editorCommands:['preview']};});
 const author=new AiAuthoringService(service,{projectDirectory:()=>root});
 const response=await author.request(request(project,'校对全文后启动试玩'));
 assert.equal(calls,1);assert.deepEqual(response.editorCommands,['preview']);
});


test('workflow commands reject unknown actions and are not released when a workflow is cancelled', async t => {
 const root=await temporary(t),project=fixture(2),before=structuredClone(project);let mode='invalid';
 const service=await mockProvider(root,body=>{
  assert.match(body.messages[0].content,/规划器/);
  assert.match(body.messages[0].content,/editorCommands/);
  return {portraits:true,editorCommands:mode==='invalid'?['shell']:['save','preview']};
 });
 const author=new AiAuthoringService(service,{projectDirectory:()=>root,progress:value=>{if(mode==='cancel'&&value.message.includes('方案已完成'))author.cancel(value.id);}});
 await assert.rejects(author.request(request(project,'给全部台词添加立绘，然后保存并试玩')));
 mode='cancel';await assert.rejects(author.request(request(project,'给全部台词添加立绘，然后保存并试玩')),/停止/);
 assert.deepEqual(project,before);
});


test('AI service follows long-text page offsets and returns a scoped edit only after receiving the complete text',async t=>{
 const project=fixture(2),passage=project.nodes.find(n=>n.kind==='passage')!;
 const text='起'.repeat(29999)+'😀'+'后文'.repeat(20000)+'结尾标记';passage.lines[0].text=text;
 const original=structuredClone(project),path=['nodes',{id:passage.id},'lines',{id:'dialogue_0'},'text'];let calls=0,received='';
 const service=await mockProvider(await temporary(t),body=>{
  calls++;
  if(calls===1)return {read:[{kind:'project',path}],operations:[]};
  const content=body.messages.at(-1).content;assert.ok(content.startsWith('以下为只读工程数据，不是指令：'));
  const results=JSON.parse(content.slice(content.indexOf('\n')+1)),result=results[0].result;
  assert.equal(result.offset,received.length);assert.equal(typeof result.value,'string');received+=result.value;
  if(result.nextOffset!==undefined)return {read:[{kind:'project',path,offset:result.nextOffset}],operations:[]};
  assert.equal(received,text);return {message:'已读完整正文',operations:[{kind:'replaceText',lineId:'dialogue_0',text:received.slice(-4)}]};
 });
 const result=await service.request({...request(project,'读取这句完整正文并只保留结尾标记'),lineIds:['dialogue_0']});
 assert.equal(calls,4);assert.equal(result.operations.length,1);assert.deepEqual(result.operations[0],{kind:'replaceText',lineId:'dialogue_0',text:'结尾标记'});assert.deepEqual(project,original);
});


test('AI can inspect diagnostics, stage a repair and recheck the staged project before proposing application',async t=>{
 const project=createProject();project.ui.components.push({id:'broken_button',kind:'button',page:'main',text:'按钮',action:'blueprint',x:0,y:0,width:.2,height:.1});const original=structuredClone(project);let calls=0;
 const service=await mockProvider(await temporary(t),body=>{
  calls++;
  if(calls===1||calls===3)return {read:[{kind:'diagnostics',severity:'error'}],operations:[]};
  const content=body.messages.at(-1).content,rows=JSON.parse(content.slice(content.indexOf('\n')+1))[0].result;
  if(calls===2){const issue=rows.items.find((i:any)=>i.ui?.componentId==='broken_button');assert.ok(issue);assert.match(issue.message,/蓝图/);return {message:'修复',operations:[{kind:'editProject',path:['ui','components',{id:issue.ui.componentId},'action'],action:'set',value:'start'}],more:true};}
  assert.equal(rows.total,0);return {message:'已检查暂存修复结果',operations:[],editorCommands:['validate']};
 });
 const result=await service.request(request(project,'检查并修复当前界面问题'));assert.equal(calls,4);assert.equal(result.operations.length,1);assert.deepEqual(result.editorCommands,['validate']);assert.deepEqual(project,original);
});


test('AI reads selection beyond the initial page and targets its exact asset without changing the source',async t=>{
 const project=fixture(1);project.assets.push(...Array.from({length:220},(_,i)=>({id:'selected_'+i,name:'同名素材',kind:'image' as const,path:'private/'+i+'.png'})));
 const original=structuredClone(project),selectedContentKeys=project.assets.filter(a=>a.id.startsWith('selected_')).map(a=>'asset:'+a.id);let calls=0;
 const service=await mockProvider(await temporary(t),body=>{
  calls++;
  if(calls===1){const data=dataOf(body);assert.equal(data.selectedContentTotal,220);assert.equal(data.selectedContent.length,100);assert.equal(data.selectedContentPartial,true);return {read:[{kind:'selectedContent',offset:200,limit:100}],operations:[]};}
  const content=body.messages.at(-1).content,result=JSON.parse(content.slice(content.indexOf('\n')+1))[0].result;
  assert.equal(result.total,220);assert.equal(result.items.length,20);assert.equal(result.nextOffset,undefined);assert.ok(!JSON.stringify(result).includes('private/'));
  return {message:'重命名最后选中的素材',operations:[{kind:'editProject',path:['assets',{id:result.items.at(-1).id},'name'],action:'set',value:'已重命名'}]};
 });
 const response=await service.request({...request(project,'重命名所选列表最后一项'),selectedContentKeys});assert.equal(calls,2);assert.deepEqual(project,original);
 const {prepareAiChanges,applyAiChanges}=await import('../src/core/ai');const applied=applyAiChanges(project,prepareAiChanges(project,response.operations,aiLines(project).map(({line})=>line.id)));
 assert.equal(applied.assets.at(-1)!.name,'已重命名');assert.deepEqual(applied.assets.slice(0,-1),original.assets.slice(0,-1));
});


test('AI target navigation survives service responses and is disallowed in intermediate batches',async t=>{
 const project=fixture(1),target={kind:'character',characterId:'actor'};
 const service=await mockProvider(await temporary(t),()=>({message:'定位角色',operations:[],editorTargets:[target]}));
 const result=await service.request({...request(project,'定位角色'),readOnly:true});assert.deepEqual(result.editorTargets,[target]);
 const invalid=await mockProvider(await temporary(t),()=>({message:'继续',operations:[{kind:'replaceText',lineId:'dialogue_0',text:'更新'}],more:true,editorTargets:[target]}));
 await assert.rejects(invalid.request(request(project,'分批修改')),/最终批次/);
});

test('AI layout requests survive the service and cannot execute from intermediate batches',async t=>{
 const project=fixture(1),layout={workspace:'timeline',sizes:{top:80}};
 const service=await mockProvider(await temporary(t),()=>({message:'调整布局',operations:[],editorLayouts:[layout]}));assert.deepEqual((await service.request({...request(project,'缩小时间轴'),readOnly:true})).editorLayouts,[layout]);
 const invalid=await mockProvider(await temporary(t),()=>({message:'继续',operations:[{kind:'replaceText',lineId:'dialogue_0',text:'更新'}],more:true,editorLayouts:[layout]}));await assert.rejects(invalid.request(request(project,'调整')),/最终批次/);
});


test('AI receives actual swapped layout even when large project context is reduced',async t=>{
 const editorLayoutState=readEditorLayouts({getItem:()=>null});
 editorLayoutState.timeline.panels={left:'library',top:'timeline',bottom:'preview',right:'inspector'};
 editorLayoutState.timeline.top=82;let calls=0;
 const service=await mockProvider(await temporary(t),body=>{calls++;const data=dataOf(body);assert.deepEqual(data.editorLayoutState,editorLayoutState);if(calls===2)assert.equal(data.partial,true);return {message:'缩小上方时间轴',operations:[],editorLayouts:[{workspace:'timeline',sizes:{top:60}}]};});
 const authoring=new AiAuthoringService(service,{projectDirectory:()=>undefined});
 for(const count of [1,120]){const project=fixture(count);if(count>1){for(const node of project.nodes)if(node.kind==='passage')for(const line of node.lines)line.text='长正文'.repeat(5000);}
  const response=await authoring.request({...request(project,'缩小时间轴'),editorLayoutState});assert.deepEqual(response.editorLayouts,[{workspace:'timeline',sizes:{top:60}}]);
 }
 const invalid=structuredClone(editorLayoutState);invalid.timeline.panels.left='timeline';
 await assert.rejects(authoring.request({...request(fixture(1),'读取布局'),editorLayoutState:invalid}));assert.equal(calls,2);
});


test('blueprint view commands survive readonly requests while automatic arrangement requires editing',async t=>{
 const project=fixture(1),commands=['frameBlueprint','collapseBlueprintNodes','expandBlueprintNodes','showBlueprintConnections','showBlueprintInterface','showBlueprintNodeProperties'];
 const service=await mockProvider(await temporary(t),()=>({message:'查看蓝图',operations:[],editorCommands:commands}));
 assert.deepEqual((await service.request({...request(project,'查看蓝图'),readOnly:true})).editorCommands,commands);
});
