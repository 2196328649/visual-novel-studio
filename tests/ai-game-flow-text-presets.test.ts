import test from 'node:test';
import assert from 'node:assert/strict';
import { aiContext, aiLines, aiOperationSchema, applyAiChanges, prepareAiChanges, type AiOperation } from '../src/core/ai';
import { aiProjectEffects, createAiAgentProposal } from '../src/core/ai-agent-review';
import { readAiProject } from '../src/core/ai-project-read';
import { addedAiProjectErrors, aiProjectDiagnostics } from '../src/core/ai-project-validation';
import { buildAiStory } from '../src/core/ai-story';
import { aiAgentFingerprint, aiWorkflowFingerprint, applyAiWorkflow, type AiWorkflowProposal } from '../src/core/ai-workflow';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintAssetFilter, blueprintAssetInputFilters } from '../src/core/blueprint-assets';
import { addGameFlowStep } from '../src/core/game-flow';
import { gameFlowConnections, gameFlowRoute } from '../src/core/game-flow-graph';
import { gameFlowSchema } from '../src/core/game-flow-schema';
import { createProject, projectSchema, type Project, type TextPreset } from '../src/core/model';
import { currentScriptText } from '../src/core/script-text';
import { builtinTextPresets, effectiveTextStyle, resolveTextStyle } from '../src/core/text-presentation';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { runAiAgent, type AiAgentOptions } from '../src/desktop/ai-agent';

function fixture() {
  const project = createProject('AI流程和文字预设');
  project.assets = [
    { id: 'test_font', name: '正文字体', kind: 'font', path: 'assets/text.ttf' },
    { id: 'test_sound', name: '打字音', kind: 'audio', path: 'assets/type.ogg' },
    { id: 'test_video', name: '开场视频', kind: 'video', path: 'assets/intro.webm' },
    { id: 'test_image', name: '背景', kind: 'image', path: 'assets/background.png' },
  ];
  project.characters = [{ id: 'hero', name: '主角', color: '#ffffff', expressions: [] }];
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines = [{ id: 'first_line', text: '第一句对白。', speakerId: 'hero', actions: [] }, { id: 'second_line', text: '第二句旁白。', actions: [] }];
  project.ui.customPages = [{ id: 'intro_page', name: '开场说明', modal: true, background: '#111111', components: [] }];
  return project;
}
const lines = (project: Project) => project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);
const allowed = (project: Project) => aiLines(project).map(({ line }) => line.id);
const edit = (project: Project, operations: unknown[], ids = allowed(project)) => applyAiChanges(project, prepareAiChanges(project, operations.map(operation => aiOperationSchema.parse(JSON.parse(JSON.stringify(operation)))), ids));
const firstLinePath = (project: Project) => ['nodes', { id: project.nodes.find(node => node.kind === 'passage')!.id }, 'lines', { id: 'first_line' }, 'textPresentation'];
const storedFlow = () => gameFlowSchema.parse({ schemaVersion: 1, beforeTitle: { steps: [{ id: 'intro_video', kind: 'video', assetId: 'test_video' }] } });
const preset = (): TextPreset => ({ id: 'shared_look', name: '心声', style: { fontAssetId: 'test_font', sizeScale: .9, italic: true, color: '#aaccee', typeSoundId: 'test_sound', speed: 'duration', duration: 2 } });
function withSharedPreset() {
  const project = fixture(); project.textPresets = [preset()];
  project.characters[0].textPresentation = { presetId: 'shared_look', bold: true };
  lines(project)[0].textPresentation = { presetId: 'shared_look', color: '#ffccaa' };
  return project;
}
function legacyProposal(before: Project, after: Project): AiWorkflowProposal {
  return { ...createAiAgentProposal(before, after, allowed(before), 1), kind: undefined, changedFields: undefined, fingerprint: aiWorkflowFingerprint(before) };
}

