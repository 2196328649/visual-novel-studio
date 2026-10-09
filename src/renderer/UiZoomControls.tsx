import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { IconButton } from './components';
import type { useUiViewport } from './useUiViewport';
import './ui-editor-interactions.css';

export function UiZoomControls({ viewport }: { viewport: ReturnType<typeof useUiViewport> }) {
  const percent = Math.round(viewport.scale * 100);
  return <div className="ui-zoom-controls" role="group" aria-label="画面缩放">
    <IconButton title="缩小" disabled={viewport.scale <= .1} onClick={() => viewport.change(viewport.scale / 1.15)}><ZoomOut size={16} /></IconButton>
    <select aria-label="画面缩放比例" value={viewport.fitting ? 'fit' : String(percent)} onChange={event => viewport.change(event.target.value === 'fit' ? null : Number(event.target.value) / 100)}>
      <option value="fit">适合窗口 ({percent}%)</option>
      {[...new Set([10, 25, 50, 75, 100, 150, 200, 300, 400, ...viewport.fitting ? [] : [percent]])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value}%</option>)}
    </select>
    <IconButton title="放大 (Ctrl+滚轮)" disabled={viewport.scale >= 4} onClick={() => viewport.change(viewport.scale * 1.15)}><ZoomIn size={16} /></IconButton>
    <IconButton title="适合窗口" onClick={() => viewport.change(null)}><Maximize size={16} /></IconButton>
  </div>;
}
