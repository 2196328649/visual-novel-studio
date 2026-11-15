import type { StageAction } from './model';
import { initialPreviewStage, linePlaybackAudio, linePlaybackPlan, sampleLinePlayback } from './line-preview';
export interface UiStageEvent {at:number;action:StageAction;cancelledAt?:number}

/** Merge independently resumed events onto the UI clock without adding their waits twice. */
export function uiStagePlan(events:UiStageEvent[],elapsed:number){
 const before=initialPreviewStage(),actions:StageAction[]=[];let at=0;
 for(const event of events){
  if(event.at>at)actions.push({kind:'pause',seconds:event.at-at});at=event.at;
  let action=event.action;
  if(event.cancelledAt!==undefined){
   const duration=Math.max(0,event.cancelledAt-event.at);
   // Cancellation ends the owned media at the close time, without undoing
   // completed state changes or stopping an independently authored BGM.
   if(action.kind==='visual')action={...action,persistent:false,duration:Math.min(action.duration,duration)};
   else if(action.kind==='audioClip')action={...action,duration:Math.min(action.duration,duration),fadeOut:0};
   else if(action.kind==='chapter')action={...action,duration:Math.min(action.duration??4.2,duration)};
  }
  switch(action.kind){
   case 'pause':break;
   case 'background':case 'show':case 'hide':case 'chapter':case 'shake':case 'animate':case 'camera':case 'visual':case 'audioClip':actions.push({...action,wait:false});break;
   default:actions.push(action);
  }
 }
 const plan=linePlaybackPlan(before,actions);
 return {sample:sampleLinePlayback(before,plan,elapsed*1000),audio:linePlaybackAudio(before,plan),events};
}
