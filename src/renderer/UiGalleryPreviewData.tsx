import type { Project, UiComponent } from '../core/model';
import { galleryEntries } from '../core/gallery';
import { UiAssetSelect } from './AssetPicker';
import type { AssetUrl } from './StageEditor';

export function UiGalleryPreviewData({ project, components, assetUrl, unlocks, onChange }: { project: Project; components: UiComponent[]; assetUrl: AssetUrl; unlocks?: string[]; onChange: (value: string[] | undefined) => void }) {
  const ids = new Set(components.filter(c => c.kind === 'galleryGrid').flatMap(c => galleryEntries(project, c).flatMap(group => group.assetIds)));
  const images = project.assets.filter(asset => ids.has(asset.id));
  return <details className="ui-gallery-preview-data"><summary>图鉴测试数据</summary>
    <label><input type="checkbox" checked={unlocks === undefined} onChange={event => onChange(event.target.checked ? undefined : [])} />全部图片已解锁</label>
    {unlocks !== undefined && <>
      <UiAssetSelect project={project} kind="image" category="all" assetUrl={assetUrl} allowedIds={images.filter(asset => !unlocks.includes(asset.id)).map(asset => asset.id)} label="添加已解锁图片" empty="选择测试图片" onChange={id => { if (id) onChange([...new Set([...unlocks, id])]); }} />
      <div className="ui-gallery-test-unlocks">{images.filter(asset => unlocks.includes(asset.id)).map(asset => <button type="button" key={asset.id} aria-label={`取消解锁 ${asset.name}`} onClick={() => onChange(unlocks.filter(id => id !== asset.id))}>{asset.name} ×</button>)}</div>
      <output aria-label="图鉴测试解锁数量">{images.filter(asset => unlocks.includes(asset.id)).length} / {images.length}</output>
    </>}
  </details>;
}
