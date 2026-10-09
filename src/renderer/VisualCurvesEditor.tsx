import type { VisualObject } from '../core/model';
import { visualCurveFields, visualDissolve, visualPose, type VisualCurveProperty } from '../core/visual-object';
import { NumberField } from './Inspector';
import { Field } from './components';
import { PropertyFrameTimeline } from './PropertyFrameTimeline';

export function VisualCurvesEditor({ object, onChange, onSeek, start = 0, properties }: { object: VisualObject; onChange: (object: VisualObject) => void; onSeek?: (time: number) => void; start?: number; properties?: readonly VisualCurveProperty[] }) {
  const setFrames = (key: VisualCurveProperty, frames: NonNullable<VisualObject['curves']>[VisualCurveProperty]) => {
    const curves = { ...object.curves };
    if (frames?.length) curves[key] = frames;
    else delete curves[key];
    onChange({ ...object, curves: Object.keys(curves).length ? curves : undefined });
  };
  const initialValue = (key: VisualCurveProperty) => key === 'dissolveStrength' ? visualDissolve(object, 0) : key === 'rippleStrength' ? object.ripple?.strength ?? .01 : key === 'rippleSpeed' ? object.ripple?.speed ?? 1 : visualPose(object, 0)[key] ?? 1;
  return <details className="ui-property-group"><summary>独立属性曲线</summary>
    <p className="muted">启用后覆盖该属性的对象关键帧。时间从对象开始计算，缓动控制到达此帧的过程。</p>
    {(properties ?? Object.keys(visualCurveFields) as VisualCurveProperty[]).filter(key => object.content === 'image' || !key.startsWith('ripple')).map(key => {
      const [label, multiplier] = visualCurveFields[key], frames = object.curves?.[key];
      return <section key={key} aria-label={`${label}曲线`}>
        <Field label={`${label}独立曲线`}><input type="checkbox" checked={!!frames?.length} onChange={event => setFrames(key, event.target.checked ? [{ at: 0, value: initialValue(key), easing: 'linear' }] : undefined)} /></Field>
        {frames?.length ? <PropertyFrameTimeline frames={frames} duration={object.duration} label={label} start={start} onSeek={onSeek} onChange={next => setFrames(key, next)} /> : null}
        {frames?.map((frame, index) => <div key={index} className="timeline-keyframe">
          <NumberField label={`${label}帧 ${index + 1} 时间 秒`} value={frame.at} min={0} step={.1} onChange={at => setFrames(key, frames.map((item, i) => i === index ? { ...item, at: Math.max(0, at) } : item))} />
          <NumberField label={`${label}帧 ${index + 1} 值`} value={frame.value * multiplier} step={key === 'rippleStrength' ? .001 : 1} onChange={value => setFrames(key, frames.map((item, i) => i === index ? { ...item, value: value / multiplier } : item))} />
          <Field label={`${label}帧 ${index + 1} 缓动`}><select value={frame.easing} onChange={event => setFrames(key, frames.map((item, i) => i === index ? { ...item, easing: event.target.value as typeof frame.easing } : item))}>
            <option value="linear">线性</option><option value="ease">缓入缓出</option><option value="easein">缓入</option><option value="easeout">缓出</option><option value="outquad">二次缓出</option>
          </select></Field>
          {onSeek && <button onClick={() => onSeek(start + frame.at)}>定位属性帧</button>}
          <button onClick={() => setFrames(key, frames.filter((_, i) => i !== index))}>删除属性帧</button>
          {frame.at > object.duration && <p className="muted">此帧超出对象持续时间，延长对象后才能播放到此处。</p>}
        </div>)}
        {frames && <button disabled={frames.length >= 64} onClick={() => { const last = [...frames].sort((a, b) => a.at - b.at).at(-1)!; setFrames(key, [...frames, { ...last, at: last.at + 1 }]); }}>添加{label}帧</button>}
      </section>;
    })}
  </details>;
}
