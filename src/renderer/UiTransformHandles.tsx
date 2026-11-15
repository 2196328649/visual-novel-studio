import { uiTransformPoint, type UiLayoutGeometry } from '../core/ui-layout';
import { uiLayoutStyle } from './ui-layout-style';
import type { UiComponent } from '../core/model';
import type { UiResizeHandle } from '../core/ui-transform';
import type { useUiComponentTransform } from './useUiComponentTransform';

const handles: [UiResizeHandle, string][] = [
  ['nw', '左上角'], ['n', '上边'], ['ne', '右上角'], ['e', '右边'],
  ['se', '右下角'], ['s', '下边'], ['sw', '左下角'], ['w', '左边'],
];

export function UiTransformHandles({ component, geometry, scale = 1, width, height, handlers }: {
  component: UiComponent; geometry?: UiLayoutGeometry; scale?: number; width: number; height: number;
  handlers: ReturnType<typeof useUiComponentTransform>['handlers'];
}) {
  const point = (handle: UiResizeHandle) => {
    const x = handle.includes('w') ? 0 : handle.includes('e') ? 1 : .5, y = handle.includes('n') ? 0 : handle.includes('s') ? 1 : .5;
    return geometry ? uiTransformPoint(geometry.renderMatrix, { x: x * geometry.width, y: y * geometry.height }) : { x: (component.x+x*component.width)*width, y: (component.y+y*component.height)*height };
  };
  return <div className="ui-transform-overlay" data-transform-id={component.id}>
    <div className="ui-transform-handles" style={{ left: `${component.x * 100}%`, top: `${component.y * 100}%`, width: `${component.width * 100}%`, height: `${component.height * 100}%`, ...uiLayoutStyle(geometry, scale, false) }}>
      {/* The object owns move gestures. A full-size input overlay would hide
          unselected children and prevent starting a marquee inside a panel. */}
      <span className={`ui-transform-size${component.y < .06 ? ' below' : ''}`} aria-hidden="true">{Math.round(component.width * width)} × {Math.round(component.height * height)}</span>
    </div>
      {handles.map(([handle, name]) => <button key={handle} type="button" className={`ui-resize-handle resize-${handle}`} data-resize-handle={handle}
        aria-label={`调整${name}大小`} title="拖动调整大小 · Shift 等比缩放 · Esc 取消"
        style={{ left: point(handle).x / width * 100 + '%', top: point(handle).y / height * 100 + '%' }}
        {...handlers(component.id, handle)} />)}
  </div>;
}
