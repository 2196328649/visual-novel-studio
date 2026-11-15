import { useEffect, type RefObject } from 'react';
import { uiGeometryContains, type UiPoint } from '../core/ui-layout';
import type { previewUiLogic, UiPreviewEvent } from '../core/ui-logic-preview';

export function uiPointerInPlane(element: Element, clientX: number, clientY: number, width: number): UiPoint | undefined {
  const plane=element.closest<HTMLElement>('[data-ui-layout-plane]'),bounds=plane?.getBoundingClientRect();
  if(!plane||!bounds?.width)return;
  // A scrolled native page nests its plane inside the frame; its scrollbar narrows
  // that plane, so the scale comes from the outermost (full-width) plane.
  let frame=plane;for(let parent=plane.parentElement?.closest<HTMLElement>('[data-ui-layout-plane]');parent;parent=parent.parentElement?.closest<HTMLElement>('[data-ui-layout-plane]'))frame=parent;
  const scale=(frame===plane?bounds:frame.getBoundingClientRect()).width/width;
  if(!scale)return;
  return {x:(clientX-bounds.left)/scale,y:(clientY-bounds.top)/scale};
}
/** Wheel events follow authored ancestry even though the preview paints a flat DOM. */
export function useUiLayoutWheel(frame: RefObject<HTMLDivElement|null>, preview: ReturnType<typeof previewUiLogic>, width: number, onEvent:(event:UiPreviewEvent)=>void, disabled: boolean) {
  useEffect(()=>{
    const element=frame.current;if(!element||disabled)return;
    const wheel=(event:WheelEvent)=>{
      if(event.defaultPrevented||event.ctrlKey||event.metaKey||!(event.target instanceof Element))return;
      const layerElement=event.target.closest<HTMLElement>('[data-preview-instance]');
      // Passive text/panels paint through their layer. A wheel over them lands
      // on the layout plane, but still belongs to the top interactive page.
      const layer=layerElement
        ? preview.layers.find(layer=>layer.instance===Number(layerElement.dataset.previewInstance)&&!layer.hidden&&layer.interactive)
        : [...preview.layers].reverse().find(layer=>!layer.hidden&&layer.interactive);
      if(!layer)return;
      const instance=layer.instance;
      const target=event.target.closest<HTMLElement>('[data-preview-component]'),point=uiPointerInPlane(event.target,event.clientX,event.clientY,width);
      if(!point)return;
      let dx=Math.sign(event.deltaX)*40,dy=Math.sign(event.deltaY)*40;
      if(event.shiftKey){dx=dx||dy;dy=0;}
      // Native content widgets and form controls get first refusal. At a real
      // scroll boundary their authored container can take over instead.
      for(let current:Element|null=event.target;current&&current!==target&&current!==element;current=current.parentElement){
        const style=getComputedStyle(current);
        if(/auto|scroll/.test(style.overflowY)&&current.scrollHeight>current.clientHeight&&((dy<0&&current.scrollTop>0)||(dy>0&&current.scrollTop+current.clientHeight<current.scrollHeight-1)))return;
        if(/auto|scroll/.test(style.overflowX)&&current.scrollWidth>current.clientWidth&&((dx<0&&current.scrollLeft>0)||(dx>0&&current.scrollLeft+current.clientWidth<current.scrollWidth-1)))return;
      }
      const byId=new Map(layer.components.map(row=>[row.component.id,row]));
      let row=target?byId.get(target.dataset.previewComponent??''):[...layer.components].reverse().find(row=>row.visible&&row.geometry&&uiGeometryContains(row.geometry,point));
      const seen=new Set<string>();
      while(row&&!seen.has(row.component.id)){
        seen.add(row.component.id);
        const geometry=row.geometry,mode=row.component.layout?.scroll??'none';
        if(row.visible&&row.state!=='disabled'&&geometry&&uiGeometryContains(geometry,point)){
          const x=mode==='horizontal'?(dx||dy):mode==='both'?dx:0,y=mode==='vertical'||mode==='both'?dy:0;
          const nextX=Math.max(geometry.scrollMinimumX,Math.min(geometry.scrollMaximumX,geometry.scrollX+x)),nextY=Math.max(geometry.scrollMinimumY,Math.min(geometry.scrollMaximumY,geometry.scrollY+y));
          if((x&&nextX!==geometry.scrollX)||(y&&nextY!==geometry.scrollY)){
            event.preventDefault();event.stopPropagation();onEvent({kind:'scroll',componentId:row.component.id,pageInstance:instance,dx:x,dy:y});return;
          }
        }
        row=row.component.parentId?byId.get(row.component.parentId):undefined;
      }
    };
    element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);
  },[frame,preview,width,onEvent,disabled]);
}
