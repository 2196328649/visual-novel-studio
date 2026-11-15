import { uiPageTheme } from '../core/ui-page-settings';
import { NumberInput } from './NumberInput';
import { useEffect, useState } from 'react';
import { effectiveUiComponents, type Project, type UiButtonState, type UiSkin } from '../core/model';
import { nineSliceEdges, uiSkinAsset } from '../core/ui';
import { Field } from './components';
import type { AssetUrl } from './StageEditor';
export { UiAssetSelect } from './AssetPicker';

export function uiFontFamily(assetId?: string): string | undefined {
  return assetId ? `"vns_${assetId}", "Microsoft YaHei", sans-serif` : '"vns_runtime_default", "Microsoft YaHei", sans-serif';
}

export { uiTextShadow } from '../core/ui-text-effects';

export function UiFontFaces({ project, assetUrl, warmDialogue = false }: { project: Project; assetUrl: AssetUrl; warmDialogue?: boolean }) {
  const defaultSource = window.studio?.defaultFontUrl?.();
  const css = (defaultSource ? `@font-face { font-family: vns_runtime_default; src: url(${JSON.stringify(defaultSource)}); }` : '') + project.assets.filter(asset => asset.kind === 'font').map(asset => `@font-face { font-family: "vns_${asset.id}"; src: url(${JSON.stringify(assetUrl(asset.id))}); font-display: swap; }`).join('\n');
  useEffect(() => {
    if (!warmDialogue) return;
    // Large CJK fonts take noticeable time to decode on first use. Prepare the
    // dialogue UI's fonts when the project opens, before a line is selected or
    // expanded. Unrelated fonts stay lazy, and loaded faces are browser-cached.
    const theme = uiPageTheme(project, 'ui:say');
    const ids = new Set([undefined, theme.fontAssetId, ...effectiveUiComponents(project.ui).filter(component => component.page === 'say').map(component => component.style?.fontAssetId ?? theme.fontAssetId)]);
    for (const id of ids) {
      if (id && !project.assets.some(asset => asset.id === id && asset.kind === 'font')) continue;
      if (!id && !defaultSource) continue;
      void document.fonts.load(`16px ${id ? `"vns_${id}"` : 'vns_runtime_default'}`, '台词预览 Aa').catch(() => undefined);
    }
  }, [warmDialogue, css, project.ui]);
  return <style>{css}</style>;
}

export function UiSkinImage({ skin, state, assetUrl, scale, className = '' }: { skin?: UiSkin; state: UiButtonState; assetUrl: AssetUrl; scale: number; className?: string }) {
  const assetId = uiSkinAsset(skin, state);
  if (!assetId) return null;
  const opacity = state === 'disabled' && !skin?.disabled ? 0.45 : 1;
  const filter = skin?.brightness?.[state] === undefined ? undefined : `brightness(${skin.brightness[state]})`;
  if (skin?.fit === 'nineSlice') return <NineSliceImage src={assetUrl(assetId) ?? ''} borders={skin.borders ?? { left: 12, top: 12, right: 12, bottom: 12 }} opacity={opacity} filter={filter} scale={scale} className={className} />;
  return <img aria-hidden="true" className={`ui-skin-image ${className}`} src={assetUrl(assetId)} alt="" draggable={false} style={{ opacity, filter, objectFit: skin?.fit === 'stretch' || !skin?.fit ? 'fill' : skin.fit }} />;
}

const imageSizes = new Map<string, { width: number; height: number }>();

function NineSliceImage({ src, borders, opacity, filter, scale, className }: { src: string; borders: NonNullable<UiSkin['borders']>; opacity: number; filter?: string; scale: number; className: string }) {
  const [size, setSize] = useState(imageSizes.get(src));
  useEffect(() => {
    const known = imageSizes.get(src);
    if (known) { setSize(known); return; }
    const image = new Image();
    image.onload = () => { const loaded = { width: image.naturalWidth, height: image.naturalHeight }; imageSizes.set(src, loaded); setSize(loaded); };
    image.src = src;
    return () => { image.onload = null; };
  }, [src]);
  const b = nineSliceEdges(borders, size?.width, size?.height);
  return <div aria-hidden="true" className={`ui-skin-image ${className}`} style={{ opacity, filter, borderStyle: 'solid', borderColor: 'transparent', borderWidth: `${b.top * scale}px ${b.right * scale}px ${b.bottom * scale}px ${b.left * scale}px`, borderImageSource: `url(${JSON.stringify(src)})`, borderImageSlice: `${b.top} ${b.right} ${b.bottom} ${b.left} fill`, borderImageRepeat: 'stretch' }} />;
}

export { uiStateColor } from '../core/ui';

type Rect = { x: number; y: number; width: number; height: number };
export function UiRectFields({ name, value, onChange }: { name: string; value?: Rect; onChange: (value?: Rect) => void }) {
  return <div className="ui-inner-rect"><Field label={`自定义${name}位置`}><input type="checkbox" checked={!!value} onChange={event => onChange(event.target.checked ? { x: 0.05, y: 0.05, width: 0.9, height: 0.4 } : undefined)} /></Field>
    {value && <div className="ui-border-fields">{(['x', 'y', 'width', 'height'] as const).map(key => <Field key={key} label={`${name}${{ x: '横向', y: '纵向', width: '宽度', height: '高度' }[key]} %`}><NumberInput type="number" step={0.1}   value={Number((value[key] * 100).toFixed(2))} onChange={event => onChange({ ...value, [key]: Number(event.target.value) / 100 })} /></Field>)}</div>}
  </div>;
}
