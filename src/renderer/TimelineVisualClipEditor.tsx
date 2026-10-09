import { visualPose, type VisualClipPatch, type VisualTransformProperty } from '../core/visual-object';
import { ChevronLeft, ChevronRight, Diamond } from 'lucide-react';
import { effectiveCharacter, type Project, type VisualObject } from '../core/model';
import { AssetReferenceInput } from './AssetReferenceInput';
import { NumberField } from './Inspector';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { useEffect, useRef, useState } from 'react';
import { readVideoDuration } from './audio-metadata';
import type { AssetUrl } from './StageEditor';

export function TimelineVisualClipEditor({ project, object, linked, linkedHint = '已公开的内容在下方“调用参数”中修改默认值。', assetUrl, onChange, time = 0, keyframesEnabled = true, onPoseChange, onToggleKeyframe, onSeek }: { project: Project; object: VisualObject; linked: Set<string>; linkedHint?: string; assetUrl?: AssetUrl; onChange: (patch: VisualClipPatch) => void; time?: number; keyframesEnabled?: boolean; onPoseChange?: (key: VisualTransformProperty, value: number) => void; onToggleKeyframe?: (key: VisualTransformProperty) => void; onSeek?: (time: number) => void }) {
  const pending = useRef<AbortController | undefined>(undefined);
  const current = useRef({ object, linked }); current.current = { object, linked };
  const [notice, setNotice] = useState('');
  useEffect(() => () => pending.current?.abort(), []);
  const changeVideo = async (assetId?: string) => {
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    if (!assetId || !assetUrl) { onChange({ assetId, sourceDuration: undefined, mediaOffset: 0 }); return; }
    try {
      setNotice('正在读取视频时长…');
      const sourceDuration = await readVideoDuration(assetUrl(assetId) ?? '', controller.signal);
      if (current.current.object.instanceId !== object.instanceId || current.current.object.assetId !== object.assetId || current.current.linked.has('object_assetId')) { setNotice('片段已修改，请重新选择素材。'); return; }
      onChange({ assetId, sourceDuration, mediaOffset: 0 }); setNotice('');
    } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const first = visualPose(object, Math.max(0, Math.min(object.duration, time)));
  const character = object.characterId ? effectiveCharacter(project, object.characterId) : undefined;
  const expression = character?.expressions.find(item => item.id === object.expressionId) ?? character?.expressions.find(item => item.id === character.defaultExpressionId) ?? character?.expressions[0];
  const characterImage = object.content === 'image' && !!object.characterId;
  const expressionName = (characterName: string, expressionLabel?: string) => `角色 · ${characterName}${expressionLabel ? ` · ${expressionLabel}` : ''}`;
  const displayed = (value: number) => Math.round(value * 100) / 100;
  return <div className="timeline-clip-basics">
    {characterImage && <fieldset disabled={linked.has('object_assetId')}><Field label="角色"><select aria-label="角色图片角色" value={object.characterId ?? ''} onChange={event => {
      const next = effectiveCharacter(project, event.target.value), nextExpression = next?.expressions.find(item => item.id === next.defaultExpressionId) ?? next?.expressions[0];
      if (next && nextExpression) onChange({ characterId: next.id, expressionId: nextExpression.id, assetId: nextExpression.assetId, name: expressionName(next.name, nextExpression.name) });
    }}>{project.characters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></fieldset>}
    {characterImage && character && <fieldset disabled={linked.has('object_assetId')}><Field label="表情"><select aria-label="角色图片表情" value={expression?.id ?? ''} onChange={event => {
      const next = character.expressions.find(item => item.id === event.target.value);
      if (next) onChange({ expressionId: next.id, assetId: next.assetId, name: expressionName(character.name, next.name) });
    }}>{character.expressions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></fieldset>}
    {object.content === 'image' && !characterImage && <fieldset disabled={linked.has('object_assetId')}><Field label="图片素材"><AssetReferenceInput project={project} kind="image" label="片段图片素材" value={object.assetId} empty="选择图片" onChange={assetId => onChange({ assetId })} /></Field></fieldset>}
    {object.content === 'video' && <fieldset disabled={linked.has('object_assetId')}><Field label="视频素材"><AssetReferenceInput project={project} kind="video" label="片段视频素材" value={object.assetId} empty="选择视频" onChange={assetId => void changeVideo(assetId)} /></Field></fieldset>}
    {object.content === 'video' && notice && <p role="status">{notice}</p>}
    {object.content === 'video' && <div className="timeline-media-editing"><div className="field-row"><Field label="素材入点 秒"><NumberInput aria-label="视频素材入点" disabled={linked.has('object_mediaOffset')} min={0} max={Math.max(0, (object.sourceDuration ?? Infinity) - .05)} step={.1} value={object.mediaOffset ?? 0} onChange={event => onChange({ mediaOffset: Math.max(0, Math.min(Math.max(0, (object.sourceDuration ?? Infinity) - .05), Number(event.target.value) || 0)) })} /></Field><Field label="音量 %"><NumberInput aria-label="视频音量" disabled={linked.has('object_volume')} min={0} max={100} step={1} value={(object.volume ?? 1) * 100} onChange={event => onChange({ volume: Math.max(0, Math.min(1, (Number(event.target.value) || 0) / 100)) })} /></Field></div><div className="field-row"><Field label="淡入 秒"><NumberInput aria-label="视频淡入秒数" disabled={linked.has('object_fadeIn')} min={0} max={object.duration} step={.1} value={object.fadeIn ?? 0} onChange={event => onChange({ fadeIn: Math.max(0, Math.min(object.duration, Number(event.target.value) || 0)) })} /></Field><Field label="淡出 秒"><NumberInput aria-label="视频淡出秒数" disabled={linked.has('object_fadeOut')} min={0} max={object.duration} step={.1} value={object.fadeOut ?? 0} onChange={event => onChange({ fadeOut: Math.max(0, Math.min(object.duration, Number(event.target.value) || 0)) })} /></Field></div>{object.sourceDuration !== undefined && <p className="muted">原视频 {object.sourceDuration.toFixed(2)} 秒 · 使用 {(object.mediaOffset ?? 0).toFixed(2)}–{Math.min(object.sourceDuration, (object.mediaOffset ?? 0) + object.duration).toFixed(2)} 秒</p>}<Field label="视频静音"><input aria-label="视频静音" type="checkbox" disabled={linked.has('object_muted')} checked={object.muted ?? false} onChange={event => onChange({ muted: event.target.checked })} /></Field></div>}
    {(object.content === 'text' || object.glyphParticles?.source === 'text') && <fieldset disabled={linked.has('object_text')}><Field label="文字内容"><textarea aria-label="片段文字内容" value={object.text} onChange={event => onChange({ text: event.target.value })} /></Field></fieldset>}
    {(object.content === 'text' || object.glyphParticles?.source === 'text') && <fieldset disabled={linked.has('object_fontSize')}><Field label="字号"><NumberInput aria-label="片段字号" value={object.fontSize} step={1} onChange={event => onChange({ fontSize: Math.max(12, Math.min(300, Math.round(Number(event.target.value)))) })} /></Field></fieldset>}
    {(object.content === 'solid' || object.content === 'text' || object.content === 'particles') && <Field label={object.content === 'text' ? '文字颜色' : object.content === 'particles' ? '粒子颜色' : '色块颜色'}><input aria-label="片段颜色" type="color" value={object.color} onChange={event => onChange({ color: event.target.value })} /></Field>}
    {[...linked].some(key => key.startsWith('object_')) && <p className="muted">{linkedHint}</p>}
    <details open className="ui-property-group"><summary>画面与变换</summary>
      {object.content !== 'image' && <div className="field-row">{(['width', 'height'] as const).map(key => <NumberField key={key} label={key === 'width' ? '宽度 %' : '高度 %'} value={displayed(object[key] * 100)} step={1} onChange={value => onChange({ [key]: Math.max(.001, Math.min(4, value / 100)) })} />)}</div>}
      {(object.content === 'image' || object.content === 'video') && <Field label={object.content === 'video' ? '视频适配' : '图片适配'}><select aria-label={object.content === 'video' ? '片段视频适配' : '片段图片适配'} value={object.imageFit ?? 'stretch'} onChange={event => onChange({ imageFit: event.target.value as VisualObject['imageFit'] })}><option value="contain">完整显示</option><option value="cover">等比铺满</option><option value="stretch">拉伸填满</option></select></Field>}
      {object.content === 'image' && <Field label="图片垂直对齐"><select aria-label="片段图片垂直对齐" value={object.imageAlign ?? 'center'} onChange={event => onChange({ imageAlign: event.target.value as VisualObject['imageAlign'] })}><option value="top">顶部</option><option value="center">居中</option><option value="bottom">底部</option></select></Field>}
      <output className="timeline-property-time" aria-label="片段当前时间">{time.toFixed(2)} 秒</output>
      {([['x', '水平位置 %', 100], ['y', '垂直位置 %', 100], ['scale', '缩放 %', 100], ['scaleX', '缩放 X %', 100], ['scaleY', '缩放 Y %', 100], ['rotation', '旋转 °', 1], ['opacity', '不透明度 %', 100]] as const).filter(([key]) => key === 'scale' ? object.content !== 'image' || object.keyframes.some(frame => frame.scale !== 1) || !!object.curves?.scale : key !== 'scaleX' && key !== 'scaleY' || object.content === 'image').map(([key, label, factor]) => {
        const frames = [...(object.curves?.[key] ?? [])].sort((a, b) => a.at - b.at);
        const active = frames.some(frame => Math.abs(frame.at - time) < .001);
        const previous = frames.filter(frame => frame.at < time - .001).at(-1), next = frames.find(frame => frame.at > time + .001);
        return <div className="timeline-property-value" key={key}><Field label={label}><NumberInput aria-label={label} disabled={!keyframesEnabled} value={displayed((first[key] ?? 1) * factor)} step={1} onChange={event => {
          const value = Number(event.target.value) / factor, result = key === 'opacity' ? Math.max(0, Math.min(1, value)) : value;
          if (onPoseChange) onPoseChange(key, result); else onChange({ firstFrame: { [key]: result } });
        }} /></Field>{onToggleKeyframe && <div className="timeline-keyframe-controls">
          <button type="button" className="icon-button" title={`上一帧：${label}`} aria-label={`上一帧：${label}`} disabled={!previous} onClick={() => previous && onSeek?.(previous.at)}><ChevronLeft size={14} /></button>
          <button type="button" className={'icon-button' + (active ? ' active' : '')} title={`${active ? '删除' : '添加'}关键帧：${label}`} aria-label={`关键帧：${label}`} aria-pressed={active} disabled={!keyframesEnabled} onClick={() => onToggleKeyframe(key)}><Diamond size={14} fill={active ? 'currentColor' : 'none'} /></button>
          <button type="button" className="icon-button" title={`下一帧：${label}`} aria-label={`下一帧：${label}`} disabled={!next} onClick={() => next && onSeek?.(next.at)}><ChevronRight size={14} /></button>
        </div>}</div>;
      })}
    </details>
  </div>;
}
