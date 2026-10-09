import { renderActorLayers } from './ActorLayers';
import { effectiveCharacter, type Project } from '../core/model';
import type { PreviewStage } from '../core/line-preview';
import type { previewUiLogic } from '../core/ui-logic-preview';
import { actorKey } from '../core/actor-instance';
import { VisualEditingSurface, VisualObjectPreview } from './VisualObjectPreview';
import { ChapterStageLayer } from './ChapterPreview';
import type { AssetUrl } from './StageEditor';
import { useContext } from 'react';
import { CompositionEditingContext } from './CompositionEditingContext';

export function UiStagePreview({project,preview,assetUrl,playing=false}:{project:Project;preview:ReturnType<typeof previewUiLogic>;assetUrl:AssetUrl;playing?:boolean}){
 return <PlaybackStage project={project} sample={preview.stage.sample} assetUrl={assetUrl} playing={playing} />;
}
export function PlaybackStage({project,sample,assetUrl,playing=false}:{project:Project;sample:ReturnType<typeof import('../core/line-preview').sampleLinePlayback>;assetUrl:AssetUrl;playing?:boolean}){
 const context=useContext(CompositionEditingContext),editing=context&&(playing?{...context,canSelect:()=>false,selected:()=>false,transform:undefined}:context);
 const ghost=sample.transition;
 const world=(state:PreviewStage,chapter?:typeof sample.chapter,active=false)=><div className="text-stage-world" style={{transform:'translate('+state.camera.x*100+'%, '+state.camera.y*100+'%) scale('+state.camera.zoom+') rotate('+state.camera.rotation+'deg)'}}>
  {state.backgroundId&&context?.backgroundVisible!==false&&<img className="text-stage-background" src={assetUrl(state.backgroundId)} alt="演出背景"/>}
  {[...state.visuals.values()].map(({object,elapsed})=><VisualObjectPreview key={object.instanceId} object={object} elapsed={elapsed} project={project} assetUrl={assetUrl} playing={active} editing={editing}/>)}
  {chapter&&!context?.isolate&&<ChapterStageLayer project={project} chapter={chapter} assetUrl={assetUrl}/>}
  {renderActorLayers([...(state.actorGhosts ?? []), ...state.actors.values()].filter(actor=>context?.actorVisible?.(actor.characterId,actor.instanceId)!==false), actor =>{const character=effectiveCharacter(project,actor.characterId),expression=character?.expressions.find(e=>e.id===actor.expressionId),asset=project.assets.find(a=>a.id===expression?.assetId);return expression&&<div key={actorKey(actor)} data-stage-character={actor.characterId} className="text-stage-actor" style={{left:actor.x*100+'%',top:actor.y*100+'%',height:(asset?.height??project.height*.88)/project.height*100+'%',width:asset?.width?asset.width/project.width*100+'%':undefined,transform:'translate(-50%, -100%) scale('+actor.scale+') rotate('+actor.rotation+'deg)',opacity:actor.opacity,zIndex:actor.layer}}><img src={assetUrl(expression.assetId)} alt={character?.name}/></div>;})}
 </div>;
 return <div aria-label="事件演出画面" style={{position:'absolute',inset:0,pointerEvents:'none',isolation:'isolate',zIndex:0}}>
  <VisualEditingSurface>
  <div className="text-stage-shake" style={{opacity:ghost?ghost.type==='fade'?ghost.progress<.5?0:1:ghost.progress:1,mixBlendMode:ghost?.type==='dissolve'?'plus-lighter':undefined,transform:'translate('+sample.shake.x/project.width*100+'%, '+sample.shake.y/project.height*100+'%)'}}>{world(sample.state,sample.chapter,playing)}</div>
  {ghost&&<div className="preview-transition-ghost" style={{opacity:ghost.type==='fade'?ghost.progress<.5?1:0:1-ghost.progress,mixBlendMode:ghost.type==='dissolve'?'plus-lighter':undefined}}>{world(ghost.before)}</div>}
  {ghost?.type==='fade'&&<div className="preview-transition-black" style={{opacity:1-Math.abs(ghost.progress*2-1)}}/>}
  </VisualEditingSurface>
 </div>;
}
