import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Project } from '../core/model';
import { editFlowCaptionSlot, editFlowCaptionText, flowCaptionSlotIndex, type FlowCaptionProperty, type FlowCaptionStyles, type FlowStyleProperty } from '../core/flow-style-editing';
import { IconButton } from './components';
import { NumberInput } from './NumberInput';
import { UiAssetSelect } from './AssetPicker';
import { UiDesignColorField } from './UiDesignColorField';
import { FlowStyleField } from './FlowStyleField';
import { UiPropertyGroup } from './UiPropertyGroup';
import type { AssetUrl } from './StageEditor';
import './flow-style-fields.css';

const captionMappingSearchLabels = [
  '分段对应关系', '添加分段样式', '预设添加分段样式', '删除分段样式', '未使用样式', '此样例未使用', '从末尾对应', '应用对应变化', '取消',
  ...Array.from({ length: 8 }, (_, index) => [`第 ${index + 1} 项`, ...['', '预设'].flatMap(prefix => [`删除${prefix}第 ${index + 1} 段样式`, ...['字体', '字号', '颜色', '字间距', '后面间距'].map(label => `${prefix}第 ${index + 1} 项样式${label}`)])]).flat(),
];
export const uiFlowCaptionSearchLabels = [
  '文字', '分段文字样式', '选择要调整的文字段', '字体', '字号', '颜色', '字间距', '段内字间距', '字符距离', '与下一段间距', '段间距', '段后间距',
  '恢复此段继承', '沿用整组基础字间距', '改用整组基础字间距（单独设置分段）', '恢复基础分段样式',
  '整套分段改用本图设置', '清除本图分段样式，改用整组基础文字', ...captionMappingSearchLabels,
  ...['', '预设'].flatMap(prefix => Array.from({ length: 8 }, (_, index) => ['字体', '字号', '颜色', '字间距', '后面间距', '样式'].map(label => `${prefix}第 ${index + 1} 段${label}`)).flat()),
] as const;

