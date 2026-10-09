import { editorLayoutEvent, readBlueprintLayout } from '../core/editor-layout';
import { useEffect, useRef, useState, type DragEvent } from 'react';
const defaults={palette:194,properties:280};
const key='vns-blueprint-panel-widths-v1';
export function useBlueprintPanelLayout(paletteOpen:boolean,propertiesOpen:boolean){
 const [widths,setWidths]=useState(()=>{const {palette,properties}=readBlueprintLayout(localStorage);return {palette,properties};});
 const [reversed,setReversed]=useState(()=>readBlueprintLayout(localStorage).reversed);
 useEffect(()=>{try{localStorage.setItem(key+':reversed',String(reversed));}catch{}},[reversed]);
 useEffect(()=>{const refresh=(event:Event)=>{if((event as CustomEvent<string>).detail!==key)return;const {palette,properties,reversed}=readBlueprintLayout(localStorage);setWidths({palette,properties});setReversed(reversed);};window.addEventListener(editorLayoutEvent,refresh);return()=>window.removeEventListener(editorLayoutEvent,refresh);},[]);
 const handle=(side:'palette'|'properties')=>({draggable:true,title:'拖到另一侧面板标题交换位置',onDragStart:(event:DragEvent)=>{event.stopPropagation();event.dataTransfer.setData('application/vns-blueprint-panel',side);event.dataTransfer.effectAllowed='move';},onDragOver:(event:DragEvent)=>{if(event.dataTransfer.types.includes('application/vns-blueprint-panel')){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';}},onDrop:(event:DragEvent)=>{const from=event.dataTransfer.getData('application/vns-blueprint-panel');if((from==='palette'||from==='properties')&&from!==side){event.preventDefault();event.stopPropagation();setReversed(value=>!value);}}});
 const root=useRef<HTMLDivElement>(null),drag=useRef<{side:'palette'|'properties';x:number;width:number}|undefined>(undefined);
 useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(widths));}catch{}},[widths]);
 const set=(side:'palette'|'properties',value:number)=>setWidths(current=>({...current,[side]:Math.max(side==='palette'?140:180,Math.min(side==='palette'?500:600,value))}));
 const divider=(side:'palette'|'properties')=><div className={"blueprint-panel-divider divider-"+side} role="separator" tabIndex={0} aria-label={side==='palette'?'调整节点库宽度':'调整蓝图属性宽度'} aria-orientation="vertical" aria-valuenow={widths[side]} aria-valuemin={side==='palette'?140:180} aria-valuemax={side==='palette'?500:600}
 onDoubleClick={()=>set(side,defaults[side])} onKeyDown={event=>{const delta=event.key==='ArrowRight'?10:event.key==='ArrowLeft'?-10:0;if(delta||event.key==='Home'){event.preventDefault();set(side,event.key==='Home'?defaults[side]:widths[side]+delta*(side==='palette'?1:-1)*(reversed?-1:1));}}}
 onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={side,x:event.clientX,width:widths[side]};}}
 onPointerMove={event=>{const start=drag.current;if(start?.side===side)set(side,start.width+(event.clientX-start.x)*(side==='palette'?1:-1)*(reversed?-1:1));}}
 onPointerUp={event=>{drag.current=undefined;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={()=>{drag.current=undefined;}} onLostPointerCapture={()=>{drag.current=undefined;}}/>;
 return {root,reversed,handle,style:{gridTemplateColumns:[...(paletteOpen?[`minmax(100px, min(28%, ${widths.palette}px))`,'6px']:[]),'minmax(160px, 1fr)',...(propertiesOpen?['6px',`minmax(140px, min(36%, ${widths.properties}px))`]:[])].map((_,index,array)=>array[reversed?array.length-1-index:index]).join(' ')},divider};
}
