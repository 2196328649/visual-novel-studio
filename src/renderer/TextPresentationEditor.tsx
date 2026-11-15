import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { effectiveUiComponents, makeId, type Project, type TextPresentation, type TextPresentationStyle } from '../core/model';
import { uiPageTheme } from '../core/ui-page-settings';
import { defaultLoopSpeed, defaultLoopStrength, defaultScreenPlacement, defaultTypeSoundEvery, editTextTypeSound, isBuiltinTextPreset, mergeTextStyles, resolveTextStyle, textAlignNames, textLoopNames, textPlacementNames, textPreset, textPresets, textRevealPlan, textSpeedNames, textTypeSoundMode, type TextTypeSoundMode } from '../core/text-presentation';
import type { TextMarks } from '../core/text-spans';
import { readAudioDuration } from './audio-metadata';
import { UiAssetSelect } from './AssetPicker';
import { Field, IconButton } from './components';
import type { Commit } from './editor';
import { NumberInput } from './NumberInput';
import type { AssetUrl } from './StageEditor';
import { playerTextSpeed, TextLookSample } from './StyledText';
import { TextAnimatorFields } from './TextAnimatorFields';

type Key = Exclude<keyof TextPresentationStyle, 'textEffects'>;
type EffectKey = keyof NonNullable<TextPresentationStyle['textEffects']>;
type Tab = 'style' | 'speed' | 'place' | 'motion' | 'exit' | 'sound';
/** A tab the host adds around the text settings. `look` keeps the preset row and sample in view. */
export interface TextPanelTab { id: string; label: string; set?: boolean; look?: boolean; content: ReactNode }

const tabs: [Tab, string, (keyof TextPresentation)[]][] = [
  ['style', '文字样式', ['fontAssetId', 'sizeScale', 'color', 'bold', 'italic', 'align', 'textEffects']],
  ['speed', '播放速度', ['speed', 'duration', 'cps']],
  ['place', '位置', ['placement', 'x', 'y', 'width']],
  ['motion', '文字动画', ['entrance', 'entranceTime', 'entranceAnimation', 'loop', 'loopStrength', 'loopSpeed']],
  ['exit', '文字退场', ['exit', 'exitTotal', 'exitTime', 'exitAnimation']],
  ['sound', '打字音', ['typeSoundId', 'typeSoundEvery', 'typeSoundVolume']],
];

/** Edit a text look for a dialogue line, a character's default or a preset.
 * Every field shows the value in effect; a dot marks the ones set here, and the
 * arrow returns a field to what it inherits. */
