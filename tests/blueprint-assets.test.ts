import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintAssetFilter, blueprintNodeAssetFilter } from '../src/core/blueprint-assets';
import { textAssistance } from '../src/core/text-completion';
import { createAudioClip } from '../src/core/audio-clip';

test('nested public media parameters and text completion keep video, font and sound formats', () => {
  const project = createProject();
  project.assets = [
    { id: 'video', name: '电影素材', path: 'video.webm', kind: 'video', category: 'video' },
    { id: 'font', name: '字体素材', path: 'font.ttf', kind: 'font', category: 'font' },
    { id: 'sound', name: '音效素材', path: 'sound.wav', kind: 'audio', category: 'sound' },
    { id: 'image', name: '图片素材', path: 'image.png', kind: 'image', category: 'scene' },
  ];
  const child = blueprintFromPerformance(project, [
    createVisualObject('video', 'video'),
    { ...createVisualObject('text'), fontAssetId: 'font' },
    { kind: 'sound', assetId: 'sound' },
  ], '内部演出');
  project.blueprints.push(child);
  const fields = performanceInputs(child);
  for (const [pinId, name] of [['object_assetId', '视频'], ['object_fontAssetId', '字体'], ['assetId', '音效']]) {
    const field = fields.find(f => f.pinId === pinId)!; assert.ok(field, pinId);
    exposePerformanceInputs(child, [{ ...field, name }]);
  }
  synchronizeBlueprintSignatures(project);
  const owner = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: child.id }], '素材格式验收');
  project.blueprints.push(owner);
  exposePerformanceInputs(owner, performanceInputs(owner).filter(f => f.dataType === 'asset'));
  synchronizeBlueprintSignatures(project);
  for (const [name, kind, category, id] of [['视频', 'video', 'video', 'video'], ['字体', 'font', 'font', 'font'], ['音效', 'audio', 'sound', 'sound']]) {
    const pin = owner.exposedInputs.find(p => p.name === name)!; assert.ok(pin, name);
    assert.deepEqual(blueprintAssetFilter(project, owner, pin), { kind, category });
    const source = '@素材格式验收：' + name + '=';
    const assistance = textAssistance(project, source, source.length, true)!;
    assert.equal(assistance.resource?.kind, kind);
    assert.deepEqual(assistance.items.map(i => i.id).sort(), ['none', id].sort());
  }
});

test('inline chapter sound, video and audio clips start in compatible categories', () => {
  const project = createProject(), chapter = blueprintNodeDefaults('showChapter');
  assert.deepEqual(blueprintNodeAssetFilter(chapter, 'soundId'), { kind: 'audio', category: 'sound' });
  assert.deepEqual(blueprintNodeAssetFilter(chapter, 'backgroundId'), { kind: 'image', category: 'scene' });
  const graph = blueprintFromPerformance(project, [createVisualObject('video'), createAudioClip('sound', '音效', 1)]);
  const clips = graph.nodes.filter(n => n.type === 'savedAction');
  assert.deepEqual(blueprintNodeAssetFilter(clips[0], 'object_assetId'), { kind: 'video', category: 'video' });
  assert.deepEqual(blueprintNodeAssetFilter(clips[1], 'clip_assetId'), { kind: 'audio', category: 'all' });
});

test('an unused input reader does not hide a later connected consumer', () => {
  const project = createProject(), child = blueprintFromPerformance(project, [{ kind: 'sound', assetId: '' }], '内部音效');
  exposePerformanceInputs(child, [performanceInputs(child).find(f => f.pinId === 'assetId')!]);
  const unused = structuredClone(child.nodes.find(n => n.type === 'getInput')!); unused.id = 'unused_reader'; child.nodes.unshift(unused);
  project.blueprints.push(child); synchronizeBlueprintSignatures(project);
  const owner = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: child.id }], '外层音效'); project.blueprints.push(owner);
  exposePerformanceInputs(owner, performanceInputs(owner).filter(f => f.dataType === 'asset'));
  assert.deepEqual(blueprintAssetFilter(project, owner, owner.exposedInputs[0]), { kind: 'audio', category: 'sound' });
});
