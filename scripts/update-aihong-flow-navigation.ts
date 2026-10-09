import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema, type UiSkin } from '../src/core/model';
import { validateProject } from '../src/core/validate';
import { UnityUi, type UnityObject } from './lib/unity-ui';
import { addAihongSpatialMenus } from './lib/aihong-spatial-menus';

const root = path.resolve('.');
const ui = await UnityUi.load(path.join(root, 'artifacts/aihong-ui-inspection/2026-09-10-layout'));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'artifacts/aihong-ui-assets/manifest.json'), 'utf8'));
for (const relative of ['resources/templates/aihong', 'artifacts/aihong-template']) {
  const file = path.join(root, relative, 'project.vns.json');
  const project = projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  assert.equal(project.id, 'project_aihong_ui_template');
  const preview = structuredClone(project), additions = new Map();
  const asset = (record: UnityObject | undefined) => {
    const found = record && manifest.assets.find((item: { source: UnityObject }) => ui.key(item.source) === ui.key(record));
    assert.ok(found, `Unextracted UI asset: ${record?.data.m_Name}`);
    additions.set(found.id, found); return found.id as string;
  };
  addAihongSpatialMenus({ project: preview, ui, asset, skin: node => {
    const result: UiSkin = { fit: 'stretch', hideText: true };
    for (const [state, source] of Object.entries({ idle: 'normal', hover: 'highlighted', pressed: 'Pressed', selected: 'selected', disabled: 'disabled' } as const)) {
      const sprite = ui.localizedSprite(node, source); if (sprite) result[state as 'idle'] = asset(sprite);
    }
    return result;
  } });
  const target = project.ui.components.find(item => item.id === 'ai_flowchart_items')!;
  const generated = preview.ui.components.find(item => item.id === target.id)!;
  Object.assign(target, { x: generated.x, y: generated.y, width: generated.width, height: generated.height });
  target.list = { ...target.list, flowViewport: generated.list!.flowViewport, flowShowControls: false, flowShowVerticalScrollbar: false, flowScrollbar: generated.list!.flowScrollbar };
  const needed = [target.list.flowScrollbar!.trackId, target.list.flowScrollbar!.thumb!.idle];
  for (const id of needed) if (!project.assets.some(item => item.id === id)) {
    const item = additions.get(id);
    const destination = path.join(root, relative, item.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(root, 'artifacts/aihong-ui-assets', item.path), destination);
    project.assets.push({ id: item.id, name: item.name, kind: item.kind, path: item.path, width: item.width, height: item.height, category: 'ui' });
  }
  assert.deepEqual(validateProject(project).filter(item => item.severity === 'error'), []);
  await fs.writeFile(file, JSON.stringify(projectSchema.parse(project), null, 2) + '\n');
  console.log(file);
}
