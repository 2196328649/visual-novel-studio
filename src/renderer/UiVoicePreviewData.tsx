import type { Project } from '../core/model';
import type { previewUiLogic, UiPreviewEvent } from '../core/ui-logic-preview';
import { storyVoiceEntries, storyVoiceLogEntries } from '../core/story-menu';
import { UiAssetSelect } from './AssetPicker';
import type { AssetUrl } from './StageEditor';

export function UiVoicePreviewData({project,preview,assetUrl,onEvent}:{project:Project;preview:ReturnType<typeof previewUiLogic>;assetUrl:AssetUrl;onEvent:(event:UiPreviewEvent)=>void}){
 const entries=storyVoiceEntries(project),logs=storyVoiceLogEntries(project),unlocks=preview.voiceUnlocks,favorites=preview.voice.favorites;
 return <details className="ui-gallery-preview-data"><summary>语音测试数据</summary><p>收藏和解锁只用于本次预演，不写入玩家资料。修改测试数据会停止试听。</p>
  <label><input type="checkbox" checked={unlocks===undefined} onChange={event=>onEvent({kind:'voiceData',data:'unlocks',ids:event.target.checked?undefined:[]})}/>全部语音已解锁</label>
  {unlocks!==undefined&&<><UiAssetSelect project={project} kind="audio" category="all" assetUrl={assetUrl} allowedIds={entries.filter(entry=>!unlocks.includes(entry.id)).map(entry=>entry.id)} label="添加已解锁语音" empty="选择测试语音" onChange={id=>{if(id)onEvent({kind:'voiceData',data:'unlocks',ids:[...unlocks,id]});}}/>
   <div className="ui-gallery-test-unlocks">{entries.filter(entry=>unlocks.includes(entry.id)).map(entry=><button type="button" key={entry.id} aria-label={'取消语音解锁 '+entry.name} onClick={()=>onEvent({kind:'voiceData',data:'unlocks',ids:unlocks.filter(id=>id!==entry.id)})}>{entry.name} ×</button>)}</div></>}
  <UiAssetSelect project={project} kind="audio" category="all" assetUrl={assetUrl} allowedIds={entries.filter(entry=>!favorites.includes(entry.id)).map(entry=>entry.id)} label="添加测试收藏" empty="选择测试收藏" onChange={id=>{if(id)onEvent({kind:'voiceData',data:'favorites',ids:[...favorites,id]});}}/>
  {!!logs.length&&<label>添加测试对白收藏<select aria-label="添加测试对白收藏" value="" onChange={event=>{if(event.target.value)onEvent({kind:'voiceData',data:'favorites',ids:[...favorites,event.target.value]});}}><option value="">选择对白记录</option>{logs.filter(entry=>!favorites.includes(entry.id)).map(entry=><option key={entry.id} value={entry.id}>{entry.caption}</option>)}</select></label>}
  <button type="button" onClick={()=>onEvent({kind:'voiceData',data:'favorites'})}>收藏全部语音</button>{!!logs.length&&<button type="button" onClick={()=>onEvent({kind:'voiceData',data:'favorites',ids:logs.map(entry=>entry.id)})}>收藏全部对白</button>}<button type="button" onClick={()=>onEvent({kind:'voiceData',data:'favorites',ids:[]})}>清空测试收藏</button>
  <output aria-label="语音测试收藏数量">{favorites.length} / {entries.length+favorites.filter(id=>id.startsWith('line:')).length}</output>
 </details>;
}
