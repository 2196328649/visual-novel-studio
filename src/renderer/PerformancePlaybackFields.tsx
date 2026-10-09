import type { PerformancePlayback, Project, StoryLine } from '../core/model';
import { performancePlayback } from '../core/standalone-performance';
import { Field } from './components';
import { NumberInput } from './NumberInput';

export function PerformancePlaybackFields({ project, line, onChange }: { project: Project; line: Pick<StoryLine, 'actions' | 'playback'>; onChange: (value: PerformancePlayback) => void }) {
  const settings = performancePlayback(project, line);
  const transition = settings.transition ?? { mode: 'none', outDuration: .5, hold: 0, inDuration: .5, color: '#000000' };
  const editTransition = (patch: Partial<typeof transition>) => onChange({ ...line.playback, transition: { ...transition, ...patch } });
  return <details className="ui-property-group" open><summary>播放设置</summary>
    <label className="check-field"><input aria-label="允许点击跳过独立演出" type="checkbox" checked={settings.clickSkip} onChange={event => onChange({ ...line.playback, clickSkip: event.target.checked })} />允许点击跳过</label>
    <Field label="结束转场"><select aria-label="独立演出结束转场" value={transition.mode} onChange={event => editTransition({ mode: event.target.value as typeof transition.mode })}><option value="none">直接切换</option><option value="dissolve">溶解到下一画面</option><option value="color">经过纯色画面</option></select></Field>
    {transition.mode !== 'none' && <>
      <Field label={transition.mode === 'color' ? '淡出秒数' : '溶解秒数'}><NumberInput aria-label="演出淡出秒数" min={0} max={60} step={.1} value={transition.outDuration} onChange={event => editTransition({ outDuration: Math.max(0, Math.min(60, Number(event.target.value) || 0)) })} /></Field>
      {transition.mode === 'color' && <>
        <Field label="过渡颜色"><input aria-label="演出过渡颜色" type="color" value={transition.color} onChange={event => editTransition({ color: event.target.value })} /></Field>
        <Field label="纯色停留秒数"><NumberInput aria-label="演出纯色停留秒数" min={0} max={60} step={.1} value={transition.hold} onChange={event => editTransition({ hold: Math.max(0, Math.min(60, Number(event.target.value) || 0)) })} /></Field>
        <Field label="淡入秒数"><NumberInput aria-label="演出淡入秒数" min={0} max={60} step={.1} value={transition.inDuration} onChange={event => editTransition({ inDuration: Math.max(0, Math.min(60, Number(event.target.value) || 0)) })} /></Field>
      </>}
    </>}
  </details>;
}
