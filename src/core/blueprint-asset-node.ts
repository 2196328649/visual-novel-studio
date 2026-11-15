import { makeId, type Asset, type BlueprintNode, type Project } from './model';

export const blueprintAssetKindNames = { image: '图片素材', audio: '音频素材', video: '视频素材', font: '字体素材', spine: 'Spine素材' } as const;
export type BlueprintAssetNodeKind = keyof typeof blueprintAssetKindNames;
export interface BlueprintAssetNodePresentation { kind: BlueprintAssetNodeKind; kindName: string; name: string; title: string; missing: boolean }

/** A drag creates a data reference. Execution remains an explicit consumer's job. */
export function createBlueprintAssetNode(asset: Asset, position: { x: number; y: number } = { x: 80, y: 80 }): BlueprintNode | undefined {
  if (!Object.hasOwn(blueprintAssetKindNames, asset.kind)) return;
  const kind = asset.kind as BlueprintAssetNodeKind, kindName = blueprintAssetKindNames[kind];
  const name = asset.name.trim() || '未命名素材';
  return {
    id: makeId('bpnode'), type: 'literal', name: (kindName + ' · ' + name).slice(0, 120), x: position.x, y: position.y, collapsed: false,
    properties: { value: asset.id, assetKind: kind },
    pins: [{ id: 'value', name: kindName, direction: 'output', dataType: 'asset', required: false }],
  };
}

/** The marker narrows only new asset literals; existing literals remain generic. */
export function blueprintAssetNodeKind(node: BlueprintNode): BlueprintAssetNodeKind | undefined {
  const kind = node.properties.assetKind;
  return node.type === 'literal' && typeof kind === 'string' && Object.hasOwn(blueprintAssetKindNames, kind)
    && node.pins.some(pin => pin.id === 'value' && pin.direction === 'output' && pin.dataType === 'asset') ? kind as BlueprintAssetNodeKind : undefined;
}

/** Resolve display from current resources without rewriting the authored title. */
export function blueprintAssetNodePresentation(project: Pick<Project, 'assets'>, node: BlueprintNode): BlueprintAssetNodePresentation | undefined {
  const kind = blueprintAssetNodeKind(node); if (!kind) return;
  const value = node.properties.value ?? node.pins.find(pin => pin.id === 'value')?.defaultValue;
  const asset = project.assets.find(asset => asset.id === value), kindName = blueprintAssetKindNames[kind];
  const missing = !asset || asset.kind !== kind;
  const name = !asset ? typeof value !== 'string' ? '素材引用类型无效' : value ? '素材引用已失效' : '未选择素材'
    : asset.kind !== kind ? '素材类型不匹配' : asset.name.trim() || '未命名素材';
  return { kind, kindName, name, title: kindName + ' · ' + name, missing };
}
