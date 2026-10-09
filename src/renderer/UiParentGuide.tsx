import type { CSSProperties } from 'react';
import type { UiComponent } from '../core/model';
import type { UiHierarchyRow } from '../core/ui-hierarchy';
import { componentName } from './UiNames';

export interface UiParentDrop { sourceId: string; parentId?: string }

const rectangle = (c: UiComponent): CSSProperties => ({ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.width * 100}%`, height: `${c.height * 100}%` });

/** Guides live above all artwork, including opaque children and locked parents. */
export function UiParentGuide({ rows, selectedId, drop, width, height }: {
  rows: UiHierarchyRow[]; selectedId?: string; drop?: UiParentDrop; width: number; height: number;
}) {
  const child = rows.find(row => row.component.id === (drop?.sourceId ?? selectedId) && row.visible)?.component;
  const parentId = drop ? drop.parentId : child?.parentId;
  const parent = rows.find(row => row.component.id === parentId && row.visible)?.component;
  if (!child || !parent && !drop) return null;
  return <div className={`ui-parent-guide${drop ? ' is-dropping' : ''}`} data-parent-id={parentId} aria-hidden="true">
    {parent && <>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"><line x1={(child.x + child.width / 2) * width} y1={(child.y + child.height / 2) * height} x2={(parent.x + parent.width / 2) * width} y2={(parent.y + parent.height / 2) * height} vectorEffect="non-scaling-stroke" /></svg>
      <div className={`ui-parent-guide-parent${parent.y > .06 ? ' label-above' : ''}`} style={rectangle(parent)}><span>{drop ? '放入' : '父对象'} · {componentName(parent)}</span></div>
    </>}
    {drop && <div className="ui-parent-guide-child" style={rectangle(child)}><span>{parent ? '成为子对象' : '移到页面根级'} · 保留位置</span></div>}
  </div>;
}
