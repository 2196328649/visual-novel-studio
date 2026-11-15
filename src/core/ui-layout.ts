import type { UiComponent, UiLayout, VariableValue } from './model';

export interface UiPoint { x: number; y: number }
export interface UiPixelRect extends UiPoint { width: number; height: number }
/** CSS/Canvas convention: x' = ax + cy + e, y' = bx + dy + f. */
export type UiMatrix = readonly [number, number, number, number, number, number];
export const uiIdentity: UiMatrix = [1, 0, 0, 1, 0, 0];
export const uiLayoutViewport = { width: 1920, height: 1080 };
export const uiLayoutPropertyFields = {
  anchorX: 'anchorX', anchorY: 'anchorY', pivotX: 'pivotX', pivotY: 'pivotY',
  layoutRotation: 'rotation', scaleX: 'scaleX', scaleY: 'scaleY', layoutFlow: 'flow', layoutOrder: 'order',
  childGap: 'gap', paddingLeft: 'paddingLeft', paddingTop: 'paddingTop', paddingRight: 'paddingRight', paddingBottom: 'paddingBottom',
  clipChildren: 'clip', scrollMode: 'scroll', scrollX: 'scrollX', scrollY: 'scrollY',
} as const;
export const uiLayoutDefaults = {
  anchorX: 0, anchorY: 0, pivotX: 0, pivotY: 0, rotation: 0, scaleX: 1, scaleY: 1,
  flow: 'absolute', order: 0, gap: 0, paddingLeft: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0,
  clip: false, scroll: 'none', scrollX: 0, scrollY: 0,
} as const;
export const uiLayoutObservationProperties = ['screenX', 'screenY', 'screenWidth', 'screenHeight', 'scrollX', 'scrollY', 'scrollMinimumX', 'scrollMinimumY', 'scrollMaximumX', 'scrollMaximumY', 'contentWidth', 'contentHeight'] as const;
export const isUiLayoutObservation = (property: string): boolean => (uiLayoutObservationProperties as readonly string[]).includes(property);
export function uiLayoutProblem(component: UiComponent): string | undefined {
  if (component.layout && component.layout.version !== 1) return '控件布局版本暂不支持；原始数据已保留，请明确恢复后再编辑布局。';
}
export function uiLayoutValues(component: UiComponent) {
  const layout = uiLayoutProblem(component) ? undefined : component.layout;
  return Object.fromEntries(Object.entries(uiLayoutDefaults).map(([key, value]) => [key, layout?.[key] ?? value])) as { [K in keyof typeof uiLayoutDefaults]: NonNullable<UiLayout[K]> };
}
export function recoverUiLayout(component: UiComponent): UiLayout {
  return { version: 1, recovery: JSON.stringify(component.layout ?? {}) };
}
export const uiMultiply = (a: UiMatrix, b: UiMatrix): UiMatrix => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
export const uiTranslate = (x: number, y: number): UiMatrix => [1, 0, 0, 1, x, y];
export function uiInverse(m: UiMatrix): UiMatrix | undefined {
  const d = m[0]*m[3]-m[1]*m[2];
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return;
  return [m[3]/d, -m[1]/d, -m[2]/d, m[0]/d, (m[2]*m[5]-m[3]*m[4])/d, (m[1]*m[4]-m[0]*m[5])/d];
}
export const uiTransformPoint = (m: UiMatrix, p: UiPoint): UiPoint => ({ x: m[0]*p.x+m[2]*p.y+m[4], y: m[1]*p.x+m[3]*p.y+m[5] });
export const uiTransformVector = (m: UiMatrix, p: UiPoint): UiPoint => ({ x: m[0]*p.x+m[2]*p.y, y: m[1]*p.x+m[3]*p.y });
export const uiRectPolygon = (r: UiPixelRect): UiPoint[] => [{x:r.x,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.height},{x:r.x,y:r.y+r.height}];
export function uiPolygonBounds(points: readonly UiPoint[]): UiPixelRect {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...points.map(p=>p.x)), y = Math.min(...points.map(p=>p.y));
  return { x, y, width: Math.max(...points.map(p=>p.x))-x, height: Math.max(...points.map(p=>p.y))-y };
}
const transformedBounds = (m: UiMatrix, r: UiPixelRect) => uiPolygonBounds(uiRectPolygon(r).map(p=>uiTransformPoint(m,p)));
const union = (a: UiPixelRect, b: UiPixelRect): UiPixelRect => { const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return {x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y}; };
const intersection = (a: UiPixelRect, b: UiPixelRect): UiPixelRect => { const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);return {x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)}; };
const cross = (a: UiPoint,b: UiPoint,c: UiPoint) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const area = (p: readonly UiPoint[]) => p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-a.y*b.x;},0)/2;
/** Convex clipping works for nested rotated and mirrored containers too. */
export function uiClipPolygon(subject: readonly UiPoint[], clip: readonly UiPoint[]): UiPoint[] {
  let result = [...subject];
  if (clip.length < 3 || Math.abs(area(clip)) < 1e-10) return [];
  const direction = area(clip) >= 0 ? 1 : -1;
  for (let i=0;i<clip.length&&result.length;i++) {
    const a=clip[i],b=clip[(i+1)%clip.length],input=result;result=[];
    let previous=input.at(-1)!,dp=direction*cross(a,b,previous);
    for (const current of input) {
      const dc=direction*cross(a,b,current);
      if ((dc>=-1e-8)!==(dp>=-1e-8)) { const t=dp/(dp-dc);result.push({x:previous.x+t*(current.x-previous.x),y:previous.y+t*(current.y-previous.y)}); }
      if(dc>=-1e-8)result.push(current);
      previous=current;dp=dc;
    }
  }
  return result;
}
export function uiPointInPolygon(point: UiPoint, polygon: readonly UiPoint[]): boolean {
  if (polygon.length < 3 || Math.abs(area(polygon)) < 1e-10) return false;
  const direction=area(polygon)>=0?1:-1;
  return polygon.every((a,i)=>direction*cross(a,polygon[(i+1)%polygon.length],point)>=-1e-8);
}

