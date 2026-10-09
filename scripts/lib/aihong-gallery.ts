import { assetSchema, galleryGroupSchema, type Asset, type GalleryGroup, type Project } from '../../src/core/model';
import { ensureAssetFolder } from '../../src/core/asset-library';
import { createContentFolder } from '../../src/core/content-browser';

export interface GallerySourceReference { resourcePath: string; candidates: string[] }
export interface GallerySourceGroup { id: string; name: string; thumbnail: GallerySourceReference; variants: (GallerySourceReference & { label: string })[] }
export interface GallerySourceManifest { groupCount: number; variantCount: number; assets: (Asset & { resourcePath: string; sourcePathId: number })[]; groups: GallerySourceGroup[] }

// Template choices follow the source ResourceManager's first candidate. These
// are recorded authoring defaults, not proof of which version the game loads.
export const aihongGalleryDefaults:Readonly<Record<string,string>>={
 'starveling/texture/event/scatter/史可法斩首p3':'ai_cg_6f0924aa837a97e3',
 'starveling/texture/event/scatter/史可法斩首p4':'ai_cg_83ccd0e6abfaeb25',
 'starveling/texture/event/scatter/史可法斩首p5':'ai_cg_5282cf87e840c2e0',
 'starveling/texture/event/scatter/史可法斩首p7':'ai_cg_c93d5eb364737775',
 'starveling/texture/event/yi/cg4':'ai_cg_9dcaa43d8cbaa15f',
 'starveling/texture/thumbnail/cg4':'ai_cg_392fd0a35d215fef',
 'starveling/texture/thumbnail/cg5':'ai_cg_9783764b2aa33d6a',
 'starveling/texture/thumbnail/cg34':'ai_cg_ee9c3f33015c7321',
};

/** Resolve only exact resource candidates. Ambiguous paths require a recorded choice. */
export function aihongGalleryGroups(manifest: GallerySourceManifest, resolutions: Record<string, string> = {}, groupIds?: string[]) {
  const assets = new Map(manifest.assets.map(asset => [asset.id, asset]));
  const used = new Set<string>();
  const select = (reference: GallerySourceReference) => {
    const id = resolutions[reference.resourcePath] ?? (reference.candidates.length === 1 ? reference.candidates[0] : undefined);
    if (!id || !reference.candidates.includes(id)) throw new Error(`图鉴资源需要确认版本：${reference.resourcePath}`);
    const asset = assets.get(id);
    if (!asset || asset.resourcePath !== reference.resourcePath || asset.kind !== 'image') throw new Error(`图鉴资源引用无效：${reference.resourcePath} / ${id}`);
    used.add(id); return id;
  };
  if (manifest.groups.length !== manifest.groupCount || manifest.groups.reduce((sum, group) => sum + group.variants.length, 0) !== manifest.variantCount) throw new Error('图鉴清单计数不一致。');
  if (groupIds?.some(id => !manifest.groups.some(group => group.id === id))) throw new Error('图鉴分组不存在。');
  const groups: GalleryGroup[] = manifest.groups.filter(group => !groupIds || groupIds.includes(group.id)).map(group => galleryGroupSchema.parse({
    id: group.id, name: group.name, thumbnailAssetId: select(group.thumbnail), assetIds: group.variants.map(select),
  }));
  return { groups, assets: [...used].map(id => { const asset = assets.get(id)!; return assetSchema.parse({ ...asset, sourcePath: `${asset.resourcePath}#resources.assets:${asset.sourcePathId}` }); }) };
}

/** Populate the shipped template, retaining alternatives and all unrelated work. */
export function populateAihongGallery(project:Project,manifest:GallerySourceManifest,resolutions:Record<string,string>=aihongGalleryDefaults){
 const component=project.ui.components.find(c=>c.id==='ai_gallery_items'&&c.kind==='galleryGrid');
 if(!component)throw new Error('模板缺少 CG 图鉴组件。');
 const imported=aihongGalleryGroups(manifest,resolutions),selected=new Set(imported.assets.map(a=>a.id));
 const references=manifest.groups.flatMap(g=>[g.thumbnail,...g.variants]);
 const candidates=new Set(references.flatMap(r=>r.candidates));
 const assets=manifest.assets.filter(a=>candidates.has(a.id)).map(a=>assetSchema.parse({...a,name:selected.has(a.id)?a.name:a.name+' · 候选版本 '+a.sourcePathId,sourcePath:`${a.resourcePath}#resources.assets:${a.sourcePathId}`}));
 for(const asset of assets){const existing=project.assets.find(a=>a.id===asset.id);if(existing&&(existing.path!==asset.path||existing.sourcePath!==asset.sourcePath))throw new Error('图鉴素材 ID 已被其他素材使用：'+asset.id);}
 const root=ensureAssetFolder(project,'scene');
 const folder=(name:string)=>project.contentBrowser!.folders.find(f=>f.parentId===root&&f.name===name)?.id??createContentFolder(project,name,root)!;
 const full=folder('CG 分镜'),thumb=folder('CG 缩略图'),alternatives=folder('CG 候选版本');
 for(const asset of assets){if(!project.assets.some(a=>a.id===asset.id))project.assets.push(asset);project.contentBrowser!.assignments['asset:'+asset.id]=!selected.has(asset.id)?alternatives:asset.sourcePath!.includes('/thumbnail/')?thumb:full;}
 component.list={...component.list,galleryGroups:imported.groups,galleryFit:'cover',galleryEndAction:'close',galleryShowControls:false,galleryPageButtonLimit:12};delete component.list.assetIds;
 return {groups:imported.groups,assets,selected:imported.assets.length,alternatives:assets.length-imported.assets.length};
}
