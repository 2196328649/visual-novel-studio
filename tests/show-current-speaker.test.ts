import { createShowCharacterFixture } from '../scripts/lib/show-character-fixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type StageAction } from '../src/core/model';
import { actionText, textCommandAction, projectToText, applyTextScript } from '../src/core/text-script';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { commandPerformanceBlueprints } from '../src/core/builtin-performances';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { compileProject } from '../src/runtime/compiler';
import { moveStageActor } from '../src/core/stage-edit';
import { linePreviewSnapshot } from '../src/core/line-preview';
import { textAssistance } from '../src/core/text-completion';
import { defaultShowCharacter } from '../src/core/character-presets';

function fixture() {
  const p = createProject();
  p.assets = [{ id: 'portrait', name: '立绘', kind: 'image', path: 'portrait.png', width: 200, height: 300 }];
  p.characters = ['a', 'b'].map(id => ({ id, name: id.toUpperCase(), color: '#ffffff', defaultExpressionId: id + '_happy', expressions: [{ id: id + '_normal', name: '普通', assetId: 'portrait' }, { id: id + '_happy', name: '笑', assetId: 'portrait' }] }));
  const show = textCommandAction(p, '@显示角色：显示范围=仅本句')!;
  assert.equal(show.kind, 'show');
  const node = p.nodes.find(n => n.kind === 'passage')!; p.entryId = node.id;
  node.lines = [{ id: 'line', speakerId: 'a', text: '说话', actions: [show] }];
  return { p, show: show as Extract<StageAction, { kind: 'show' }>, node };
}

test('one show command preserves blank targets and expressions through authoring and serialization', () => {
  const { p, show } = fixture();
  assert.equal(show.characterId, ''); assert.equal(show.expressionId, '');
  for (const action of [show, { ...show, expressionId: '笑' }, { ...show, characterId: 'a' }]) assert.deepEqual(textCommandAction(p, actionText(p, action)), action);
  const restored = applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(p))), projectToText(p));
  assert.deepEqual(restored.issues.filter(i => i.severity === 'error'), []);
  const node = restored.project.nodes.find(n => n.kind === 'passage')!;
  assert.equal((node.lines[0].actions[0] as typeof show).characterId, '');
  assert.equal(textCommandAction(p, '@显示角色：不存在'), undefined);
});

test('show commands omit default parameters without losing expressions, timing overrides or manual framing', () => {
  const { p } = fixture();
  const basic = defaultShowCharacter({ duration: .5, wait: true });
  assert.equal(actionText(p, basic), '@显示角色');
  assert.equal(actionText(p, { ...basic, expressionId: '笑' }), '@显示角色：表情=笑');
  const byId = { ...defaultShowCharacter(), expressionId: 'a_happy' };
  const text = actionText(p, byId);
  assert.equal(text, '@显示角色：表情=笑【a_happy】');
  p.characters[0].expressions[1].name = '改名';
  assert.deepEqual(textCommandAction(p, text), byId);
  for (const action of [defaultShowCharacter({ presetId: undefined }), defaultShowCharacter({ presetId: undefined, x: .2 }), defaultShowCharacter({ x: .2 }), defaultShowCharacter({ characterId: 'a', expressionId: 'a_normal', lifetime: 'persistent', actorTransitions: { enter: { mode: 'fade', duration: 1.2 }, expression: { mode: 'fade', duration: 1.2 } }, wait: false, layer: 20, instanceId: 'closeup' })]) {
    assert.deepEqual(textCommandAction(p, actionText(p, action)), JSON.parse(JSON.stringify(action)));
  }
  const node = p.nodes.find(n => n.kind === 'passage')!;
  node.lines = [{ id: 'compact', speakerId: 'a', text: 'Hello', actions: [basic] }];
  const source = projectToText(p);
  assert.match(source, /^@显示角色$/m); assert.doesNotMatch(source, /@演出实例/);
  const restored = applyTextScript(p, source);
  assert.deepEqual(restored.issues, []);
  const found = restored.project.nodes.find(n => n.kind === 'passage' && n.lines.some(l => l.id === 'compact'))!;
  assert.ok(found.kind === 'passage');
  assert.deepEqual(found.lines.find(l => l.id === 'compact')!.actions, [defaultShowCharacter()]);
});

test('blank show follows speaker, defaults and overrides; narration skips without hiding persistent actors', () => {
  const { p, show } = fixture(), context = previewActionContext(p);
  for (const id of ['a', 'b']) {
    context.speakerId = id;
    const result = expandPreviewActions(p, [show], context)[0] as typeof show;
    assert.equal(result.characterId, id); assert.equal(result.expressionId, id + '_happy');
  }
  assert.equal((expandPreviewActions(p, [{ ...show, expressionId: '普通' }], context)[0] as typeof show).expressionId, 'b_normal');
  assert.equal((expandPreviewActions(p, [{ ...show, characterId: 'a' }], context)[0] as typeof show).characterId, 'a');
  expandPreviewActions(p, [{ ...show, lifetime: 'persistent' }], context);
  assert.equal((expandPreviewActions(p, [show], context)[0] as typeof show).lifetime, 'persistent');
  context.speakerId = undefined;
  const before = [...context.actors];
  assert.deepEqual(expandPreviewActions(p, [show], context), []); assert.deepEqual([...context.actors], before); assert.equal(context.incomplete, false);
  p.characters[1].expressions = []; context.speakerId = 'b';
  assert.deepEqual(expandPreviewActions(p, [show], context), []); assert.equal(context.incomplete, false);
});

test('blank show stays dynamic in both encapsulated and authored blueprints', () => {
  const { p, show } = fixture(), context = previewActionContext(p); context.speakerId = 'b';
  const graph = blueprintFromPerformance(p, [show], '显示'), authored = createShowCharacterFixture(); p.blueprints.push(graph, authored);
  for (const blueprintId of [graph.id, authored.id]) assert.equal((expandPreviewActions(p, [{ kind: 'blueprint', blueprintId }], context).find(a => a.kind === 'show') as typeof show).characterId, 'b');
  assert.ok(commandPerformanceBlueprints(p).some(g => g.id === authored.id));
  const built = compileProject(p); assert.deepEqual(built.diagnostics.filter(d => d.severity === 'error'), []);
  assert.match(built.files['game/story.rpy'], /if vn_bp_show_speaker\(/);
});

test('dragging an automatic actor preserves speaker binding and uses resolved framing', () => {
  const { p, show, node } = fixture(), selection = { nodeId: node.id, lineId: 'line' };
  const before = linePreviewSnapshot(p, selection).after.actors.get('a')!;
  moveStageActor(p, selection, 'a', { x: .2 });
  assert.equal(node.lines[0].actions.length, 1);
  const changed = node.lines[0].actions[0] as typeof show;
  assert.equal(changed.characterId, ''); assert.equal(changed.presetId, undefined); assert.equal(changed.scale, before.scale);
  node.lines[0].speakerId = 'b';
  assert.equal(linePreviewSnapshot(p, selection).after.actors.get('b')!.x, .2);
});

test('expression completion uses the following dialogue when show target is blank', () => {
  const { p } = fixture(), source = '@显示角色：表情=\nB：说话';
  assert.ok(textAssistance(p, source, source.indexOf('\n'), true)?.items.some(i => i.label === '笑'));
});
