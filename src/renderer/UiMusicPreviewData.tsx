import type { Project } from '../core/model';
import type { previewUiLogic, UiPreviewEvent } from '../core/ui-logic-preview';
import { musicRoomEntries } from '../core/music-preview';
import { UiAssetSelect } from './AssetPicker';
import type { AssetUrl } from './StageEditor';

export function UiMusicPreviewData({ project, preview, assetUrl, onEvent }: { project: Project; preview: ReturnType<typeof previewUiLogic>; assetUrl: AssetUrl; onEvent: (event: UiPreviewEvent) => void }) {
 const entries = musicRoomEntries(project), unlocks = preview.musicUnlocks;
 return <details className="ui-gallery-preview-data"><summary>音乐测试数据</summary><p>解锁只用于本次预演，不写入玩家资料。修改解锁会停止试听；循环表示播完列表后从头播放。</p>
  <label><input type="checkbox" checked={unlocks === undefined} onChange={e => onEvent({ kind: 'musicData', ids: e.target.checked ? undefined : [] })}/>全部音乐已解锁</label>
  {unlocks !== undefined && <><UiAssetSelect project={project} kind="audio" category="all" assetUrl={assetUrl} allowedIds={entries.filter(entry => !unlocks.includes(entry.id)).map(entry => entry.id)} label="添加已解锁音乐" empty="选择测试音乐" onChange={id => { if (id) onEvent({ kind: 'musicData', ids: [...unlocks, id] }); }}/>
   <div className="ui-gallery-test-unlocks">{entries.filter(entry => unlocks.includes(entry.id)).map(entry => <button type="button" key={entry.id} aria-label={'取消音乐解锁 ' + entry.name} onClick={() => onEvent({ kind: 'musicData', ids: unlocks.filter(id => id !== entry.id) })}>{entry.name} ×</button>)}</div></>}
 </details>;
}
