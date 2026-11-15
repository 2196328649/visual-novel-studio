import { uiPages, uiPage } from '../core/ui-pages';
import { UiPageArgumentsEditor } from './UiPageArgumentsEditor';
import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Plus, Settings2, Trash2 } from 'lucide-react';
import type { Project } from '../core/model';
import { gameFlowDiagnostics } from '../core/game-flow';
import { editGameFlowSteps, findFlowStep, flowExit, flowNodeIds, flowNodeName, flowPhases, flowSourcePhase, flowStepNodeId, gameFlow, gameFlowAttachments, gameFlowConnectionProblem, gameFlowConnections, gameFlowSteps } from '../core/game-flow-graph';
import { gameFlowRepeatNames, type GameFlowPhase, type GameFlowStep } from '../core/game-flow-schema';
import { flowTransitionSummary } from '../core/flow-transitions';
import { gameFlowTransition } from '../core/game-flow-transitions';
import { projectGraphs } from '../core/project-resources';
import { BlueprintValueInput } from './BlueprintValueInput';
import { Field } from './components';
import { NodePicker, type NodePickerItem } from './NodePicker';
import type { Commit } from './editor';
import './game-flow.css';
import { flowPageOpening, flowPageOpeningOverrides, setFlowPageOpening } from '../core/ui-page-opening';
import { UiPageOpeningFields } from './UiPageOpeningFields';

export interface GameFlowFocus { phase: GameFlowPhase; stepId?: string; request: number }
export type FlowStepInput = Partial<GameFlowStep> & { kind: GameFlowStep['kind'] };
export const flowStepKindNames = { page: '页面', blueprint: '蓝图演出', video: '视频' } as const;

