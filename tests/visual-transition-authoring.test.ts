import assert from 'node:assert/strict';
import test from 'node:test';
import { Children, isValidElement, type ChangeEvent, type ReactNode } from 'react';
import { actorTransitionRuleSchema, createProject, projectSchema, type ActorTransitionRule } from '../src/core/model';
import { createMediaVisual } from '../src/core/media-command';
import { initialPreviewStage, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { visualPhasePose } from '../src/core/visual-transitions';
import { VisualTransitionField, VisualTransitionsEditor } from '../src/renderer/VisualTransitionsEditor';

function findProps(node: ReactNode, match: (props: Record<string, unknown>) => boolean): Record<string, unknown> {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (match(child.props)) return child.props;
    if (child.props.children) {
      try { return findProps(child.props.children as ReactNode, match); } catch { /* try the next sibling */ }
    }
  }
  throw new Error('field not found');
}
function changeMode(value: ActorTransitionRule | undefined, mode: ActorTransitionRule['mode'], inherit = false) {
  let saved: ActorTransitionRule | undefined;
  const field = VisualTransitionField({ label: '测试过渡', value, inherit, onChange: next => { saved = next; } });
  const select = findProps(field, props => props['aria-label'] === '测试过渡');
  (select.onChange as (event: ChangeEvent<HTMLSelectElement>) => void)({ target: { value: mode } } as ChangeEvent<HTMLSelectElement>);
  return saved!;
}
const displayedSeconds = (value?: ActorTransitionRule, inherit = false) => findProps(VisualTransitionField({ label: '测试过渡', value, inherit, onChange: () => {} }), props => props['aria-label'] === '测试过渡秒数');

test('each shared visual transition field preserves an authored zero through every mode', () => {
  for (const from of ['dissolve', 'fade', 'move', 'none'] as const) for (const to of ['dissolve', 'fade', 'move', 'none'] as const) {
    const saved = changeMode({ mode: from, duration: 0 }, to);
    assert.deepEqual(saved, { mode: to, duration: 0 });
    assert.deepEqual(actorTransitionRuleSchema.parse(saved), saved);
    assert.equal(displayedSeconds(saved).value, 0);
  }
});

test('new settings initialize half a second while immediate displays effective zero without changing saved memory', () => {
  assert.equal(displayedSeconds(undefined).value, 0);
  assert.deepEqual(changeMode(undefined, 'move'), { mode: 'move', duration: .5 });
  const remembered: ActorTransitionRule = { mode: 'none', duration: 2 };
  assert.equal(displayedSeconds(remembered).value, 0);
  assert.equal(displayedSeconds(remembered).disabled, true);
  assert.deepEqual(remembered, { mode: 'none', duration: 2 });
  assert.deepEqual(changeMode(remembered, 'fade'), { mode: 'fade', duration: 2 });
  assert.equal(displayedSeconds(undefined, true).value, '');
  assert.equal(displayedSeconds(undefined, true).placeholder, '沿用显示时设置');
});

test('hiding an object can restore the display rule without materializing a duration', () => {
  let saved: ActorTransitionRule | undefined = { mode: 'fade', duration: 0 };
  const field = VisualTransitionField({ label: '离场过渡', value: saved, inherit: true, onChange: next => { saved = next; } });
  const select = findProps(field, props => props['aria-label'] === '离场过渡');
  (select.onChange as (event: ChangeEvent<HTMLSelectElement>) => void)({ target: { value: 'inherit' } } as ChangeEvent<HTMLSelectElement>);
  assert.equal(saved, undefined);
  assert.equal(displayedSeconds(saved, true).value, '');
});

test('replacement field inherits a zero entry duration and writes only the replacement override', () => {
  const value = { enter: { mode: 'dissolve', duration: 0 } as ActorTransitionRule };
  let saved = value as Parameters<typeof VisualTransitionsEditor>[0]['value'];
  const editor = VisualTransitionsEditor({ value, wait: false, onChange: next => { saved = next; }, onWaitChange: () => {} });
  const replacement = findProps(editor, props => props.label === '替换过渡');
  const field = VisualTransitionField(replacement as Parameters<typeof VisualTransitionField>[0]);
  const select = findProps(field, props => props['aria-label'] === '替换过渡');
  (select.onChange as (event: ChangeEvent<HTMLSelectElement>) => void)({ target: { value: 'move' } } as ChangeEvent<HTMLSelectElement>);
  assert.deepEqual(saved, { enter: { mode: 'dissolve', duration: 0 }, replace: { mode: 'move', duration: 0 } });
  assert.deepEqual(value, { enter: { mode: 'dissolve', duration: 0 } });
});

test('zero transitions survive image and video project saving and introduce no preview wait or blend', () => {
  for (const content of ['image', 'video'] as const) {
    const project = createProject('零秒媒体');
    project.assets.push({ id: 'media', kind: content, name: '媒体', path: content === 'image' ? 'image.png' : 'movie.webm' });
    const rule = changeMode({ mode: 'dissolve', duration: 0 }, 'move');
    const action = createMediaVisual(content, 'media', { loop: content === 'video', visualTransitions: { enter: rule, replace: rule, exit: rule }, transitionWait: true });
    const passage = project.nodes.find(node => node.kind === 'passage')!;
    passage.lines[0].actions = [action];
    const saved = projectSchema.parse(project).nodes.find(node => node.kind === 'passage')!.lines[0].actions[0];
    assert.equal(saved.kind, 'visual');
    if (saved.kind !== 'visual') throw new Error('wrong action');
    const before = initialPreviewStage(), plan = linePlaybackPlan(before, [saved]);
    assert.equal(plan.dialogueAt, 0);
    const shown = sampleLinePlayback(before, plan, 0).state;
    assert.equal(shown.visuals.get(saved.instanceId)?.blend, undefined);
    assert.deepEqual(visualPhasePose(saved, 0), { opacity: 1, x: 0 });
    const replace = linePlaybackPlan(shown, [{ ...saved, assetId: 'replacement_media' }]);
    assert.equal(replace.dialogueAt, 0);
    const replaced = sampleLinePlayback(shown, replace, 0).state;
    assert.equal(replaced.visuals.get(saved.instanceId)?.blend, undefined);
    assert.equal(replaced.visuals.get(saved.instanceId)?.object.assetId, 'replacement_media');
    const hide = linePlaybackPlan(replaced, [{ kind: 'hideVisual', instanceId: saved.instanceId, exitTransition: changeMode({ mode: 'fade', duration: 0 }, 'move', true), wait: true }]);
    assert.equal(hide.dialogueAt, 0);
    assert.equal(sampleLinePlayback(replaced, hide, 0).state.visuals.has(saved.instanceId), false);
  }
});
