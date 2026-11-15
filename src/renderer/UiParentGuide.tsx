import type { CSSProperties } from 'react';
import type { UiHierarchyRow } from '../core/ui-hierarchy';
import { uiTransformPoint, uiRectPolygon } from '../core/ui-layout';
import { componentName } from './UiNames';

export interface UiParentDrop { sourceId: string; parentId?: string }
/** Guides use transformed corners, not an axis-aligned approximation of the authored rect. */
export function UiParentGuide({ rows, selectedId, drop, width, height }: {
  rows: UiHierarchyRow[]; selectedId?: string; drop?: UiParentDrop; width: number; height: number;
}) {
  const child=rows.find(row=>row.component.id===(drop?.sourceId??selectedId)&&row.visible);
  const parentId=drop?drop.parentId:child?.component.parentId,parent=rows.find(row=>row.component.id===parentId&&row.visible);
  if(!child||!parent&&!drop)return null;
  const points=(row:UiHierarchyRow)=>row.geometry?uiRectPolygon({x:0,y:0,width:row.geometry.width,height:row.geometry.height}).map(p=>uiTransformPoint(row.geometry!.renderMatrix,p)):uiRectPolygon({x:row.component.x*width,y:row.component.y*height,width:row.component.width*width,height:row.component.height*height});
  const center=(row:UiHierarchyRow)=>{const p=points(row);return {x:(p[0].x+p[2].x)/2,y:(p[0].y+p[2].y)/2};};
  const label=(row:UiHierarchyRow):CSSProperties=>{const p=points(row);return {left:Math.min(...p.map(p=>p.x))/width*100+'%',top:Math.min(...p.map(p=>p.y))/height*100+'%',width:0,height:0,border:0};};
  return <div className={'ui-parent-guide'+(drop?' is-dropping':'')} data-parent-id={parentId} aria-hidden="true">
    <svg viewBox={'0 0 '+width+' '+height} preserveAspectRatio="none">
      {parent&&<><line x1={center(child).x} y1={center(child).y} x2={center(parent).x} y2={center(parent).y} vectorEffect="non-scaling-stroke"/><polygon points={points(parent).map(p=>p.x+','+p.y).join(' ')} fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke"/></>}
      {drop&&<polygon points={points(child).map(p=>p.x+','+p.y).join(' ')} fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke"/>}
    </svg>
    {parent&&<div className="ui-parent-guide-parent label-above" style={label(parent)}><span>{drop?'放入':'父对象'} · {componentName(parent.component)}</span></div>}
    {drop&&<div className="ui-parent-guide-child" style={label(child)}><span>{parent?'成为子对象':'移到页面根级'} · 保留位置</span></div>}
  </div>;
}
