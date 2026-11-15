import { useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { textEntranceEffects, type Project, type StoryLine, type TextSpanStyle } from '../core/model';
import { defaultEntranceTime, defaultLoopSpeed, defaultLoopStrength, textEntranceNames, textLoopNames } from '../core/text-presentation';
import { applySpanStyle, clearSpanStyle, hasTextMarks, normalizeTextMarks, setTextPause, sharedSpanStyle, textRangeWords, textSpanSummary, writeLineMarks } from '../core/text-spans';
import { IconButton } from './components';
import { NumberInput } from './NumberInput';
import { UiAssetSelect } from './AssetPicker';
import type { AssetUrl } from './StageEditor';

export type LineEdit = (label: string, change: (line: StoryLine) => void) => void;

function SpanNumber({ label, name, value, step = 1, min, onChange }: { label: string; name: string; value: number; step?: number; /** Lowest value that makes sense; a value at or below `min` when exclusive is ignored. */ min: { above: number } | { from: number }; onChange: (value: number) => void }) {
  return <label className="text-span-field"><span>{label}</span><NumberInput aria-label={name} type="number" step={step} value={value} onChange={event => { const next = event.target.valueAsNumber; if ('above' in min ? next > min.above : next >= min.from) onChange(next); }} /></label>;
}

/** The controls for one part of a line. Every change is a patch, so other fields stay. */
export function TextSpanControls({ project, style, onChange, assetUrl }: { project: Project; style: TextSpanStyle; onChange: (patch: Partial<TextSpanStyle>) => void; assetUrl: AssetUrl }) {
  const loop = style.loop && style.loop !== 'none' ? style.loop : undefined;
  const entrance = style.entrance && style.entrance !== 'none' ? style.entrance : undefined;
  return <div className="text-span-controls">
    <label className="text-span-field"><span>颜色</span><span className="text-span-color">
      <input aria-label="局部文字颜色" type="color" value={style.color ?? '#ffffff'} onChange={event => onChange({ color: event.target.value })} />
      {style.color && <IconButton title="恢复这句的颜色" onClick={() => onChange({ color: undefined })}><RotateCcw size={12} /></IconButton>}
    </span></label>
    <SpanNumber label="大小 %" name="局部大小百分比" value={+((style.sizeScale ?? 1) * 100).toFixed(2)} min={{ above: 0 }} onChange={value => onChange({ sizeScale: value === 100 ? undefined : value / 100 })} />
    <div className="text-span-field"><span>字形</span><span className="text-span-toggles">
      <button type="button" className="small-button" aria-label="局部粗体" aria-pressed={!!style.bold} onClick={() => onChange({ bold: style.bold ? undefined : true })}><b>粗</b></button>
      <button type="button" className="small-button" aria-label="局部斜体" aria-pressed={!!style.italic} onClick={() => onChange({ italic: style.italic ? undefined : true })}><i>斜</i></button>
    </span></div>
    <label className="text-span-field is-wide"><span>字体</span><UiAssetSelect project={project} kind="font" category="all" label="局部文字字体" empty="这句的字体" value={style.fontAssetId} assetUrl={assetUrl} onChange={fontAssetId => onChange({ fontAssetId })} /></label>
    <SpanNumber label="速度倍数" name="局部速度倍数" step={.1} value={style.speed ?? 1} min={{ above: 0 }} onChange={value => onChange({ speed: value === 1 ? undefined : value })} />
    <label className="text-span-field is-wide"><span>入场</span><select aria-label="局部入场效果" value={style.entrance ?? ''} onChange={event => onChange({ entrance: (event.target.value || undefined) as TextSpanStyle['entrance'], entranceTime: undefined })}>
      <option value="">跟随整句</option>
      {textEntranceEffects.map(id => <option key={id} value={id}>{textEntranceNames[id]}</option>)}
    </select></label>
    {entrance && <SpanNumber label="每字入场（秒）" name="局部入场时间" step={.05} value={style.entranceTime ?? defaultEntranceTime[entrance]} min={{ from: 0 }} onChange={entranceTime => onChange({ entranceTime })} />}
    <label className="text-span-field is-wide"><span>持续动画</span><select aria-label="局部持续效果" value={style.loop ?? ''} onChange={event => onChange({ loop: (event.target.value || undefined) as TextSpanStyle['loop'], loopStrength: undefined, loopSpeed: undefined })}>
      <option value="">跟随整句</option>
      <option value="none">无动画</option>
      {(['shake', 'wave', 'pulse'] as const).map(id => <option key={id} value={id}>{textLoopNames[id]}</option>)}
    </select></label>
    {loop && <SpanNumber label={loop === 'pulse' ? '明暗变化 %' : '幅度（像素）'} name="局部动画幅度" value={style.loopStrength ?? defaultLoopStrength[loop]} min={{ from: 0 }} onChange={loopStrength => onChange({ loopStrength })} />}
    {loop && loop !== 'shake' && <SpanNumber label="每秒次数" name="局部动画频率" step={.1} value={style.loopSpeed ?? defaultLoopSpeed[loop]} min={{ above: 0 }} onChange={loopSpeed => onChange({ loopSpeed })} />}
  </div>;
}

/** Shown under a dialogue box while some of its words are selected. Offsets count characters. */
export function TextSelectionToolbar({ project, line, start, end, edit, assetUrl }: { project: Project; line: StoryLine; start: number; end: number; edit: LineEdit; assetUrl: AssetUrl }) {
  const style = sharedSpanStyle(line.text, line.textSpans, start, end);
  const pause = line.textPauses?.find(item => item.at === start)?.seconds;
  const marked = line.textSpans?.some(span => span.start < end && span.end > start);
  const words = textRangeWords(line.text, start, end);
  return <div className="text-selection-toolbar" role="toolbar" aria-label="选中文字效果" onClick={event => event.stopPropagation()}>
    <div className="text-selection-heading">
      <span>选中</span><strong className="text-selection-words" title={words}>{words}</strong>
      {(marked || pause) && <button type="button" className="small-button" onClick={() => edit('清除局部文字效果', target => writeLineMarks(target, { spans: clearSpanStyle(target.text, target.textSpans, start, end), pauses: setTextPause(target.textPauses, start, undefined) }))}><Trash2 size={12} />清除效果</button>}
    </div>
    <TextSpanControls project={project} assetUrl={assetUrl} style={style} onChange={patch => edit('局部文字效果 ' + Object.keys(patch).join(), target => {
      writeLineMarks(target, { spans: applySpanStyle(target.text, target.textSpans, start, end, patch), pauses: target.textPauses });
    })} />
    <div className="text-span-controls">
      <SpanNumber label="显示前停顿（秒）" name="在选中文字前停顿（秒）" step={.1} value={pause ?? 0} min={{ from: 0 }} onChange={value => edit('局部文字停顿', target => writeLineMarks(target, { spans: target.textSpans, pauses: setTextPause(target.textPauses, start, value || undefined) }))} />
    </div>
  </div>;
}

/** Everything set on parts of a line, so effects stay findable after the selection is gone. */
export function TextMarkList({ project, line, edit, flat = false, assetUrl }: { project: Project; line: StoryLine; edit: LineEdit; /** Inside its own tab, without the collapsible heading. */ flat?: boolean; assetUrl: AssetUrl }) {
  const [opened, setOpened] = useState<number>();
  const { spans, pauses } = normalizeTextMarks(line.text, { spans: line.textSpans, pauses: line.textPauses });
  const body = <>
    {!hasTextMarks(line) && <p className="text-look-hint muted">在模块编辑的台词框里选中几个字，可以单独改颜色、大小、速度、入场和动画，或让它们晚一点出现。文本编辑里右键选中的文字，或写 〖不想死｜颜色=#ff0000，逐字砸入，抖动〗、〖停顿=1〗。</p>}
    {spans.map(span => <div className="text-mark-row" key={span.start} data-text-mark="span">
      <button type="button" className="text-mark-summary" aria-expanded={opened === span.start} onClick={() => setOpened(current => current === span.start ? undefined : span.start)}>
        <strong>{textRangeWords(line.text, span.start, span.end)}</strong><small>{textSpanSummary(project, span.style)}</small>
      </button>
      <IconButton title="删除这段效果" onClick={() => edit('删除局部文字效果', target => writeLineMarks(target, { spans: clearSpanStyle(target.text, target.textSpans, span.start, span.end), pauses: target.textPauses }))}><Trash2 size={13} /></IconButton>
      {opened === span.start && <TextSpanControls project={project} assetUrl={assetUrl} style={span.style} onChange={patch => edit('局部文字效果 ' + Object.keys(patch).join(), target => writeLineMarks(target, { spans: applySpanStyle(target.text, target.textSpans, span.start, span.end, patch), pauses: target.textPauses }))} />}
    </div>)}
    {pauses.map(pause => <div className="text-mark-row" key={'pause' + pause.at} data-text-mark="pause">
      <label className="text-mark-summary">{pause.at < Array.from(line.text).length ? `“${textRangeWords(line.text, pause.at, pause.at + 6)}”前停顿（秒）` : '句末停顿（秒）'}
        <NumberInput aria-label="停顿秒数" type="number" step={.1} value={pause.seconds} onChange={event => { const value = event.target.valueAsNumber; if (value > 0) edit('局部文字停顿', target => writeLineMarks(target, { spans: target.textSpans, pauses: setTextPause(target.textPauses, pause.at, value) })); }} />
      </label>
      <IconButton title="删除这个停顿" onClick={() => edit('删除局部文字停顿', target => writeLineMarks(target, { spans: target.textSpans, pauses: setTextPause(target.textPauses, pause.at, undefined) }))}><Trash2 size={13} /></IconButton>
    </div>)}
  </>;
  if (flat) return <div className="text-mark-list">{body}</div>;
  return <details className="ui-property-group text-mark-list" open={hasTextMarks(line)}>
    <summary>局部效果{hasTextMarks(line) ? ` ${spans.length + pauses.length}` : ''}</summary>
    {body}
  </details>;
}
