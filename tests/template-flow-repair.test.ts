import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { loadProject, parseProject } from '../src/desktop/project-store';
import { uiSkinAsset } from '../src/core/ui';
import { uiSkinData } from '../src/runtime/ui-runtime';

const fixture = () => projectSchema.parse(JSON.parse(readFileSync(new URL('../resources/templates/aihong/project.vns.json', import.meta.url), 'utf8')));
test('legacy template flow repairs retain node type, locks, and source data', () => {
  const input = fixture(), flow = input.ui.components.find(item => item.id === 'ai_flowchart_items')!;
  for (const skin of [flow.skin!, flow.list!.flowEndSkin!, flow.list!.flowChapterSkin!]) {
    delete skin.brightness; skin.hover = skin.pressed = 'ai_ui_fd5ccd7009a7038d';
  }
  flow.style = {fontSize:28, textColor:'#242a26'};
  flow.list!.showProgress = true;
  const before = JSON.stringify(input), result = parseProject(input).project;
  assert.equal(JSON.stringify(input), before);
  const repaired = result.ui.components.find(item => item.id === flow.id)!;
  for (const [skin, old] of [[repaired.skin!, flow.skin!], [repaired.list!.flowEndSkin!, flow.list!.flowEndSkin!], [repaired.list!.flowChapterSkin!, flow.list!.flowChapterSkin!]]) {
    assert.equal(uiSkinAsset(skin, 'hover'), old.idle);
    assert.equal(skin.disabled, old.disabled);
    assert.equal(skin.brightness!.hover, 118 / 255);
    assert.equal(uiSkinData(result, skin).brightness, skin.brightness);
  }
  assert.equal(repaired.style!.hoverTextColor, '#ffffff');
  assert.equal(repaired.style!.fontAssetId, 'ai_ui_3510f58115c3cc3c');
  assert.equal(repaired.list!.showProgress, false);
  assert.equal(repaired.list!.lockUnread, true);
  assert.deepEqual(parseProject(result).project, result);
});
test('authored hover images and text colors survive template loading', () => {
  const input = fixture(), flow = input.ui.components.find(item => item.id === 'ai_flowchart_items')!;
  flow.skin!.hover = flow.skin!.pressed = 'my_hover'; delete flow.skin!.brightness;
  flow.style!.hoverTextColor = '#eeccaa';
  const result = parseProject(input).project.ui.components.find(item => item.id === flow.id)!;
  assert.deepEqual(result.skin, flow.skin);
  assert.deepEqual(result.style, flow.style);
  const { flowScrollbar: repairedScrollbar, ...layout } = result.list!;
  const { flowScrollbar: oldScrollbar, ...oldLayout } = flow.list!;
  assert.deepEqual(layout, oldLayout);
  assert.deepEqual({ ...repairedScrollbar, thumb: undefined }, { ...oldScrollbar, thumb: undefined });
  assert.equal(repairedScrollbar!.thumb!.fit, 'nineSlice');
  assert.deepEqual(repairedScrollbar!.thumb!.borders, { left: 24, top: 0, right: 24, bottom: 0 });
});

test('legacy stock shadows and scrollbar are repaired while authored replacements survive', () => {
  const input = fixture(), flow = input.ui.components.find(item => item.id === 'ai_flowchart_items')!;
  Object.assign(flow.style!, { outlineOpacity: .5, shadowX: 2, shadowY: 3, shadowBlur: undefined, shadowOpacity: .7 });
  Object.assign(flow.list!.flowScrollbar!.thumb!, { fit: 'stretch', borders: undefined });
  const result = parseProject(input).project.ui.components.find(item => item.id === flow.id)!;
  assert.deepEqual({ x: result.style!.shadowX, y: result.style!.shadowY, blur: result.style!.shadowBlur, opacity: result.style!.shadowOpacity }, { x: 0, y: 0, blur: 7, opacity: .4 });
  assert.equal(result.list!.flowScrollbar!.thumb!.fit, 'nineSlice');
  flow.style!.shadowBlur = 3;
  flow.list!.flowScrollbar!.thumb!.idle = 'authored_scrollbar';
  assert.deepEqual(parseProject(input).project.ui.components.find(item => item.id === flow.id), flow);
});

test('opening an old template adds its font without rewriting the project or replacing files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-flow-font-'));
  try {
    const input = fixture(), flow = input.ui.components.find(item => item.id === 'ai_flowchart_items')!;
    const font = input.assets.find(item => item.id === 'ai_ui_3510f58115c3cc3c')!;
    input.assets = input.assets.filter(item => item.id !== font.id);
    flow.style = {fontSize:28, textColor:'#242a26'}; flow.list!.showProgress = true;
    const file = path.join(directory, 'project.vns.json'), data = JSON.stringify(input);
    await fs.writeFile(file, data);
    const template = path.resolve('resources/templates/aihong');
    const loaded = await loadProject(file, template);
    assert.equal(loaded.project.ui.components.find(item => item.id === flow.id)!.style!.fontAssetId, font.id);
    assert.equal(await fs.readFile(file, 'utf8'), data);
    assert.deepEqual(await fs.readFile(path.join(directory, font.path)), await fs.readFile(path.join(template, font.path)));
    await fs.writeFile(path.join(directory, font.path), 'authored file');
    await assert.rejects(loadProject(file, template), /字体路径/);
    assert.equal(await fs.readFile(path.join(directory, font.path), 'utf8'), 'authored file');
  } finally { await fs.rm(directory, {recursive:true, force:true}); }
});
