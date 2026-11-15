import test from 'node:test';
import assert from 'node:assert/strict';
import { aiContext, aiLines, aiRequestMessages, applyAiChanges, prepareAiChanges } from '../src/core/ai';
import { aiProjectEffects, createAiAgentProposal } from '../src/core/ai-agent-review';
import { readAiProject } from '../src/core/ai-project-read';
import { isPrivateAiProjectPath, scrubAiProject, type AiProjectPath } from '../src/core/ai-project-privacy';
import { buildAiStory } from '../src/core/ai-story';
import { aiWorkflowFingerprint, applyAiWorkflow, type AiWorkflowProposal } from '../src/core/ai-workflow';
import { createBlueprintGraph } from '../src/core/blueprint';
import { exportSettingsSchema } from '../src/core/export-settings';
import { createProject, projectSchema, type Project } from '../src/core/model';
import { currentScriptText } from '../src/core/script-text';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { createVisualObject } from '../src/core/visual-object';

function groupedProject() {
  const project = createProject('有剧情分组的作品');
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines[0].text = '保留分组的原台词。';
  project.storyGroups = [
    { id: 'outer_group', name: '完整剧情', sceneId: passage.sceneId, nodeIds: [], x: 100, y: 100 },
    { id: 'branch_group', name: '谈话支线', sceneId: passage.sceneId, parentId: 'outer_group', nodeIds: [passage.id], x: 200, y: 200 },
    { id: 'empty_group', name: '预留内容', sceneId: passage.sceneId, nodeIds: [], x: 300, y: 300 },
  ];
  return project;
}

function replacement(project: Project) {
  const fresh = createProject('替换的故事');
  fresh.chapters[0].name = '新的章节'; fresh.scenes[0].name = '新的地点';
  fresh.nodes.find(node => node.kind === 'passage')!.lines[0].text = '新的故事已经开始。';
  const source = projectToText(fresh), parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  parsed.project.scriptText = currentScriptText(source);
  return parsed.project;
}

function legacyProposal(before: Project, after: Project): AiWorkflowProposal {
  return { ...createAiAgentProposal(before, after, [], 1), kind: undefined, changedFields: undefined, fingerprint: aiWorkflowFingerprint(before) };
}

test('AI new story generation removes only obsolete story groups from the replacement draft', () => {
  const original = groupedProject(), before = structuredClone(original);
  const result = buildAiStory(original, {
    title: '新的旅途', entry: 'opening', scenes: [{ key: 'new_scene', name: '晨光下的车站' }],
    beats: [{ key: 'opening', sceneKey: 'new_scene', name: '出发', lines: [{ text: '列车缓缓出发。' }], ending: '新的开始' }],
  });
  assert.deepEqual(result.project.storyGroups, []);
  assert.equal(projectSchema.safeParse(result.project).success, true);
  assert.deepEqual(result.project.ui, projectSchema.parse(before).ui);
  assert.deepEqual(original, before);
});

test('AI script replacement carries pruned groups through review and application atomically', () => {
  const original = groupedProject(), before = structuredClone(original), draft = replacement(original);
  assert.deepEqual(draft.storyGroups, []);
  const proposal = createAiAgentProposal(original, draft, aiLines(original).map(({ line }) => line.id), 1);
  assert.ok(proposal.changedFields?.includes('storyGroups'));
  assert.ok(aiProjectEffects(original, draft).some(effect => effect.path[0] === 'storyGroups'));
  const applied = applyAiWorkflow(original, proposal);
  assert.deepEqual(applied.storyGroups, draft.storyGroups);
  assert.deepEqual(applied.nodes, projectSchema.parse(draft).nodes);
  assert.equal(applied.scriptText?.content, draft.scriptText?.content);
  assert.equal(projectSchema.safeParse(applied).success, true);
  assert.deepEqual(original, before);
});

