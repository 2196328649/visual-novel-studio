import { cloneData } from "../core/project-mutation";
import { projectGraphs } from '../core/project-resources';
import { displayPresetLabel } from '../core/character-presets';
import { actorInstanceLabel } from '../core/actor-instance';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Clapperboard, Plus, Save, Sparkles, Trash2, Type, Volume2, X } from 'lucide-react';
import { effectiveCharacter, makeId, type Project, type StageAction, type StoryLine } from '../core/model';
import { actionNames, authorableActions, findLine, type Commit } from './editor';
import { ActionEditor, EffectManager, newAction } from './Inspector';
import { Field, IconButton } from './components';
import { UiAssetSelect } from './AssetPicker';
import type { AssetUrl } from './StageEditor';
import { EncapsulatePerformance } from './PerformanceTools';
import { assignBlueprintGroup, installPerformanceBlueprint } from '../core/blueprint-authoring';
import type { PerformanceTarget } from '../core/performance-workspace';
import { PerformancePlaybackFields } from './PerformancePlaybackFields';
import { TextPresentationFields } from './TextPresentationEditor';
import { speakerTextStyle, textStyleSummary } from '../core/text-presentation';
import { hasTextMarks, lineMarks, writeLineMarks } from '../core/text-spans';
import { TextMarkList } from './TextSpanTools';
import { createFloatingText } from '../core/media-command';

const actionLabel = (action: StageAction) => action.kind === 'visual' && action.content === 'text' ? '显示文字' : actionNames[action.kind];

function actionDetail(project: Project, action: StageAction) {
  if (action.kind === 'visual' && action.content === 'text') return action.text || '空文字';
  if ('assetId' in action) return project.assets.find(a => a.id === action.assetId)?.name ?? '选择素材';
  if (action.kind === 'show') { const c = effectiveCharacter(project, action.characterId); return `${c?.name ?? (action.characterId || '当前台词角色')} · ${actorInstanceLabel(action.instanceId)} · ${c?.expressions.find(e => e.id === action.expressionId)?.name ?? (action.expressionId || '默认表情')} · ${action.presetId ? displayPresetLabel(project, action.characterId, action.presetId) : `${action.x}，${action.scale}`}`; }
  if (action.kind === 'hide' || action.kind === 'animate') return `${project.characters.find(c => c.id === action.characterId)?.name ?? action.characterId} · ${actorInstanceLabel(action.instanceId)}`;
  if (action.kind === 'pause') return `${action.seconds} 秒`;
  if (action.kind === 'camera') return `${action.zoom} 倍 · ${action.duration} 秒`;
  if (action.kind === 'shake') return action.direction === 'horizontal' ? '横向' : '纵向';
  if (action.kind === 'effect') return project.effects.find(e => e.id === action.effectId)?.name;
  if (action.kind === 'blueprint') return projectGraphs(project).find(b => b.id === action.blueprintId)?.name;
  if (action.kind === 'stopMusic') return `${action.fade} 秒淡出`;
}

