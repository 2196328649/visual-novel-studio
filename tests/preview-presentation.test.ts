import { parseProject } from '../src/desktop/project-store';
import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { createProject, editableUiComponent, effectiveUiComponents, projectSchema } from '../src/core/model';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { compileProject } from '../src/runtime/compiler';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { normalizeChapterPerformances } from '../src/core/standalone-performance';

test('static preview follows wired blueprint branches, nested calls and data values without running disconnected music', () => {
  const project = createProject();
  project.variables = [{ id: 'choose', name: '选择', type: 'boolean', initial: false, persistent: false }];
  const graph = createBlueprintGraph('function', '配乐'), nested = createBlueprintGraph('macro', '换景');
  const branch = blueprintNodeDefaults('branch'), state = blueprintNodeDefaults('getVariable'); state.properties.variableId = 'choose';
  const yes = blueprintNodeDefaults('playMusic'), no = blueprintNodeDefaults('playMusic'), disconnected = blueprintNodeDefaults('playMusic');
  yes.properties.assetId = 'song_yes'; no.properties.assetId = 'song_no'; disconnected.properties.assetId = 'not_executed';
  const call = blueprintNodeDefaults('callMacro'); call.properties.graphId = nested.id;
  const background = blueprintNodeDefaults('showBackground'); background.properties.assetId = 'chapter_background';
  graph.nodes.push(branch, state, yes, no, disconnected, call); nested.nodes.push(background);
  for (const [from, output, to, input] of [[graph.nodes[0].id, 'exec', branch.id, 'exec_in'], [state.id, 'value', branch.id, 'condition'], [branch.id, 'true', yes.id, 'exec_in'], [branch.id, 'false', no.id, 'exec_in'], [no.id, 'exec_out', call.id, 'exec_in']]) assert.equal(connectBlueprintPins(graph, from, output, to, input), undefined);
  assert.equal(connectBlueprintPins(nested, nested.nodes[0].id, 'exec', background.id, 'exec_in'), undefined);
  project.blueprints.push(graph, nested);
  const original = structuredClone(project), context = previewActionContext(project);
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context);
  assert.deepEqual(actions.filter(a => 'assetId' in a).map(a => 'assetId' in a ? a.assetId : ''), ['song_no', 'chapter_background']);
  assert.equal(context.incomplete, false); assert.deepEqual(project, original);
});

test('recursive blueprint preview ends with an incomplete flag', () => {
  const project = createProject(), graph = createBlueprintGraph('function', '递归');
  const call = blueprintNodeDefaults('callFunction'); call.properties.graphId = graph.id;
  graph.nodes.push(call); connectBlueprintPins(graph, graph.nodes[0].id, 'exec', call.id, 'exec_in'); project.blueprints.push(graph);
  const context = previewActionContext(project);
  assert.deepEqual(expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context), []);
  assert.equal(context.incomplete, true);
});

test('hiding and locking an inherited design control preserves the base and keeps it in the game', () => {
  const project = createProject();
  project.ui.components = [{ id: 'caption', page: 'main', kind: 'text', text: '作品', x: 0.1, y: 0.1, width: 0.5, height: 0.1 }];
  project.ui.instances = [{ id: 'variant', name: '派生', components: [] }]; project.ui.activeInstanceId = 'variant';
  const override = editableUiComponent(project.ui, 'caption')!; override.editor = { hidden: true, locked: true }; override.name = '标题文字';
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.equal(restored.ui.components[0].editor, undefined);
  assert.equal(effectiveUiComponents(restored.ui)[0].editor?.hidden, true);
  const compiled = compileProject(restored);
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.match(compiled.files['game/screens.rpy'], /id "vn_component_caption"/);
  assert.doesNotMatch(compiled.files['game/00-vn-ui.rpy'], /"hidden": True|"locked": True/);
});

test('editing Chinese dialogue retains chapter artwork, effect and music references', () => {
  const project = createProject();
  project.assets.push({ id: 'chapter_art', name: '章图', kind: 'image', path: 'assets/chapter.png' }, { id: 'chapter_music', name: '章曲', kind: 'audio', path: 'assets/chapter.ogg' });
  const start = project.nodes[0];
  project.nodes.push({ id: 'chapter_card', kind: 'chapterTitle', name: '入城', title: '第一章', subtitle: '入城', sceneId: project.scenes[0].id, x: 0, y: 0, duration: 4.2, effect: 'ink', backgroundId: 'chapter_art', titleImageId: 'chapter_art', soundId: 'chapter_music', next: project.nodes[1].id });
  if (start.kind === 'start') start.next = 'chapter_card';
  const migrated = parseProject(project).project;
  const text = projectToText(migrated), parsed = applyTextScript(migrated, text);
  assert.deepEqual(parsed.issues, []);
  assert.doesNotMatch(text, /@章节标题|@章节背景/);
  assert.deepEqual(parsed.project.nodes.find(n => n.id === 'chapter_card'), migrated.nodes.at(-1));
});