test('ordinary AI text edits preserve nested and deliberately empty story groups', () => {
  const original = groupedProject(), source = projectToText(original).replace('保留分组的原台词。', '只修改这句台词。');
  const parsed = applyTextScript(original, source);
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  parsed.project.scriptText = currentScriptText(source);
  const proposal = createAiAgentProposal(original, parsed.project, [], 1);
  assert.equal(proposal.changedFields?.includes('storyGroups'), false);
  const applied = applyAiWorkflow(original, proposal);
  assert.deepEqual(applied.storyGroups, original.storyGroups);
  assert.equal(aiLines(applied)[0].line.text, '只修改这句台词。');
});

test('AI reads and edits authored story groups while rejecting invalid containment without changing the original', () => {
  const original = groupedProject(), before = structuredClone(original);
  const schema: any = readAiProject(original, [], { kind: 'schema', field: 'storyGroups' });
  assert.ok(schema.schema.items.properties.nodeIds);
  const read: any = readAiProject(original, [], { kind: 'project', path: ['storyGroups', { id: 'branch_group' }] });
  assert.equal(read.value.parentId, 'outer_group');
  const rename = prepareAiChanges(original, [{ kind: 'editProject', path: ['storyGroups', { id: 'branch_group' }, 'name'], action: 'set', value: '新的支线名称' }], []);
  const applied = applyAiChanges(original, rename);
  assert.equal(applied.storyGroups![1].name, '新的支线名称');
  assert.deepEqual(applied.nodes, projectSchema.parse(original).nodes);
  assert.throws(() => prepareAiChanges(original, [{ kind: 'editProject', path: ['storyGroups', { id: 'outer_group' }, 'parentId'], action: 'set', value: 'branch_group' }], []), /分组层级不能互相包含/);
  assert.deepEqual(original, before);
});

test('legacy AI workflows synchronize story groups and preserve independent UI edits', () => {
  const original = groupedProject(), draft = replacement(original), proposal = legacyProposal(original, draft);
  const current = structuredClone(original);
  current.ui.accent = '#aabbcc';
  const applied = applyAiWorkflow(current, proposal);
  assert.deepEqual(applied.storyGroups, []);
  assert.deepEqual(applied.ui, current.ui);
  assert.equal(projectSchema.safeParse(applied).success, true);
  for (const value of [proposal, createAiAgentProposal(original, draft, [], 1)]) {
    const changed = structuredClone(original);
    changed.storyGroups![1].x += 50;
    assert.throws(() => applyAiWorkflow(changed, value), /生成方案期间/);
  }
});

test('AI workflow validates the merged project and rejects a valid proposal that omits required group updates', () => {
  const original = groupedProject(), before = structuredClone(original), draft = replacement(original);
  const proposal = createAiAgentProposal(original, draft, [], 1);
  proposal.changedFields = proposal.changedFields!.filter(field => field !== 'storyGroups');
  assert.equal(projectSchema.safeParse(proposal.project).success, true);
  assert.throws(() => applyAiWorkflow(original, proposal), /方案无法应用：剧情组/);
  assert.deepEqual(original, before);
});

test('unchanged unfinished UI remains intact, but cannot mask newly invalid story groups on AI merge', () => {
  const original = groupedProject();
  original.ui.components.push({ id: 'unfinished_control', kind: 'preference', page: 'preferences', text: '尚未选参数', x: 0, y: 0, width: .5, height: .1 });
  assert.equal(projectSchema.safeParse(original).success, false);
  const completed = structuredClone(original);
  completed.ui.components[0].preference = 'musicVolume'; completed.width += 100;
  assert.equal(projectSchema.safeParse(completed).success, true);
  const proposal = createAiAgentProposal(original, completed, [], 1);
  proposal.changedFields = proposal.changedFields!.filter(field => field !== 'ui');
  const applied = applyAiWorkflow(original, proposal);
  assert.equal(applied.width, completed.width);
  assert.deepEqual(applied.ui, original.ui);
  const replaced = replacement(original);
  replaced.ui.components[0].preference = 'musicVolume';
  const invalidMerge = createAiAgentProposal(original, replaced, [], 1);
  invalidMerge.changedFields = invalidMerge.changedFields!.filter(field => field !== 'ui' && field !== 'storyGroups');
  assert.throws(() => applyAiWorkflow(original, invalidMerge), /方案无法应用：剧情组/);
});