export function LineEffects({ project, nodeId, line, number, commit, playbackCommit = commit, assetUrl, select, openBlueprint, openPerformance, autoExpand = false, mode = 'all', topSlot }: {
  project: Project; nodeId: string; line: StoryLine; number: number; commit: Commit; playbackCommit?: Commit; assetUrl: AssetUrl; select: () => void; openBlueprint?: (id: string) => void; openPerformance?: (target: PerformanceTarget) => void; autoExpand?: boolean;
  /** Module rows keep stage actions above the dialogue and text settings below it. */ mode?: 'all' | 'stage' | 'text'; topSlot?: ReactNode;
}) {
  const [expanded, setExpanded] = useState<number | 'voice' | 'text' | 'save' | undefined>(() => autoExpand ? line.actions.length ? 0 : line.voiceId ? 'voice' : undefined : undefined);
  useEffect(() => { if (autoExpand) setExpanded(line.actions.length ? 0 : line.voiceId ? 'voice' : undefined); }, [autoExpand, line.id]);
  const [adding, setAdding] = useState(false);
  const [manager, setManager] = useState(false);
  const [encapsulate, setEncapsulate] = useState(false);
  const [effectName, setEffectName] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const edit = (label: string, change: (line: StoryLine) => void, apply = commit) => apply(label, draft => { const target = findLine(draft, nodeId, line.id); if (target?.id === line.id) change(target); });
  useEffect(() => {
    if (!adding) return;
    const close = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setAdding(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [adding]);
  const partCount = (line.textSpans?.length ?? 0) + (line.textPauses?.length ?? 0);
  const textFields = () => <TextPresentationFields key={project.id + '/' + nodeId + '/' + line.id} project={project} look={line.textPresentation} text={line.text} marks={lineMarks(line)} voiceId={line.voiceId} assetUrl={assetUrl} commit={commit}
    deletable={!!line.textPresentation || hasTextMarks(line)} onDelete={() => { edit('删除文字演出', l => { delete l.textPresentation; writeLineMarks(l, { spans: [], pauses: [] }); }); if (mode === 'all') setExpanded(undefined); }}
    trailingTabs={[{ id: 'parts', label: partCount ? `局部效果 ${partCount}` : '局部效果', set: !!partCount, look: true, content: <TextMarkList project={project} line={line} assetUrl={assetUrl} edit={(label, change) => edit(label, change)} flat /> }]}
    inherited={speakerTextStyle(project, line.speakerId)} inheritedLabel={line.speakerId && project.characters.find(c => c.id === line.speakerId)?.textPresentation ? `角色“${project.characters.find(c => c.id === line.speakerId)!.name}”的文字演出` : undefined}
    target={draft => { const target = findLine(draft, nodeId, line.id); return target?.id === line.id ? target : undefined; }} />;
  const close = (event: ReactKeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setAdding(false); setExpanded(undefined); } };
  if (mode === 'text') return <div className="line-effects line-text-effects" role="region" aria-label={`第${number}行台词文字演出`} ref={container} onKeyDown={close}>
    {topSlot}
    {textFields()}
  </div>;
  const action = typeof expanded === 'number' ? line.actions[expanded] : undefined;
  const textChip = mode === 'all' ? [line.textPresentation ? textStyleSummary(project, line.textPresentation) : '', partCount ? `局部 ${partCount}` : ''].filter(Boolean).join(' · ') : '';
  const toggle = (value: typeof expanded) => { select(); setAdding(false); setExpanded(current => current === value ? undefined : value); };
  const voiceFields = <><Field label="配音素材"><UiAssetSelect project={project} kind="audio" category="voice" label="配音素材" value={line.voiceId} assetUrl={assetUrl} empty="无配音" onChange={value => edit('设置配音', l => { l.voiceId = value; })} /></Field>{line.voiceId && <audio controls preload="metadata" src={assetUrl(line.voiceId)} />}</>;
  const stage = <>
    <div className="line-effect-strip">
      {line.actions.map((action, index) => {
        const label = actionLabel(action), detail = actionDetail(project, action);
        return <button key={index} type="button" className={`line-effect-chip ${expanded === index ? 'active' : ''}`} data-action-kind={action.kind} aria-label={`编辑${label}：${detail ?? ''}`} aria-expanded={expanded === index} title={action.kind === 'blueprint' ? '点击设置本次参数，Ctrl+点击进入蓝图' : undefined} onClick={event => { if ((event.ctrlKey || event.metaKey) && action.kind === 'blueprint' && openBlueprint) { event.stopPropagation(); openBlueprint(action.blueprintId); } else toggle(index); }}><span>@{label}</span><small>{detail}</small></button>;
      })}
      {mode === 'all' && (line.textPresentation || hasTextMarks(line)) && !line.silent && <button type="button" className={`line-effect-chip ${expanded === 'text' ? 'active' : ''}`} aria-label={`编辑文字演出：${textChip}`} aria-expanded={expanded === 'text'} onClick={() => toggle('text')}><Type size={12} /><span>文字</span><small>{textChip}</small></button>}
      {line.voiceId && <button type="button" className={`line-effect-chip ${expanded === 'voice' ? 'active' : ''}`} aria-expanded={expanded === 'voice'} onClick={() => toggle('voice')}><Volume2 size={12} /><span>配音</span><small>{project.assets.find(a => a.id === line.voiceId)?.name}</small></button>}
      <IconButton title={`为第${number}行添加效果`} className="add-line-effect" aria-haspopup="menu" aria-expanded={adding} onClick={() => { select(); if (!adding) setExpanded(undefined); setAdding(!adding); }}><Plus size={14} /></IconButton>
      {!line.actions.length && !line.voiceId && (mode === 'stage' || !line.textPresentation && !hasTextMarks(line)) && <span className="line-effect-placeholder">添加演出</span>}
    </div>
    {adding && <div className="line-effect-menu" role="menu" aria-label="添加本行演出">
      {authorableActions.map(([kind, name]) => <button type="button" role="menuitem" key={kind} disabled={kind !== 'visual' && !newAction(kind, project)} onClick={() => { const action = kind === 'visual' ? createFloatingText() : newAction(kind, project); if (!action) return; edit('添加演出', current => current.actions.push(action)); setExpanded(line.actions.length); setAdding(false); }}><Plus size={13} />{kind === 'visual' ? '显示文字' : name}</button>)}
      <button type="button" role="menuitem" onClick={() => { setExpanded('voice'); setAdding(false); }}><Volume2 size={13} />配音</button>
      {mode === 'all' && !line.silent && <button type="button" role="menuitem" onClick={() => { setExpanded('text'); setAdding(false); }}><Type size={13} />文字演出</button>}
      <button type="button" role="menuitem" disabled={!line.actions.length} onClick={() => { setEffectName('新的演出效果'); setExpanded('save'); setAdding(false); }}><Save size={13} />保存本行为效果</button>
      <button type="button" role="menuitem" disabled={!line.actions.length} onClick={() => { setEncapsulate(true); setAdding(false); }}><Save size={13} />封装本行演出为蓝图</button>
      <button type="button" role="menuitem" onClick={() => { setManager(true); setAdding(false); }}><Sparkles size={13} />管理效果</button>
    </div>}
    {(action || expanded === 'voice' || expanded === 'text' || expanded === 'save') && <div className="line-effect-editor" role="region" aria-label={action ? `编辑${actionLabel(action)}` : expanded === 'voice' ? '编辑配音' : expanded === 'text' ? '编辑文字演出' : '保存演出效果'}>
      <div className="action-editor-header"><strong>{action ? actionLabel(action) : expanded === 'voice' ? '配音' : expanded === 'text' ? '文字演出' : '保存为效果'}</strong><div className="spacer" />
        {action && typeof expanded === 'number' && openPerformance && <button type="button" className="small-button edit-action-performance" onClick={event => { event.stopPropagation(); openPerformance({ nodeId, lineId: line.id, actionIndex: expanded }); }}><Clapperboard size={14} />编辑演出</button>}
        {typeof expanded === 'number' && <>
          <IconButton title="动作上移" disabled={expanded === 0} onClick={() => { edit('移动演出', l => { [l.actions[expanded - 1], l.actions[expanded]] = [l.actions[expanded], l.actions[expanded - 1]]; }); setExpanded(expanded - 1); }}><ArrowUp size={13} /></IconButton>
          <IconButton title="动作下移" disabled={expanded === line.actions.length - 1} onClick={() => { edit('移动演出', l => { [l.actions[expanded + 1], l.actions[expanded]] = [l.actions[expanded], l.actions[expanded + 1]]; }); setExpanded(expanded + 1); }}><ArrowDown size={13} /></IconButton>
          <IconButton title="删除动作" onClick={() => { edit('删除演出', l => l.actions.splice(expanded, 1)); setExpanded(undefined); }}><Trash2 size={13} /></IconButton>
        </>}
        {expanded === 'voice' && line.voiceId && <IconButton title="移除配音" onClick={() => { edit('移除配音', l => { l.voiceId = undefined; }); setExpanded(undefined); }}><Trash2 size={13} /></IconButton>}
        <IconButton title="收起演出编辑" onClick={() => setExpanded(undefined)}><X size={14} /></IconButton>
      </div>
      {action && typeof expanded === 'number' && <ActionEditor project={project} action={action} speakerId={line.speakerId} assetUrl={assetUrl} onChange={next => edit(`编辑动作 ${line.id} ${expanded}`, l => { l.actions[expanded] = next; })} />}
      {expanded === 'text' && textFields()}
      {expanded === 'voice' && voiceFields}
      {expanded === 'save' && <><Field label="效果名称"><input value={effectName} maxLength={120} onChange={event => setEffectName(event.target.value)} /></Field><button type="button" className="small-button" disabled={!effectName.trim() || project.effects.some(e => e.name === effectName.trim())} onClick={() => { commit('保存为效果', draft => { const source = findLine(draft, nodeId, line.id); if (!source?.actions.length) return; const id = makeId('effect'); draft.effects.push({ id, name: effectName.trim(), commands: [], actions: cloneData(source.actions) }); source.actions = [{ kind: 'effect', effectId: id }]; }); setExpanded(0); }}><Save size={14} />保存并使用</button></>}
    </div>}
  </>;
  const dialogs = <>
    {line.silent && <PerformancePlaybackFields project={project} line={line} onChange={playback => edit('独立演出播放设置', current => { current.playback = playback; }, playbackCommit)} />}
    {manager && <EffectManager project={project} commit={commit} onClose={() => setManager(false)} />}
    {encapsulate && <EncapsulatePerformance project={project} actions={line.actions} assetUrl={assetUrl} onClose={() => setEncapsulate(false)} onCreate={(graph, group) => { const copy = cloneData(project); installPerformanceBlueprint(copy, graph); assignBlueprintGroup(copy, graph.id, group); commit('封装本行演出', draft => { installPerformanceBlueprint(draft, graph); draft.contentBrowser = copy.contentBrowser; const target = findLine(draft, nodeId, line.id); if (target) target.actions = [{ kind: 'blueprint', blueprintId: graph.id }]; }); setEncapsulate(false); setExpanded(0); }} />}
  </>;
  return <div className="line-effects" ref={container} onKeyDown={close}>
    {stage}
    {dialogs}
  </div>;
}

/** Only the settings hidden by the dialogue arrow; stage actions stay visible above. */
export function lineTextEffectSummary(project: Project, line: StoryLine) {
  const parts = (line.textSpans?.length ?? 0) + (line.textPauses?.length ?? 0);
  const look = [line.textPresentation ? textStyleSummary(project, line.textPresentation) : '', parts ? `局部 ${parts}` : ''].filter(Boolean).join(' ');
  return { count: (line.textPresentation ? 1 : 0) + parts, text: look ? '文字：' + look : '' };
}
