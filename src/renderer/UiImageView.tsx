import { useEffect, useId, useRef, useState } from 'react';
import type { Project, UiButtonState, UiComponent } from '../core/model';
import { uiImageAsset, uiImageCrop, uiImagePatches, type UiImageReport, type UiImageRequest } from '../core/ui-image';
import { uiComponentBounds } from '../core/ui';
import type { AssetUrl } from './StageEditor';

export interface UiImageFeedback { request: UiImageRequest; onReport: (report: UiImageReport) => void }
export function UiImageView({ project, component, state, assetUrl, feedback }: {
  project: Project; component: UiComponent; state: UiButtonState; assetUrl: AssetUrl; feedback?: UiImageFeedback;
}) {
  const assetId = uiImageAsset(component, state), asset = project.assets.find(asset => asset.id === assetId && asset.kind === 'image');
  const url = asset ? assetUrl(asset.id) ?? '' : '';
  const key = JSON.stringify([assetId, url, feedback?.request.pageInstance, feedback?.request.sequence]);
  if (!assetId) return null;
  return <UiImageSource key={key} {...{ project, component, state, assetId, url, feedback }} />;
}
function UiImageSource({ project, component, state, assetId, url, feedback }: {
  project: Project; component: UiComponent; state: UiButtonState; assetId: string; url: string; feedback?: UiImageFeedback;
}) {
  const [size, setSize] = useState<{ width: number; height: number }>();
  const reported = useRef(false), callback = useRef(feedback); callback.current = feedback;
  const id = 'ui-image-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const report = (status: 'loaded' | 'failed', width = 0, height = 0) => {
    if (reported.current) return;
    reported.current = true;
    if (status === 'loaded') setSize({ width, height });
    const current = callback.current;
    if (current?.request.assetId === assetId) current.onReport({ pageInstance: current.request.pageInstance, sequence: current.request.sequence, assetId, status, width, height,
      ...(status === 'failed' ? { error: '图片无法读取或解码。' } : {}) });
  };
  useEffect(() => { if (!url) report('failed'); }, [url]);
  const b = uiComponentBounds(component, project.width, project.height), effects = component.imageEffects;
  const patches = size ? uiImagePatches(uiImageCrop(size.width, size.height, effects), b.width, b.height, component.style?.imageFit ?? 'contain', component.skin?.borders) : [];
  const tint = effects?.tint ?? '#ffffff', channel = (offset: number) => Number.parseInt(tint.slice(offset, offset + 2), 16) / 255;
  const brightness = Math.round((component.skin?.brightness?.[state] ?? 1) * 255) / 255;
  const alpha = (tint.length === 9 ? channel(7) : 1) * (state === 'disabled' && !component.skin?.disabled ? .45 : 1);
  const matrix = [channel(1) * brightness, 0, 0, 0, 0, 0, channel(3) * brightness, 0, 0, 0, 0, 0, channel(5) * brightness, 0, 0, 0, 0, 0, alpha, 0].join(' ');
  return <>
    {url && <img aria-hidden="true" alt="" draggable={false} src={url} data-ui-image-probe={assetId} style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} onLoad={event => {
      const { naturalWidth, naturalHeight } = event.currentTarget; report(naturalWidth && naturalHeight ? 'loaded' : 'failed', naturalWidth, naturalHeight);
    }} onError={() => report('failed')} />}
    <svg aria-hidden="true" className="ui-skin-image ui-image-surface" data-ui-image-source={assetId} viewBox={`0 0 ${Math.max(1, b.width)} ${Math.max(1, b.height)}`} preserveAspectRatio="none" style={{ overflow: 'hidden' }}>
      <defs><filter id={id} x="0" y="0" width={b.width} height={b.height} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={matrix} /></filter></defs>
      <g transform={`translate(${effects?.flipX ? b.width : 0} ${effects?.flipY ? b.height : 0}) scale(${effects?.flipX ? -1 : 1} ${effects?.flipY ? -1 : 1})`} filter={`url(#${id})`}>
        {size && patches.map(({ source, target }, i) => <svg key={i} x={target.x} y={target.y} width={target.width} height={target.height} viewBox={`${source.x} ${source.y} ${source.width} ${source.height}`} preserveAspectRatio="none" overflow="hidden">
          <image href={url} x="0" y="0" width={size.width} height={size.height} preserveAspectRatio="none" />
        </svg>)}
      </g>
    </svg>
  </>;
}
