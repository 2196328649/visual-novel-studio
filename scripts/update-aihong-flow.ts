import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema, type UiSkin } from '../src/core/model';
import { UnityUi } from './lib/unity-ui';
import { addAihongSpatialMenus } from './lib/aihong-spatial-menus';

// Refresh only the generated template's flow components; retain every other edit.
const root = path.resolve('.');
const ui = await UnityUi.load(path.join(root, 'artifacts/aihong-ui-inspection/2026-09-10-layout'));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'artifacts/aihong-ui-assets/manifest.json'), 'utf8'));
for (const relative of ['resources/templates/aihong', 'artifacts/aihong-template']) {
  const file = path.join(root, relative, 'project.vns.json');
  const original = projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  if (original.id !== 'project_aihong_ui_template') throw new Error('Unexpected template');
  const updated = structuredClone(original);
  const asset = (record: Parameters<typeof ui.key>[0] | undefined) => {
    const found = record && manifest.assets.find((item: {source: Parameters<typeof ui.key>[0]}) => ui.key(item.source) === ui.key(record));
    if (!found) throw new Error('Missing template asset');
    if (!original.assets.some(item => item.id === found.id)) original.assets.push({id:found.id, name:found.name, kind:found.kind, path:found.path});
    return found.id as string;
  };
  addAihongSpatialMenus({project:updated, ui, asset, skin:node => {
    const result: UiSkin = {fit:'stretch', hideText:true};
    for(const [state, source] of Object.entries({idle:'normal', hover:'highlighted', pressed:'Pressed', selected:'selected', disabled:'disabled'} as const)) {
      const sprite = ui.localizedSprite(node, source); if(sprite) result[state as 'idle'] = asset(sprite);
    }
    return result;
  }});
  const target = original.ui.components.find(item => item.id === 'ai_flowchart_items')!;
  Object.assign(target, updated.ui.components.find(item => item.id === target.id));
  for (const item of original.assets.filter(item => !updated.assets.some(old => old.id === item.id))) {
    await fs.copyFile(path.join(root, 'artifacts/aihong-ui-assets', item.path), path.join(root, relative, item.path));
  }
  await fs.writeFile(file, JSON.stringify(projectSchema.parse(original), null, 2) + '\n');
  console.log(file);
}
