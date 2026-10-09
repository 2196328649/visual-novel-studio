import { actionSchema, type StageAction, type BlueprintNode } from '../core/model';
import { nodeAfterOffsets, afterOffsetDuration, setAfterOffsetCurve, nodeMoveOffsets, setMoveOffsetCurve, supportsEntranceOffsets } from '../core/move-offsets';
import { actorCurveProperties } from '../core/actor-animation';
import { visualCurve } from '../core/visual-object';
import { NumberField } from './Inspector';
import { Field } from './components';
import { PropertyFrameTimeline } from './PropertyFrameTimeline';

export const entranceOffsetFields = { x: ['横向偏移', 100], y: ['纵向偏移', 100], scale: ['缩放偏移', 100], rotation: ['旋转偏移', 1], opacity: ['不透明度偏移', 100] } as const;
export function EntranceOffsetsEditor({ node, edit, onSeek, start = 0, duration }: { node: BlueprintNode; edit: (change: (node: BlueprintNode) => void) => void; onSeek?: (time: number) => void; start?: number; duration?: number }) {
  if (!supportsEntranceOffsets(node)) return null;
  let curves: ReturnType<typeof nodeMoveOffsets>;
  try { curves = nodeMoveOffsets(node); } catch { return <section><p>入场偏移数据无效。</p><button onClick={() => edit(target => { delete target.properties.moveOffsets; })}>清除无效入场偏移</button></section>; }
  return <><details className="ui-property-group entrance-offsets-editor"><summary>入场偏移关键帧</summary>
    <p className="muted">进度 0～100% 对应入场开始到结束，随传入时长缩放。偏移叠加在原轨迹上，0 表示不改变；位置按画面宽高百分比，缩放与不透明度按百分点，旋转按度。关闭某项可恢复该属性的原轨迹。</p>
    {actorCurveProperties.map(key => {
      const [label, multiplier] = entranceOffsetFields[key], frames = curves?.[key];
      const set = (next: typeof frames) => edit(target => setMoveOffsetCurve(target, key, next));
      const seek = onSeek && duration !== undefined ? (percent: number) => onSeek(start + percent / 100 * duration) : undefined;
      return <section key={key} aria-label={label + '曲线'}>
        <Field label={label + '曲线'}><input type="checkbox" checked={!!frames?.length} onChange={event => set(event.target.checked ? [{ at: 0, value: 0, easing: 'linear' }, { at: 1, value: 0, easing: 'linear' }] : undefined)} /></Field>
        {frames && <PropertyFrameTimeline frames={frames.map(frame => ({ ...frame, at: frame.at * 100 }))} duration={100} start={0} unit="%" label={label} onSeek={seek} onChange={next => { const moved = next.findIndex((frame, i) => frame.at !== frames[i].at * 100); const ordered = moved < 0 ? next : [...next.filter((_, i) => i !== moved), next[moved]]; set(ordered.map(frame => ({ ...frame, at: Math.max(0, Math.min(1, frame.at / 100)) }))); }} />}
        {frames?.map((frame, index) => <div className="timeline-keyframe" key={index}>
          <NumberField label={label + '帧 ' + (index + 1) + ' 进度 %'} value={frame.at * 100} min={0} max={100} step={1} onChange={at => set([...frames.filter((_, i) => i !== index), { ...frame, at: Math.max(0, Math.min(1, at / 100)) }])} />
          <NumberField label={label + '帧 ' + (index + 1) + ' 数值'} value={frame.value * multiplier} step={1} onChange={value => set(frames.map((item, i) => i === index ? { ...item, value: value / multiplier } : item))} />
          <Field label={label + '帧 ' + (index + 1) + ' 缓动'}><select value={frame.easing} onChange={event => set(frames.map((item, i) => i === index ? { ...item, easing: event.target.value as typeof frame.easing } : item))}><option value="linear">线性</option><option value="ease">缓入缓出</option><option value="easein">缓入</option><option value="easeout">缓出</option><option value="outquad">二次缓出</option></select></Field>
          {seek && <button onClick={() => seek(frame.at * 100)}>定位{label}帧</button>}
          <button onClick={() => set(frames.filter((_, i) => i !== index))}>删除{label}帧 {index + 1}</button>
        </div>)}
        {frames && <button disabled={frames.length >= 64} onClick={() => {
          const points = [0, ...frames.map(frame => frame.at), 1].sort((a, b) => a - b);
          let at = .5, gap = -1;
          for (let i = 1; i < points.length; i++) if (points[i] - points[i - 1] > gap) { gap = points[i] - points[i - 1]; at = (points[i] + points[i - 1]) / 2; }
          set([...frames, { at, value: visualCurve({ curves }, key, at, 0), easing: 'linear' }]);
        }}>添加{label}帧</button>}
      </section>;
    })}
  </details><AfterOffsetsEditor node={node} edit={edit} onSeek={onSeek} start={start + (duration ?? 0)} /></>;
}