/** Actual caption text selects its effective slot; arrays still override as one unit. */
export function FlowCaptionParts({ project, parts, base, assetUrl, onChange, prefix = '', texts, selectedPart, onSelectPart, onFocusProperty, scope = 'flow-caption', inherited = false }: {
  project: Project; parts?: FlowCaptionStyles; base: { fontAssetId?: string; fontSize: number; textColor: string; letterSpacing?: number };
  assetUrl: AssetUrl; onChange: (parts?: FlowCaptionStyles, options?: { separate?: boolean }) => void; prefix?: string;
  texts?: readonly string[]; selectedPart?: number; onSelectPart?: (textIndex: number) => void;
  onFocusProperty?: (property: FlowStyleProperty) => void; scope?: string; inherited?: boolean;
}) {
  const [localPart, setLocalPart] = useState(0), [unusedSlot, setUnusedSlot] = useState<number>();
  const [pending, setPending] = useState<{ original?: FlowCaptionStyles; next?: FlowCaptionStyles; label: string }>();
  const list = parts ?? [];
  const sampleTexts = texts ?? Array.from({ length: list.length || 1 }, (_, index) => list.length > 1 ? `第 ${index + 1} 段示例` : '剧情标题');
  const activeText = Math.max(0, Math.min(selectedPart ?? localPart, sampleTexts.length - 1));
  const slotFor = (index: number, count = list.length) => flowCaptionSlotIndex(count, sampleTexts.length, index);
  const actualSlot = slotFor(activeText);
  const slotTexts = (index: number) => sampleTexts.flatMap((text, at) => slotFor(at) === index ? [{ text, index: at }] : []);
  const textLabel = (text: string) => text || '（空文字）';
  const selectText = (index: number) => { setLocalPart(index); onSelectPart?.(index); setUnusedSlot(undefined); };
  const baseFont = project.assets.find(asset => asset.id === base.fontAssetId)?.name ?? '界面默认';
  const source = (slot: number | undefined, property: FlowCaptionProperty) => {
    if (property === 'gap' && (slot === undefined || list[slot]?.gap === undefined)) return '段后间距：16 px';
    if (property === 'letterSpacing' && (slot === undefined || list[slot]?.letterSpacing === undefined)) return `沿用整组基础字间距：${base.letterSpacing ?? 0} px`;
    if (slot === undefined || list[slot]?.[property] === undefined) return '沿用整组基础文字';
    return `${inherited ? '本图分段样式' : prefix ? '此预设分段样式' : '本图分段样式'} · 第 ${slot + 1} 项`;
  };
  const controls = (slot: number | undefined, textIndex: number | undefined, showGap: boolean) => {
    const part = slot === undefined ? {} : list[slot] ?? {};
    const predictedSlot = slot ?? flowCaptionSlotIndex(Math.min(8, sampleTexts.length), sampleTexts.length, textIndex ?? 0) ?? 0;
    const edit = (key: FlowCaptionProperty, value: FlowCaptionStyles[number][FlowCaptionProperty], separate = false) => {
      const next = textIndex === undefined ? editFlowCaptionSlot(list, predictedSlot, key, value)
        : editFlowCaptionText(parts, sampleTexts.length, textIndex, key, value);
      onChange(next, { separate });
    };
    const fieldScope = `${scope}/${textIndex === undefined ? 'slot' : 'text'}/${textIndex ?? slot}/${predictedSlot}`;
    const names = { fontAssetId: '字体', fontSize: '字号', color: '颜色', letterSpacing: '字间距', gap: '段后间距' };
    const field = (key: FlowCaptionProperty) => ({
      scope: `${fieldScope}/${key}`, source: source(slot, key), canReset: part[key] !== undefined,
      onReset: () => edit(key, undefined, true),
      resetLabel: key === 'gap' ? '恢复段后间距 16 px' : inherited ? `改用整组基础${names[key]}（单独设置分段）` : `沿用整组基础${names[key]}`,
      onFocus: () => onFocusProperty?.({ kind: 'caption', index: predictedSlot, key }),
    });
    const aria = textIndex === undefined ? `${prefix}第 ${(slot ?? 0) + 1} 项样式` : `${prefix}第 ${textIndex + 1} 段`;
    return <div className="flow-caption-selected-fields" data-flow-caption-slot={slot} data-flow-caption-text-index={textIndex}>
      <FlowStyleField label="字体" {...field('fontAssetId')}><UiAssetSelect project={project} assetUrl={assetUrl} kind="font" label={`${aria}字体`} value={part.fontAssetId} empty={`整组基础字体：${baseFont}`} onChange={value => edit('fontAssetId', value)} /></FlowStyleField>
      <FlowStyleField label="字号 px" {...field('fontSize')}><NumberInput aria-label={`${aria}字号`} min={.01} step={1} value={part.fontSize ?? base.fontSize} onChange={event => edit('fontSize', event.target.valueAsNumber)} /></FlowStyleField>
      <FlowStyleField label="字间距 px" {...field('letterSpacing')}><NumberInput aria-label={`${aria}字间距`} step={0.1} value={part.letterSpacing ?? base.letterSpacing ?? 0} onChange={event => edit('letterSpacing', event.target.valueAsNumber)} /></FlowStyleField>
      <FlowStyleField label={`${aria}颜色`} raw {...field('color')}><UiDesignColorField label={`${aria}颜色`} value={part.color ?? base.textColor} onChange={value => edit('color', value)} /></FlowStyleField>
      {part.color !== undefined && <small className="flow-style-note">此段单独设置了颜色，悬停等状态也使用这个颜色。</small>}
      {part.letterSpacing !== undefined && <small className="flow-style-note">此段单独设置了字间距，优先于整组基础字间距。</small>}
      {showGap && <FlowStyleField label="与下一段间距 px" {...field('gap')}><NumberInput aria-label={`${aria}后面间距`} min={0} step={1} value={part.gap ?? 16} onChange={event => edit('gap', event.target.valueAsNumber)} /></FlowStyleField>}
    </div>;
  };
  const sameSlot = actualSlot === undefined ? [] : slotTexts(actualSlot).filter(item => item.index !== activeText);
  const proposed = pending?.original === parts ? pending : undefined;
  const describeSlot = (next: FlowCaptionStyles | undefined, index: number) => {
    const at = flowCaptionSlotIndex(next?.length ?? 0, sampleTexts.length, index);
    const part = at === undefined ? undefined : next?.[at];
    const font = project.assets.find(asset => asset.id === (part?.fontAssetId ?? base.fontAssetId))?.name ?? '界面默认';
    return `${at === undefined ? '基础文字' : `第 ${at + 1} 项`} · ${font} · ${part?.fontSize ?? base.fontSize} px · 字间距 ${part?.letterSpacing ?? base.letterSpacing ?? 0} px`;
  };
  return <div className="flow-caption-editor">
    {!!sampleTexts.length && <>
      <div className="flow-caption-text-tabs" role="tablist" aria-label="选择要调整的文字段">{sampleTexts.map((text, index) => <button key={index} type="button" role="tab" aria-selected={activeText === index} className={activeText === index ? 'is-active' : ''} onClick={() => selectText(index)} title={textLabel(text)}>{textLabel(text)}</button>)}</div>
      {texts === undefined && <small className="flow-style-note">尚无可显示的剧情文字，使用示例查看分段效果。</small>}
      {actualSlot === undefined ? <small className="flow-style-note">当前沿用整组基础文字；修改后为所选文字保存分段样式。</small>
        : sameSlot.length ? <small className="flow-style-note">与 {sameSlot.map(item => `“${textLabel(item.text)}”`).join('、')} 共用第 {actualSlot + 1} 项样式，修改会一起生效。</small>
          : <small className="flow-style-note">“{textLabel(sampleTexts[activeText])}”使用第 {actualSlot + 1} 项样式；未设置的项沿用整组基础文字。</small>}
      {inherited && <small className="flow-style-note">这套分段沿用本图设置。修改任一段后，此预设会单独保存整套分段。</small>}
      <small className="flow-style-note">字间距控制同一段内字符之间的距离；“与下一段间距”控制相邻文字段之间的留白。</small>
      {controls(actualSlot, activeText, activeText < sampleTexts.length - 1)}
    </>}
    {!sampleTexts.length && <p className="flow-style-note">此节点当前没有文字，可在下面管理已有分段样式。</p>}
    <UiPropertyGroup id={`${scope}-caption-mapping`} title="分段对应关系" summary={`${list.length} 项样式`} searchKeywords={captionMappingSearchLabels} >
      <p className="flow-style-note">样式从末尾对应文字；只有一段文字时使用最后一项。新增或删除前会列出对应变化。</p>
      <div className="flow-caption-slot-list">{list.map((_, index) => {
        const used = slotTexts(index);
        return <div key={index} className="flow-caption-slot-row">
          <button type="button" className="flow-caption-slot-link" onClick={() => used.length ? selectText(used[0].index) : setUnusedSlot(index)}><span>第 {index + 1} 项</span><small>{used.length ? used.map(item => textLabel(item.text)).join('、') : '此样例未使用，点击编辑'}</small></button>
          <IconButton title={`删除${prefix}第 ${index + 1} 段样式`} onClick={() => setPending({ original: parts, next: list.length > 1 ? list.filter((_, at) => at !== index) : undefined, label: `删除第 ${index + 1} 项样式` })}><Trash2 size={13} /></IconButton>
        </div>;
      })}</div>
      {unusedSlot !== undefined && list[unusedSlot] && !slotTexts(unusedSlot).length && <div className="flow-caption-unused-editor"><strong>第 {unusedSlot + 1} 项 · 此样例未使用</strong><small className="flow-style-note">更多分段的节点可能使用此项，当前预览不会变化。</small>{controls(unusedSlot, undefined, true)}</div>}
      <button type="button" className="small-button flow-caption-add" disabled={list.length >= 8} onClick={() => setPending({ original: parts, next: [...list, {}], label: '添加一项分段样式' })}><Plus size={13} />{prefix}添加分段样式</button>
      {proposed && <div className="flow-caption-mapping-preview" role="group" aria-label="分段对应变化预览">
        <strong>{proposed.label}</strong>
        {sampleTexts.map((text, index) => <div key={index}><span>{textLabel(text)}</span><small>{describeSlot(parts, index)} → {describeSlot(proposed.next, index)}</small></div>)}
        {!sampleTexts.length && <small>当前没有样例文字；其他引用会按新的样式数量从末尾对应。</small>}
        <div className="button-row"><button type="button" className="small-button" onClick={() => { onChange(proposed.next, { separate: true }); setPending(undefined); setUnusedSlot(undefined); }}>应用对应变化</button><button type="button" className="text-button" onClick={() => setPending(undefined)}>取消</button></div>
      </div>}
    </UiPropertyGroup>
  </div>;
}
