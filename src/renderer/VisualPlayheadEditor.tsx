import type { VisualObject } from '../core/model';
import { visualCurve, visualCurveFields, visualDissolve, visualPose, type VisualCurveProperty } from '../core/visual-object';
import { NumberField } from './Inspector';

export function VisualPlayheadEditor({ object, time, onChange }: { object: VisualObject; time: number; onChange: (patch: Partial<Record<VisualCurveProperty, number>>) => void }) {
  const pose = visualPose(object, time);
  return <details open className="ui-property-group"><summary>当前播放时刻属性</summary>
    <p className="muted">对象内 {time.toFixed(2)} 秒；修改会添加或更新此时刻的属性帧，保留原有起止帧。</p>
    {(Object.keys(visualCurveFields) as VisualCurveProperty[]).filter(key => object.content === 'image' || !key.startsWith('ripple')).map(key => {
      const [label, multiplier] = visualCurveFields[key];
      const value = key === 'dissolveStrength' ? visualDissolve(object, time) : key === 'rippleStrength' || key === 'rippleSpeed' ? visualCurve(object, key, time, key === 'rippleStrength' ? object.ripple?.strength ?? .01 : object.ripple?.speed ?? 1) : pose[key] ?? 1;
      return <NumberField key={key} label={`当前${label}`} value={Number((value * multiplier).toFixed(3))} step={key === 'rippleStrength' ? .001 : 1} onChange={value => onChange({ [key]: value / multiplier })} />;
    })}
  </details>;
}
