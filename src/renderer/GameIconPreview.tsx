import { androidIconLayout } from '../core/icon-layout';
import type { ExportSettings } from '../core/export-settings';

export function GameIconPreview({ source, settings }: { source?: string; settings: ExportSettings }) {
  const layout = androidIconLayout(settings.android.iconScale);
  if (!source) return null;
  return <div aria-label="游戏图标裁切预览" style={{ display: 'flex', gap: 24, padding: '12px 0', flexWrap: 'wrap' }}>
    {['Windows', 'Android 圆角', 'Android 圆形'].map((label, index) => {
      const appearance = index ? settings.android : settings.windows;
      const extent = index ? (layout.canvas - 2 * layout.inset) / layout.mask : appearance.iconScale;
      return <div key={label} style={{ display: 'grid', justifyItems: 'center', gap: 8 }}>
      <div className="icon-preview-frame" aria-label={label + '图标预览'} style={{ position: 'relative', width: 88, height: 88, borderRadius: index === 2 ? '50%' : index === 1 ? '26%' : 4, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: appearance.iconBackgroundMode === 'solid' ? appearance.iconBackground : undefined }} />
        <img src={source} alt={label} style={{ position: 'absolute', width: `${extent * 100}%`, height: `${extent * 100}%`, maxWidth: 'none', left: `${50 + appearance.iconX * 100}%`, top: `${50 + appearance.iconY * 100}%`, transform: 'translate(-50%, -50%)', objectFit: 'contain' }} />
        {index > 0 && <div aria-label="图案安全区域" style={{ position: 'absolute', inset: `${(1 - layout.safeDiameter / layout.mask) * 50}%`, border: '1px dashed #fff8', borderRadius: '50%', pointerEvents: 'none' }} />}
      </div><small>{label}</small>
    </div>; })}
  </div>;
}
