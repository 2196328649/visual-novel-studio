import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { projectSchema } from '../src/core/model';
import { validateProject } from '../src/core/validate';
import { UnityUi } from './lib/unity-ui';

const ui = await UnityUi.load('artifacts/aihong-ui-inspection/2026-09-10-layout');
const regular = [...ui.nodes].find(([name, node]) => name.startsWith('Canvas-AdvUI/UI_PlotMap/') && ui.components(node).some(c => c.class === 'UI_PlotChapterElement') && ui.localizedSprite(node)?.data.m_Name === 'flowchart_data_bg_J')!;
const marker = ui.node(regular[0] + '/Highlight'), sprite = ui.localizedSprite(marker)!;
const parentRect = ui.rectangle(regular[1]), markerRect = ui.rectangle(marker);
const manifest = JSON.parse(await fs.readFile('artifacts/aihong-ui-assets/manifest.json', 'utf8'));
const asset = manifest.assets.find((item: { source: { file: string; pathId: number } }) => ui.key(item.source) === ui.key(sprite));
assert.ok(asset);
for (const directory of ['resources/templates/aihong', 'artifacts/aihong-template']) {
  const file = path.join(directory, 'project.vns.json');
  const project = projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  assert.equal(project.id, 'project_aihong_ui_template');
  const flow = project.ui.components.find(c => c.id === 'ai_flowchart_items')!;
  flow.list!.flowCurrentMarker = { assetId: asset.id, rect: { x: (markerRect.x - parentRect.x) / parentRect.width, y: (markerRect.y - parentRect.y) / parentRect.height, width: markerRect.width / parentRect.width, height: markerRect.height / parentRect.height } };
  for (const skin of [flow.skin, flow.list!.flowChapterSkin, flow.list!.flowEndSkin]) if (skin) skin.brightness = { ...skin.brightness, selected: 1 };
  if (!project.assets.some(a => a.id === asset.id)) {
    project.assets.push({ id: asset.id, name: '流程图 · 当前位置发光', kind: 'image', path: asset.path, width: asset.width, height: asset.height, category: 'ui' });
    await fs.copyFile(path.join('artifacts/aihong-ui-assets', asset.path), path.join(directory, asset.path));
  }
  assert.deepEqual(validateProject(project).filter(d => d.severity === 'error'), []);
  await fs.writeFile(file, JSON.stringify(project, null, 2) + '\n');
  console.log(file);
}
