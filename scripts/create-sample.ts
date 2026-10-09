import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, type Project, type StoryLine, type StageAction, type StoryNode } from '../src/core/model';
import { importAsset, saveProject, PROJECT_FILENAME } from '../src/desktop/project-store';
import { endingPerformanceNodes } from '../src/core/ending-migration';

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = path.resolve(studio, '..');
const aihong = process.env.VNS_AIHONG_ASSETS ?? 'E:/Project/Model/SLY/T/Assets';
const destination = path.join(studio, 'resources', 'example');
await fs.mkdir(destination, { recursive: true });
const sources: [string, string, string][] = [
  ['城门前', path.join(aihong, 'Resources', 'starveling', 'texture', 'bg', '东关街忆晴.png'), 'asset_f1198e9a72940a65bfded78c'],
  ['茶舍', path.join(aihong, 'Resources', 'starveling', 'texture', 'bg', '茶舍忆昼.png'), 'asset_d8f477d6022ec8d409985e6d'],
  ['荒野', path.join(aihong, 'Resources', 'starveling', 'texture', 'bg', '郊外晴.png'), 'asset_c6d77eb070edb21658d66d5d'],
  ['满穗 · 合成预览', path.join(aihong, 'Resources', 'screenshot.png'), 'asset_724f120436c899c75101b627'],
  ['满穗 · 合成预览 2', path.join(aihong, 'Resources', 'starveling', 'texture', 'thumbnail', '琼华离去.png'), 'asset_8a19f9138cdc9efc85e01264'],
  ['琼华 · 合成预览', path.join(aihong, 'Resources', 'screenshot.png'), 'asset_536f034b266f735c23a6dba1'],
  ['哀鸿 · 葬花埋香', path.join(aihong, 'Resources', 'starveling', 'sound', 'bgm', '哀鸿_葬花埋香.ogg'), 'asset_71ef3afe95a5b8e39c6c97ff'],
];
for (const [, source] of sources) await fs.access(source);
await fs.rm(path.join(destination, 'assets'), { recursive: true, force: true });
const assets = [];
for (const [name, source, stableId] of sources) {
  const imported = await importAsset(destination, source);
  const extension = path.extname(imported.path);
  const stablePath = `assets/${stableId}${extension}`;
  await fs.rm(path.join(destination, stablePath), { force: true });
  await fs.rename(path.join(destination, imported.path), path.join(destination, stablePath));
  assets.push({ ...imported, id: stableId, path: stablePath, name });
}
const [school, library, meadow, yuNormal, yuSmile, xiaNormal, music] = assets;
const base = createProject('哀鸿·蓝图演示');
const line = (id: string, text: string, speakerId?: string, actions: StageAction[] = []): StoryLine => ({ id, text, speakerId, actions });
const background = (assetId: string): StageAction => ({ kind: 'background', assetId, transition: 'dissolve' });
const show = (characterId: string, expressionId: string, x: number): StageAction => ({ kind: 'show', characterId, expressionId, x, y: 1, scale: 0.75, layer: 1, transition: 'dissolve' });
const pos = (id: string, name: string, sceneId: string, x: number, y: number) => ({ id, name, sceneId, x, y });
const nodes: StoryNode[] = [
  { ...pos('start', '开始', 'scene_school', 40, 120), kind: 'start', next: 'opening' },
  { ...pos('opening', '雨停了', 'scene_school', 300, 120), kind: 'passage', next: 'choice_invite', lines: [
    line('line_opening', '午后的雨刚停，校门口的路面映着天空。', undefined, [background(school.id), { kind: 'music', assetId: music.id, loop: true, fade: 0.3 }, show('char_yu', 'expression_yu_normal', 0.64)]),
    line('line_invite', '我正要去图书馆。要一起吗？', 'char_yu'),
  ] },
  { ...pos('choice_invite', '同行的邀请', 'scene_school', 580, 120), kind: 'choice', prompt: '你决定……', choices: [
    { id: 'option_accept', text: '一起去图书馆', target: 'gain_first' },
    { id: 'option_decline', text: '今天先回家', target: 'ending_alone' },
  ] },
  { ...pos('gain_first', '好感度 +1', 'scene_library', 40, 120), kind: 'set', variableId: 'affection', operation: 'add', value: 1, next: 'library' },
  { ...pos('library', '书页之间', 'scene_library', 300, 120), kind: 'passage', next: 'choice_help', lines: [
    line('line_library', '窗边还留着几滴雨水。图书室里，林夏正在整理书架。', undefined, [background(library.id), show('char_yu', 'expression_yu_normal', 0.7), show('char_xia', 'expression_xia_normal', 0.28)]),
    line('line_xia', '来得正好，这里还有一摞书。', 'char_xia'),
    line('line_yu', '一起整理，很快就能完成。', 'char_yu'),
  ] },
  { ...pos('choice_help', '留下来吗', 'scene_library', 580, 120), kind: 'choice', prompt: '接下来……', choices: [
    { id: 'option_help', text: '留下来帮忙', target: 'gain_second' },
    { id: 'option_leave', text: '约好下次再来', target: 'walk' },
  ] },
  { ...pos('gain_second', '好感度再 +1', 'scene_library', 840, 80), kind: 'set', variableId: 'affection', operation: 'add', value: 1, next: 'walk' },
  { ...pos('walk', '回家的路', 'scene_meadow', 40, 120), kind: 'passage', next: 'condition_ending', lines: [
    line('line_walk', '走过草地时，云间透出了阳光。', undefined, [background(meadow.id), show('char_yu', 'expression_yu_smile', 0.62)]),
    line('line_goodbye', '今天，谢谢你。', 'char_yu'),
  ] },
  { ...pos('condition_ending', '好感度达到 2', 'scene_meadow', 320, 120), kind: 'condition', condition: { kind: 'compare', variableId: 'affection', operator: 'gte', value: 2 }, yes: 'ending_warm', no: 'ending_friend' },
  ...endingPerformanceNodes(base, pos('ending_warm', '结局 · 雨后', 'scene_meadow', 620, 40), '雨后，新的故事开始了。', [meadow.id]),
  ...endingPerformanceNodes(base, pos('ending_friend', '结局 · 再会', 'scene_meadow', 620, 260), '我们约好了，下次再见。', [school.id]),
  ...endingPerformanceNodes(base, pos('ending_alone', '结局 · 擦肩', 'scene_school', 840, 300), '有些故事，留待下一场雨。'),
];
const project: Project = {
  ...base, id: 'project_rainy_day', assets, nodes, entryId: 'start',
  chapters: [{ id: 'chapter_one', name: '第一回 · 归' }],
  scenes: [{ id: 'scene_school', name: '城门前', chapterId: 'chapter_one' }, { id: 'scene_library', name: '茶舍', chapterId: 'chapter_one' }, { id: 'scene_meadow', name: '荒野', chapterId: 'chapter_one' }],
  variables: [{ id: 'affection', name: '满穗信任度', type: 'number', initial: 0, persistent: false }, { id: 'revisited', name: '曾经来过', type: 'boolean', initial: false, persistent: true }],
  characters: [
    { id: 'char_yu', name: '满穗（合成预览）', color: '#37bba7', expressions: [{ id: 'expression_yu_normal', name: '合成预览', assetId: yuNormal.id }, { id: 'expression_yu_smile', name: '合成预览 2', assetId: yuSmile.id }] },
    { id: 'char_xia', name: '琼华（合成预览）', color: '#e7b05c', expressions: [{ id: 'expression_xia_normal', name: '合成预览', assetId: xiaNormal.id }] },
  ],
  ui: { ...base.ui, menuBackgroundId: meadow.id },
};
await saveProject(path.join(destination, PROJECT_FILENAME), project);
await fs.copyFile(path.join(studio, 'resources', 'SAMPLE-CREDITS.md'), path.join(destination, 'CREDITS.md'));
await fs.copyFile(path.join(sdk, 'LICENSE.txt'), path.join(destination, 'LICENSE-RenPy.txt'));
console.log(`Sample created: ${destination}`);
