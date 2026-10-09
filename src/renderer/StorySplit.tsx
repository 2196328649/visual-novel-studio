import { useRef, useState } from 'react';
const clamp=(value:number)=>Math.max(.25,Math.min(.75,Number.isFinite(value)?value:.51));
export function useStorySplit() {
 const root=useRef<HTMLDivElement>(null),drag=useRef<{x:number;ratio:number;width:number}|undefined>(undefined);
 const [ratio,setRatio]=useState(()=>{try{return clamp(Number(localStorage.getItem('vns:story-split')??.51));}catch{return .51;}});
 const update=(value:number)=>{const next=clamp(value);setRatio(next);try{localStorage.setItem('vns:story-split',String(next));}catch{/* Optional layout preference. */}};
 const divider=<div className="story-split-divider" role="separator" aria-label="调整文本与预览宽度" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(ratio*100)} tabIndex={0} title="拖动调整宽度；双击恢复默认"
  onDoubleClick={()=>update(.51)} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();update(ratio+(event.key==='ArrowLeft'?-.02:.02));}}}
  onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,ratio,width:root.current!.getBoundingClientRect().width-6};}}
  onPointerMove={event=>{const start=drag.current;if(start)update(start.ratio+(event.clientX-start.x)/Math.max(1,start.width));}}
  onPointerUp={()=>{drag.current=undefined;}} onPointerCancel={()=>{drag.current=undefined;}} onLostPointerCapture={()=>{drag.current=undefined;}}/>;
 return {root,style:{gridTemplateColumns:`minmax(0, ${ratio}fr) 6px minmax(0, ${1-ratio}fr)`},divider};
}
