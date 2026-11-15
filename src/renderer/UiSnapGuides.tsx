import type { UiSnapGuide } from '../core/ui-snap';
import type { UiComponent } from '../core/model';
import { componentName } from './UiNames';

export function UiSnapGuides({ guides, components, width, height, scale }: { guides: readonly UiSnapGuide[]; components: readonly UiComponent[]; width: number; height: number; scale: number }) {
  if (!guides.length) return null;
  const labels = guides.map(guide => ({ left: Math.max(4, Math.min((guide.axis === 'x' ? guide.position : guide.start) * scale + 6, width * scale - 184)), top: Math.max(4, Math.min((guide.axis === 'x' ? guide.start : guide.position) * scale + 6, height * scale - 24)) }));
  if (labels.length === 2 && Math.abs(labels[0].left - labels[1].left) < 184 && Math.abs(labels[0].top - labels[1].top) < 24) labels[1].top = labels[0].top + 48 < height * scale ? labels[0].top + 24 : Math.max(4, labels[0].top - 24);
  return <div className="ui-snap-guides" aria-hidden="true"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
    {guides.map(guide => {
      const points = guide.axis === 'x' ? { x1: guide.position, x2: guide.position, y1: guide.start, y2: guide.end } : { x1: guide.start, x2: guide.end, y1: guide.position, y2: guide.position };
      return <g key={guide.axis} data-snap-axis={guide.axis} data-snap-position={guide.position} data-snap-target={guide.targetId ?? 'canvas'}>
        <line {...points} className="ui-snap-guide-shadow" vectorEffect="non-scaling-stroke" />
        <line {...points} vectorEffect="non-scaling-stroke" />
      </g>;
    })}
  </svg>{guides.map((guide, index) => {
    const target = components.find(component => component.id === guide.targetId);
    const edge = guide.edge === 'center' ? guide.axis === 'x' ? '水平中心' : '垂直中心' : guide.axis === 'x' ? guide.edge === 'start' ? '左边' : '右边' : guide.edge === 'start' ? '上边' : '下边';
    return <span key={guide.axis} className="ui-snap-label" style={labels[index]}>{target ? componentName(target) : '游戏画面'} · {edge}</span>;
  })}</div>;
}
