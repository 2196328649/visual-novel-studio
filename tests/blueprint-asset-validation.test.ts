import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { chapterBlueprintPair, createChapterPerformance } from '../src/core/chapter-performances';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { useTimelineDefault } from '../src/core/timeline-component';
import { applyTextScript } from '../src/core/text-script';
import { validateProject } from '../src/core/validate';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { compileProject } from '../src/runtime/compiler';

function chapterFixture() {
  const project = createProject();
  project.assets = [
    { id: 'title', name: '章节题图', kind: 'image', path: 'title.png' },
    { id: 'music', name: '花街柳巷', kind: 'audio', path: 'music.ogg' },
    { id: 'other_music', name: '另一首配乐', kind: 'audio', path: 'other.ogg' },
  ];
  const [owner, timeline] = chapterBlueprintPair(createChapterPerformance(project, 'image', {
    kind: 'chapter', title: '第一章 · 酒醒城破', subtitle: '', duration: 7, titleImageId: 'title', soundId: 'music',
  }));
  owner.name = owner.callName = '章节进入演出';
  project.blueprints.push(owner, timeline);
  return { project, owner, timeline };
}

test('a chapter still compiles and plays after its child timeline stops exposing music', () => {
  const { project, owner, timeline } = chapterFixture();
  const music = timeline.nodes.find(node => node.type === 'playSound')!;
  useTimelineDefault(timeline, music.id, 'assetId');
  synchronizeBlueprintSignatures(project);
  assert.ok(owner.exposedInputs.some(pin => pin.id === 'sound'));
  assert.ok(!timeline.exposedInputs.some(pin => pin.id === 'sound'));
  const parsed = applyTextScript(project, '# 章节：第一章 · 酒醒城破\n# 小章节：开场\n@章节进入演出\n@独立演出：段落 1\n旁白：城门开了。');
  assert.deepEqual(parsed.issues, []);
  const loaded = projectSchema.parse(JSON.parse(JSON.stringify(parsed.project)));
  assert.deepEqual(validateProject(loaded).filter(issue => issue.severity === 'error'), []);
  const compiled = compileProject(loaded);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.ok(compiled.files['game/story.rpy']);
  const context = previewActionContext(loaded);
  const actions = expandPreviewActions(loaded, [{ kind: 'blueprint', blueprintId: owner.id }], context);
  assert.equal(context.incomplete, false);
  assert.equal(actions.find(action => action.kind === 'sound')?.assetId, 'music');
  assert.ok(actions.some(action => action.kind === 'visual'));
});

test('an unconnected asset input accepts audio overrides but still rejects missing assets', () => {
  const { project, owner, timeline } = chapterFixture();
  useTimelineDefault(timeline, timeline.nodes.find(node => node.type === 'playSound')!.id, 'assetId');
  synchronizeBlueprintSignatures(project);
  const line = project.nodes.find(node => node.kind === 'passage')!.lines[0];
  const call = { kind: 'blueprint' as const, blueprintId: owner.id, inputs: { sound: 'other_music' } };
  line.actions = [call];
  assert.deepEqual(validateProject(project).filter(issue => issue.severity === 'error'), []);
  call.inputs.sound = 'missing_music';
  assert.ok(validateProject(project).some(issue => issue.lineId === line.id && issue.message.includes('missing_music')));
});

test('connected chapter assets still reject audio in image inputs and images in music inputs', () => {
  const { project, owner } = chapterFixture();
  const line = project.nodes.find(node => node.kind === 'passage')!.lines[0];
  line.actions = [{ kind: 'blueprint', blueprintId: owner.id, inputs: { sound: 'title', title_image: 'music' } }];
  const errors = validateProject(project).filter(issue => issue.severity === 'error' && issue.lineId === line.id);
  assert.equal(errors.length, 2);
  assert.ok(errors.some(issue => issue.message.includes('花街柳巷')));
  assert.ok(errors.some(issue => issue.message.includes('章节题图')));
});
