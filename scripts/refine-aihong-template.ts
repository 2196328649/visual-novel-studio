import { simplifySample } from '../src/core/sample-cleanup';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema, type Asset, type UiSkin } from '../src/core/model';
import { validateProject } from '../src/core/validate';
import { prepareAihongAuthoring } from './lib/aihong-authoring';
import { addAihongMenus } from './lib/aihong-menus';
import { addAihongPortraits } from './lib/aihong-portraits';
import { refineAihongFidelity } from './lib/aihong-fidelity';
import { organizeAihongResources } from './lib/aihong-resources';
import { UnityUi, type UnityObject } from './lib/unity-ui';

// Deliberately bounded to the two generated templates. Never open an autosave or user project.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'artifacts/aihong-ui-assets');
const ui = await UnityUi.load(path.join(root, 'artifacts/aihong-ui-inspection/2026-09-10-layout'));
const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8')) as { assets: (Asset & { source: { file: string; pathId: number } })[] };
const bySource = new Map(manifest.assets.map(asset => [ui.key(asset.source), asset]));
for (const relative of ['resources/templates/aihong', 'artifacts/aihong-template']) {
  const output = path.join(root, relative), file = path.join(output, 'project.vns.json');
  const project = projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  if (project.id !== 'project_aihong_ui_template') throw new Error(`不是内置模板：${file}`);
  const used = new Map<string, Asset>();
  const asset = (record: UnityObject | undefined) => {
    const found = record && bySource.get(ui.key(record));
    if (!found) throw new Error(`未提取的界面图片：${record?.data.m_Name}`);
    used.set(found.id, found); return found.id;
  };
  const skin = (node: UnityObject) => {
    const value: UiSkin = { fit: 'stretch', hideText: true };
    for (const [state, original] of Object.entries({ idle: 'normal', hover: 'highlighted', pressed: 'Pressed', selected: 'selected', disabled: 'disabled' } as const)) {
      const sprite = ui.localizedSprite(node, original);
      if (sprite) value[state as 'idle'] = asset(sprite);
    }
    return value;
  };
  addAihongMenus({ project, ui, asset, skin });
  const namedAsset = (name: string) => {
    const found = manifest.assets.find(a => a.name === name);
    if (!found) throw new Error(`缺少模板资源：${name}`);
    used.set(found.id, found); return found.id;
  };
  refineAihongFidelity({ project, ui, asset, skin, namedAsset });
  for (const record of used.values()) {
    const destination = path.join(output, record.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(source, record.path), destination);
    if (!project.assets.some(asset => asset.id === record.id)) project.assets.push({ id: record.id, name: record.name, kind: record.kind, path: record.path, width: record.width, height: record.height, category: 'ui' });
  }
  const portraits = await addAihongPortraits(project, output, undefined, path.join(root, 'resources/templates/aihong'));
  organizeAihongResources(project);
  prepareAihongAuthoring(project);
  simplifySample(project);
  const valid = projectSchema.parse(project), errors = validateProject(valid).filter(issue => issue.severity === 'error');
  if (errors.length) throw new Error(JSON.stringify(errors));
  await fs.writeFile(file, JSON.stringify(valid, null, 2) + '\n');
  await fs.copyFile(path.join(root, 'docs/aihong-story-sample.md'), path.join(output, '示例说明.md'));
  console.log(JSON.stringify({ template: relative, portraits, components: valid.ui.components.length, assets: valid.assets.length }));
}