/** Only the selected-node inspector; every node lives on the shared story canvas. */
export function GameFlowInspector({ project, nodeId, commit, openPage, openBlueprint, openStory, preview, busy, connect, add, remove, editTransition }: {
  project: Project; nodeId: string; commit: Commit; openPage: (id: string, saveMode?: 'save' | 'load') => void; openBlueprint: (id: string) => void; openStory: () => void;
  preview: (start: 'launch' | 'title') => void; busy?: boolean; connect: (source: string, target?: string) => void;
  add: (kind: GameFlowStep['kind'], after: string) => void; remove: (id: string) => void; editTransition: (source: string) => void;
}) {
  const flow = gameFlow(project), found = findFlowStep(project, nodeId), step = found?.step;
  const phase = flowSourcePhase(project, nodeId);
  const attachment = useMemo(() => gameFlowAttachments(project).get(nodeId), [project, nodeId]);
  const destinations = useMemo(() => [...flowPhases.flatMap(p => gameFlowSteps(project, p).map(s => flowStepNodeId(s.id))), flowExit.beforeTitle, flowExit.beforeNewGame]
    .filter(id => id !== nodeId).map(id => ({ id, problem: gameFlowConnectionProblem(project, nodeId, id) })), [project, nodeId]);
  const graphs = useMemo(() => projectGraphs(project).filter(g => !g.uiPageId), [project.blueprints, project.timelinePresets]);
  const diagnostics = useMemo(() => gameFlowDiagnostics(project), [project]);
  const graph = step?.kind === 'blueprint' ? graphs.find(g => g.id === step.graphId) : undefined;
  const opening = step?.kind === 'page' ? flowPageOpening(project, step) : undefined;
  const edit = (change: (step: GameFlowStep) => void) => commit('编辑流程节点', draft => {
    if (!found) return;
    const target = editGameFlowSteps(draft, found.phase).find(s => s.id === found.step.id); if (target) change(target);
  });
  return <aside className="inspector game-flow-inspector" aria-label="流程节点属性">
    <div className="panel-heading"><Settings2 size={15} /><h2>{step ? flowStepKindNames[step.kind] : '流程节点'}</h2></div>
    <div className="inspector-scroll">
      <h3>{flowNodeName(project, nodeId)}</h3>
      {nodeId === flowNodeIds.launch && <>
        <Field label="执行时机"><select aria-label="启动节点执行时机" value={flow.beforeTitle.repeat} onChange={e => commit('启动节点执行时机', draft => { (draft.gameFlow ??= gameFlow(draft)).beforeTitle.repeat = e.target.value as typeof flow.beforeTitle.repeat; })}>{Object.entries(gameFlowRepeatNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
        {flow.beforeTitle.repeat === 'version' && <Field label="首次执行版本"><input aria-label="首次执行版本" maxLength={120} value={flow.beforeTitle.revision} onChange={e => commit('启动节点首次版本', draft => { (draft.gameFlow ??= gameFlow(draft)).beforeTitle.revision = e.target.value; })} /></Field>}
        <p className="muted">默认每次应用启动执行一次。返回标题时，只有“每次进入标题”会重播连接的内容；其他情况直接显示标题。预览的首次记录与玩家资料隔离。</p>
        <button className="small-button" disabled={busy} onClick={() => preview('launch')}>从启动预览</button>
      </>}
      {nodeId === flowNodeIds.title && <><p className="muted">启动内容完成后显示标题。出口来自实际菜单按钮；双击标题卡片查看页面事件，按钮外观在界面设计中编辑。</p><button className="text-button" onClick={() => openPage('ui:main')}><ExternalLink size={14} />编辑标题菜单</button><button className="small-button" disabled={busy} onClick={() => preview('title')}>从标题预览</button></>}
      {nodeId === flowNodeIds.newGame && <p className="muted">玩家开始新游戏后，先把非持久变量恢复为设计初始值，保留持久玩家设置，再执行连线上的页面、视频或演出，最后进入故事入口。标题按钮改过的本局变量也会重置；读取存档不会经过这里。</p>}
      {nodeId === flowNodeIds.load && <><p className="muted">打开读档页面。选择存档后恢复保存时的剧情位置与状态，不重新执行启动内容或新游戏内容。</p><button className="text-button" onClick={() => openPage('ui:save', 'load')}><ExternalLink size={14} />编辑读档页面</button></>}
      {nodeId === flowNodeIds.story && <><p className="muted">故事入口位于其他场景，当前节点是同一入口的导航引用。</p><button className="text-button" onClick={openStory}><ExternalLink size={14} />进入故事入口所在场景</button></>}
      {step && <>
        <p className="muted">{attachment === 'beforeTitle' ? '游戏启动 → 标题菜单' : attachment === 'beforeNewGame' ? '新游戏 → 故事入口' : '尚未接入流程。把入口或其他模块的出口连到这里，再连接后续模块。'}</p>
        <Field label="节点说明"><input aria-label="流程节点说明" placeholder="可选，例如：首次语言选择" maxLength={120} value={step.name ?? ''} onChange={e => edit(s => { s.name = e.target.value; })} /></Field>
        {step.kind === 'page' ? <>
          <Field label="页面"><select aria-label="节点页面" value={step.pageId} onChange={e => edit(s => { if (s.kind === 'page') { s.pageId = e.target.value; if (uiPage(project, s.pageId)?.template) { s.wait = true; s.modal = true; s.opening = {}; s.completion = 'close'; } } })}>
            {!uiPage(project, step.pageId) && <option value={step.pageId}>页面已不存在</option>}
            {uiPages(project).map(p => <option key={p.id} value={p.id} disabled={p.disabled || !!p.openProblem}>{p.name}{p.openProblem ? ' · 系统内容' : ''}</option>)}
          </select></Field>
          <button className="text-button" disabled={!uiPage(project, step.pageId)} onClick={() => openPage(step.pageId, step.saveMode)}><ExternalLink size={14} />编辑页面与内部事件</button>
          {step.pageId === 'ui:save' && <Field label="存读档用途"><select aria-label="节点存读档用途" value={step.saveMode ?? 'load'} onChange={event => edit(target => { if (target.kind === 'page') target.saveMode = event.target.value as 'save' | 'load'; })}><option value="save">保存游戏</option><option value="load">读取存档</option></select></Field>}
          <UiPageArgumentsEditor project={project} pageId={step.pageId} values={step.inputs} label="页面步骤输入" onChange={values => edit(target => { if (target.kind === 'page') target.inputs = values; })} />
          <p className="muted">页面输入在进入步骤时固定；若要把返回结果接到数据线，请调用“打开页面”蓝图节点。</p>
          <UiPageOpeningFields project={project} pageId={step.pageId} value={flowPageOpeningOverrides(step)} label="节点" onChange={value => edit(s => { if (s.kind === 'page') { setFlowPageOpening(s, value); if (!flowPageOpening(project, s).wait) s.completion = 'close'; } })} />
          {opening?.wait ? <><Field label="完成方式"><select aria-label="节点完成方式" value={step.completion} onChange={e => edit(s => { if (s.kind === 'page') s.completion = e.target.value as typeof step.completion; })}><option value="close">由页面关闭事件完成</option><option value="auto" disabled={uiPage(project, step.pageId)?.template}>计时后自动完成</option><option value="confirm" disabled={uiPage(project, step.pageId)?.template}>显示继续按钮，由玩家确认</option></select></Field>
            {step.completion === 'auto' && <Field label="停留时间（秒）"><BlueprintValueInput project={project} type="number" min={.05} step={.1} label="节点停留秒数" value={step.duration} onChange={v => { if (typeof v === 'number' && v >= .05) edit(s => { if (s.kind === 'page') s.duration = v; }); }} /></Field>}
            <Field label="取消后"><select aria-label="节点取消后" value={step.cancel} onChange={e => edit(s => { if (s.kind === 'page') s.cancel = e.target.value as typeof step.cancel; })}><option value="continue">沿完成连线继续</option><option value="title">进入标题菜单</option></select></Field>
          </> : <p className="muted">叠加页面后立即继续；页面自行关闭。进入标题或新游戏时会清理页面。</p>}
        </> : step.kind === 'blueprint' ? <>
          <Field label="调用蓝图"><select aria-label="节点蓝图" value={step.graphId} onChange={e => edit(s => { if (s.kind === 'blueprint') { s.graphId = e.target.value; s.inputs = {}; } })}>{!graph && <option value={step.graphId}>蓝图已不存在或属于页面事件</option>}{graphs.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
          {graph && <><button className="text-button" onClick={() => openBlueprint(graph.id)}><ExternalLink size={14} />编辑入口蓝图</button>{graph.exposedInputs.map(pin => <Field key={pin.id} label={pin.name}><BlueprintValueInput project={project} type={pin.dataType} label={'节点参数 ' + pin.name} value={step.inputs?.[pin.id] ?? pin.defaultValue} onChange={value => edit(s => { if (s.kind === 'blueprint') { s.inputs ??= {}; if (value === undefined) delete s.inputs[pin.id]; else s.inputs[pin.id] = value; } })} /></Field>)}</>}
        </> : <Field label="视频素材"><BlueprintValueInput project={project} type="asset" assetKind="video" label="节点视频" value={step.assetId} onChange={v => { if (typeof v === 'string' && v) edit(s => { if (s.kind === 'video') s.assetId = v; }); }} /></Field>}
        <label className="game-flow-check"><input type="checkbox" checked={step.allowSkip} onChange={e => edit(s => { s.allowSkip = e.target.checked; })} />允许玩家跳过这一项</label>
        {step.kind === 'blueprint' && <p className="muted">关闭时，点击空白和快进不会缩短演出等待；演出里的按钮、确认和页面操作仍可使用。</p>}
      </>}
      {phase && <>
        <Field label="完成后"><select aria-label="流程后续节点" value={gameFlowConnections(project)[nodeId] ?? ''} onChange={e => connect(nodeId, e.target.value || undefined)}>
          <option value="">未连接</option>
          {destinations.map(({ id, problem }) => <option key={id} value={id} disabled={!!problem} title={problem}>{flowNodeName(project, id)}</option>)}
        </select></Field>
        <p className="muted">与画布连线同步。拖动出口可改接；断线只取消连接，保留节点。</p>
        <button type="button" className="game-flow-transition-summary" aria-label="编辑后续过渡" onClick={() => editTransition(nodeId)}><span>后续过渡<strong>{flowTransitionSummary(gameFlowTransition(project, nodeId))}</strong></span><ExternalLink size={14} /></button>
        <div className="game-flow-add" aria-label="在此出口插入模块">{(['page', 'blueprint', 'video'] as const).map(kind => <button key={kind} className="small-button" title="在此出口插入，自动衔接原来的后续模块" disabled={gameFlowSteps(project, phase).length >= 64} onClick={() => add(kind, nodeId)}><Plus size={14} />插入{flowStepKindNames[kind]}</button>)}</div>
      </>}
      {diagnostics.filter(d => d.gameFlow?.phase === phase && d.gameFlow?.stepId === step?.id).map((issue, i) => <p key={i} className="game-flow-error" role="alert">{issue.message}</p>)}
      {step && <div className="inspector-footer-actions"><button className="small-button danger" onClick={() => remove(nodeId)}><Trash2 size={14} />删除节点并衔接前后</button></div>}
    </div>
  </aside>;
}

export function GameFlowModulePicker({ project, kind, after, x, y, onClose, onAdd }: { project: Project; kind?: GameFlowStep['kind']; after?: string; x: number; y: number; onClose: () => void; onAdd: (input: FlowStepInput, after?: string) => void }) {
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => () => { if ((!document.activeElement || document.activeElement === document.body) && returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); }, []);
  const phase = after ? flowSourcePhase(project, after) : undefined;
  const full = after ? !phase || gameFlowSteps(project, phase).length >= 64 : flowPhases.every(p => gameFlowSteps(project, p).length >= 64);
  const items: NodePickerItem[] = [
    ...(!kind || kind === 'page' ? uiPages(project).filter(page => !page.disabled && !page.openProblem).map(page => ({
      id: 'page:' + page.id, name: page.name, category: '页面', hint: '显示页面，可等待关闭或计时后继续', disabled: full,
      choose: () => onAdd({ kind: 'page', pageId: page.id, opening: {} }, after),
    })) : []),
    ...(!kind || kind === 'blueprint' ? projectGraphs(project).filter(graph => !graph.uiPageId).map(graph => ({
      id: 'blueprint:' + graph.id, name: graph.name, category: '动画演出', hint: '调用已有演出，执行完成后继续', disabled: full,
      choose: () => onAdd({ kind: 'blueprint', graphId: graph.id }, after),
    })) : []),
    ...(!kind || kind === 'video' ? project.assets.filter(asset => asset.kind === 'video').map(asset => ({
      id: 'video:' + asset.id, name: asset.name, category: '视频', hint: '播放视频，播放结束后继续', disabled: full,
      choose: () => onAdd({ kind: 'video', assetId: asset.id }, after),
    })) : []),
  ];
  const transition = after ? gameFlowTransition(project, after) : undefined;
  const description = full ? '可容纳的模块数量已满，请先移除不需要的模块。' : after
    ? `插入“${flowNodeName(project, after)}”的出口，自动衔接原后续模块。${transition ? `原出口的${flowTransitionSummary(transition)}用于进入新模块。` : ''}`
    : '选择后放到画布，再拖动出口连接模块。';
  return createPortal(<NodePicker x={x} y={y} items={items} onClose={onClose} ariaLabel="添加流程节点" title={after ? '在此出口插入' : '添加模块'} description={description}
    emptyMessage={items.length ? undefined : '暂无可用资源。请先创建页面或演出，或导入视频素材。'} />, document.body);
}
