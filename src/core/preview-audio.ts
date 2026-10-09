export interface PreviewAudioEvent { id?: string; channel: 'music'|'sound'|'voice'; at: number; loop?: boolean; fade?: number; stopGain?: number; key?: string; duration?: number; offset?: number; volume?: number; fadeOut?: number }
/** BGM is auditioned by the author's manual player, independent of stage transport. */
export function performancePreviewAudio(events: PreviewAudioEvent[]): PreviewAudioEvent[] {
 return events.filter(event => event.channel !== 'music');
}
/** Reconstruct only the current source and its pending fade, without replaying earlier sounds. */
export function previewAudioAt(events: PreviewAudioEvent[], time: number) {
 const channels = new Map<string,{source:PreviewAudioEvent;stop?:PreviewAudioEvent;stopGain?:number}>();
 for(const event of events) {
  if(event.at>time)continue;
  if(event.id)channels.set(previewAudioKey(event),{source:event});
  else {const active=channels.get(previewAudioKey(event));if(active) {
   active.stopGain=event.stopGain??previewAudioGain(event.at,active.source.at,active.source.fade??0,active.stop?.at,active.stop?.fade??0,active.stopGain);
   active.stop=event;
  }}
 }
 return [...channels.values()].filter(({source,stop,stopGain})=>(source.duration===undefined||time<source.at+source.duration)&&(!stop||((stopGain??1)>0&&time<stop.at+(stop.fade??0))));
}
export function previewAudioGain(time:number,at:number,fade:number,stopAt?:number,stopFade=0,stopGain?:number) {
 const entered=(t:number)=>fade?Math.min(1,Math.max(0,(t-at)/fade)):1;
 if(stopAt===undefined)return entered(time);
 return (stopGain??entered(stopAt))*(stopFade?Math.max(0,1-(time-stopAt)/stopFade):0);
}

/** Carry the latest channels into a new local clock, preserving elapsed time and fades. */
export function carryPreviewAudio(events:PreviewAudioEvent[],milliseconds:number):PreviewAudioEvent[] {
 return previewAudioAt(events,milliseconds).flatMap(({source,stop,stopGain})=>[
  {...source,at:source.at-milliseconds},
  ...(stop?[{...stop,at:stop.at-milliseconds,stopGain}]:[]),
 ]);
}

export const previewAudioKey = (event: PreviewAudioEvent) => event.key ?? event.channel;
export function previewClipGain(time: number, event: Pick<PreviewAudioEvent, 'at' | 'duration' | 'fade' | 'fadeOut'>) {
 if (event.duration === undefined) return 1;
 const elapsed = time - event.at;
 if (elapsed < 0 || elapsed >= event.duration) return 0;
 return event.fadeOut ? Math.min(1, (event.duration - elapsed) / Math.min(event.duration, event.fadeOut)) : 1;
}
