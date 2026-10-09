import { useState, type CSSProperties } from 'react';
import type { Project, UiComponent, UiButtonState } from '../core/model';
import { customVoiceItem, removingVoiceFavorite, voiceCollectionLayout, voiceCollectionView, type VoicePreviewAction } from '../core/voice-preview';
import { storyVoiceEntries } from '../core/story-menu';
import { uiSkinAsset } from '../core/ui';
import { UiSkinImage } from './UiAppearance';
import type { AssetUrl } from './StageEditor';

export function UiVoiceCollectionPreview({project,component,assetUrl,scale,state,interaction}:{project:Project;component:UiComponent;assetUrl:AssetUrl;scale:number;state:UiButtonState;interaction?:{view:ReturnType<typeof voiceCollectionView>;playingId?:string;onAction:(action:VoicePreviewAction)=>void}}){
 const geometry=voiceCollectionLayout(project,component),list=component.list,custom=customVoiceItem(component);
 const view=interaction?.view??voiceCollectionView(project,component,{favorites:list?.favoritesOnly||state==='selected'?storyVoiceEntries(project).map(entry=>entry.id):[],serial:0});
 const [hover,setHover]=useState(''),[pressed,setPressed]=useState('');
 const box=(r:{x:number;y:number;width:number;height:number}):CSSProperties=>({position:'absolute',left:r.x*scale,top:r.y*scale,width:r.width*scale,height:r.height*scale});
 const Button=interaction?'button':'span';
 const drawButton=(id:string,label:string,skin:UiComponent['skin'],style:CSSProperties,action:VoicePreviewAction,disabled=false,selected=false,content?:React.ReactNode)=>{
  const buttonState=disabled||state==='disabled'?'disabled':pressed===id?'pressed':selected?'selected':hover===id?'hover':state;
  const surface=style.background??component.style?.background??'#283133';
  const fallback=custom&&action.action==='play'?surface:buttonState==='disabled'?'#393e3b':buttonState==='pressed'?'#344638':buttonState==='selected'||buttonState==='hover'?'#586157':surface;
  return <Button key={id} type={interaction?'button':undefined} aria-label={interaction?label:undefined} disabled={interaction?(disabled||state==='disabled'):undefined} aria-pressed={interaction&&action.action==='play'?selected:undefined} data-voice-control={id}
   onClick={interaction?()=>interaction.onAction(action):undefined} onMouseEnter={()=>setHover(id)} onMouseLeave={()=>{setHover('');setPressed('');}} onMouseDown={()=>setPressed(id)} onMouseUp={()=>setPressed('')} onFocus={()=>setHover(id)} onBlur={()=>{setHover('');setPressed('');}}
   style={{position:'relative',display:'grid',placeItems:'center',padding:0,border:0,borderRadius:0,font:'inherit',color:'inherit',flexShrink:0,...style,background:uiSkinAsset(skin,buttonState)?'transparent':fallback}}>
   <UiSkinImage skin={skin} state={buttonState} assetUrl={assetUrl} scale={scale}/>{!skin?.hideText&&(content??<span style={{position:'relative'}}>{label}</span>)}
  </Button>;
 };
 const {cellW,cellH,favorite,caption,navigation}=geometry;
 return <div className={'ui-voice-collection-preview'+(interaction?' interactive':'')} style={{position:'relative',width:'100%',height:'100%',overflow:'hidden'}}>
  {geometry.controlsH>0&&<div style={{display:'flex',justifyContent:'flex-end',gap:20*scale,height:geometry.controlsH*scale,fontSize:Math.min(component.style?.fontSize??project.ui.fontSize,24)*scale}}>
   {drawButton('filter',view.favoritesOnly?'仅收藏':'全部语音',{...component.skin,hideText:false},{width:geometry.controlsW*scale,height:'100%'},{action:'filter'})}
   {drawButton('stop','停止试听',{...component.skin,hideText:false},{width:geometry.controlsW*scale,height:'100%'},{action:'stop'})}
  </div>}
  <div data-voice-viewport style={{position:'absolute',top:geometry.top*scale,left:0,width:'100%',height:geometry.viewH*scale,overflowY:geometry.rows?'hidden':'auto'}}>
   <div style={{display:'grid',gridTemplateColumns:`repeat(${geometry.columns}, ${cellW*scale}px)`,gridAutoRows:cellH*scale,columnGap:geometry.gapX*scale,rowGap:geometry.gapY*scale}}>
    {view.entries.map(entry=>{
     const locked=!entry.unlocked||state==='disabled',raw=locked?'未解锁':custom&&list?.voiceCaptionMode==='text'?entry.text:entry.caption;
     const removing=removingVoiceFavorite(component,view.favoritesOnly);
     return <div key={entry.id} data-voice-entry={entry.id} style={{position:'relative',width:cellW*scale,height:cellH*scale}}>
      {drawButton('play:'+entry.id,(locked?'未解锁语音 ':'播放语音 ')+entry.text,component.skin,{position:'absolute',inset:0,width:(custom?cellW:cellW-favorite.width-8)*scale,height:cellH*scale},{action:'play',assetId:entry.id},locked,interaction?.playingId===entry.id,
       <span style={{...(custom?box(caption):{position:'absolute',inset:8*scale}),display:'flex',alignItems:'center',overflow:'hidden',textAlign:custom?'left':'center',justifyContent:custom?'flex-start':'center'}}><span data-voice-caption style={{width:'100%',overflow:'hidden',textOverflow:list?.voiceSingleLine?'ellipsis':undefined,whiteSpace:list?.voiceSingleLine?'nowrap':'pre-wrap',overflowWrap:'anywhere'}}>{list?.voiceSingleLine?raw.replace(/\s+/g,' ').trim():raw}</span></span>)}
      {drawButton('favorite:'+entry.id,(entry.favorite?'取消收藏 ':'收藏 ')+entry.text,list?.voiceFavoriteSkin,{...box(favorite),background:'transparent',fontSize:Math.min(component.style?.fontSize??project.ui.fontSize,18)*scale},{action:'favorite',assetId:entry.id},removing?!entry.favorite:locked,!removing&&entry.favorite,<span style={{position:'relative'}}>{entry.favorite?'取消收藏':'收藏'}</span>)}
     </div>;
    })}
   </div>
   {!view.total&&<span>{view.favoritesOnly?'尚未收藏语音，可在对话历史中点击收藏':'暂无语音'}</span>}
  </div>
  {!!geometry.rows&&<div data-voice-pagination style={{...box(navigation),display:'flex',alignItems:'center',justifyContent:list?.navigationRect?'flex-start':'center',gap:(list?.navigationRect?8:12)*scale,fontSize:(list?.navigationRect?component.style?.fontSize??project.ui.fontSize:Math.min(component.style?.fontSize??project.ui.fontSize,22))*scale}}>
   {list?.navigationRect?Array.from({length:view.pages},(_,page)=>drawButton('page:'+page,`语音第 ${page+1} 页`,list.pageSkin,{width:Math.min(64,Math.max(20,Math.floor(navigation.width/view.pages)-8))*scale,height:'100%',background:'transparent',color:page===view.page?list.pageSelectedTextColor??list.pageTextColor:list.pageTextColor},{action:'page',page},false,page===view.page,<span aria-current={page===view.page?'page':undefined} style={{position:'relative'}}>{page+1}</span>)):<>
    {drawButton('previous','上一页',undefined,{background:'transparent',height:'100%'},{action:'page',page:view.page-1},view.page===0)}
    <span aria-label="语音页码">{view.page+1} / {view.pages}</span>
    {drawButton('next','下一页',undefined,{background:'transparent',height:'100%'},{action:'page',page:view.page+1},view.page===view.pages-1)}
   </>}
  </div>}
 </div>;
}
