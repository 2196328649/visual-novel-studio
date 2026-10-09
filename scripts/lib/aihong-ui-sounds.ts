import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Project } from '../../src/core/model';
import { ensureAssetFolder } from '../../src/core/asset-library';
import sourceMap from './aihong-hover-map.json';

export const aihongHoverAssets = [
  { id: 'ai_ui_hover', name: '鼠标滑动', file: '鼠标滑动.ogg' },
  { id: 'ai_ui_hover_highlight', name: 'Highlight_New', file: 'Highlight_New.ogg' },
] as const;

export async function addAihongUiSounds(project: Project, directory: string) {
  for (const item of aihongHoverAssets) {
    let asset = project.assets.find(a => a.id === item.id);
    if (!asset) {
      asset = { id: item.id, name: item.name, kind: 'audio', category: 'sound', path: `assets/音效/界面/${item.file}` };
      project.assets.push(asset);
    }
    const destination = path.join(directory, asset.path);
    const folder = ensureAssetFolder(project, 'sound', ['界面']);
    project.contentBrowser!.assignments['asset:' + asset.id] ??= folder;
    const source = path.join(process.env.VNS_AIHONG_PRESENTATION_ASSETS ?? 'E:/Project/Model/SLY/T/Assets', 'AudioClip', item.file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
  project.ui.hoverSoundId ??= 'ai_ui_hover';
  const mapping = sourceMap as Record<string, string | null>;
  for (const component of [...project.ui.components, ...(project.ui.instances ?? []).flatMap(i => i.components), ...project.ui.customPages.flatMap(p => p.components)]) {
    if (component.hoverSoundId === undefined && Object.hasOwn(mapping, component.id)) component.hoverSoundId = mapping[component.id];
  }
}
