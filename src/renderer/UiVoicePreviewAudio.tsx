import { useEffect, useRef, useState } from 'react';
import type { previewUiLogic, UiPreviewEvent } from '../core/ui-logic-preview';
import type { AssetUrl } from './StageEditor';

export function UiVoicePreviewAudio({preview,assetUrl,onEvent}:{preview?:ReturnType<typeof previewUiLogic>;assetUrl:AssetUrl;onEvent:(event:UiPreviewEvent)=>void}){
 const element=useRef<HTMLAudioElement>(null),[error,setError]=useState(''),callback=useRef(onEvent);callback.current=onEvent;
 const playback=preview?.voice.playback,url=playback?assetUrl(playback.assetId):undefined,requestId=playback?.requestId;
 const gain=Math.max(0,Math.min(1,(preview?.muted?0:1)*Number(preview?.preferences.masterVolume??1)*Number(preview?.preferences.voiceVolume??1)*(playback?.characterGain??1)));
 useEffect(()=>{const audio=element.current;if(audio)audio.volume=gain;},[gain,requestId]);
 useEffect(()=>{
  const audio=element.current;if(!audio)return;audio.pause();if(!url||requestId===undefined){audio.removeAttribute('src');audio.load();return;}
  let cancelled=false;setError('');
  // A repaired local file must not reuse Chromium's failed media response.
  const source=/^(studio-asset|https?|file):/.test(url)?new URL(url):undefined;
  if(source)source.searchParams.set('vns-voice-attempt',String(Date.now())+'-'+requestId);
  audio.src=source?.href??url;audio.currentTime=0;
  const end=()=>{if(!cancelled)callback.current({kind:'voiceEnded',requestId});};
  const fail=()=>{if(!cancelled){setError('语音试听失败，请检查素材文件和音频格式。');end();}};
  audio.addEventListener('ended',end);audio.addEventListener('error',fail);void audio.play().catch(fail);
  return()=>{cancelled=true;audio.removeEventListener('ended',end);audio.removeEventListener('error',fail);audio.pause();audio.removeAttribute('src');audio.load();};
 },[url,requestId]);
 useEffect(()=>{if(!preview?.voice.serial)setError('');},[preview?.voice.serial]);
 return <><audio key={requestId??'idle'} ref={element} aria-label="语音预演播放器" style={{display:'none'}}/>{error&&<p role="status">{error}</p>}</>;
}