export function TextPresentationFields({ project, look, target, commit, inherited, inheritedLabel, text = '', voiceId, assetUrl, allowPresets = true, marks, leadingTabs = [], trailingTabs = [], onDelete, deletable }: {
  project: Project; look?: TextPresentation;
  /** Resolve the exact current owner; deleted targets must never fall back to another line. */
  target: (draft: Project) => { textPresentation?: TextPresentation; voiceId?: string } | undefined;
  commit: Commit; inherited?: TextPresentationStyle; inheritedLabel?: string; text?: string; voiceId?: string; assetUrl: AssetUrl; allowPresets?: boolean; marks?: TextMarks;
  leadingTabs?: TextPanelTab[]; trailingTabs?: TextPanelTab[];
  /** Replaces the plain clear, for hosts that remove more than the look. */ onDelete?: () => void; deletable?: boolean;
}) {
  const theme = uiPageTheme(project, 'ui:say');
  const dialogue = effectiveUiComponents(project.ui).find(component => component.page === 'say' && component.binding === 'dialogue');
  const [tab, setTab] = useState<string>(leadingTabs[0]?.id ?? 'style');
  const hosted = [...leadingTabs, ...trailingTabs].find(item => item.id === tab);
  const own = look ?? {};
  const presetStyle = textPreset(project, own.presetId)?.style;
  const effective = useMemo(() => mergeTextStyles(inherited, resolveTextStyle(project, look)), [inherited, project, look]);
  const baseDialogue = effective.placement === 'screen' ? undefined : dialogue;
  const textColor = baseDialogue?.style?.textColor ?? theme.textColor;
  const [naming, setNaming] = useState<string>();
  const [voiceStatus, setVoiceStatus] = useState('');
  const voiceRead = useRef<AbortController | undefined>(undefined);
  const voiceUrl = voiceId ? assetUrl(voiceId) : undefined;
  useEffect(() => {
    setVoiceStatus('');
    return () => { voiceRead.current?.abort(); voiceRead.current = undefined; };
  }, [project.id, voiceId, voiceUrl]);
  const clean = (next: TextPresentation): TextPresentation | undefined => {
    const result: TextPresentation = { ...next };
    for (const key of Object.keys(result) as (keyof TextPresentation)[]) if (result[key] === undefined) delete result[key];
    if (result.textEffects) { result.textEffects = { ...result.textEffects }; for (const key of Object.keys(result.textEffects) as EffectKey[]) if (result.textEffects[key] === undefined) delete result.textEffects[key]; if (!Object.keys(result.textEffects).length) delete result.textEffects; }
    return Object.keys(result).length ? result : undefined;
  };
  const apply = (draft: Project, next?: TextPresentation) => {
    if (draft.id !== project.id) return;
    const owner = target(draft);
    if (!owner) return;
    const value = next && clean(next);
    if (value) owner.textPresentation = value; else delete owner.textPresentation;
  };
  const save = (label: string, change: (current: TextPresentation) => TextPresentation, expectedVoice?: string) => commit(label, draft => {
    if (draft.id !== project.id) return;
    const owner = target(draft);
    if (!owner || expectedVoice !== undefined && owner.voiceId !== expectedVoice) return;
    apply(draft, change(owner.textPresentation ?? {}));
  });
  // Clearing an effect clears the adjustments made to it.
  const set = <K extends Key>(key: K, value: TextPresentation[K]) => save('文字演出', current => ({ ...current, [key]: value, ...(key === 'entrance' && value === undefined ? { entranceAnimation: undefined } : {}), ...(key === 'exit' && value === undefined ? { exitAnimation: undefined } : {}) }));
  const setEffect = (key: EffectKey, value: string | number | undefined) => save('文字演出', current => ({ ...current, textEffects: { ...current.textEffects, [key]: value } }));
  const row = (key: Key | EffectKey, field: ReactNode, effect = false) => {
    const isSet = effect ? own.textEffects?.[key as EffectKey] !== undefined : own[key as Key] !== undefined;
    return <div className={`text-look-row${isSet ? ' is-set' : ''}`}>{field}{isSet && <IconButton className="text-look-reset" title="恢复为继承值" onClick={() => effect ? setEffect(key as EffectKey, undefined) : set(key as Key, undefined)}><RotateCcw size={12} /></IconButton>}</div>;
  };
  const number = (key: Key, label: string, value: number, change: (value: number) => void, valid: (value: number) => boolean = () => true, step = 1) =>
    row(key, <Field label={label}><NumberInput aria-label={label} type="number" step={step} value={+value.toFixed(4)} onChange={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next) && valid(next)) change(next); }} /></Field>);
  const select = <T extends string>(key: Key, label: string, names: Record<T, string>, value: T, change?: (value: T) => void) =>
    row(key, <Field label={label}><select aria-label={label} value={value} onChange={event => (change ?? (next => set(key, next as never)))(event.target.value as T)}>{(Object.entries(names) as [T, string][]).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>);
  const check = (key: 'bold' | 'italic', label: string) => row(key, <Field label={label}><input aria-label={label} type="checkbox" checked={!!effective[key]} onChange={event => set(key, event.target.checked)} /></Field>);

  const speed = effective.speed === 'duration' && !effective.duration || effective.speed === 'cps' && !effective.cps ? 'player' : effective.speed ?? 'player';
  const plan = textRevealPlan(effective, text, playerTextSpeed(project), marks);
  const count = plan.count;
  const entrance = effective.entrance ?? 'none', loop = effective.loop ?? 'none', placement = effective.placement ?? 'dialogue';
  const presets = textPresets(project);
  const custom = own.presetId && !isBuiltinTextPreset(own.presetId) ? project.textPresets?.find(preset => preset.id === own.presetId) : undefined;
  const { presetId: _presetId, ...ownStyle } = own;
  const hasOwnStyle = Object.keys(ownStyle).length > 0;
  const soundMode = textTypeSoundMode(own, effective);
  const hasOwnSound = soundMode !== 'inherit';
  const soundAsset = project.assets.find(asset => asset.id === effective.typeSoundId && asset.kind === 'audio');
  const soundStatus = effective.typeSoundVolume === 0 ? '静音（音量 0%）' : soundAsset ? `${soundAsset.name} · 音量 ${+((effective.typeSoundVolume ?? 1) * 100).toFixed(2)}%`
    : effective.typeSoundId ? '声音素材已丢失，不播放' : '未设置声音，不播放';
  const soundSource = own.typeSoundId !== undefined ? '本处设置' : presetStyle?.typeSoundId !== undefined ? `预设“${textPreset(project, own.presetId)!.name}”`
    : inherited?.typeSoundId !== undefined ? inheritedLabel ?? '上级文字演出' : '未设置';
  const changeSound = (mode: TextTypeSoundMode, assetId?: string) => save('打字音', current => editTextTypeSound(current, mergeTextStyles(inherited, textPreset(project, current.presetId)?.style), mode, assetId));

  const matchVoice = () => {
    if (!voiceUrl || !voiceId) return;
    voiceRead.current?.abort();
    setVoiceStatus('正在读取配音时长…');
    const controller = new AbortController();
    voiceRead.current = controller;
    readAudioDuration(voiceUrl, controller.signal).then(seconds => {
      if (controller.signal.aborted) return;
      // Merge into the current transaction: metadata can arrive after the
      // author changes colour, preset or font while the file is being read.
      save('文字时长对齐配音', current => ({ ...current, speed: 'duration', duration: Math.max(.01, +seconds.toFixed(2)) }), voiceId);
      setVoiceStatus(`已设为配音时长 ${seconds.toFixed(2)} 秒。`);
    }).catch(error => { if (!controller.signal.aborted) setVoiceStatus(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (voiceRead.current === controller) voiceRead.current = undefined; });
  };

  const tabButton = (id: string, name: string, set?: boolean) => <button key={id} type="button" role="tab" aria-label={name} aria-selected={tab === id} className={set ? 'is-set' : undefined} onClick={() => setTab(id)}>{name}</button>;
  return <div className="text-look-editor">
    {(!hosted || hosted.look) && <>
    {allowPresets && <div className="text-look-presets">
      <select aria-label="文字演出预设" value={own.presetId ?? ''} onChange={event => { const presetId = event.target.value || undefined; save('套用文字演出预设', current => ({ ...current, presetId })); }}>
        <option value="">不使用预设</option>
        <optgroup label="内置预设">{presets.filter(preset => isBuiltinTextPreset(preset.id)).map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</optgroup>
        {!!project.textPresets?.length && <optgroup label="我的预设">{project.textPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</optgroup>}
        {own.presetId && !presets.some(preset => preset.id === own.presetId) && <option value={own.presetId}>已删除的预设</option>}
      </select>
      <button type="button" className="small-button" disabled={!hasOwnStyle && !own.presetId} onClick={() => setNaming('')}>存为预设</button>
      {custom && <button type="button" className="small-button" disabled={!hasOwnStyle} title="把这里调整的项目写入预设，所有使用它的台词一起更新" onClick={() => commit('更新文字演出预设', draft => {
        const preset = draft.textPresets?.find(item => item.id === custom.id);
        if (preset) preset.style = mergeTextStyles(preset.style, ownStyle);
        apply(draft, { presetId: custom.id });
      })}>更新预设</button>}
      {(deletable ?? !!look) && <button type="button" className="small-button text-look-delete" onClick={() => onDelete ? onDelete() : commit('删除文字演出', draft => apply(draft, undefined))}><Trash2 size={12} />删除文字演出</button>}
    </div>}
    {naming !== undefined && <div className="text-look-presets">
      <input aria-label="新预设名称" placeholder="预设名称，例如 心声" autoFocus value={naming} maxLength={80} onChange={event => setNaming(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setNaming(undefined); }} />
      <button type="button" className="small-button" disabled={!naming.trim() || presets.some(preset => preset.name === naming.trim())} onClick={() => {
        const preset = { id: makeId('textlook'), name: naming.trim(), style: mergeTextStyles(presetStyle, ownStyle) };
        commit('保存文字演出预设', draft => { draft.textPresets = [...(draft.textPresets ?? []), preset]; apply(draft, { presetId: preset.id }); });
        setNaming(undefined);
      }}>保存</button>
      <button type="button" className="small-button" onClick={() => setNaming(undefined)}>取消</button>
    </div>}
    {naming !== undefined && presets.some(preset => preset.name === naming.trim()) && <p className="text-look-hint muted" role="alert">已有同名预设。</p>}
    {custom && <details className="ui-property-group"><summary>管理预设“{custom.name}”</summary>
      <Field label="预设名称"><input aria-label="预设名称" value={custom.name} maxLength={80} onChange={event => { const name = event.target.value; if (name.trim() && !presets.some(preset => preset.id !== custom.id && preset.name === name.trim())) commit('重命名文字演出预设', draft => { const preset = draft.textPresets?.find(item => item.id === custom.id); if (preset) preset.name = name; }); }} /></Field>
      <button type="button" className="small-button" onClick={() => commit('删除文字演出预设', draft => {
        // Lines that used the preset keep its look as their own settings.
        const removed = draft.textPresets?.find(item => item.id === custom.id);
        draft.textPresets = draft.textPresets?.filter(item => item.id !== custom.id);
        const detach = (value?: TextPresentation) => value?.presetId === custom.id ? clean({ ...mergeTextStyles(removed?.style, value) }) : value;
        for (const node of draft.nodes) if (node.kind === 'passage') for (const line of node.lines) { const next = detach(line.textPresentation); if (next) line.textPresentation = next; else delete line.textPresentation; }
        for (const character of draft.characters) { const next = detach(character.textPresentation); if (next) character.textPresentation = next; else delete character.textPresentation; }
      })}>删除预设</button>
      <p className="text-look-hint muted">删除后，使用它的台词和角色保留相同效果，改为各自的设置。</p>
    </details>}
    {inheritedLabel && <p className="text-look-inherit muted">未单独设置的项目沿用{inheritedLabel}。</p>}

    <TextLookSample project={project} style={effective} text={text} marks={marks} assetUrl={assetUrl} fontSize={baseDialogue?.style?.fontSize ?? theme.fontSize} fontAssetId={baseDialogue?.style?.fontAssetId ?? theme.fontAssetId} textColor={textColor} align={baseDialogue?.style?.align} />
    </>}

    <div className="text-look-tabs" role="tablist" aria-label="台词演出设置">
      {leadingTabs.map(item => tabButton(item.id, item.label, item.set))}
      {tabs.map(([id, name, keys]) => tabButton(id, name, keys.some(key => own[key] !== undefined)))}
      {trailingTabs.map(item => tabButton(item.id, item.label, item.set))}
    </div>

    {tab === 'style' && <div className="text-look-grid" role="tabpanel">
      {row('fontAssetId', <Field label="字体"><UiAssetSelect project={project} kind="font" category="all" label="文字演出字体" empty={placement === 'screen' ? '对话页面字体' : '对话框字体'} value={effective.fontAssetId} assetUrl={assetUrl} onChange={value => set('fontAssetId', value)} /></Field>)}
      {number('sizeScale', '大小 %', (effective.sizeScale ?? 1) * 100, value => set('sizeScale', value / 100), value => value > 0)}
      {row('color', <Field label="颜色"><input aria-label="文字颜色" type="color" value={effective.color ?? textColor.slice(0, 7)} onChange={event => set('color', event.target.value)} /></Field>)}
      {select('align', '对齐', textAlignNames, effective.align ?? (placement === 'screen' ? 'center' : baseDialogue?.style?.align ?? 'left'))}
      {check('bold', '粗体')}
      {check('italic', '斜体')}
      <p className="text-look-hint muted">可搜索或浏览项目中的全部字体；在字体资源浏览器中点“选择项目外素材”可导入 TTF、OTF 字体。粗体、斜体会在所选字体上加粗、倾斜。</p>
      {([['outlineWidth', '描边宽度', 0, 1], ['outlineOpacity', '描边不透明度', 1, .1], ['shadowX', '阴影横向偏移', 0, 1], ['shadowY', '阴影纵向偏移', 0, 1], ['shadowBlur', '阴影柔化', 0, 1], ['shadowOpacity', '阴影不透明度', .7, .1]] as const).map(([key, label, fallback, step]) =>
        <div key={key}>{row(key, <Field label={label}><NumberInput aria-label={label} type="number" step={step} value={effective.textEffects?.[key] ?? fallback} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value) && (key === 'shadowX' || key === 'shadowY' || value >= 0 && (!key.endsWith('Opacity') || value <= 1))) setEffect(key, value); }} /></Field>, true)}</div>)}
      {([['outlineColor', '描边颜色'], ['shadowColor', '阴影颜色']] as const).map(([key, label]) => <div key={key}>{row(key, <Field label={label}><input aria-label={label} type="color" value={effective.textEffects?.[key] ?? '#000000'} onChange={event => setEffect(key, event.target.value)} /></Field>, true)}</div>)}
    </div>}

    {tab === 'speed' && <div className="text-look-grid" role="tabpanel">
      {select('speed', '显示方式', textSpeedNames, speed, value => save('文字演出', current => ({ ...current, speed: value, ...(value === 'duration' && !effective.duration ? { duration: Math.max(.01, +(plan.seconds || Math.max(.5, count / Math.max(1, playerTextSpeed(project)))).toFixed(2)) } : {}), ...(value === 'cps' && !effective.cps ? { cps: playerTextSpeed(project) || 30 } : {}) })))}
      {speed === 'duration' && number('duration', '整句时长（秒）', effective.duration!, value => set('duration', value), value => value > 0, .1)}
      {speed === 'cps' && number('cps', '每秒字数', effective.cps!, value => set('cps', value), value => value > 0)}
      {speed === 'duration' && <p className="text-look-hint muted" role="status">{!count
        ? `这句没有文字${plan.pauseSeconds ? `，仅保留 ${+plan.pauseSeconds.toFixed(3)} 秒的停顿` : ''}。`
        : plan.extended
        ? `停顿共 ${+plan.pauseSeconds.toFixed(3)} 秒，已达到整句目标。保留停顿和 ${effective.duration} 秒的文字显示预算，实际约 ${+plan.seconds.toFixed(3)} 秒完成。`
        : `整句目标 ${effective.duration} 秒${count ? `，实际约 ${+plan.seconds.toFixed(3)} 秒完成，基准速度每秒 ${plan.cps.toFixed(1)} 字` : ''}。停顿与各字入场都计入完成时间。`}</p>}
      {voiceId && <div className="text-look-presets"><button type="button" className="small-button" onClick={matchVoice}>时长与配音一致</button><span className="muted text-look-hint" role="status">{voiceStatus}</span></div>}
    </div>}

    {tab === 'place' && <div className="text-look-grid" role="tabpanel">
      {select('placement', '显示位置', textPlacementNames, placement)}
      {placement === 'screen' && <>
        {number('x', '横向位置 %', (effective.x ?? defaultScreenPlacement.x) * 100, value => set('x', value / 100))}
        {number('y', '纵向位置 %', (effective.y ?? defaultScreenPlacement.y) * 100, value => set('y', value / 100))}
        {number('width', '文字区域宽度 %', (effective.width ?? defaultScreenPlacement.width) * 100, value => set('width', value / 100), value => value > 0)}
        <p className="text-look-hint muted">隐藏对话框和说话人名，把这句文字放在画面上，适合独白、字幕和画面大字。可以在右侧预览里直接拖动文字，两侧手柄调宽度；上面的数值是文字中心。</p>
      </>}
    </div>}

    {tab === 'motion' && <div className="text-look-grid" role="tabpanel">
      <TextAnimatorFields phase="entrance" motion={effective} onChange={patch => save('文字演出', current => ({ ...current, ...patch }))} wrap={(key, field) => row(key as Key, field)} />
      {entrance !== 'none' && speed === 'duration' && <p className="text-look-hint muted">以当前顺序中最后完成入场的字为准；每字入场最多占文字显示预算的一半。{plan.extended ? `停顿使整句顺延至约 ${+plan.seconds.toFixed(3)} 秒。` : `整句约 ${+plan.seconds.toFixed(3)} 秒完成。`}</p>}
      {select('loop', '持续效果', textLoopNames, loop)}
      {loop !== 'none' && number('loopStrength', loop === 'pulse' ? '明暗变化 %' : '幅度（像素）', effective.loopStrength ?? defaultLoopStrength[loop], value => set('loopStrength', value), value => value >= 0)}
      {(loop === 'wave' || loop === 'pulse') && number('loopSpeed', '每秒次数', effective.loopSpeed ?? defaultLoopSpeed[loop], value => set('loopSpeed', value), value => value > 0, .1)}
    </div>}

    {tab === 'exit' && <div className="text-look-grid" role="tabpanel">
      <TextAnimatorFields phase="exit" motion={effective} onChange={patch => save('文字演出', current => ({ ...current, ...patch }))} wrap={(key, field) => row(key as Key, field)} />
    </div>}

    {tab === 'sound' && <div className="text-look-grid" role="tabpanel">
      <div className={`text-look-row text-look-wide${hasOwnSound ? ' is-set' : ''}`}>
        <Field label="打字音方式"><select aria-label="打字音方式" value={soundMode} onChange={event => changeSound(event.target.value as TextTypeSoundMode)}>
          <option value="inherit">沿用上级／预设</option><option value="mute">无打字音（静音）</option><option value="sound">播放打字音</option>
        </select></Field>
        {hasOwnSound && <IconButton className="text-look-reset" title="恢复沿用上级／预设的打字音" onClick={() => changeSound('inherit')}><RotateCcw size={12} /></IconButton>}
      </div>
      <p className="text-look-hint text-look-wide muted" role="status">当前：{soundStatus}。{soundMode === 'inherit' ? '未单独设置的声音、音量和节拍沿用上级或预设。' : soundMode === 'mute' ? '恢复播放时可继续使用原声音。' : ''}</p>
      {effective.typeSoundId && <p className="text-look-hint text-look-wide muted">声音来源：{soundSource}。</p>}
      {soundMode !== 'mute' && <div className="text-look-wide">{row('typeSoundId', <Field label="声音"><UiAssetSelect project={project} kind="audio" category="sound" label="打字音" empty="无打字音" value={effective.typeSoundId} assetUrl={assetUrl} onChange={value => changeSound(value === undefined ? 'mute' : 'sound', value)} /></Field>)}</div>}
      {soundMode !== 'mute' && effective.typeSoundId && <>
        {number('typeSoundEvery', '每隔几个字响一次', effective.typeSoundEvery ?? defaultTypeSoundEvery, value => set('typeSoundEvery', Math.round(value)), value => value >= 1)}
        {number('typeSoundVolume', '音量 %', (effective.typeSoundVolume ?? 1) * 100, value => set('typeSoundVolume', value / 100), value => value >= 0 && value <= 100)}
        <p className="text-look-hint muted">逐字显示时播放，标点和空格不发声。声音跟随玩家的音效音量；音量设为 0 时这句不发声。点上面的“重播”试听。</p>
      </>}
      {speed === 'instant' && <p className="text-look-hint text-look-wide muted">当前文字为瞬间显示，不播放打字音。</p>}
    </div>}

    {hosted && <div role="tabpanel">{hosted.content}</div>}
  </div>;
}
