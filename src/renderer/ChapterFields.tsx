import type { Project, StageAction } from '../core/model';
import { chapterEffectNames, chapterSource } from '../core/chapter';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { UiAssetSelect } from './AssetPicker';
import type { AssetUrl } from './StageEditor';
import type { Commit } from './editor';

export function ChapterFields({ project, action, onChange, assetUrl }: { project: Project; action: Extract<StageAction, { kind: 'chapter' }>; onChange: (action: Extract<StageAction, { kind: 'chapter' }>) => void; assetUrl?: AssetUrl }) {
  assetUrl ??= id => project.assets.find(asset => asset.id === id)?.path;
  return <div className="chapter-performance-fields">
    <Field label="章节标题"><input aria-label="章节标题" value={action.title} onChange={event => onChange({ ...action, title: event.target.value })} /></Field>
    <Field label="章节副标题"><input aria-label="章节副标题" value={action.subtitle} onChange={event => onChange({ ...action, subtitle: event.target.value })} /></Field>
    <Field label="章节时长（秒）"><NumberInput aria-label="章节时长（秒）" value={action.duration} step={0.1} onChange={event => onChange({ ...action, duration: Number(event.target.value) })} /></Field>
    <Field label="章节动效"><select aria-label="章节动效" value={action.effect ?? ''} onChange={event => onChange({ ...action, effect: (event.target.value || undefined) as typeof action.effect })}><option value="">使用主题动效</option>{Object.entries(chapterEffectNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
    {([['backgroundId', '章节背景', 'image'], ['titleImageId', '章节题图', 'image'], ['soundId', '章节音效', 'audio']] as const).map(([key, label, kind]) => <Field key={key} label={label}><UiAssetSelect project={project} kind={kind} category={kind === 'audio' ? 'sound' : undefined} value={action[key]} label={label} assetUrl={assetUrl} empty={key === 'backgroundId' ? '主题默认' : '无'} onChange={value => onChange({ ...action, [key]: value })} /></Field>)}
  </div>;
}

export function ChapterCompositionFields({ project, commit, assetUrl }: { project: Project; commit: Commit; assetUrl: AssetUrl }) {
  return <details className="chapter-composition"><summary>章节背景与消散效果 · 全作品</summary>
    <div className="field-row">{(['backgroundOffsetX', 'backgroundOffsetY'] as const).map((key, index) => <Field key={key} label={`背景${index ? '纵向' : '横向'}偏移 %`}><NumberInput aria-label={`背景${index ? '纵向' : '横向'}偏移 %`} min={-100} max={100} step={0.1} value={Number(((project.ui.chapterTransition?.[key] ?? 0) * 100).toFixed(3))} onChange={event => commit('调整章节背景取景', draft => { draft.ui.chapterTransition = { ...draft.ui.chapterTransition, [key]: Number(event.target.value) / 100 }; })} /></Field>)}</div>
    {([['overlayId', '章节底纹'], ['maskId', '章节蒙板'], ['dissolveId', '渐变纹理']] as const).map(([key, label]) => <Field key={key} label={label}><UiAssetSelect project={project} kind="image" value={project.ui.chapterTransition?.[key]} label={label} assetUrl={assetUrl} empty="默认" onChange={value => commit('修改章节合成素材', draft => { draft.ui.chapterTransition = { ...draft.ui.chapterTransition, [key]: value }; })} /></Field>)}
    <label className="check-field"><input type="checkbox" checked={project.ui.chapterTransition?.particles !== false} onChange={event => commit('章节粒子', draft => { draft.ui.chapterTransition = { ...draft.ui.chapterTransition, particles: event.target.checked }; })} />显示消散粒子</label>
    <Field label="章节粒子颜色"><input type="color" aria-label="章节粒子颜色" value={project.ui.chapterTransition?.particleColor ?? '#ffffff'} onChange={event => commit('章节粒子颜色', draft => { draft.ui.chapterTransition = { ...draft.ui.chapterTransition, particleColor: event.target.value }; })} /></Field>
    <label className="check-field"><input type="checkbox" checked={project.ui.chapterTransition?.ripple !== false} onChange={event => commit('章节背景波动', draft => { draft.ui.chapterTransition = { ...draft.ui.chapterTransition, ripple: event.target.checked }; })} />笔触消散时背景轻微波动</label>
    {project.ui.chapterTransition?.ripple !== false && <div className="field-row">
      <Field label="波动幅度"><NumberInput aria-label="波动幅度" min={0} max={0.2} step={0.005} value={project.ui.chapterTransition?.rippleStrength ?? chapterSource.shaders.ripple.strength} onChange={event => commit('章节波动幅度', draft => { draft.ui.chapterTransition = { ...draft.ui.chapterTransition, rippleStrength: Number(event.target.value) }; })} /></Field>
      <Field label="波动速度"><NumberInput aria-label="波动速度" min={0} max={1} step={0.01} value={project.ui.chapterTransition?.rippleSpeed ?? chapterSource.shaders.ripple.speed} onChange={event => commit('章节波动速度', draft => { draft.ui.chapterTransition = { ...draft.ui.chapterTransition, rippleSpeed: Number(event.target.value) }; })} /></Field>
    </div>}
  </details>;
}
