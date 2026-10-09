import { projectGraphs } from '../core/project-resources';
import { displayPresetLabel } from '../core/character-presets';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Clapperboard, Plus, Save, Sparkles, Trash2, Volume2, X } from 'lucide-react';
import { effectiveCharacter, makeId, type Project, type StageAction, type StoryLine } from '../core/model';
import { actionNames, findLine, type Commit } from './editor';
import { ActionEditor, EffectManager, newAction } from './Inspector';
import { Field, IconButton } from './components';
import { UiAssetSelect } from './AssetPicker';
import type { AssetUrl } from './StageEditor';
import { EncapsulatePerformance } from './PerformanceTools';
import { assignBlueprintGroup, installPerformanceBlueprint } from '../core/blueprint-authoring';
import type { PerformanceTarget } from '../core/performance-workspace';
import { PerformancePlaybackFields } from './PerformancePlaybackFields';

function actionDetail(project: Project, action: StageAction) {
  if ('assetId' in action) return project.assets.find(a => a.id === action.assetId)?.name ?? '选择素材';
  if (action.kind === 'show') { const c = effectiveCharacter(project, action.characterId); return `${c?.name ?? (action.characterId || '当前台词角色')} · ${c?.expressions.find(e => e.id === action.expressionId)?.name ?? (action.expressionId || '默认表情')} · ${action.presetId ? displayPresetLabel(project, action.characterId, action.presetId) : `${action.x}，${action.scale}`}`; }
  if ('characterId' in action) return project.characters.find(c => c.id === action.characterId)?.name;
  if (action.kind === 'pause') return `${action.seconds} 秒`;
  if (action.kind === 'camera') return `${action.zoom} 倍 · ${action.duration} 秒`;
  if (action.kind === 'shake') return action.direction === 'horizontal' ? '横向' : '纵向';
  if (action.kind === 'effect') return project.effects.find(e => e.id === action.effectId)?.name;
  if (action.kind === 'blueprint') return projectGraphs(project).find(b => b.id === action.blueprintId)?.name;
  if (action.kind === 'stopMusic') return `${action.fade} 秒淡出`;
}

