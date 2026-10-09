import type { StageAction } from './model';
import { initialPreviewStage, linePlaybackAudio, linePlaybackPlan, sampleLinePlayback } from './line-preview';
export interface UiStageEvent {at:number;action:StageAction}

/** Merge independently resumed events onto the UI clock without adding their waits twice. */
export function uiStagePlan(events:UiStageEvent[],elapsed:number){
 const before=initialPreviewStage(),actions:StageAction[]=[];let at=0;
 for(const event of events){
  if(event.at>at)actions.push({kind:'pause',seconds:event.at-at});at=event.at;
  const action=event.action;
  switch(action.kind){
   case 'pause':break;
   case 'background':case 'show':case 'hide':case 'chapter':case 'shake':case 'animate':case 'camera':case 'visual':case 'audioClip':actions.push({...action,wait:false});break;
   default:actions.push(action);
  }
 }
 const plan=linePlaybackPlan(before,actions);
 return {sample:sampleLinePlayback(before,plan,elapsed*1000),audio:linePlaybackAudio(before,plan),events};
}
