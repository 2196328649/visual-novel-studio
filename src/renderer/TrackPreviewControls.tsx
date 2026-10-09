import { Eye, EyeOff, Focus } from 'lucide-react';
export function TrackPreviewControls({ name, hidden, solo, onHidden, onSolo }: { name: string; hidden: boolean; solo: boolean; onHidden: () => void; onSolo: () => void }) {
  return <span className="track-preview-controls" role="group" aria-label={'轨道预览 ' + name}><button type="button" aria-label={'隐藏轨道 ' + name} aria-pressed={hidden} title={hidden ? '恢复此轨道预览' : '隐藏此轨道预览'} onClick={onHidden}>{hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button><button type="button" aria-label={'独显轨道 ' + name} aria-pressed={solo} title="仅预览独显轨道；可同时独显多条轨道" onClick={onSolo}><Focus size={13} /></button></span>;
}
