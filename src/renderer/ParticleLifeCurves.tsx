import type { VisualObject } from '../core/model';
import { NumberField } from './Inspector';
import { Field } from './components';
import { PropertyFrameTimeline } from './PropertyFrameTimeline';

export function ParticleLifeCurves({ object, onChange }: { object: VisualObject; onChange: (object: VisualObject) => void }) {
  const particles = object.particles!;
  const glyph = object.glyphParticles;
  const activeCurves: typeof particles.lifeCurves = glyph ? glyph.lifeCurves : particles.lifeCurves;
  const fields = { size: '粒子大小', opacity: '粒子不透明度', speed: '粒子速度', red: '粒子红色通道', green: '粒子绿色通道', blue: '粒子蓝色通道', forceX: '粒子横向加速度', forceY: '粒子纵向加速度' } as const;
  type Key = keyof typeof fields;
  type Frames = NonNullable<typeof particles.lifeCurves>[Key];
  const set = (key: Key, frames: Frames) => {
    const lifeCurves = { ...activeCurves };
    if (frames?.length) lifeCurves[key] = frames; else delete lifeCurves[key];
    const next = Object.keys(lifeCurves).length ? lifeCurves : undefined;
    onChange(glyph ? { ...object, glyphParticles: { ...glyph, lifeCurves: next } } : { ...object, particles: { ...particles, lifeCurves: next } });
  };
  return <details className="ui-property-group"><summary>粒子寿命曲线</summary>
    <p className="muted">时间 0 为出生，1 为寿命结束。{!glyph && '速度沿发射方向累积位移，负值反向；'}加速度以对象宽／高每平方秒计。颜色通道为 0–255；同比缩放演出时保持轨迹与颜色。</p>
    {glyph && <p className="muted">字形模式：大小值为原粒子大小的倍率；加速度曲线替换该轴原运动与噪声。未启用的属性沿用原章节效果。</p>}
    {(Object.keys(fields) as Key[]).filter(key => !glyph || key !== 'speed').map(key => {
      const frames = activeCurves?.[key], label = glyph && key === 'size' ? '字形粒子大小倍率' : fields[key];
      const channel = ['red', 'green', 'blue'].indexOf(key);
      const initial = key === 'size' ? glyph ? 1 : particles.size : key === 'opacity' ? 1 : key === 'speed' ? particles.speed : channel >= 0 ? parseInt(object.color.slice(1 + channel * 2, 3 + channel * 2), 16) : 0;
      return <section key={key}>
        <Field label={`${label}寿命曲线`}><input type="checkbox" checked={!!frames} onChange={event => set(key, event.target.checked ? [{ at: 0, value: initial, easing: 'linear' }, { at: 1, value: key === 'size' ? glyph ? 1 : particles.endSize : key === 'speed' || channel >= 0 || glyph && key === 'opacity' ? initial : 0, easing: 'linear' }] : undefined)} /></Field>
        {frames && <PropertyFrameTimeline frames={frames} duration={1} start={0} unit="寿命比例" label={label} onChange={next => set(key, next.map(frame => ({ ...frame, at: Math.min(1, frame.at) })))} />}
        {frames?.map((frame, index) => <div className="timeline-keyframe" key={index}>
          <NumberField label={`${label}帧 ${index + 1} 寿命比例`} value={frame.at} min={0} max={1} step={.05} onChange={at => set(key, frames.map((item, i) => i === index ? { ...item, at: Math.max(0, Math.min(1, at)) } : item))} />
          <NumberField label={`${label}帧 ${index + 1} 数值`} value={frame.value} step={.1} onChange={value => set(key, frames.map((item, i) => i === index ? { ...item, value } : item))} />
          <Field label={`${label}帧 ${index + 1} 缓动`}><select value={frame.easing} onChange={event => set(key, frames.map((item, i) => i === index ? { ...item, easing: event.target.value as typeof frame.easing } : item))}><option value="linear">线性</option><option value="ease">缓入缓出</option><option value="easein">缓入</option><option value="easeout">缓出</option><option value="outquad">二次缓出</option></select></Field>
          <button onClick={() => set(key, frames.filter((_, i) => i !== index))}>删除{label}帧</button>
        </div>)}
        {frames && <button disabled={frames.length >= 64} onClick={() => set(key, [...frames, { at: .5, value: frames[0].value, easing: 'linear' }])}>添加{label}帧</button>}
      </section>;
    })}
  </details>;
}