test('a pre-existing group issue cannot hide a second missing member with the same schema message', () => {
  const original = groupedProject(), passage = original.nodes.find(node => node.kind === 'passage')!;
  original.storyGroups![1].nodeIds.push('already_missing');
  const completed = structuredClone(original);
  completed.storyGroups![1].nodeIds = [];
  completed.nodes = completed.nodes.filter(node => node.id !== passage.id);
  const start = completed.nodes.find(node => node.kind === 'start')!;
  start.next = passage.next;
  assert.equal(projectSchema.safeParse(completed).success, true);
  const proposal = createAiAgentProposal(original, completed, [], 1);
  proposal.changedFields = proposal.changedFields!.filter(field => field !== 'storyGroups');
  assert.throws(() => applyAiWorkflow(original, proposal), /方案无法应用：剧情组/);
});

function privateLocationsProject() {
  const project = createProject('路径过滤');
  project.assets = [{
    id: 'spine_asset', name: '骨骼角色', kind: 'spine', path: 'assets/private_skeleton.json',
    sourcePath: 'C:/private_source/source.json', externalPath: 'D:/private_reference/external.json',
    externalFiles: { 'assets/private_atlas.atlas': 'D:/private_reference/external.atlas', 'assets/private_page.png': 'D:/private_reference/external.png' },
    spine: { version: '4.2.0', atlasPath: 'assets/private_atlas.atlas', pages: [{ name: '角色贴图', path: 'assets/private_page.png', width: 100, height: 200 }], animations: [{ name: '待机', duration: 1 }], skins: ['通常'], bounds: { x: 0, y: 0, width: 100, height: 200 } },
  }];
  project.exportSettings = exportSettingsSchema.parse({ directory: 'E:/private_export/game', fileName: '我的游戏' });
  project.scriptText = currentScriptText('private_source_text');
  return project;
}

test('AI initial context and all parent asset reads hide actual stored file locations without losing metadata', () => {
  const project = privateLocationsProject(), before = structuredClone(project), context = aiContext(project, []);
  const reads = [
    context,
    scrubAiProject(project),
    aiRequestMessages({ id: 'privacy_review', prompt: '检查素材', project, lineIds: [] }).at(-1)!.content,
    ...[
      ['assets'], ['assets', { id: 'spine_asset' }], ['assets', 0, 'spine'], ['assets', '0', 'spine', 'pages'],
      ['assets', { id: 'spine_asset' }, 'spine', 'pages', 0], ['exportSettings'],
    ].map(path => readAiProject(project, [], { kind: 'project', path })),
  ];
  for (const output of reads) assert.doesNotMatch(JSON.stringify(output), /private_(?:skeleton|source|reference|atlas|page|export)/);
  assert.equal(context.editor.assets[0].spine.pages[0].width, 100);
  assert.equal(context.editor.assets[0].spine.pages[0].name, '角色贴图');
  assert.equal(context.editor.assets[0].spine.animations[0].name, '待机');
  assert.equal(context.editor.exportSettings.fileName, '我的游戏');
  assert.deepEqual(project, before);
});

