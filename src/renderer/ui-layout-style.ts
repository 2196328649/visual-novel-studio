import type { CSSProperties } from 'react';
import { uiTransformPoint, type UiLayoutGeometry } from '../core/ui-layout';

/** Flat DOM painting still uses the full world transform and all ancestor clips. */
export function uiLayoutStyle(geometry: UiLayoutGeometry | undefined, scale: number, clipped = true): CSSProperties {
  if (!geometry) return {};
  const m=geometry.renderMatrix;
  const style: CSSProperties={left:0,top:0,transformOrigin:'0 0',transform:'matrix('+[m[0],m[1],m[2],m[3],m[4]*scale,m[5]*scale].join(',')+')'};
  if(clipped && geometry.clippedOut) return {...style,visibility:'hidden',pointerEvents:'none'};
  if(clipped && geometry.clipPolygons.length && geometry.inverse) {
    const points=geometry.visiblePolygon.map(p=>uiTransformPoint(geometry.inverse!,p));
    style.clipPath='polygon('+points.map(p=>p.x*scale+'px '+p.y*scale+'px').join(',')+')';
  }
  return style;
}
