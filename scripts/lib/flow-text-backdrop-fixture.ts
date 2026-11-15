import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, projectSchema } from '../../src/core/model';
import { applyTextScript, projectToText } from '../../src/core/text-script';
import { storyMenuEntries } from '../../src/core/story-menu';
import { storyFlowOwner } from '../../src/core/story-flow-authoring';

/** A small project with the real brushstrokes and fonts, and the previous
 * release's 40% shadow in both the component and its shared presets. */
export async function flowTextBackdropFixture(directory: string) {
  const templateRoot = path.resolve('resources/templates/aihong');
  const template = projectSchema.parse(JSON.parse(await fs.readFile(path.join(templateRoot, 'project.vns.json'), 'utf8')));
  const project = applyTextScript(createProject('剧情图文字黑底验收'), '#章节：主线\n旁白：主线\n#章节：回忆\n旁白：回忆\n#章节：结局\n旁白：结局\n#章节：长标题\n旁白：长标题').project;
  project.width = 1280; project.height = 900;
  project.playerDefaults = { masterVolume: 0, textSpeed: 0 };
  project.ui.fontAssetId = template.ui.fontAssetId;
  project.ui.pages = { ...project.ui.pages, flowchart: { layout: 'custom', background: '#555555' } };
  const map = structuredClone(template.ui.components.find(component => component.id === 'ai_flowchart_items')!);
  map.x = 0; map.y = 0; map.width = 1; map.height = 1;
  map.hoverSoundId = null; map.clickSoundId = null;
  map.list = { layout: 'flow', itemWidth: 547, itemHeight: 90, gapY: 65, lockUnread: false, showProgress: false,
    flowDirection: 'vertical', flowViewport: { x: 0, y: 0, width: 1, height: 1 }, flowShowControls: true, flowShowVerticalScrollbar: false };
  project.ui.components = [map];
  project.ui.flowStyles = structuredClone(template.ui.flowStyles);
  for (const look of [map, ...project.ui.flowStyles!]) {
    Object.assign(look.style!, { shadowBlur: 7, shadowOpacity: .4 });
    delete look.style!.shadowSpread;
    if (look.skin) { delete look.skin.disabled; delete look.skin.brightness; }
  }
  // Keep the full template signature for loading, including its lock artwork.
  for (const look of [map, ...project.ui.flowStyles!]) if (look.skin) look.skin.disabled = 'ai_ui_ae60f933b9c28da3';
  project.ui.flowStyles![0].style!.shadowSpread = 5;
  const names = ['记 第一回｜醉梦', '忆 第一回｜烟', '坏结局｜死于狼妖', '记 第一回｜很长的剧情标题也应保留清晰的黑色衬底'];
  const styles = ['ai_flow_main', 'ai_flow_memory', 'ai_flow_ending', 'ai_flow_main'];
  const entries = storyMenuEntries(project, 'flowchart');
  entries.forEach((entry, index) => { storyFlowOwner(project, entry.owner)!.flowchart = { name: names[index], styleId: styles[index] }; });
  map.list.flowPositions = Object.fromEntries(entries.map((entry, index) => [entry.id, { x: 70, y: 65 + index * 170 }]));
  const referenced = JSON.stringify([map, project.ui.flowStyles, project.ui.fontAssetId]);
  project.assets = template.assets.filter(asset => referenced.includes(asset.id));
  await fs.mkdir(directory, { recursive: true });
  for (const asset of project.assets) {
    await fs.mkdir(path.dirname(path.join(directory, asset.path)), { recursive: true });
    await fs.copyFile(path.join(templateRoot, asset.path), path.join(directory, asset.path));
  }
  project.scriptText!.content = projectToText(project);
  const file = path.join(directory, 'project.vns.json');
  await fs.writeFile(file, JSON.stringify(project));
  return { project, file, entries: storyMenuEntries(project, 'flowchart') };
}

export function cropPng(source: PNG, rect: { x: number; y: number; width: number; height: number }) {
  const x = Math.max(0, Math.round(rect.x)), y = Math.max(0, Math.round(rect.y));
  const width = Math.min(source.width - x, Math.max(1, Math.round(rect.width))), height = Math.min(source.height - y, Math.max(1, Math.round(rect.height)));
  const result = new PNG({ width, height });
  PNG.bitblt(source, result, x, y, width, height, 0, 0);
  return result;
}

/** Compare identical artwork/glyph positions with the shadow switched off.
 * Read actual darkening beside the glyphs, excluding white face pixels. */
export function backingPixels(on: PNG, off: PNG) {
  assert.deepEqual([on.width, on.height], [off.width, off.height]);
  let changed = 0, strong = 0, total = 0, peak = 0, face = 0;
  for (let at = 0; at < on.data.length; at += 4) {
    const a = (on.data[at] + on.data[at + 1] + on.data[at + 2]) / 3;
    const b = (off.data[at] + off.data[at + 1] + off.data[at + 2]) / 3;
    if (Math.min(on.data[at], on.data[at + 1], on.data[at + 2]) > 225) face++;
    if (Math.min(off.data[at], off.data[at + 1], off.data[at + 2]) > 240) continue;
    const darkening = b - a;
    if (darkening > 8) { changed++; total += darkening; peak = Math.max(peak, darkening); }
    if (darkening > 30) strong++;
  }
  return { changed, strong, mean: changed ? total / changed : 0, peak, face, area: on.width * on.height };
}

export function assertBacking(on: PNG, off: PNG, label: string) {
  const result = backingPixels(on, off);
  assert.ok(result.face > 12, `${label}: no readable white glyphs: ${JSON.stringify(result)}`);
  assert.ok(result.changed > result.area * .004, `${label}: no visible backing: ${JSON.stringify(result)}`);
  assert.ok(result.strong > result.area * .0007 && result.peak > 45, `${label}: backing too faint: ${JSON.stringify(result)}`);
  return result;
}
