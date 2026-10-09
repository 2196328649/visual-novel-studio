import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { buildAiStory } from '../src/core/ai-story';
import { prepareAiChanges, applyAiChanges } from '../src/core/ai';
import { projectToText, applyTextScript } from '../src/core/text-script';
import { compileProject } from '../src/runtime/compiler';

function fixture() {
  const p = createProject('原作品');
  p.characters = [{ id: 'hero', name: '旅人', color: '#ffffff', expressions: [{ id: 'smile', name: '笑', assetId: 'portrait' }] }];
  p.assets = [
    { id: 'portrait', name: '旅人', kind: 'image', category: 'portrait', path: 'p.png' },
    { id: 'home', name: '故乡', kind: 'image', category: 'scene', path: 'home.png' },
    { id: 'road', name: '山路', kind: 'image', category: 'scene', path: 'road.png' },
    { id: 'music', name: '回忆', kind: 'audio', category: 'bgm', path: 'm.ogg' },
    { id: 'voice', name: '我回来了。', kind: 'audio', category: 'voice', path: 'v.ogg' },
  ];
  const story = {
    title: '归途', summary: '旅人在故乡的岔路口选择去留。', entry: 'opening',
    scenes: [{ key: 'gate', name: '故乡入口', backgroundId: 'home', musicId: 'music' }, { key: 'mountain', name: '远行山路', backgroundId: 'road', musicId: null }],
    beats: [
      { key: 'opening', sceneKey: 'gate', name: '抉择', lines: [{ text: '我回来了。', speakerId: 'hero', expressionId: 'smile', presetId: 'left', voiceId: 'voice' }], choices: [{ text: '留下', target: 'stay' }, { text: '离开', target: 'leave' }] },
      { key: 'stay', sceneKey: 'gate', name: '留下', lines: [{ text: '炊烟升起。' }], ending: '结局一 · 团圆' },
      { key: 'leave', sceneKey: 'mountain', name: '离开', lines: [{ text: '路还很长。' }], ending: '结局二 · 远行' },
    ],
  };
  return { p, story };
}

test('one story draft becomes editable connected scenes, linked portraits, reliable existing voice and two playable endings', () => {
  const { p, story } = fixture(), original = structuredClone(p);
  const result = buildAiStory(p, story), project = result.project;
  assert.deepEqual(p, original); assert.equal(project.name, '归途');
  assert.deepEqual(result.counts, { lines: 3, portraitLines: 1, expressions: 1, voices: 1, scenes: 2, choices: 1, endings: 2 });
  assert.equal(project.nodes.flatMap(n => n.kind === 'passage' ? n.lines : [])[0].voiceId, 'voice');
  const parsed = applyTextScript(project, projectToText(project));
  assert.deepEqual(parsed.issues.filter(i => i.severity === 'error'), []);
  assert.deepEqual(compileProject(parsed.project).diagnostics.filter(i => i.severity === 'error'), []);
  assert.equal(parsed.project.nodes.filter(n => n.kind === 'end').length, 2);
  assert.ok(compileProject(project).files['game/story.rpy'].includes('vn_blueprint_builtin_ending_performance'));
  assert.doesNotMatch(Object.values(compileProject(project).files).join('\n'), /vn_ending/);
});

test('a generated graph rejects dangling targets, isolated branches, endless routes and fabricated or wrong-class media', () => {
  const { p, story } = fixture();
  const changed = () => structuredClone(story);
  let bad = changed(); bad.beats[0].choices![0].target = 'missing'; assert.throws(() => buildAiStory(p, bad), /目标missing不存在/);
  bad = changed(); bad.beats[0].choices![0].target = 'leave'; assert.throws(() => buildAiStory(p, bad), /无法从入口到达/);
  bad = changed(); Object.assign(bad.beats[1], { ending: undefined, next: 'stay' }); assert.throws(() => buildAiStory(p, bad), /无法到达结局/);
  bad = changed(); bad.scenes[0].backgroundId = 'portrait'; assert.throws(() => buildAiStory(p, bad), /分类不符/);
  bad = changed(); Object.assign(bad.beats[0].lines[0], { voiceId: 'music' }); assert.throws(() => buildAiStory(p, bad), /分类不符/);
  bad = changed(); Object.assign(bad.beats[0].lines[0], { expressionId: 'not_owned' }); assert.throws(() => buildAiStory(p, bad), /不属于角色/);
});

test('new characters remain explicit missing-art roles with working default display calls', () => {
  const { p, story } = fixture();
  const raw = { ...story, characters: [{ key: 'stranger', name: '陌生人' }], beats: story.beats.map(b => b.key === 'opening' ? { ...b, lines: [{ text: '一起走吧。', speakerId: 'stranger' }] } : b) };
  const result = buildAiStory(p, raw);
  assert.match(result.warnings.join('\n'), /陌生人/);
  assert.ok(result.project.characters.find(c => c.name === '陌生人')?.expressions.length === 0);
  assert.deepEqual(compileProject(result.project).diagnostics.filter(i => i.severity === 'error'), []);
});

test('AI scene editing preserves unrelated entry actions, respects selected scenes and detects stale scene changes', () => {
  const { p } = fixture(), scene = p.scenes[0], line = p.nodes.find(n => n.kind === 'passage')!.lines[0];
  scene.entryActions = [{ kind: 'pause', seconds: .1 }, { kind: 'background', assetId: 'home', transition: 'none' }];
  const operations = [{ kind: 'setScene' as const, sceneId: scene.id, backgroundId: 'road', musicId: 'music' }];
  const changes = prepareAiChanges(p, operations, [line.id]);
  const edited = applyAiChanges(p, changes);
  assert.ok(edited.scenes[0].entryActions!.some(a => a.kind === 'pause'));
  assert.ok(edited.scenes[0].entryActions!.some(a => a.kind === 'background' && a.assetId === 'road'));
  const parsed = applyTextScript(edited, projectToText(edited));
  assert.ok(parsed.project.scenes[0].entryActions!.some(a => a.kind === 'music' && a.assetId === 'music'));
  p.scenes.push({ id: 'unselected', name: '范围外', chapterId: scene.chapterId });
  assert.throws(() => prepareAiChanges(p, [{ ...operations[0], sceneId: 'unselected' }], [line.id]), /范围以外的场景/);
  scene.entryActions.push({ kind: 'pause', seconds: .2 });
  assert.throws(() => applyAiChanges(p, changes), /发生变化/);
  assert.throws(() => prepareAiChanges(p, [{ kind: 'setVoice', lineId: line.id, assetId: 'music' }], [line.id]), /不能把配乐或音效/);
});
