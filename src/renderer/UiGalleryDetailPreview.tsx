import { useEffect, useRef } from 'react';
import type { GalleryPreviewAction, GalleryPreviewState } from '../core/gallery-preview';
import type { AssetUrl } from './StageEditor';

export function UiGalleryDetailPreview({ detail, assetUrl, scale, onAction }: { detail: NonNullable<GalleryPreviewState['detail']>; assetUrl: AssetUrl; scale: number; onAction: (action: GalleryPreviewAction) => void }) {
  const advance = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    advance.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <div className="ui-gallery-detail-preview" role="group" aria-label={`图鉴详情预演 ${detail.name}`} onContextMenu={event => { event.preventDefault(); onAction({ action: 'close' }); }} style={{ position: 'absolute', inset: 0, zIndex: 1, background: '#080b0d', color: '#ffffff', fontSize: 24 * scale }}>
    <button ref={advance} type="button" className="ui-gallery-advance" aria-label="查看下一张图鉴" onClick={() => onAction({ action: 'next' })} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', padding: 0, border: 0, background: 'transparent' }}>
      <img data-gallery-detail-asset={detail.assetIds[detail.index]} src={assetUrl(detail.assetIds[detail.index])} alt={`${detail.name}，第 ${detail.index + 1} 张，共 ${detail.assetIds.length} 张`} draggable={false} style={{ width: '100%', height: '100%', objectFit: detail.fit === 'stretch' ? 'fill' : detail.fit }} />
    </button>
    {detail.showControls && <>
      <button type="button" className="ui-gallery-detail-close" aria-label="关闭图鉴详情" onClick={() => onAction({ action: 'close' })} style={{ position: 'absolute', right: '3%', top: '3%' }}>关闭</button>
      {detail.assetIds.length > 1 && <div className="ui-gallery-detail-controls" style={{ position: 'absolute', bottom: '4%', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 24 * scale, whiteSpace: 'nowrap' }}>
        <button type="button" disabled={detail.index === 0} onClick={() => onAction({ action: 'previous' })}>上一张</button>
        <span aria-label="当前图鉴分镜">{detail.index + 1} / {detail.assetIds.length}</span>
        <button type="button" onClick={() => onAction({ action: 'next' })}>下一张</button>
      </div>}
    </>}
  </div>;
}
