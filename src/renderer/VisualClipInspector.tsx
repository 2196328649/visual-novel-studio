import { useState } from 'react';
import { Diamond, Layers, Sparkles } from 'lucide-react';
import type { BlueprintGraph, Project, VariableValue, VisualObject } from '../core/model';
import { compositionFieldBinding, type CompositionObjectView } from '../core/composition-timeline';
import { visualInputFields, type VisualClipPatch, type VisualInputField, type VisualTransformProperty } from '../core/visual-object';
import { chapterSource } from '../core/chapter';
import { visualAtPath, visualAssetKind, visualValue } from '../core/visual-parameters';
import { TimelineVisualClipEditor } from './TimelineVisualClipEditor';
import { VisualObjectEditor } from './VisualObjectEditor';
import { AssetReferenceInput } from './AssetReferenceInput';
import { NumberInput } from './NumberInput';
import type { AssetUrl } from './StageEditor';
import './visual-clip-inspector.css';

export function VisualClipInspector({ project, graph, view, assetUrl, time, onSeek, onChange, onPose, onKeyframe, onEffects, onExpose, onParameterValue, onRemoveParameter, onRenameParameter, onOpen, onSave, onResource, onDetach, onGlyphParticles }: {
  project: Project; graph: BlueprintGraph; view: CompositionObjectView; assetUrl: AssetUrl; time: number;
  onSeek: (time: number) => void; onChange: (patch: VisualClipPatch) => void;
  onPose: (key: VisualTransformProperty, value: number) => void; onKeyframe: (key: VisualTransformProperty) => void;
  onEffects: (object: VisualObject) => void;
  onExpose: (field: VisualInputField, existingId?: string) => void; onParameterValue: (field: VisualInputField, value: VariableValue) => void;
  onRemoveParameter?: (id: string) => void; onRenameParameter?: (id: string, name: string) => void;
  onOpen?: () => void; onSave?: () => void; onResource?: () => void; onDetach?: () => void; onGlyphParticles?: () => void;
}) {
  const [tab, setTab] = useState<'basic' | 'animation' | 'parameters'>('basic');
  const object = view.action, local = Math.max(0, time - view.at), enabled = time >= view.at && time < view.until;
  const fields = visualInputFields(view.object).filter(field => field.path[0] !== 'children' && (object.content !== 'group' || field.path[0] === 'parameterValues' || ['duration', 'width', 'height'].includes(field.key)));
  const computed = new Set(fields.filter(field => compositionFieldBinding(graph, view, field.path).computed).map(field => 'object_' + field.key));
  const animate = (kind: 'fade' | 'slide' | 'ink') => {
    const duration = object.duration, curves = { ...object.curves }, first = object.keyframes[0];
    const key = (at: number, value: number, easing: 'linear' | 'outquad' = 'linear') => ({ at, value, easing });
    if (kind === 'fade') curves.opacity = [key(0, 0), key(duration * .12, 1, 'outquad'), key(duration * .8, 1), key(duration, 0)];
    else if (kind === 'slide') curves.x = [key(0, first.x - .5), key(Math.min(1, duration * .25), first.x, 'outquad')];
    else {
      const ratio = duration / chapterSource.timing.duration, start = (chapterSource.timing.move + chapterSource.timing.holdTitle) * ratio;
      curves.x = [key(0, first.x - .5), key(chapterSource.timing.move * ratio, first.x, 'outquad')];
      curves.dissolveStrength = [key(0, 1), key(start, 1), key(start + chapterSource.timing.disappear * ratio, -1, 'outquad')];
    }
    onEffects({ ...object, curves });
  };
  return <div className="visual-clip-inspector" aria-label="通用片段属性">
    {object.content === 'group' && <div className="visual-composition-actions">{onOpen && <button className="small-button" onClick={onOpen}><Layers size={15} />进入组合</button>}{onSave && !object.compositionId && <button className="small-button" onClick={onSave}>保存为组合资源</button>}{object.compositionId && <><button className="small-button" onClick={onResource}>编辑组合资源</button><button className="small-button" onClick={onDetach}>转为本地组合</button></>}</div>}
    <div className="segmented visual-inspector-tabs" role="tablist" aria-label="片段属性分类">{([['basic', '基础'], ['animation', '动画与效果'], ['parameters', '可替换参数']] as const).map(([id, name]) => <button type="button" role="tab" key={id} aria-selected={tab === id} onClick={() => setTab(id)}>{name}</button>)}</div>
    {tab === 'basic' && <>
      {!enabled && <button className="visual-locate" onClick={() => onSeek(view.at + Math.min(.01, (view.until - view.at) / 2))}>定位到片段，调整当前画面</button>}
      <TimelineVisualClipEditor project={project} object={object} linked={computed} linkedHint="此属性由组件连线控制。" assetUrl={assetUrl} onChange={onChange} time={local} keyframesEnabled={enabled} onPoseChange={onPose} onToggleKeyframe={onKeyframe} onSeek={at => onSeek(view.at + at)} />
      <label className="visual-retime"><input type="checkbox" aria-label="同步缩放动画" checked={object.retimeOnDuration ?? false} onChange={event => onChange({ retimeOnDuration: event.target.checked })} />调整时长时同步缩放动画</label>
    </>}
    {tab === 'animation' && <div className="visual-effects">
      {object.content === 'group' && <label className="visual-retime"><input type="checkbox" aria-label="快进时跳过此演出" checked={object.chapterPresentation ?? false} onChange={event => onChange({ chapterPresentation: event.target.checked })} />快进时跳过此演出</label>}
      <div className="visual-animation-presets" aria-label="添加动画"><button onClick={() => animate('fade')}><Sparkles size={14} />淡入淡出</button><button onClick={() => animate('slide')}>滑入</button>{['text', 'image'].includes(object.content) && <button onClick={() => animate('ink')}>笔触消散</button>}</div>
      {onGlyphParticles && ['text', 'image'].includes(object.content) && <button className="visual-glyph-create" onClick={onGlyphParticles}>从此{object.content === 'text' ? '文字' : '图片'}生成粒子</button>}
      <VisualObjectEditor project={project} object={object} effectsOnly onChange={onEffects} start={view.at} onSeek={onSeek} />
    </div>}
    {tab === 'parameters' && <div className="visual-parameters" aria-label="片段可替换参数">
      <p className="muted">公开后可在上层替换；组合参数可继续向外传递。</p>
      {fields.map(field => {
        const binding = compositionFieldBinding(graph, view, field.path), parameter = field.path[0] === 'parameterValues' ? object.parameters?.find(item => item.id === field.path[1]) : undefined;
        const value = parameter ? object.parameterValues?.[parameter.id] ?? parameter.defaultValue : visualValue(object, field.path) as VariableValue ?? field.value;
        const assetKind = visualAssetKind(view.object, field.path);
        const parent = view.path.length ? visualAtPath(view.root, view.path.slice(0, -1)) : undefined;
        const shared = parent?.parameters?.filter(item => item.dataType === field.type && (field.type !== 'asset' || visualAssetKind(parent, ['parameterValues', item.id]) === assetKind)) ?? [];
        return <div className="visual-parameter-row" data-parameter-key={field.key} key={field.key}>
          {parameter && onRenameParameter ? <input aria-label={'组合参数名称 ' + parameter.name} value={parameter.name} onChange={event => onRenameParameter(parameter.id, event.target.value)} /> : <strong>{field.name}</strong>}
          <fieldset disabled={binding.computed}>{field.type === 'asset' ? <AssetReferenceInput project={project} kind={assetKind} label={'参数值 ' + field.name} value={String(value || '') || undefined} empty="使用默认素材" onChange={value => onParameterValue(field, value ?? '')} /> : field.type === 'number' ? <NumberInput aria-label={'参数值 ' + field.name} value={Number(value)} step={.1} onChange={event => onParameterValue(field, Number(event.target.value))} /> : field.type === 'boolean' ? <input aria-label={'参数值 ' + field.name} type="checkbox" checked={Boolean(value)} onChange={event => onParameterValue(field, event.target.checked)} /> : <input aria-label={'参数值 ' + field.name} value={String(value)} onChange={event => onParameterValue(field, event.target.value)} />}</fieldset>
          <div className="visual-parameter-actions">{binding.input ? <span>时间轴 · {binding.input.name}</span> : binding.publicPath ? <span>已公开到上层组合</span> : <button className="small-button" disabled={binding.computed} onClick={() => onExpose({ ...field, value })}><Diamond size={12} />公开到{view.path.length ? '上层组合' : '时间轴'}</button>}{parameter && onRemoveParameter && <button className="small-button danger-text" aria-label={'移除组合参数 ' + parameter.name} onClick={() => onRemoveParameter(parameter.id)}>移除</button>}</div>
          {!!shared.length && !binding.publicPath && <select aria-label={'关联已有参数 ' + field.name} value="" disabled={binding.computed} onChange={event => { if (event.target.value) onExpose({ ...field, value }, event.target.value); }}><option value="">关联上层已有参数…</option>{shared.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
        </div>;
      })}
      {object.content === 'group' && !object.parameters?.length && <p className="muted">进入组合，选中图片或文字，在这里公开需要替换的属性。</p>}
    </div>}
  </div>;
}