export function ShowOffsetsEditor({ action, onChange }: { action: Extract<StageAction, { kind: 'show' }>; onChange: (action: StageAction) => void }) {
  const node: BlueprintNode = { id: 'entrance_offset_adapter', type: 'savedAction', name: '角色入场', x: 0, y: 0, collapsed: false, pins: [], properties: { action: JSON.stringify(action) } };
  return <EntranceOffsetsEditor node={node} edit={change => { change(node); onChange(actionSchema.parse(JSON.parse(String(node.properties.action)))); }} />;
}

export function AfterOffsetsEditor({node, edit, onSeek, start = 0}: {node: BlueprintNode; edit: (change: (node: BlueprintNode)=>void)=>void; onSeek?: (time:number)=>void; start?: number}) {
  let curves: ReturnType<typeof nodeAfterOffsets>;
  try { curves = nodeAfterOffsets(node); } catch { return <section><p>入场后关键帧数据无效。</p><button onClick={()=>edit(target=>{delete target.properties.afterOffsets;})}>清除无效入场后关键帧</button></section>; }
  const end = Math.max(1, afterOffsetDuration(curves));
  return <details className="ui-property-group after-offsets-editor"><summary>入场后关键帧</summary>
    <p className="muted">时间从入场结束开始计算。偏移叠加在原入场终点上；改变入场时长会移动后续动作的起点，后续关键帧之间的秒数保持不变。</p>
    {actorCurveProperties.map(key=>{const [label,multiplier]=entranceOffsetFields[key],frames=curves?.[key];const set=(next:typeof frames)=>edit(target=>setAfterOffsetCurve(target,key,next));return <section key={key}>
      <Field label={'入场后'+label}><input type="checkbox" checked={!!frames?.length} onChange={event=>set(event.target.checked?[{at:0,value:0,easing:'linear'},{at:1,value:0,easing:'linear'}]:undefined)} /></Field>
      {frames && <PropertyFrameTimeline frames={frames} duration={end} start={start} label={'入场后'+label} onSeek={onSeek} onChange={next=>{const moved=next.findIndex((frame,i)=>frame.at!==frames[i].at);set(moved<0?next:[...next.filter((_,i)=>i!==moved),next[moved]]);}} />}
      {frames?.map((frame,index)=><div className="timeline-keyframe" key={index}>
        <NumberField label={'入场后'+label+'帧 '+(index+1)+' 秒'} value={frame.at} min={0} step={.1} onChange={at=>set([...frames.filter((_,i)=>i!==index),{...frame,at}])} />
        <NumberField label={'入场后'+label+'帧 '+(index+1)+' 数值'} value={frame.value*multiplier} step={1} onChange={value=>set(frames.map((item,i)=>i===index?{...item,value:value/multiplier}:item))} />
        <Field label={'入场后'+label+'帧 '+(index+1)+' 缓动'}><select value={frame.easing} onChange={event=>set(frames.map((item,i)=>i===index?{...item,easing:event.target.value as typeof frame.easing}:item))}><option value="linear">线性</option><option value="ease">缓入缓出</option><option value="easein">缓入</option><option value="easeout">缓出</option><option value="outquad">二次缓出</option></select></Field>
        {onSeek&&<button onClick={()=>onSeek(start+frame.at)}>定位入场后{label}帧</button>}
        <button onClick={()=>set(frames.filter((_,i)=>i!==index))}>删除入场后{label}帧 {index+1}</button>
      </div>)}
      {frames&&<button disabled={frames.length>=64} onClick={()=>set([...frames,{at:end+1,value:frames.at(-1)!.value,easing:'linear'}])}>添加入场后{label}帧</button>}
    </section>;})}
  </details>;
}
