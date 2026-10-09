import { useContext, useEffect, useRef, useState } from 'react';
import { CompositionEditingContext } from './CompositionEditingContext';
import { previewAudioAt, previewAudioKey, previewAudioGain, previewClipGain } from '../core/preview-audio';
import type { previewUiLogic } from '../core/ui-logic-preview';
import type { AssetUrl } from './StageEditor';

export function UiStagePreviewAudio({preview,playing,assetUrl}:{preview:ReturnType<typeof previewUiLogic>;playing:boolean;assetUrl:AssetUrl}){
 const editing=useContext(CompositionEditingContext);
 type Track={audio:HTMLAudioElement;signature:string;release:()=>void};
 const tracks=useRef(new Map<string,Track>()),container=useRef<HTMLDivElement>(null),latest=useRef({preview,playing,assetUrl,editing});latest.current={preview,playing,assetUrl,editing};
 const [error,setError]=useState('');
 useEffect(()=>()=>{for(const track of tracks.current.values())track.release();tracks.current.clear();},[]);
 useEffect(()=>{
  const wanted=previewAudioAt(preview.stage.audio,preview.elapsed*1000),keys=new Set<string>();
  const sync=(track:Track,key:string)=>{
   if(tracks.current.get(key)!==track)return;
   const {preview,playing}=latest.current,time=preview.elapsed*1000;
   const active=previewAudioAt(preview.stage.audio,time).find(e=>previewAudioKey(e.source)===key);
   if(!active||!playing||preview.musicRoomOpen&&active.source.channel==='music'){track.audio.pause();return;}
   const {source,stop,stopGain}=active,audio=track.audio;
   const channel=source.channel==='music'?'musicVolume':source.channel==='voice'?'voiceVolume':'soundVolume';
   const gain=(preview.muted||latest.current.editing?.audioEnabled?.(key,source.id)===false?0:1)*Number(preview.preferences.masterVolume)*Number(preview.preferences[channel])*(source.volume??1);
   audio.volume=Math.max(0,Math.min(1,gain*previewAudioGain(time,source.at,source.fade??0,stop?.at,stop?.fade??0,stopGain)*previewClipGain(time,source)));
   if(audio.readyState<1)return;
   let position=Math.max(0,(time-source.at+(source.offset??0))/1000);
   if(Number.isFinite(audio.duration)&&audio.duration>0){if(audio.loop)position%=audio.duration;else if(position>=audio.duration){audio.pause();return;}}
   if(Math.abs(audio.currentTime-position)>.25||audio.paused)audio.currentTime=position;
   if(audio.paused)void audio.play().catch(e=>{if(e?.name!=='AbortError'&&tracks.current.get(key)===track)setError('无法播放演出音频，请检查素材。');});
  };
  for(const {source} of wanted){
   const key=previewAudioKey(source),url=assetUrl(source.id);if(!url)continue;keys.add(key);
   const signature=JSON.stringify([source.id,source.at,source.offset,source.duration,url]);let track=tracks.current.get(key);
   if(track?.signature!==signature){
    track?.release();const audio=document.createElement('audio');audio.setAttribute('aria-label','演出音频 '+source.id);audio.dataset.stageAudio=key;audio.preload='auto';audio.loop=source.loop??false;container.current?.append(audio);
    const created:Track={audio,signature,release:()=>{audio.onloadedmetadata=null;audio.onerror=null;audio.pause();audio.removeAttribute('src');audio.load();audio.remove();}};
    track=created;tracks.current.set(key,track);setError('');audio.onloadedmetadata=()=>sync(created,key);audio.onerror=()=>{if(tracks.current.get(key)===created)setError('无法播放演出音频，请检查素材。');};audio.src=url;
   }
   sync(track,key);
  }
  for(const [key,track] of tracks.current)if(!keys.has(key)){tracks.current.delete(key);track.release();}
 },[preview,playing,assetUrl,editing]);
 return <><div hidden ref={container}/>{error&&<p role="status">{error}</p>}</>;
}