export interface UiLayoutGeometry {
  width: number; height: number; matrix: UiMatrix; renderMatrix: UiMatrix; inverse?: UiMatrix;
  bounds: UiPixelRect; content: UiPixelRect; overflow: UiPixelRect;
  basis: UiPixelRect; basisMatrix: UiMatrix; parentMatrix: UiMatrix; slot: UiPoint;
  localMatrix: UiMatrix; localRenderMatrix: UiMatrix;
  clipPolygons: UiPoint[][]; visiblePolygon: UiPoint[]; clippedOut: boolean;
  scrollX: number; scrollY: number; scrollMinimumX: number; scrollMinimumY: number; scrollMaximumX: number; scrollMaximumY: number;
  contentWidth: number; contentHeight: number; legacy: boolean; visible: boolean;
}
interface Frame {
  component: UiComponent; layout: ReturnType<typeof uiLayoutValues>; width: number; height: number; visible: boolean;
  content: UiPixelRect; basis: UiPixelRect; slot: UiPoint; local: UiMatrix; overflow: UiPixelRect; children: Frame[];
  scrollX: number; scrollY: number; minX: number; minY: number; maxX: number; maxY: number; legacy: boolean;
}
const clamp = (v: number, a: number, b: number) => Math.max(a,Math.min(b,v));
const isIdentityLayout = (layout: ReturnType<typeof uiLayoutValues>) => Object.entries(uiLayoutDefaults).every(([k,v])=>k==='order'||layout[k as keyof typeof layout]===v);
export function uiContentRect(width: number, height: number, layout: ReturnType<typeof uiLayoutValues>): UiPixelRect {
  const sx = Math.min(1,width/(layout.paddingLeft+layout.paddingRight||1)), sy = Math.min(1,height/(layout.paddingTop+layout.paddingBottom||1));
  return {x:layout.paddingLeft*sx,y:layout.paddingTop*sy,width:Math.max(0,width-(layout.paddingLeft+layout.paddingRight)*sx),height:Math.max(0,height-(layout.paddingTop+layout.paddingBottom)*sy)};
}
/** Two passes: measure in local space, then place/clip in world pixels. No project mutation. */
export function resolveUiLayout(components: readonly UiComponent[], viewport = uiLayoutViewport, visible: (c: UiComponent)=>boolean = ()=>true): Map<string,UiLayoutGeometry> {
  const ids=new Set(components.map(c=>c.id)), children=new Map<string|undefined,UiComponent[]>(), ranks=new Map(components.map((c,i)=>[c.id,i]));
  for(const c of components){const key=c.parentId&&ids.has(c.parentId)?c.parentId:undefined;const group=children.get(key);if(group)group.push(c);else children.set(key,[c]);}
  // Equal explicit/default orders retain declaration order, never paint/list order.
  for(const group of children.values())group.sort((a,b)=>(uiLayoutProblem(a)?0:a.layout?.order??0)-(uiLayoutProblem(b)?0:b.layout?.order??0)||ranks.get(a.id)!-ranks.get(b.id)!);
  const make=(c:UiComponent,basis:UiPixelRect,slot:UiPoint,parentVisible:boolean,legacy:boolean,seen:Set<string>):Frame|undefined=>{
    if(seen.has(c.id)||seen.size>=32)return;
    const layout=uiLayoutValues(c),width=Math.max(0,c.width*basis.width),height=Math.max(0,c.height*basis.height),ownVisible=parentVisible&&visible(c);
    const angle=layout.rotation*Math.PI/180,co=Math.cos(angle),si=Math.sin(angle),a=co*layout.scaleX,b=si*layout.scaleX,cc=-si*layout.scaleY,d=co*layout.scaleY;
    const x=basis.x+(c.x+layout.anchorX)*basis.width+slot.x,y=basis.y+(c.y+layout.anchorY)*basis.height+slot.y;
    const local:UiMatrix=[a,b,cc,d,x-a*layout.pivotX*width-cc*layout.pivotY*height,y-b*layout.pivotX*width-d*layout.pivotY*height];
    const content=uiContentRect(width,height,layout),outer={x:0,y:0,width,height};
    const frame:Frame={component:c,layout,width,height,visible:ownVisible,content,basis,slot,local,overflow:outer,children:[],scrollX:0,scrollY:0,minX:0,minY:0,maxX:0,maxY:0,legacy:legacy&&isIdentityLayout(layout)};
    let cursor=0,extent={...content};
    for(const child of children.get(c.id)??[]){
      const background=child.childLayer==='background',childSlot={x:!background&&layout.flow==='horizontal'?cursor:0,y:!background&&layout.flow==='vertical'?cursor:0};
      const nested=make(child,background?outer:content,childSlot,ownVisible,frame.legacy,new Set(seen).add(c.id));
      if(!nested)continue;
      frame.children.push(nested);
      if(nested.visible&&!background){if(layout.flow!=='absolute')cursor+=(layout.flow==='horizontal'?nested.width:nested.height)+layout.gap;extent=union(extent,transformedBounds(nested.local,nested.overflow));}
    }
    frame.minX=Math.min(0,extent.x-content.x);frame.minY=Math.min(0,extent.y-content.y);
    frame.maxX=Math.max(0,extent.x+extent.width-content.x-content.width);frame.maxY=Math.max(0,extent.y+extent.height-content.y-content.height);
    const scrollH=layout.scroll==='horizontal'||layout.scroll==='both',scrollV=layout.scroll==='vertical'||layout.scroll==='both';
    frame.scrollX=scrollH?clamp(layout.scrollX,frame.minX,frame.maxX):0;frame.scrollY=scrollV?clamp(layout.scrollY,frame.minY,frame.maxY):0;
    for(const child of frame.children){
      const background=child.component.childLayer==='background';
      if(!background)child.local=uiMultiply(uiTranslate(-frame.scrollX,-frame.scrollY),child.local);
      if(!child.visible)continue;
      let overflow=transformedBounds(child.local,child.overflow);
      if(layout.clip||layout.scroll!=='none')overflow=intersection(overflow,background?outer:content);
      if(overflow.width>0&&overflow.height>0)frame.overflow=union(frame.overflow,overflow);
    }
    return frame;
  };
  const result=new Map<string,UiLayoutGeometry>();
  const place=(frame:Frame,parentMatrix:UiMatrix,parentRenderMatrix:UiMatrix,clips:UiPoint[][],parent?:Frame)=>{
    const matrix=uiMultiply(parentMatrix,frame.local),renderMatrix:UiMatrix=frame.legacy?[1,0,0,1,Math.floor(matrix[4]+.5),Math.floor(matrix[5]+.5)]:matrix;
    const inverse=uiInverse(renderMatrix),background=frame.component.childLayer==='background';
    const scroll=parent&&!background?{x:parent.scrollX,y:parent.scrollY}:{x:0,y:0};
    const basisMatrix=uiMultiply(parentMatrix,uiTranslate(frame.basis.x-scroll.x,frame.basis.y-scroll.y));
    const localRenderMatrix=uiMultiply(uiInverse(parentRenderMatrix)??uiIdentity,renderMatrix);
    const localRect={x:0,y:0,width:frame.width,height:frame.height},polygon=uiRectPolygon(localRect).map(p=>uiTransformPoint(renderMatrix,p));
    const visiblePolygon=clips.reduce((points,clip)=>uiClipPolygon(points,clip),polygon);
    const geometry:UiLayoutGeometry={width:frame.width,height:frame.height,matrix,renderMatrix,inverse,bounds:transformedBounds(matrix,localRect),content:frame.content,overflow:frame.overflow,
      basis:frame.basis,basisMatrix,parentMatrix,slot:frame.slot,localMatrix:frame.local,localRenderMatrix,clipPolygons:clips,visiblePolygon,clippedOut:!inverse||Math.abs(area(visiblePolygon))<1e-8,
      scrollX:frame.scrollX,scrollY:frame.scrollY,scrollMinimumX:frame.minX,scrollMinimumY:frame.minY,scrollMaximumX:frame.maxX,scrollMaximumY:frame.maxY,
      contentWidth:frame.content.width+frame.maxX-frame.minX,contentHeight:frame.content.height+frame.maxY-frame.minY,legacy:frame.legacy,visible:frame.visible};
    result.set(frame.component.id,geometry);
    for(const child of frame.children){
      const rect=child.component.childLayer==='background'?localRect:frame.content;
      const nextClips=frame.layout.clip||frame.layout.scroll!=='none'?[...clips,uiRectPolygon(rect).map(p=>uiTransformPoint(renderMatrix,p))]:clips;
      place(child,matrix,renderMatrix,nextClips,frame);
    }
  };
  for(const c of children.get(undefined)??[]){const frame=make(c,{x:0,y:0,width:viewport.width,height:viewport.height},{x:0,y:0},true,true,new Set());if(frame)place(frame,uiIdentity,uiIdentity,[]);}
  return result;
}
export function uiLayoutObservation(geometry: UiLayoutGeometry, property: string): VariableValue | undefined {
  const fields: Record<string,keyof UiPixelRect> = {screenX:'x',screenY:'y',screenWidth:'width',screenHeight:'height'}, field=fields[property];
  if(field)return geometry.bounds[field as keyof UiPixelRect];
  if((uiLayoutObservationProperties as readonly string[]).includes(property))return geometry[property as 'scrollX'];
}
export function uiGeometryContains(geometry: UiLayoutGeometry, point: UiPoint): boolean {
  if(!geometry.visible||geometry.clippedOut||!geometry.inverse)return false;
  const p=uiTransformPoint(geometry.inverse,point);
  return p.x>=0&&p.y>=0&&p.x<geometry.width&&p.y<geometry.height&&geometry.clipPolygons.every(poly=>uiPointInPolygon(point,poly));
}
export function uiLayoutLocalDelta(geometry:UiLayoutGeometry,delta:UiPoint,own=false):UiPoint|undefined{
  const inverse=uiInverse(own?geometry.matrix:geometry.parentMatrix);return inverse&&uiTransformVector(inverse,delta);
}
/** Reparenting cannot invent an unexposed shear. Refuse instead of silently changing the drawing. */
export function uiDecomposeLinear(m:UiMatrix):{rotation:number;scaleX:number;scaleY:number}|undefined{
  const sx=Math.hypot(m[0],m[1]),sy=(m[0]*m[3]-m[1]*m[2])/sx;
  if(!Number.isFinite(sy)||sx<1e-9||Math.abs(sy)<1e-9||sx>16||Math.abs(sy)>16||Math.abs(m[0]*m[2]+m[1]*m[3])>1e-8*Math.max(1,sx*Math.abs(sy)))return;
  return {rotation:Math.atan2(m[1],m[0])*180/Math.PI,scaleX:sx,scaleY:sy};
}