test('AI cannot directly read file-location leaves or descendants with IDs or either numeric index form', () => {
  const project = privateLocationsProject();
  const paths: AiProjectPath[] = [
    ['exportSettings', 'directory'], ['scriptText', 'content'],
    ...['path', 'sourcePath', 'externalPath', 'externalFiles'].flatMap(field => [
      ['assets', { id: 'spine_asset' }, field], ['assets', 0, field], ['assets', '0', field],
    ]),
    ['assets', { id: 'spine_asset' }, 'externalFiles', 'assets/private_atlas.atlas'],
    ['assets', 0, 'spine', 'atlasPath'], ['assets', '0', 'spine', 'atlasPath', 0],
    ['assets', { id: 'spine_asset' }, 'spine', 'pages', 0, 'path'],
    ['assets', 0, 'spine', 'pages', '0', 'path', 0],
  ];
  for (const path of paths) {
    assert.equal(isPrivateAiProjectPath(path), true, JSON.stringify(path));
    assert.throws(() => readAiProject(project, [], { kind: 'project', path }), /读取此工程字段|读取路径无效/);
  }
});

test('AI preserves composition parameter property paths in context, nested reads and editable objects', () => {
  const project = createProject('组合属性路径'), group = createVisualObject('group'), text = createVisualObject('text');
  group.children = [text];
  group.parameters = [{ id: 'caption_size', name: '字号', dataType: 'number', defaultValue: 60, targets: [{ instanceId: text.instanceId, path: ['fontSize'] }] }];
  project.scenes[0].entryActions = [group];
  const before = structuredClone(project), scenePath = ['scenes', { id: project.scenes[0].id }, 'entryActions', 0];
  const object: any = readAiProject(project, [], { kind: 'project', path: scenePath });
  assert.deepEqual(object.value.parameters[0].targets[0].path, ['fontSize']);
  assert.deepEqual(aiContext(project, []).editor.scenes[0].entryActions[0].parameters[0].targets[0].path, ['fontSize']);
  const propertyPath = [...scenePath, 'parameters', 0, 'targets', 0, 'path'];
  assert.equal(isPrivateAiProjectPath(propertyPath), false);
  const read: any = readAiProject(project, [], { kind: 'project', path: propertyPath });
  assert.deepEqual(read.items, ['fontSize']);
  const unset: any = readAiProject(project, [], { kind: 'project', path: [...scenePath, 'assetId'] });
  assert.equal(unset.value, null);
  object.value.name = '改名后的组合';
  const edited = applyAiChanges(project, prepareAiChanges(project, [{ kind: 'editProject', path: scenePath, action: 'set', value: object.value }], aiLines(project).map(({ line }) => line.id)));
  const action = edited.scenes[0].entryActions![0];
  assert.equal(action.kind, 'visual');
  if (action.kind === 'visual') assert.deepEqual(action.parameters![0].targets[0].path, ['fontSize']);
  assert.deepEqual(project, before);
});

test('author-defined blueprint fields and variable names resembling private keys remain public data', () => {
  const project = createProject('普通参数名称'), graph = createBlueprintGraph('effect', '路径示例'), node = graph.nodes[0];
  node.properties.path = '通往出口'; node.properties.sourcePath = '源节点名称';
  node.properties.externalPath = '外层剧情名称'; node.properties.externalFiles = '关联标题'; node.properties.scriptText = '普通显示文字';
  project.blueprints = [graph];
  project.variables = [{ id: 'path', name: 'externalPath', type: 'string', initial: '变量中的普通文字', persistent: false }];
  const path = ['blueprints', { id: graph.id }, 'nodes', { id: node.id }, 'properties'];
  const read: any = readAiProject(project, [], { kind: 'project', path });
  assert.deepEqual(read.value, node.properties);
  const leaf: any = readAiProject(project, [], { kind: 'project', path: [...path, 'path'] });
  assert.equal(leaf.value, '通往出口');
  const selected: any = readAiProject(project, [], { kind: 'selectedBlueprint', elements: 'nodes' }, [], { graphId: graph.id, nodeIds: [node.id] });
  assert.deepEqual(selected.items[0].properties, node.properties);
  const context = aiContext(project, []);
  assert.deepEqual(context.editor.blueprints[0].nodes[0].properties, node.properties);
  assert.equal(context.variables[0].name, 'externalPath');
});
