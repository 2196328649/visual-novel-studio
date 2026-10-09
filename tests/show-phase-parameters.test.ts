import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema } from '../src/core/model';
import { defaultShowCharacter } from '../src/core/character-presets';
import { actionText, applyTextScript, projectToText, textCommandAction } from '../src/core/text-script';
import { textAssistance } from '../src/core/text-completion';

const fixture = () => {
  const project = createProject();
  project.assets = [{ id: 'portrait', name: '立绘', kind: 'image', path: 'portrait.png' }];
  project.characters = [{ id: 'hero', name: '主角', color: '#ffffff', expressions: [{ id: 'happy', name: '笑', assetId: 'portrait' }] }];
  return project;
};

test('show signature and named completions contain phase settings and no generic transition or duration', () => {
  const project = fixture(), source = '@显示角色：';
  const hint = textAssistance(project, source, source.length, true)!;
  const names = hint.signature!.parameters.map(p => p.name);
  assert.equal(names.length, 16);
  assert.ok(!names.includes('转场') && !names.includes('时长'));
  for (const phase of ['入场', '离场', '表情切换']) {
    for (const suffix of ['过渡', '秒数']) {
      const name = phase + suffix, edit = hint.parameterEdits!.find(p => p.label === name)!;
      assert.ok(names.includes(name));
      assert.ok(hint.items.some(item => item.insertText === name + '='));
      const next = source.slice(0, edit.replaceStart) + edit.insertText + source.slice(edit.replaceEnd);
      const completed = textAssistance(project, next, edit.replaceStart! + edit.insertText.length, true)!;
      assert.equal(completed.signature!.parameters[completed.parameterIndex!].name, name);
      if (suffix === '过渡') assert.ok(completed.items.some(item => item.label === '渐变'));
    }
  }
});

test('removed show parameters and old positional transition values are rejected', () => {
  for (const value of ['转场=移动', '时长=1', '主角，笑，0.5，1，1，10，移动，1']) {
    assert.equal(textCommandAction(fixture(), '@显示角色：' + value), undefined);
    assert.throws(() => textCommandAction(fixture(), '@显示角色：' + value, true));
  }
});

test('phase rules survive text and project save with zero duration, expression, wait and instance', () => {
  const project = fixture();
  const action = textCommandAction(project, '@显示角色：主角，表情=笑，入场过渡=移动，入场秒数=1.2，离场过渡=立即，离场秒数=0，表情切换过渡=先淡出再淡入，表情切换秒数=0.3，等待完成=否，实例ID=closeup，显示范围=持续显示', true)!;
  assert.ok(action.kind === 'show');
  assert.deepEqual(action.actorTransitions, { enter: { mode: 'move', duration: 1.2 }, exit: { mode: 'none', duration: 0 }, expression: { mode: 'fade', duration: .3 } });
  assert.equal(action.wait, false); assert.equal(action.expressionId, 'happy'); assert.equal(action.instanceId, 'closeup');
  assert.deepEqual(textCommandAction(project, actionText(project, action), true), action);
  const node = project.nodes.find(n => n.kind === 'passage')!;
  node.lines = [{ id: 'phase_line', text: '测试', speakerId: 'hero', actions: [action] }];
  const source = projectToText(project);
  assert.doesNotMatch(source, /@演出实例|，(?:转场|时长)=/);
  const reopened = applyTextScript(projectSchema.parse(project), source);
  assert.deepEqual(reopened.issues, []);
  const restored = reopened.project.nodes.find(n => n.id === node.id)!;
  assert.ok(restored.kind === 'passage'); assert.deepEqual(restored.lines[0].actions, [action]);
});

test('omitted phases inherit while a mode or seconds alone creates only that override', () => {
  const project = fixture();
  assert.equal(actionText(project, defaultShowCharacter()), '@显示角色');
  for (const [source, expected] of [
    ['@显示角色', undefined],
    ['@显示角色：离场秒数=0', { exit: { mode: 'dissolve', duration: 0 } }],
    ['@显示角色：表情切换过渡=先淡出再淡入', { expression: { mode: 'fade', duration: .5 } }],
  ] as const) {
    const action = textCommandAction(project, source, true)!;
    assert.ok(action.kind === 'show'); assert.deepEqual(action.actorTransitions, expected);
  }
  for (const source of ['入场过渡=错误', '离场秒数=-1', '表情切换秒数=61', '入场秒数=abc']) {
    assert.throws(() => textCommandAction(project, '@显示角色：' + source, true));
  }
});

test('stage timing writes phase parameters instead of removed generic fields', () => {
  const project = fixture(), show = defaultShowCharacter({ actorTransitions: { enter: { mode: 'move', duration: 1.2 }, expression: { mode: 'move', duration: 1.2 } }, wait: false });
  const text = actionText(project, show);
  assert.match(text, /入场过渡=移动，入场秒数=1.2/);
  assert.match(text, /表情切换过渡=移动，表情切换秒数=1.2/);
  assert.doesNotMatch(text, /，(?:转场|时长)=/);
  const parsed = textCommandAction(project, text, true)!;
  assert.ok(parsed.kind === 'show');
  assert.deepEqual(parsed.actorTransitions, { enter: { mode: 'move', duration: 1.2 }, expression: { mode: 'move', duration: 1.2 } });
});