test('AI exposes authored game flow and custom text presets, while absent fields remain absent after reads', () => {
  const project = fixture(), before = structuredClone(project);
  for (const field of ['gameFlow', 'textPresets'] as const) {
    const response: any = readAiProject(project, [], { kind: 'project', path: [field] });
    assert.equal(response.value, null); assert.equal(Object.hasOwn(project, field), false);
    const schema: any = readAiProject(project, [], { kind: 'schema', field });
    assert.equal(schema.field, field);
    assert.match(JSON.stringify(schema.schema), field === 'gameFlow' ? /connections/ : /fontAssetId/);
  }
  assert.deepEqual(project, before);
  project.gameFlow = storedFlow(); project.textPresets = [preset()];
  const context = aiContext(project, allowed(project));
  assert.deepEqual(context.editor.gameFlow, project.gameFlow);
  assert.deepEqual(context.editor.textPresets, project.textPresets);
  const step: any = readAiProject(project, [], { kind: 'project', path: ['gameFlow', 'beforeTitle', 'steps', { id: 'intro_video' }] });
  assert.equal(step.value.assetId, 'test_video'); assert.equal(step.value.allowSkip, false);
  const style: any = readAiProject(project, [], { kind: 'project', path: ['textPresets', { id: 'shared_look' }, 'style'] });
  assert.equal(style.value.fontAssetId, 'test_font');
  assert.doesNotMatch(JSON.stringify(context), /assets\//);
});

test('AI can page and search read-only builtin text presets without mutating their shared definitions', () => {
  const project = fixture(), before = structuredClone(builtinTextPresets);
  const first: any = readAiProject(project, [], { kind: 'builtinTextPresets', limit: 5 });
  const second: any = readAiProject(project, [], { kind: 'builtinTextPresets', offset: first.nextOffset, limit: 5 });
  assert.equal(first.readOnly, true); assert.equal(first.total, builtinTextPresets.length);
  assert.equal(first.items.length, 5); assert.equal(second.offset, 5);
  assert.deepEqual([...first.items, ...second.items], builtinTextPresets.slice(0, 10));
  const search: any = readAiProject(project, [], { kind: 'builtinTextPresets', query: 'whisper' });
  assert.equal(search.total, 1); assert.equal(search.items[0].id, 'builtin_text_whisper');
  first.items[0].style.color = '#000000'; assert.deepEqual(builtinTextPresets, before);
  assert.equal(project.textPresets, undefined);
});

test('AI creates a page, blueprint, video and complete startup route in one coherent batch', () => {
  const project = fixture(), before = structuredClone(project), graph = createBlueprintGraph('function', '开场演出');
  const flow = gameFlowSchema.parse({ schemaVersion: 1, beforeTitle: { repeat: 'version', revision: 'intro_2', steps: [
    { id: 'intro_call', kind: 'blueprint', graphId: graph.id },
    { id: 'intro_notice', kind: 'page', pageId: 'new_page', completion: 'auto', duration: .5 },
    { id: 'intro_movie', kind: 'video', assetId: 'new_video' },
  ] }, connections: { 'flow:launch': 'flow:step:intro_movie', 'flow:step:intro_movie': 'flow:step:intro_call', 'flow:step:intro_call': 'flow:step:intro_notice', 'flow:step:intro_notice': 'flow:title', 'flow:newGame': 'flow:story' },
  transitions: { 'flow:step:intro_notice': { mode: 'dissolve', duration: .4 } }, positions: { 'flow:step:intro_movie': { x: 100, y: 150 } } });
  const next = edit(project, [
    { kind: 'editProject', path: ['gameFlow'], action: 'set', value: flow },
    { kind: 'editProject', path: ['ui', 'customPages'], action: 'append', value: { id: 'new_page', name: '新说明', modal: true, background: '#222222', components: [] } },
    { kind: 'editProject', path: ['blueprints'], action: 'append', value: graph },
    { kind: 'editProject', path: ['assets'], action: 'append', value: { id: 'new_video', name: '新片头', kind: 'video', path: 'assets/new.webm' } },
  ]);
  assert.deepEqual(next.gameFlow, flow);
  assert.deepEqual(gameFlowRoute(next, 'beforeTitle').steps.map(step => step.id), ['intro_movie', 'intro_call', 'intro_notice']);
  assert.equal(gameFlowRoute(next, 'beforeTitle').complete, true);
  const proposal = createAiAgentProposal(project, next, [], 1);
  assert.ok(proposal.changedFields?.includes('gameFlow'));
  assert.ok(aiProjectEffects(project, next).some(effect => effect.path[0] === 'gameFlow'));
  const applied = applyAiWorkflow(project, proposal);
  assert.deepEqual(applied.gameFlow, flow); assert.deepEqual(project, before);
  for (const field of ['assets', 'ui', 'blueprints'] as const) {
    const partial = { ...proposal, changedFields: proposal.changedFields!.filter(key => key !== field) };
    assert.throws(() => applyAiWorkflow(project, partial), /方案无法应用/);
  }
});

test('AI preserves sequential legacy flow until an explicit complete graph is authored, including detached modules', () => {
  const project = fixture(); project.gameFlow = storedFlow();
  const before = structuredClone(project), connections = gameFlowConnections(project);
  const detached = edit(project, [
    { kind: 'editProject', path: ['gameFlow', 'connections'], action: 'set', value: connections },
    { kind: 'editProject', path: ['gameFlow', 'beforeTitle', 'steps'], action: 'append', value: { id: 'detached_video', kind: 'video', assetId: 'test_video', allowSkip: false } },
    { kind: 'editProject', path: ['gameFlow', 'transitions'], action: 'set', value: { 'flow:step:detached_video': { mode: 'none' } } },
  ]);
  assert.deepEqual(gameFlowRoute(detached, 'beforeTitle').steps.map(step => step.id), ['intro_video']);
  assert.equal(detached.gameFlow!.beforeTitle.steps.length, 2);
  assert.ok(aiProjectDiagnostics(detached).some(issue => issue.severity === 'warning' && issue.gameFlow?.stepId === 'detached_video'));
  assert.deepEqual(project, before); assert.equal(project.gameFlow!.connections, undefined);
  const movedConnections = { 'flow:launch': 'flow:title', 'flow:newGame': 'flow:step:intro_video', 'flow:step:intro_video': 'flow:story' };
  assert.throws(() => edit(project, [{ kind: 'editProject', path: ['gameFlow', 'connections'], action: 'set', value: movedConnections }]), /归属不一致|未连接/);
  const moved = edit(project, [
    { kind: 'editProject', path: ['gameFlow', 'connections'], action: 'set', value: movedConnections },
    { kind: 'editProject', path: ['gameFlow', 'beforeTitle', 'steps'], action: 'set', value: [] },
    { kind: 'editProject', path: ['gameFlow', 'beforeNewGame'], action: 'set', value: project.gameFlow!.beforeTitle.steps },
  ]);
  assert.equal(gameFlowRoute(moved, 'beforeTitle').steps.length, 0);
  assert.deepEqual(gameFlowRoute(moved, 'beforeNewGame').steps.map(step => step.id), ['intro_video']);
});

test('AI rejects broken game-flow references, cycles and unsupported transitions without changing the original', () => {
  const project = fixture(); project.gameFlow = storedFlow(); const before = structuredClone(project);
  const badOperations: AiOperation[] = [
    { kind: 'editProject', path: ['gameFlow', 'beforeTitle', 'steps', { id: 'intro_video' }, 'assetId'], action: 'set', value: 'test_image' },
    { kind: 'editProject', path: ['gameFlow', 'beforeTitle', 'steps'], action: 'append', value: { id: 'missing_page', kind: 'page', pageId: 'not_a_page' } },
    { kind: 'editProject', path: ['gameFlow', 'beforeNewGame'], action: 'append', value: { id: 'missing_graph', kind: 'blueprint', graphId: 'not_a_graph' } },
    { kind: 'editProject', path: ['gameFlow', 'connections'], action: 'set', value: { 'flow:launch': 'flow:step:intro_video', 'flow:step:intro_video': 'flow:step:intro_video', 'flow:newGame': 'flow:story' } },
    { kind: 'editProject', path: ['gameFlow', 'transitions'], action: 'set', value: { 'flow:title': { mode: 'dissolve', duration: .3 } } },
    { kind: 'editProject', path: ['gameFlow', 'transitions'], action: 'set', value: { 'flow:step:unknown': { mode: 'none' } } },
  ];
  for (const operation of badOperations) assert.throws(() => edit(project, [operation]), /建议无法应用/);
  assert.deepEqual(project, before);
});

test('AI validates blueprint step argument names, types and referenced objects, including detached steps', () => {
  const project = fixture(), graph = createBlueprintGraph('function', '有参数的流程');
  graph.exposedInputs = [blueprintPin('count', '次数', 'input', 'number', 1), blueprintPin('scene', '场景', 'input', 'scene', project.scenes[0].id),
    blueprintPin('actor', '角色', 'input', 'character', 'hero'), blueprintPin('page', '页面', 'input', 'ui', 'intro_page'), blueprintPin('media', '素材', 'input', 'asset', 'test_image')];
  project.blueprints = [graph]; project.gameFlow = storedFlow();
  const graphWire = { ...gameFlowConnections(project) };
  const input = (inputs: Record<string, string | number | boolean>) => [
    { kind: 'editProject', path: ['gameFlow', 'connections'], action: 'set', value: graphWire },
    { kind: 'editProject', path: ['gameFlow', 'beforeNewGame'], action: 'append', value: { id: 'argument_step', kind: 'blueprint', graphId: graph.id, inputs } },
  ] satisfies AiOperation[];
  const invalidInputs: Record<string, string | number | boolean>[] = [{ removed: 1 }, { count: '一' }, { scene: 'missing' }, { actor: 'missing' }, { page: 'missing' }, { media: 'missing' }];
  for (const inputs of invalidInputs) {
    assert.throws(() => edit(project, input(inputs)), /输入已不存在|需要有效的/);
  }
  const next = edit(project, input({ count: 3, page: 'preferences', media: 'test_sound' }));
  assert.equal(gameFlowRoute(next, 'beforeNewGame').steps.length, 0, 'a valid disconnected step remains a draft');
  assert.equal(next.gameFlow!.beforeNewGame[0].kind, 'blueprint');
  graph.exposedInputs.push({ ...blueprintPin('required_actor', '必填角色', 'input', 'character'), required: true });
  assert.throws(() => edit(project, input({})), /缺少必填输入/);
});

test('AI uses actual blueprint asset consumers while preserving the picker fallback behavior', () => {
  const project = fixture(), graph = createBlueprintGraph('function', '素材输入'), input = blueprintPin('media', '素材', 'input', 'asset', 'test_image');
  graph.exposedInputs = [input]; project.blueprints = [graph];
  assert.deepEqual(blueprintAssetInputFilters(project, graph, input), []);
  assert.equal(blueprintAssetFilter(project, graph, input).kind, 'image');
  addGameFlowStep(project, 'beforeTitle', { kind: 'blueprint', graphId: graph.id, id: 'media_step', inputs: { media: 'test_sound' } });
  assert.deepEqual(aiProjectDiagnostics(project).filter(issue => issue.severity === 'error'), []);
  const read = blueprintNodeDefaults('getInput'); read.properties.inputId = 'media';
  const background = blueprintNodeDefaults('showBackground'); graph.nodes.push(read, background);
  synchronizeBlueprintSignatures(project);
  assert.equal(connectBlueprintPins(graph, read.id, 'value', background.id, 'assetId'), undefined);
  assert.equal(connectBlueprintPins(graph, graph.nodes[0].id, 'exec', background.id, 'exec_in'), undefined);
  assert.equal(blueprintAssetInputFilters(project, graph, input)[0].kind, 'image');
  const issues = aiProjectDiagnostics(project);
  assert.ok(issues.some(issue => issue.code === 'ai.gameFlow.input.assetKind' && issue.gameFlow?.stepId === 'media_step'));
  const repaired = edit(project, [{ kind: 'editProject', path: ['gameFlow', 'beforeTitle', 'steps', { id: 'media_step' }, 'inputs', 'media'], action: 'set', value: 'test_image' }]);
  assert.equal(aiProjectDiagnostics(repaired).some(issue => issue.code === 'ai.gameFlow.input.assetKind'), false);
  const music = blueprintNodeDefaults('playMusic'); graph.nodes.push(music);
  assert.equal(connectBlueprintPins(graph, read.id, 'value', music.id, 'assetId'), undefined);
  assert.deepEqual(new Set(blueprintAssetInputFilters(project, graph, input).map(filter => filter.kind)), new Set(['image', 'audio']));
  assert.equal(blueprintAssetFilter(project, graph, input).kind, 'image', 'picker retains its existing default-media fallback');
  assert.equal(aiProjectDiagnostics(project).some(issue => issue.code === 'ai.gameFlow.input.assetKind'), false, 'mixed branch constraints do not invent one mandatory media kind');
});

test('AI validates typed page argument references while preserving old untyped page arguments', () => {
  const project = fixture();
  addGameFlowStep(project, 'beforeTitle', { kind: 'page', id: 'page_step', pageId: 'intro_page', completion: 'auto', inputs: { caption: '旧页面数据' } });
  const next = edit(project, [{ kind: 'editProject', path: ['gameFlow', 'beforeTitle', 'steps', { id: 'page_step' }, 'duration'], action: 'set', value: 1 }]);
  assert.equal(next.gameFlow!.beforeTitle.steps[0].kind, 'page');
  const typed = structuredClone(project);
  typed.ui.pageInterfaces = { intro_page: { version: 1, inputs: [{ ...blueprintPin('portrait', '图片', 'input', 'asset'), dataType: 'asset', required: true }], outputs: [] } };
  const step = typed.gameFlow!.beforeTitle.steps[0]; if (step.kind !== 'page') throw new Error('fixture');
  step.inputs = { portrait: 'test_image' };
  assert.throws(() => edit(typed, [{ kind: 'editProject', path: ['gameFlow', 'beforeTitle', 'steps', { id: 'page_step' }, 'inputs', 'portrait'], action: 'set', value: 'missing_asset' }]), /需要有效的素材/);
  const batch = edit(typed, [
    { kind: 'editProject', path: ['gameFlow', 'beforeTitle', 'steps', { id: 'page_step' }, 'inputs', 'portrait'], action: 'set', value: 'new_picture' },
    { kind: 'editProject', path: ['assets'], action: 'append', value: { id: 'new_picture', name: '新图片', kind: 'image', path: 'assets/new.png' } },
  ]);
  assert.equal(aiProjectDiagnostics(batch).some(issue => issue.severity === 'error'), false);
});

test('a preexisting game-flow error cannot mask the same error in another step or a new broken reference', () => {
  const project = fixture(); project.gameFlow = storedFlow();
  const step = project.gameFlow.beforeTitle.steps[0]; if (step.kind !== 'video') throw new Error('fixture'); step.assetId = 'already_missing';
  const before = structuredClone(project);
  const unrelated = edit(project, [{ kind: 'editProject', path: ['gameFlow', 'beforeTitle', 'revision'], action: 'set', value: '2' }]);
  assert.equal(unrelated.gameFlow!.beforeTitle.revision, '2');
  assert.throws(() => edit(project, [{ kind: 'editProject', path: ['gameFlow', 'beforeTitle', 'steps'], action: 'append', value: { id: 'another_broken', kind: 'video', assetId: 'already_missing' } }]), /建议无法应用/);
  assert.throws(() => edit(project, [{ kind: 'editProject', path: ['gameFlow', 'beforeTitle', 'steps', { id: step.id }, 'assetId'], action: 'set', value: 'different_missing' }]), /建议无法应用/);
  const invalid = structuredClone(project); invalid.gameFlow!.beforeTitle.steps.push({ id: 'another_broken', kind: 'video', assetId: 'already_missing', allowSkip: false });
  assert.throws(() => applyAiWorkflow(project, createAiAgentProposal(project, invalid, [], 1)), /方案无法应用/);
  const diagnostic = aiProjectDiagnostics(project).find(issue => issue.severity === 'error')!;
  assert.equal(addedAiProjectErrors([diagnostic], [diagnostic, diagnostic]).length, 1);
  assert.deepEqual(project, before);
});

test('AI creates a shared text preset and references in one batch with actual script serialization', () => {
  const project = fixture(); project.scriptText = currentScriptText(projectToText(project));
  const before = structuredClone(project);
  const next = edit(project, [
    { kind: 'editProject', path: firstLinePath(project), action: 'set', value: { presetId: 'shared_look', color: '#ffccaa' } },
    { kind: 'editProject', path: ['characters', { id: 'hero' }, 'textPresentation'], action: 'set', value: { presetId: 'shared_look', bold: true } },
    { kind: 'editProject', path: ['textPresets'], action: 'set', value: [preset()] },
  ]);
  assert.equal(effectiveTextStyle(next, lines(next)[0]).italic, true);
  assert.equal(effectiveTextStyle(next, lines(next)[0]).color, '#ffccaa');
  assert.equal(effectiveTextStyle(next, lines(next)[0]).bold, true);
  assert.equal(effectiveTextStyle(next, lines(next)[0]).fontAssetId, 'test_font');
  assert.match(next.scriptText!.content, /心声【shared_look】/);
  const parsed = applyTextScript(next, next.scriptText!.content);
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(effectiveTextStyle(parsed.project, lines(parsed.project)[0]), effectiveTextStyle(next, lines(next)[0]));
  const proposal = createAiAgentProposal(project, next, allowed(project), 1);
  assert.ok(proposal.changedFields?.includes('textPresets'));
  assert.ok(aiProjectEffects(project, next).some(effect => effect.path[0] === 'textPresets'));
  assert.deepEqual(applyAiWorkflow(project, proposal).textPresets, next.textPresets);
  assert.throws(() => applyAiWorkflow(project, { ...proposal, changedFields: proposal.changedFields!.filter(field => field !== 'textPresets') }), /方案无法应用.*预设/);
  assert.deepEqual(project, before);
});

test('AI rejects duplicate and shadowed preset identities, including unused invalid resource references', () => {
  const project = withSharedPreset(), before = structuredClone(project);
  for (const value of [
    { id: 'shared_look', name: '第二个', style: {} }, { id: 'another_look', name: '心声', style: {} },
    { id: builtinTextPresets[0].id, name: '覆盖内置', style: {} }, { id: 'another_look', name: builtinTextPresets[0].name, style: {} },
    { id: 'another_look', name: '坏字体', style: { fontAssetId: 'test_image' } }, { id: 'another_look', name: '坏声音', style: { typeSoundId: 'missing_audio' } },
  ]) assert.throws(() => edit(project, [{ kind: 'editProject', path: ['textPresets'], action: 'append', value }]), /建议无法应用/);
  assert.throws(() => edit(project, [{ kind: 'editProject', path: firstLinePath(project), action: 'set', value: { presetId: 'missing_preset' } }]), /预设不存在/);
  assert.deepEqual(project, before);
});

test('AI deletes a shared preset only with all references explicitly rebound or detached in the same batch', () => {
  const project = withSharedPreset(), before = structuredClone(project);
  const remove: AiOperation = { kind: 'editProject', path: ['textPresets', { id: 'shared_look' }], action: 'remove' };
  assert.throws(() => edit(project, [remove]), /预设不存在/);
  const next = edit(project, [remove,
    { kind: 'editProject', path: firstLinePath(project), action: 'set', value: resolveTextStyle(project, lines(project)[0].textPresentation) },
    { kind: 'editProject', path: ['characters', { id: 'hero' }, 'textPresentation'], action: 'set', value: resolveTextStyle(project, project.characters[0].textPresentation) },
  ]);
  assert.deepEqual(next.textPresets, []);
  assert.deepEqual(effectiveTextStyle(next, lines(next)[0]), effectiveTextStyle(project, lines(project)[0]));
  assert.equal(lines(next)[0].textPresentation!.presetId, undefined); assert.equal(next.characters[0].textPresentation!.presetId, undefined);
  assert.deepEqual(project, before);
});

test('AI requires preset asset references to stay valid and does not silently inline shared styles', () => {
  const project = withSharedPreset(), before = structuredClone(project);
  assert.throws(() => edit(project, [{ kind: 'editProject', path: ['assets', { id: 'test_font' }], action: 'remove' }]), /字体素材/);
  assert.throws(() => edit(project, [{ kind: 'editProject', path: ['assets', { id: 'test_sound' }, 'kind'], action: 'set', value: 'image' }]), /打字音素材/);
  const next = edit(project, [
    { kind: 'editProject', path: ['assets', { id: 'test_font' }], action: 'remove' },
    { kind: 'editProject', path: ['assets'], action: 'append', value: { id: 'new_font', name: '替换字体', kind: 'font', path: 'assets/new.otf' } },
    { kind: 'editProject', path: ['textPresets', { id: 'shared_look' }, 'style', 'fontAssetId'], action: 'set', value: 'new_font' },
  ]);
  assert.equal(lines(next)[0].textPresentation!.presetId, 'shared_look');
  assert.equal(next.characters[0].textPresentation!.presetId, 'shared_look');
  assert.equal(effectiveTextStyle(next, lines(next)[0]).fontAssetId, 'new_font');
  assert.deepEqual(project, before);
});

test('AI preserves existing invalid text references but rejects a second one even on an unselected line', () => {
  const project = fixture(); lines(project)[0].textPresentation = { presetId: 'old_missing' };
  const before = structuredClone(project);
  const next = edit(project, [{ kind: 'editProject', path: ['name'], action: 'set', value: '仅改名' }], []);
  assert.deepEqual(lines(next), lines(project));
  const invalid = structuredClone(project); lines(invalid)[1].textPresentation = { presetId: 'old_missing' };
  assert.throws(() => applyAiWorkflow(project, createAiAgentProposal(project, invalid, [], 1)), /方案无法应用/);
  const read: any = readAiProject(invalid, ['first_line'], { kind: 'diagnostics' });
  assert.ok(read.items.some((issue: any) => issue.projectPath?.includes('textPresentation')));
  assert.equal(read.items.some((issue: any) => issue.lineId === 'second_line'), false);
  assert.ok(read.omittedLineDiagnostics > 0); assert.deepEqual(project, before);
});

test('reordering or renaming an existing invalid preset does not migrate or multiply its original issues', () => {
  const project = fixture(); project.textPresets = [
    { id: 'old_first', name: '原同名', style: { fontAssetId: 'old_missing_font' } },
    { id: 'old_second', name: '原同名', style: {} },
  ];
  const before = structuredClone(project);
  const reordered = edit(project, [{ kind: 'editProject', path: ['textPresets'], action: 'set', value: [...project.textPresets].reverse() }]);
  assert.equal(reordered.textPresets![0].id, 'old_second');
  const renamed = edit(project, [{ kind: 'editProject', path: ['textPresets', { id: 'old_first' }, 'name'], action: 'set', value: '独立名称' }]);
  assert.equal(renamed.textPresets![0].style.fontAssetId, 'old_missing_font');
  assert.equal(aiProjectDiagnostics(renamed).filter(issue => issue.code === 'ai.textPreset.name').length, 0);
  assert.deepEqual(project, before);
});

test('AI cannot detach an out-of-scope line while deleting a preset and can apply builtins locally', () => {
  const project = withSharedPreset(), before = structuredClone(project);
  lines(project)[1].textPresentation = { presetId: 'shared_look' };
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  assert.throws(() => edit(project, [
    { kind: 'editProject', path: ['textPresets'], action: 'set', value: [] },
    { kind: 'editProject', path: ['characters', { id: 'hero' }, 'textPresentation'], action: 'remove' },
    { kind: 'editProject', path: firstLinePath(project), action: 'remove' },
    { kind: 'editProject', path: ['nodes', { id: passage.id }, 'lines', { id: 'second_line' }, 'textPresentation'], action: 'remove' },
  ], ['first_line']), /范围以外/);
  const next = edit(before, [{ kind: 'editProject', path: firstLinePath(before), action: 'set', value: { presetId: 'builtin_text_whisper' } }], ['first_line']);
  assert.deepEqual(next.textPresets, before.textPresets);
  assert.equal(effectiveTextStyle(next, lines(next)[0]).sizeScale, .85);
  assert.deepEqual(lines(next)[1], lines(before)[1]);
});

test('AI scope checks allow unrelated edits but reject actual changes to unselected dialogue', () => {
  const project = fixture(), first = lines(project)[0];
  // Authored fields and nested actions need not arrive in schema declaration order.
  first.actions = [{ seconds: .25, kind: 'pause' }, { assetId: 'test_sound', kind: 'sound' }];
  first.textPresentation = { color: '#ffccaa', sizeScale: .9 };
  first.voiceId = undefined;
  const before = structuredClone(project);
  const next = edit(project, [{ kind: 'editProject', path: ['name'], action: 'set', value: '只改工程名' }], []);
  assert.equal(next.name, '只改工程名');
  assert.deepEqual(lines(next), lines(project));
  const linePath = firstLinePath(project).slice(0, -1);
  const changes: { field: string; path: unknown[]; action: string; value?: unknown }[] = [
    { field: 'text', path: [...linePath, 'text'], action: 'set', value: '修改对白。' },
    { field: 'speaker', path: [...linePath, 'speakerId'], action: 'remove' },
    { field: 'voice', path: [...linePath, 'voiceId'], action: 'set', value: 'test_sound' },
    { field: 'style', path: [...linePath, 'textPresentation', 'bold'], action: 'set', value: true },
    { field: 'new action', path: [...linePath, 'actions'], action: 'append', value: { kind: 'pause', seconds: .5 } },
    { field: 'action order', path: [...linePath, 'actions'], action: 'set', value: [...first.actions].reverse() },
    { field: 'line removal', path: linePath, action: 'remove' },
  ];
  for (const { field, ...operation } of changes) {
    assert.throws(() => edit(project, [{ kind: 'editProject', ...operation }], []), /范围以外/, field);
  }
  const selected = edit(project, [{ kind: 'editProject', path: [...linePath, 'text'], action: 'set', value: '允许修改。' }], ['first_line']);
  assert.equal(lines(selected)[0].text, '允许修改。');
  assert.deepEqual(lines(selected)[1], lines(project)[1]);
  assert.deepEqual(project, before);
});

test('gameFlow and textPresets participate in both AI fingerprint paths and legacy application', () => {
  const project = withSharedPreset(); project.gameFlow = storedFlow();
  const draft = structuredClone(project); draft.gameFlow!.beforeTitle.repeat = 'profile'; draft.textPresets![0].style.sizeScale = 1.2;
  const agent = createAiAgentProposal(project, draft, [], 1), legacy = legacyProposal(project, draft);
  for (const proposal of [agent, legacy]) {
    const applied = applyAiWorkflow(project, proposal);
    assert.deepEqual(applied.gameFlow, draft.gameFlow); assert.deepEqual(applied.textPresets, draft.textPresets);
    const changed = structuredClone(project); changed.gameFlow!.beforeTitle.repeat = 'title';
    assert.throws(() => applyAiWorkflow(changed, proposal), /生成方案期间/);
    const presetChanged = structuredClone(project); presetChanged.textPresets![0].name = '新的共享名称';
    assert.throws(() => applyAiWorkflow(presetChanged, proposal), /生成方案期间/);
  }
  const uiChanged = structuredClone(project); uiChanged.ui.accent = '#123456';
  const applied = applyAiWorkflow(uiChanged, legacy); assert.equal(applied.ui.accent, '#123456');
  assert.equal(aiWorkflowFingerprint(uiChanged), aiWorkflowFingerprint(project));
  assert.notEqual(aiAgentFingerprint(uiChanged), aiAgentFingerprint(project));
  const changes = prepareAiChanges(project, [{ kind: 'editProject', path: ['gameFlow', 'beforeTitle', 'revision'], action: 'set', value: '2' }], []);
  const revised = structuredClone(project); revised.textPresets![0].style.bold = true;
  assert.throws(() => applyAiChanges(revised, changes), /已发生变化/);
});

test('story replacement preserves startup/text settings and rejects newly broken retained flow arguments', () => {
  const project = withSharedPreset(); project.gameFlow = storedFlow(); const before = structuredClone(project);
  const raw = { title: '新故事', entry: 'opening', scenes: [{ key: 'new_scene', name: '车站' }], beats: [{ key: 'opening', sceneKey: 'new_scene', name: '出发', lines: [{ text: '列车出发。' }], ending: '结束' }] };
  const next = buildAiStory(project, raw).project;
  assert.deepEqual(next.gameFlow, before.gameFlow); assert.deepEqual(next.textPresets, before.textPresets);
  assert.deepEqual(next.characters, projectSchema.parse(before).characters);
  assert.deepEqual(project, before);
  const graph = createBlueprintGraph('function', '场景参数'); graph.exposedInputs = [blueprintPin('place', '场景', 'input', 'scene')]; project.blueprints.push(graph);
  addGameFlowStep(project, 'beforeNewGame', { kind: 'blueprint', id: 'scene_argument', graphId: graph.id, inputs: { place: project.scenes[0].id } });
  const preserved = structuredClone(project);
  assert.throws(() => buildAiStory(project, raw), /场景/);
  assert.deepEqual(project, preserved);
});

test('AI keeps existing obsolete transitions but rejects removing a live source without handling its transition', () => {
  const project = fixture(); project.gameFlow = storedFlow(); project.gameFlow.transitions = { 'flow:old_step': { mode: 'none' } };
  const unchanged = edit(project, [{ kind: 'editProject', path: ['name'], action: 'set', value: '保持旧数据' }]);
  assert.deepEqual(unchanged.gameFlow, project.gameFlow);
  project.gameFlow.transitions = { 'flow:step:intro_video': { mode: 'dissolve', duration: .5 } };
  assert.throws(() => edit(project, [{ kind: 'editProject', path: ['gameFlow', 'beforeTitle', 'steps'], action: 'set', value: [] }]), /不支持继续过渡/);
  const next = edit(project, [
    { kind: 'editProject', path: ['gameFlow', 'beforeTitle', 'steps'], action: 'set', value: [] },
    { kind: 'editProject', path: ['gameFlow', 'transitions'], action: 'remove' },
  ]);
  assert.equal(gameFlowRoute(next, 'beforeTitle').complete, true); assert.equal(next.gameFlow!.transitions, undefined);
});

test('agent reads builtin presets, rejects a broken batch and proves the corrected game-flow/text result before applying', async () => {
  const project = fixture(), before = structuredClone(project);
  const tool = (id: string, name: string, args: object) => ({ id, name, arguments: args, taskIds: ['author'] });
  const results = (messages: { content: string }[]) => JSON.parse(messages.at(-1)!.content.split('\n').slice(1).join('\n'));
  const options: AiAgentOptions = { projectDirectory: () => undefined, progress: () => {}, check: () => {}, specialist: async () => { throw new Error('Unexpected specialist'); } };
  let calls = 0;
  const response = await runAiAgent({ agentStep: async (_id, messages) => {
    calls++;
    if (calls === 1) return JSON.stringify({ tasks: [{ id: 'author', title: '设置开场与台词演出', kind: 'change' }], tools: [
      tool('builtins', 'readProject', { kind: 'builtinTextPresets', query: 'whisper' }),
      tool('bad', 'editProject', { operations: [{ kind: 'editProject', path: ['textPresets'], action: 'set', value: [{ id: 'bad_look', name: '损坏预设', style: { fontAssetId: 'missing_font' } }] }] }),
    ] });
    if (calls === 2) {
      const result = results(messages); assert.equal(result[0].data.items[0].id, 'builtin_text_whisper'); assert.equal(result[1].ok, false);
      return JSON.stringify({ tools: [tool('fixed', 'editProject', { operations: [
        { kind: 'editProject', path: ['gameFlow'], action: 'set', value: storedFlow() },
        { kind: 'editProject', path: ['textPresets'], action: 'set', value: [preset()] },
        { kind: 'editProject', path: firstLinePath(project), action: 'set', value: { presetId: 'shared_look' } },
      ] }), tool('check', 'validateProject', {}), tool('review', 'reviewChanges', {})] });
    }
    assert.equal(calls, 3);
    const result = results(messages); assert.equal(result[0].ok, true); assert.deepEqual(result[1].data.newErrors, []);
    return JSON.stringify({ finish: { message: '开场视频和共享文字预设已准备好，待应用。', tasks: [{ id: 'author', status: 'complete', evidence: ['fixed'] }] } });
  } }, { id: 'ai_flow_preset_agent', prompt: '设置开场与台词演出', project, lineIds: allowed(project) }, options);
  assert.equal(calls, 3); assert.deepEqual(project, before);
  const proposal = response.workflow!;
  assert.equal(proposal.tasks![0].status, 'complete'); assert.ok(proposal.changedFields!.includes('gameFlow')); assert.ok(proposal.changedFields!.includes('textPresets'));
  const applied = applyAiWorkflow(project, proposal);
  assert.deepEqual(applied.gameFlow, storedFlow()); assert.deepEqual(applied.textPresets, [preset()]);
  assert.equal(effectiveTextStyle(applied, lines(applied)[0]).italic, true);
  assert.equal(applied.textPresets!.some(item => item.id === 'bad_look'), false);
});
