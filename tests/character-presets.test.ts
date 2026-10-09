import { createShowCharacterFixture } from '../scripts/lib/show-character-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type StageAction } from '../src/core/model';
import { characterDisplayPreset, resolveShowAction, detachDisplayPreset } from '../src/core/character-presets';
import { actionText, projectToText, applyTextScript, textCommandAction } from '../src/core/text-script';
import { linePreviewSnapshot } from '../src/core/line-preview';
import { moveStageActor } from '../src/core/stage-edit';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { compileProject } from '../src/runtime/compiler';

function fixture() {
  const p = createProject(); p.width = 1920; p.height = 1080;
  p.assets = [{ id: 'portrait', name: '立绘', kind: 'image', path: 'portrait.png', width: 1000, height: 2000, visibleBounds: { x: 200, y: 100, width: 400, height: 1600 } }];
  p.characters = [{ id: 'hero', name: '主角', color: '#ffffff', expressions: [{ id: 'normal', name: '普通', assetId: 'portrait' }, { id: 'smile', name: '笑', assetId: 'portrait' }] }];
  const show: Extract<StageAction, { kind: 'show' }> = { kind: 'show', characterId: 'hero', expressionId: 'normal', presetId: 'default', x: .5, y: 1, scale: 1, layer: 10, transition: 'none' };
  const node = p.nodes.find(n => n.kind === 'passage')!;
  node.lines = [{ id: 'one', speakerId: 'hero', text: '第一句', actions: [structuredClone(show)] }, { id: 'two', speakerId: 'hero', text: '第二句', actions: [{ ...show, presetId: 'left' }] }];
  return { p, show, node };
}

test('shared character preset edits and default selection update all references, previews and compiled positions', () => {
  const { p, node, show } = fixture();
  const before = resolveShowAction(p, show);
  p.characters[0].defaultDisplayPresetId = 'left';
  p.characters[0].displayPresets = [{ id: 'left', name: '舞台左', x: .15, y: 1.08, scale: .8, useDefaultFraming: true }];
  const expected = resolveShowAction(p, show);
  assert.notDeepEqual(expected, before);
  for (const line of node.lines) {
    const actor = linePreviewSnapshot(p, { nodeId: node.id, lineId: line.id }).after.actors.get('hero')!;
    assert.deepEqual([actor.x, actor.y, actor.scale], [expected.x, expected.y, expected.scale]);
  }
  const compiled = compileProject(p); assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.equal(compiled.files['game/story.rpy'].split(`vn_stage(${expected.x}, ${expected.y}, ${expected.scale})`).length - 1, 2);
  assert.equal(node.lines[0].actions[0].kind === 'show' && node.lines[0].actions[0].x, .5);
});

test('preset references survive named text commands, renames and project save/load; explicit old coordinates remain manual', () => {
  const { p, show } = fixture();
  assert.equal((textCommandAction(p, '@显示角色：主角，普通') as typeof show).presetId, 'default');
  const linked = { ...show, presetId: 'left', transition: 'dissolve' as const, actorTransitions: { enter: { mode: 'none' as const, duration: 0 } } };
  const text = actionText(p, linked);
  p.characters[0].displayPresets = [{ ...characterDisplayPreset(p, 'hero', 'left')!, name: '靠左新名字' }];
  assert.deepEqual(textCommandAction(p, text), linked);
  assert.deepEqual(textCommandAction(p, '@显示角色：主角，普通，0.2，0.6，1.4'), { kind: 'show', characterId: 'hero', expressionId: 'normal', x: .2, scale: .6, y: 1.4, layer: 10, transition: 'dissolve' });
  const reloaded = projectSchema.parse(JSON.parse(JSON.stringify(p)));
  const parsed = applyTextScript(reloaded, projectToText(reloaded));
  assert.deepEqual(parsed.issues.filter(i => i.severity === 'error'), []);
  assert.equal(parsed.project.nodes.flatMap(n => n.kind === 'passage' ? n.lines.flatMap(l => l.actions) : []).filter(a => a.kind === 'show' && a.presetId).length, 2);
});

test('a manual drag detaches just one invocation, while expression-only editing preserves its shared preset', () => {
  const { p, node, show } = fixture(), selection = { nodeId: node.id, lineId: 'one' };
  const expected = detachDisplayPreset(p, show);
  moveStageActor(p, selection, 'hero', { expressionId: 'smile' });
  assert.equal((node.lines[0].actions[0] as typeof show).presetId, 'default');
  moveStageActor(p, selection, 'hero', { x: .1 });
  assert.equal((node.lines[0].actions[0] as typeof show).presetId, undefined);
  assert.equal((node.lines[0].actions[0] as typeof show).scale, expected.scale);
  assert.equal((node.lines[1].actions[0] as typeof show).presetId, 'left');
  p.characters[0].defaultDisplayPresetId = 'right';
  assert.equal(linePreviewSnapshot(p, selection).after.actors.get('hero')!.x, .1);
});

test('inherited presets, automatic speaker and wrapped direct actions use the same geometry and preserve manual overrides', () => {
  const { p, show } = fixture();
  p.characters.push({ id: 'child', name: '继承角色', color: '#ffffff', expressions: [], baseCharacterId: 'hero' });
  p.characters[0].defaultDisplayPresetId = 'right';
  p.characters[0].displayPresets = [{ ...characterDisplayPreset(p, 'hero', 'right')!, scale: .7 }];
  assert.equal(characterDisplayPreset(p, 'child')?.scale, .7);
  p.blueprints.push(createShowCharacterFixture());
  const context = { ...previewActionContext(p), speakerId: 'child' };
  const emitted = expandPreviewActions(p, [{ kind: 'blueprint', blueprintId: 'fixture_show_character', inputs: { preset: 'left' } }], context)[0] as typeof show;
  assert.equal(emitted.x, resolveShowAction(p, { ...show, characterId: 'child', presetId: 'left' }).x);
  const named = expandPreviewActions(p, [{ kind: 'blueprint', blueprintId: 'fixture_show_character', inputs: { preset: '左' } }], context)[0] as typeof show;
  assert.equal(named.x, emitted.x); assert.equal(context.incomplete, false);
  const manual = expandPreviewActions(p, [{ kind: 'blueprint', blueprintId: 'fixture_show_character', inputs: { x: .3, y: 1.4, scale: .5, preset: '', default_framing: false } }], context)[0] as typeof show;
  assert.deepEqual([manual.x, manual.y, manual.scale], [.3, 1.4, .5]);
  const wrapped = blueprintFromPerformance(p, [{ ...show, presetId: undefined }]); p.blueprints.push(wrapped);
  assert.equal((expandPreviewActions(p, [{ kind: 'blueprint', blueprintId: wrapped.id }], context)[0] as typeof show).y, 1);
});
