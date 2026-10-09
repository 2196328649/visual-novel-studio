import { VisualTransitionsEditor } from './VisualTransitionsEditor';
import { AssetReferenceInput } from './AssetReferenceInput';
import type { Project, VisualObject } from '../core/model';
import { KeyframeEditor, NumberField } from './Inspector';
import { Field } from './components';
import { VisualCurvesEditor } from './VisualCurvesEditor';
import { createVisualObject, retimeVisualObject } from '../core/visual-object';
import { CompositionTimeline } from './CompositionTimeline';
import { ParticleLifeCurves } from './ParticleLifeCurves';
import { ImageTransformFields } from './ImageTransformFields';
import { canonicalImageVisual, imageTransform } from '../core/image-transform';
import { isSimpleMediaVisual, mediaLifetime, mediaLifetimeNames, withMediaLifetime, type MediaLifetime } from '../core/media-command';

export function VisualObjectEditor({ project, object, onChange, onSeek, onOpenObject, start = 0, trackLayer = false, effectsOnly = false }: { project: Project; object: VisualObject; onChange: (object: VisualObject) => void; onSeek?: (time: number) => void; onOpenObject?: (instanceId: string) => void; start?: number; trackLayer?: boolean; effectsOnly?: boolean }) {
  const scaleTiming = !!object.retimeOnDuration;
  const simpleImage = object.content === 'image' && isSimpleMediaVisual(object) ? canonicalImageVisual(project, object) : undefined;
  const setGlyphSource = (source?: 'image' | 'text') => onChange({ ...object,
    text: source === 'text' && !object.glyphParticles ? object.text || '新的文字' : object.text,
    glyphParticles: source ? {
      count: 200, emissionStart: 2.5, timeScale: 1, sizeScale: 1, motionScale: 1,
      rect: { x: 0, y: 0, width: 1, height: 1 }, ...object.glyphParticles, source,
      assetId: source === 'image' ? object.glyphParticles?.assetId ?? project.assets.find(a => a.kind === 'image')?.id : object.glyphParticles?.assetId,
    } : undefined,
  });
  let time = start;
  return <section aria-label="演出对象属性">
    {!effectsOnly && object.content === 'group' && <details open className="ui-property-group"><summary>组合内容</summary>
      <p className="muted">子对象的位置和尺寸相对于组合矩形，组合曲线作用于合成后的整体画面。</p>
      <CompositionTimeline object={object} onChange={onChange} onSeek={onSeek} onOpenObject={onOpenObject} start={start} />
      {(object.children ?? []).map((child, index) => <details key={child.instanceId}><summary>{child.name}</summary>
        <NumberField label="子对象开始 秒" value={child.startAt ?? 0} min={0} step={.1} onChange={value => onChange({ ...object, children: object.children!.map((item, i) => i === index ? { ...item, startAt: Math.max(0, value) } : item) })} />
        <VisualObjectEditor project={project} object={child} start={start + (child.startAt ?? 0)} onSeek={onSeek} onOpenObject={onOpenObject} onChange={next => onChange({ ...object, children: object.children!.map((item, i) => i === index ? next : item) })} />
        <button onClick={() => onChange({ ...object, children: object.children!.filter((_, i) => i !== index) })}>移除子对象</button>
      </details>)}
      {(['image', 'video', 'text', 'particles', 'solid', 'group'] as const).map(content => <button key={content} disabled={(object.children?.length ?? 0) >= 128} onClick={() => { const child = createVisualObject(content, content === 'image' ? project.assets.find(a => a.kind === 'image')?.id : content === 'video' ? project.assets.find(a => a.kind === 'video')?.id : undefined); child.duration = object.duration; onChange({ ...object, children: [...(object.children ?? []), child] }); }}>添加{({ image: '图片', video: '视频', text: '文字', particles: '粒子', solid: '色块', group: '组合' })[content]}子对象</button>)}
    </details>}
    {!effectsOnly && <><Field label="对象名称"><input value={object.name} onChange={event => onChange({ ...object, name: event.target.value })} /></Field>
    {object.persistent !== undefined && <Field label="对象 ID" hint="隐藏此对象时，填写这个 ID。"><input value={object.instanceId} readOnly /></Field>}
    <Field label="修改时长时同比缩放动画"><input type="checkbox" checked={scaleTiming} onChange={event => onChange({ ...object, retimeOnDuration: event.target.checked })} /></Field>
    {object.content === 'image' && <Field label="显示范围"><select aria-label="图片显示范围" value={mediaLifetime(object)} onChange={event => onChange(withMediaLifetime(object, event.target.value as MediaLifetime))}>{Object.entries(mediaLifetimeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></Field>}
    {(object.content !== 'image' || mediaLifetime(object) === 'duration') && <NumberField label="对象持续秒数" value={object.duration} min={0} step={.1} onChange={duration => onChange({ ...(scaleTiming ? retimeVisualObject(object, Math.max(0, duration)) : { ...object, duration: Math.max(0, duration), retimeBasisDuration: undefined }), ...(object.persistent !== undefined ? { persistent: duration <= 0, ...(duration <= 0 ? { wait: false } : {}) } : {}) })} />}
    {object.persistent && <p className="muted">{object.lifetime === 'line' ? '仅本句显示，推进台词后按离场设置隐藏。' : '持续显示，直到隐藏对象或切换背景。'}</p>}
    <Field label="等待显示结束"><input type="checkbox" checked={object.wait && !object.persistent && object.duration > 0} disabled={!!object.persistent || object.duration === 0} onChange={event => onChange({ ...object, wait: event.target.checked })} /></Field>
    {scaleTiming && !object.persistent && object.duration === 0 && object.retimeBasisDuration && <p className="muted">当前不显示此对象；重新设置正时长时，将按原 {object.retimeBasisDuration} 秒的动画比例恢复。</p>}
    <VisualTransitionsEditor value={object.visualTransitions} wait={object.transitionWait} onChange={visualTransitions => onChange({ ...object, visualTransitions })} onWaitChange={transitionWait => onChange({ ...object, transitionWait })} />
    {!trackLayer && <NumberField label="对象层级" value={object.layer} onChange={layer => onChange({ ...object, layer: Math.round(layer) })} />}
    {simpleImage ? <ImageTransformFields value={imageTransform(simpleImage)} onChange={value => onChange({ ...simpleImage, keyframes: [{ ...simpleImage.keyframes[0], ...value }] })} /> : <div className="field-row">{(['width', 'height'] as const).map(key => <NumberField key={key} label={key === 'width' ? '对象宽度 %' : '对象高度 %'} value={object[key] * 100} step={1} onChange={value => onChange({ ...object, [key]: Math.max(.001, Math.min(4, value / 100)) })} />)}</div>}
    {object.content === 'image' && <Field label="对象图片"><AssetReferenceInput project={project} kind="image" label="对象图片" value={object.assetId} empty="选择图片" onChange={value => onChange({ ...object, assetId: value })} /></Field>}
    {object.content === 'video' && <><Field label="对象视频"><AssetReferenceInput project={project} kind="video" label="对象视频" value={object.assetId} empty="选择视频" onChange={value => onChange({ ...object, assetId: value, sourceDuration: value === object.assetId ? object.sourceDuration : undefined, mediaOffset: 0 })} /></Field><div className="field-row"><NumberField label="视频入点 秒" value={object.mediaOffset ?? 0} min={0} step={.1} onChange={value => onChange({ ...object, mediaOffset: Math.max(0, Math.min(Math.max(0, (object.sourceDuration ?? Infinity) - .05), value)) })} /><NumberField label="视频音量 %" value={(object.volume ?? 1) * 100} min={0} max={100} step={1} onChange={value => onChange({ ...object, volume: Math.max(0, Math.min(1, value / 100)) })} /></div><div className="field-row"><NumberField label="视频淡入 秒" value={object.fadeIn ?? 0} min={0} max={object.duration} step={.1} onChange={value => onChange({ ...object, fadeIn: Math.max(0, Math.min(object.duration, value)) })} /><NumberField label="视频淡出 秒" value={object.fadeOut ?? 0} min={0} max={object.duration} step={.1} onChange={value => onChange({ ...object, fadeOut: Math.max(0, Math.min(object.duration, value)) })} /></div><Field label="视频静音"><input type="checkbox" checked={object.muted ?? false} onChange={event => onChange({ ...object, muted: event.target.checked })} /></Field></>}
    {object.content === 'video' && <Field label="视频循环"><input type="checkbox" checked={object.loop ?? false} onChange={event => onChange({ ...object, loop: event.target.checked })} /></Field>}
    {(object.content === 'image' || object.content === 'video') && <Field label={object.content === 'video' ? '视频适配' : '图片适配'}><select value={object.imageFit ?? 'stretch'} onChange={event => onChange({ ...object, imageFit: event.target.value as VisualObject['imageFit'] })}><option value="stretch">拉伸填满</option><option value="contain">完整显示</option><option value="cover">等比铺满</option></select></Field>}
    {object.content === 'image' && <Field label="图片垂直对齐"><select value={object.imageAlign ?? 'center'} onChange={event => onChange({ ...object, imageAlign: event.target.value as VisualObject['imageAlign'] })}><option value="top">顶部</option><option value="center">居中</option><option value="bottom">底部</option></select></Field>}
    </>}
    {(object.content === 'text' || object.glyphParticles?.source === 'text') && !effectsOnly && <><Field label="对象文字"><textarea value={object.text} onChange={event => onChange({ ...object, text: event.target.value })} /></Field><NumberField label="对象字号" value={object.fontSize} onChange={value => onChange({ ...object, fontSize: Math.max(12, Math.min(300, Math.round(value))) })} /></>}
    {(object.content === 'text' || object.glyphParticles?.source === 'text') && <Field label="对象字体"><AssetReferenceInput project={project} kind="font" label="对象字体" value={object.fontAssetId} empty="默认字体" onChange={value => onChange({ ...object, fontAssetId: value })} /></Field>}
    {(object.content === 'text' || object.glyphParticles?.source === 'text') && <>
      <Field label="文字斜体"><input type="checkbox" checked={object.textItalic ?? false} onChange={event => onChange({ ...object, textItalic: event.target.checked })} /></Field>
      <details className="ui-property-group"><summary>文字裁切</summary>
        <Field label="限制文字显示范围"><input type="checkbox" checked={!!object.textClip} onChange={event => onChange({ ...object, textClip: event.target.checked ? { x: 0, y: 0, width: 1, height: 1 } : undefined })} /></Field>
        {object.textClip && (['x', 'y', 'width', 'height'] as const).map(key => <NumberField key={key} label={'裁切' + ({ x: '横向位置', y: '纵向位置', width: '宽度', height: '高度' })[key] + ' %'} value={object.textClip![key] * 100} onChange={value => onChange({ ...object, textClip: { ...object.textClip!, [key]: key === 'width' || key === 'height' ? Math.max(0, value / 100) : value / 100 } })} />)}
      </details>
      <details className="ui-property-group"><summary>描边与阴影</summary>
        {([['outlineWidth', '描边宽度', 0], ['outlineOpacity', '描边不透明度', 1], ['shadowX', '阴影横向偏移', 0], ['shadowY', '阴影纵向偏移', 0], ['shadowBlur', '阴影柔化', 0], ['shadowOpacity', '阴影不透明度', .7]] as const).map(([key, label, fallback]) => <NumberField key={key} label={label} value={object.textEffects?.[key] ?? fallback} step={key.endsWith('Opacity') ? .1 : 1} onChange={value => onChange({ ...object, textEffects: { ...object.textEffects, [key]: key.endsWith('Opacity') ? Math.max(0, Math.min(1, value)) : key === 'shadowBlur' ? Math.max(0, Math.min(64, value)) : key === 'outlineWidth' ? Math.max(0, value) : value } })} />)}
        {([['outlineColor', '描边颜色'], ['shadowColor', '阴影颜色']] as const).map(([key, label]) => <Field key={key} label={label}><input type="color" value={object.textEffects?.[key] ?? '#000000'} onChange={event => onChange({ ...object, textEffects: { ...object.textEffects, [key]: event.target.value } })} /></Field>)}
      </details>
      <Field label="文字水平对齐"><select value={object.textAlign ?? 'center'} onChange={event => onChange({ ...object, textAlign: event.target.value as VisualObject['textAlign'] })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></Field>
      <Field label="文字垂直对齐"><select value={object.textVerticalAlign ?? 'center'} onChange={event => onChange({ ...object, textVerticalAlign: event.target.value as VisualObject['textVerticalAlign'] })}><option value="top">顶部</option><option value="center">居中</option><option value="bottom">底部</option></select></Field>
    </>}
    {!effectsOnly && object.content !== 'image' && object.content !== 'video' && <Field label="对象颜色"><input type="color" value={object.color} onChange={event => onChange({ ...object, color: event.target.value })} /></Field>}
    {object.content === 'particles' && <details className="ui-property-group"><summary>字形发射</summary>
      <Field label="从图片字形发射"><input type="checkbox" checked={!!object.glyphParticles && object.glyphParticles.source !== 'text'} disabled={!object.glyphParticles && !project.assets.some(a => a.kind === 'image') || object.glyphParticles?.source === 'text' && !project.assets.some(a => a.kind === 'image')} onChange={event => setGlyphSource(event.target.checked ? 'image' : undefined)} /></Field>
      <Field label="从文字字形发射"><input type="checkbox" checked={object.glyphParticles?.source === 'text'} onChange={event => setGlyphSource(event.target.checked ? 'text' : undefined)} /></Field>
      {object.glyphParticles && <>
        <p className="muted">{object.glyphParticles.source === 'text' ? '按对象文字的字形发射' : project.assets.find(asset => asset.id === object.glyphParticles?.assetId)?.emissionMesh ? '按图片附带的网格区域发射' : '按图片不透明区域发射'}，相同种子生成相同的粒子分布与运动。普通粒子参数在此模式下不生效。</p>
        <NumberField label="字形随机种子" value={object.glyphParticles.seed ?? 0} min={0} step={1} onChange={seed => onChange({ ...object, glyphParticles: { ...object.glyphParticles!, seed: Math.max(0, Math.min(1000000, Math.round(seed))) } })} />
        {object.glyphParticles.source !== 'text' && <Field label="字形来源图片"><AssetReferenceInput project={project} kind="image" label="字形来源图片" value={object.glyphParticles.assetId} empty="选择图片" onChange={value => onChange({ ...object, glyphParticles: { ...object.glyphParticles!, assetId: value } })} /></Field>}
        {([['count', '字形粒子数量', 1, 200], ['emissionStart', '字形发射开始 秒', 0, 3600], ['timeScale', '字形模拟速度', .01, 100], ['sizeScale', '字形粒子大小倍率', .01, 100], ['motionScale', '字形运动倍率', 0, 100]] as const).map(([key, label, min, max]) => <NumberField key={key} label={label} value={object.glyphParticles![key]} min={min} step={key === 'count' ? 1 : .1} onChange={value => onChange({ ...object, glyphParticles: { ...object.glyphParticles!, [key]: Math.max(min, Math.min(max, key === 'count' ? Math.round(value) : value)) } })} />)}
        {(['x', 'y', 'width', 'height'] as const).map(key => <NumberField key={key} label={`字形区域${({ x: '横向位置', y: '纵向位置', width: '宽度', height: '高度' })[key]} %`} value={object.glyphParticles!.rect[key] * 100} step={1} onChange={value => onChange({ ...object, glyphParticles: { ...object.glyphParticles!, rect: { ...object.glyphParticles!.rect, [key]: key === 'width' || key === 'height' ? Math.max(.001, value / 100) : value / 100 } } })} />)}
      </>}
    </details>}
    <details className="ui-property-group"><summary>遮罩与消散</summary>
      <Field label="透明度遮罩"><AssetReferenceInput project={project} kind="image" label="透明度遮罩" value={object.maskAssetId} empty="无遮罩" onChange={value => onChange({ ...object, maskAssetId: value })} /></Field>
      <Field label="启用笔触消散"><input type="checkbox" checked={!!object.dissolve} onChange={event => onChange({ ...object, dissolve: event.target.checked ? { start: object.duration * .4, end: object.duration * .9, from: 1, to: -1 } : undefined })} /></Field>
      {object.dissolve && (['start', 'end', 'from', 'to'] as const).map(key => <NumberField key={key} label={{ start: '消散开始 秒', end: '消散结束 秒', from: '起始遮罩强度', to: '结束遮罩强度' }[key]} value={object.dissolve![key]} step={.1} onChange={value => onChange({ ...object, dissolve: { ...object.dissolve!, [key]: key === 'start' || key === 'end' ? Math.max(0, value) : Math.max(-1, Math.min(1, value)) } })} />)}
    </details>
    {object.content === 'image' && <details className="ui-property-group"><summary>背景波动</summary><Field label="启用背景波动"><input type="checkbox" checked={!!object.ripple} onChange={event => onChange({ ...object, ripple: event.target.checked ? { strength: .01, speed: 1 } : undefined })} /></Field>{object.ripple && <><NumberField label="波动强度" value={object.ripple.strength} step={.001} onChange={value => onChange({ ...object, ripple: { ...object.ripple!, strength: Math.max(0, Math.min(1, value)) } })} /><NumberField label="波动速度" value={object.ripple.speed} step={.1} onChange={speed => onChange({ ...object, ripple: { ...object.ripple!, speed } })} /></>}</details>}
    {object.content === 'particles' && object.particles && !object.glyphParticles && <details open><summary>粒子参数</summary>{([
      ['count', '粒子数量', 1, 500], ['seed', '随机种子', 0, 1000000], ['lifetime', '粒子寿命 秒', .01, 3600], ['speed', '粒子速度', 0, 10], ['direction', '发射方向 度', -360, 360], ['spread', '方向散布 度', 0, 360], ['size', '初始大小', .1, 1000], ['endSize', '结束大小', 0, 1000],
    ] as const).map(([key, label, min, max]) => <NumberField key={key} label={label} value={object.particles![key]} step={key === 'count' || key === 'seed' ? 1 : .1} onChange={value => onChange({ ...object, particles: { ...object.particles!, [key]: Math.max(min, Math.min(max, key === 'count' || key === 'seed' ? Math.round(value) : value)) } })} />)}</details>}
    {object.content === 'particles' && (object.particles || object.glyphParticles) && <ParticleLifeCurves object={object} onChange={onChange} />}
    <VisualCurvesEditor object={object} onChange={onChange} onSeek={onSeek} start={start} />
    <details className="ui-property-group"><summary>整帧动画</summary>{object.keyframes.map((frame, index) => { time += frame.duration; const at = time; return <details key={index} className="timeline-keyframe"><summary>对象关键帧 {index + 1} · {at.toFixed(2)} 秒</summary>{onSeek && <button onClick={() => onSeek(at)}>定位对象帧</button>}<KeyframeEditor frame={frame} onChange={next => onChange({ ...object, keyframes: object.keyframes.map((item, i) => i === index ? next : item) })} /><button disabled={object.keyframes.length <= 1} onClick={() => onChange({ ...object, keyframes: object.keyframes.filter((_, i) => i !== index) })}>删除对象帧</button></details>; })}
    <button disabled={object.keyframes.length >= 32} onClick={() => onChange({ ...object, keyframes: [...object.keyframes, { ...object.keyframes.at(-1)!, duration: 1 }] })}>添加对象关键帧</button></details>
  </section>;
}