export function LineEffects({ project, nodeId, line, number, commit, playbackCommit = commit, assetUrl, select, openBlueprint, openPerformance, autoExpand = false }: {
  project: Project; nodeId: string; line: StoryLine; number: number; commit: Commit; playbackCommit?: Commit; assetUrl: AssetUrl; select: () => void; openBlueprint?: (id: string) => void; openPerformance?: (target: PerformanceTarget) => void; autoExpand?: boolean;
}) {
  const [expanded, setExpanded] = useState<number | 'voice' | 'save' | undefined>(() => autoExpand ? line.actions.length ? 0 : line.voiceId ? 'voice' : undefined : undefined);
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
  const action = typeof expanded === 'number' ? line.actions[expanded] : undefined;
  const toggle = (value: typeof expanded) => { select(); setAdding(false); setExpanded(current => current === value ? undefined : value); };
  return <div className="line-effects" ref={container} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setAdding(false); setExpanded(undefined); } }}>
    <div className="line-effect-strip">
      {line.actions.map((action, index) => <button key={index} type="button" className={`line-effect-chip ${expanded === index ? 'active' : ''}`} data-action-kind={action.kind} aria-label={`编辑${actionNames[action.kind]}：${actionDetail(project, action) ?? ''}`} aria-expanded={expanded === index} title={action.kind === 'blueprint' ? '点击设置本次参数，Ctrl+点击进入蓝图' : undefined} onClick={event => { if ((event.ctrlKey || event.metaKey) && action.kind === 'blueprint' && openBlueprint) { event.stopPropagation(); openBlueprint(action.blueprintId); } else toggle(index); }}><span>@{actionNames[action.kind]}</span><small>{actionDetail(project, action)}</small></button>)}
      {line.voiceId && <button type="button" className={`line-effect-chip ${expanded === 'voice' ? 'active' : ''}`} aria-expanded={expanded === 'voice'} onClick={() => toggle('voice')}><Volume2 size={12} /><span>配音</span><small>{project.assets.find(a => a.id === line.voiceId)?.name}</small></button>}
      <IconButton title={`为第${number}行添加效果`} className="add-line-effect" aria-haspopup="menu" aria-expanded={adding} onClick={() => { select(); if (!adding) setExpanded(undefined); setAdding(!adding); }}><Plus size={14} /></IconButton>
      {!line.actions.length && !line.voiceId && <span className="line-effect-placeholder">添加演出</span>}
    </div>
    {adding && <div className="line-effect-menu" role="menu" aria-label="添加本行演出">
      {Object.entries(actionNames).map(([kind, name]) => <button type="button" role="menuitem" key={kind} disabled={!newAction(kind as StageAction['kind'], project)} onClick={() => { const action = newAction(kind as StageAction['kind'], project); if (!action) return; edit('添加演出', current => current.actions.push(action)); setExpanded(line.actions.length); setAdding(false); }}><Plus size={13} />{name}</button>)}
      <button type="button" role="menuitem" onClick={() => { setExpanded('voice'); setAdding(false); }}><Volume2 size={13} />配音</button>
      <button type="button" role="menuitem" disabled={!line.actions.length} onClick={() => { setEffectName('新的演出效果'); setExpanded('save'); setAdding(false); }}><Save size={13} />保存本行为效果</button>
      <button type="button" role="menuitem" disabled={!line.actions.length} onClick={() => { setEncapsulate(true); setAdding(false); }}><Save size={13} />封装本行演出为蓝图</button>
      <button type="button" role="menuitem" onClick={() => { setManager(true); setAdding(false); }}><Sparkles size={13} />管理效果</button>
    </div>}
    {(action || expanded === 'voice' || expanded === 'save') && <div className="line-effect-editor" role="region" aria-label={action ? `编辑${actionNames[action.kind]}` : expanded === 'voice' ? '编辑配音' : '保存演出效果'}>
      <div className="action-editor-header"><strong>{action ? actionNames[action.kind] : expanded === 'voice' ? '配音' : '保存为效果'}</strong><div className="spacer" />
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
      {expanded === 'voice' && <><Field label="配音素材"><UiAssetSelect project={project} kind="audio" category="voice" label="配音素材" value={line.voiceId} assetUrl={assetUrl} empty="无配音" onChange={value => edit('设置配音', l => { l.voiceId = value; })} /></Field>{line.voiceId && <audio controls preload="metadata" src={assetUrl(line.voiceId)} />}</>}
      {expanded === 'save' && <><Field label="效果名称"><input value={effectName} maxLength={120} onChange={event => setEffectName(event.target.value)} /></Field><button type="button" className="small-button" disabled={!effectName.trim() || project.effects.some(e => e.name === effectName.trim())} onClick={() => { commit('保存为效果', draft => { const source = findLine(draft, nodeId, line.id); if (!source?.actions.length) return; const id = makeId('effect'); draft.effects.push({ id, name: effectName.trim(), commands: [], actions: structuredClone(source.actions) }); source.actions = [{ kind: 'effect', effectId: id }]; }); setExpanded(0); }}><Save size={14} />保存并使用</button></>}
    </div>}
    {line.silent && <PerformancePlaybackFields project={project} line={line} onChange={playback => edit('独立演出播放设置', current => { current.playback = playback; }, playbackCommit)} />}
    {manager && <EffectManager project={project} commit={commit} onClose={() => setManager(false)} />}
    {encapsulate && <EncapsulatePerformance project={project} actions={line.actions} assetUrl={assetUrl} onClose={() => setEncapsulate(false)} onCreate={(graph, group) => { const copy = structuredClone(project); installPerformanceBlueprint(copy, graph); assignBlueprintGroup(copy, graph.id, group); commit('封装本行演出', draft => { installPerformanceBlueprint(draft, graph); draft.contentBrowser = copy.contentBrowser; const target = findLine(draft, nodeId, line.id); if (target) target.actions = [{ kind: 'blueprint', blueprintId: graph.id }]; }); setEncapsulate(false); setExpanded(0); }} />}
  </div>;
}
