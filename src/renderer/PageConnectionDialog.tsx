import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { Project, VariableValue } from '../core/model';
import { uiPage, uiPageOpenProblem } from '../core/ui-pages';
import { uiPageInputValues } from '../core/ui-page-interface';
import { UiPageArgumentsEditor } from './UiPageArgumentsEditor';
import { addGameFlowStep, connectPageToButton, connectPageToStory, pageButtonProject, pageConnectionButtons, uiPageUsages, type UiPageUsage } from '../core/game-flow';
import { gameFlowPhaseNames, type GameFlowPhase } from '../core/game-flow-schema';
import { uiClickHandlers } from '../core/ui-logic';
import { projectGraphs } from '../core/project-resources';
import { actionName } from './UiNames';
import { Field, IconButton } from './components';
import type { Commit } from './editor';
import './game-flow.css';
import type { UiPageOpening } from '../core/ui-page-opening';
import { UiPageOpeningFields } from './UiPageOpeningFields';

export function PageConnectionDialog({ project, pageId, commit, storyPosition, onClose, onLocate, onOpenGameFlow, onDelete, usages: providedUsages }: {
  project: Project; pageId: string; commit: Commit; storyPosition?: { nodeId?: string; lineId?: string };
  onClose: () => void; onLocate?: (usage: UiPageUsage) => void; onOpenGameFlow?: (phase: GameFlowPhase, stepId?: string) => void; onDelete?: () => void;
  usages?: UiPageUsage[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const page = uiPage(project, pageId), openProblem = uiPageOpenProblem(project, pageId);
  const [inputs, setInputs] = useState<Record<string, VariableValue>>({});
  const [saveMode, setSaveMode] = useState<'save' | 'load'>('load');
  const [destination, setDestination] = useState<'story' | 'button' | GameFlowPhase | 'resource'>(openProblem ? 'resource' : storyPosition?.nodeId ? 'story' : 'beforeTitle');
  const [opening, setOpening] = useState<UiPageOpening>();
  const [nodeId, setNodeId] = useState(storyPosition?.nodeId ?? ''), [lineId, setLineId] = useState(storyPosition?.lineId ?? '');
  const [buttonKey, setButtonKey] = useState(''), [buttonMode, setButtonMode] = useState<'append' | 'replace'>('append');
  const [error, setError] = useState(''), [success, setSuccess] = useState<UiPageUsage>();
  const buttons = useMemo(() => pageConnectionButtons(project).filter(b => b.pageId !== pageId), [project, pageId]);
  const button = buttons.find(b => b.key === buttonKey);
  const graphs = projectGraphs(project);
  const handlers = button ? uiClickHandlers(pageButtonProject(project, button.instanceId), button.pageId, button.component.id) : [];
  const node = project.nodes.find(n => n.id === nodeId && n.kind === 'passage');
  const lines = node?.kind === 'passage' ? node.lines : [];
  const usages = useMemo(() => providedUsages ?? uiPageUsages(project, pageId), [project, pageId, providedUsages]);
  const entries = usages.filter(use => !use.reference && !use.inactive), references = usages.filter(use => use.reference || use.inactive);
  const usageList = (items: UiPageUsage[]) => items.map(use => (use.setting || use.phase || use.componentId || use.storyNodeId || use.graphId || use.pageId) && onLocate
    ? <button className="text-button" key={use.key} onClick={() => locate(use)}>{use.label}</button>
    : <p className="muted" key={use.key}>{use.label}</p>);
  useEffect(() => {
    const element = dialog.current; element?.showModal();
    return () => { element?.close(); if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); };
  }, []);
  const connect = () => {
    if (destination === 'resource') { onClose(); return; }
    try {
      if (openProblem) throw new Error(openProblem);
      uiPageInputValues(project, pageId, inputs);
      if (pageId === 'ui:save' && saveMode === 'save' && (destination === 'beforeTitle' || destination === 'button' && button?.pageId === 'ui:main')) throw new Error('标题宿主没有可保存的游戏进度；请选择读取存档。');
      let created: UiPageUsage | undefined;
      commit('添加页面使用位置', draft => {
        if (destination === 'story') {
          if (!node || !lines.length) throw new Error('请选择要接入的剧情段落。');
          const selectedLine = lines.find(l => l.id === lineId) ?? lines[0];
          const graph = connectPageToStory(draft, pageId, node.id, selectedLine.id, undefined, undefined, { inputs, saveMode, opening });
          created = { key: graph.id, label: '已接入剧情 · ' + node.name, graphId: graph.id, storyNodeId: node.id, lineId: selectedLine.id };
        } else if (destination === 'button') {
          if (!button) throw new Error('请选择要绑定的按钮。');
          const graph = connectPageToButton(draft, pageId, button.pageId, button.component.id, buttonMode, undefined, undefined, button.instanceId, { inputs, saveMode, opening });
          created = { key: graph.id, label: '已接入按钮 · ' + button.label, graphId: graph.id, componentId: button.component.id, pageId: button.pageId, instanceId: button.instanceId };
        } else {
          const step = addGameFlowStep(draft, destination, { kind: 'page', pageId, opening: opening ?? {}, inputs: { ...inputs }, saveMode });
          created = { key: step.id, label: '已加入' + gameFlowPhaseNames[destination], phase: destination, stepId: step.id };
        }
      }, { separate: true });
      setSuccess(created); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const locate = (usage: UiPageUsage) => { onClose(); onLocate?.(usage); };
  return createPortal(<dialog ref={dialog} className="page-connection-dialog" aria-label={onDelete ? '删除页面及影响' : '页面使用位置'} onCancel={e => { e.preventDefault(); onClose(); }} onKeyDown={e => { if (['F5', 'F6'].includes(e.key) || (e.ctrlKey || e.metaKey) && ['s', 'z', 'y'].includes(e.key.toLowerCase())) e.stopPropagation(); }}>
    <header><h2>{onDelete ? '删除页面' : '页面使用位置'} · {page?.name ?? '页面已不存在'}</h2><div className="spacer" /><IconButton title={onDelete ? '关闭删除页面' : '关闭页面使用位置'} onClick={onClose}><X size={17} /></IconButton></header>
    <div className="page-connection-body">
      {!onDelete && <p className="muted">这里设置页面从哪里打开，不是启用或发布页面。{page?.template ? '只修改内置页面的外观时，保存即可，无需额外设置；原有打开方式不变。' : '可以先设计并保存页面，需要从剧情、按钮或启动流程打开时，再添加使用位置。'}</p>}
      {!onDelete && openProblem && <p role="status" className="muted">{openProblem}</p>}
      {onDelete ? <p>删除后，以下位置将无法打开此页面。可先定位修改，或在问题面板中逐项处理。</p> : success ? <div role="status"><strong>{success.label}</strong><p>入口和页面内部事件分别保存，可以继续编辑完整连接。</p>{success.phase ? <button className="small-button" onClick={() => { onClose(); onOpenGameFlow?.(success.phase!, success.stepId); }}>在流程蓝图中查看</button> : <button className="small-button" onClick={() => locate({ ...success, componentId: undefined, storyNodeId: undefined })}>查看入口蓝图与返回值</button>}<button className="text-button" onClick={() => setSuccess(undefined)}>继续添加使用位置</button></div> : <>
        <Field label="使用位置"><select aria-label="页面接入位置" value={destination} onChange={e => { setDestination(e.target.value as typeof destination); setError(''); }}>
          <option value="story">插入剧情位置</option><option value="button">绑定现有按钮</option><option value="beforeTitle">启动到标题之间</option><option value="beforeNewGame">新游戏到剧情之间</option><option value="resource">暂不添加使用位置</option>
        </select></Field>
        {destination === 'story' && <>
          <Field label="剧情段落"><select aria-label="页面接入段落" value={nodeId} onChange={e => { setNodeId(e.target.value); setLineId(''); }}><option value="">选择段落</option>{project.nodes.filter(n => n.kind === 'passage').map(n => <option key={n.id} value={n.id}>{n.name}{n.id === storyPosition?.nodeId ? '（当前位置）' : ''}</option>)}</select></Field>
          <Field label="播放位置"><select aria-label="页面接入台词" value={lineId || lines[0]?.id || ''} onChange={e => setLineId(e.target.value)}>{lines.map((l, i) => <option key={l.id} value={l.id}>{i + 1}. {l.text.slice(0, 60) || '演出'}{l.id === storyPosition?.lineId ? '（当前台词）' : ''}</option>)}</select></Field>
          <p className="muted">在这句台词前打开页面；完成或取消后继续本句。入口蓝图公开“关闭结果”和“关闭原因”，可继续连接不同分支。</p>
        </>}
        {destination === 'button' && <>
          <Field label="按钮与界面方案"><select aria-label="页面接入按钮" value={buttonKey} onChange={e => setButtonKey(e.target.value)}><option value="">选择按钮</option>{buttons.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
          {button && <div className="page-connection-bindings"><strong>原有绑定</strong><p>主操作：{button.component.action ? actionName(button.component.action) : '无'}</p>
            {handlers.length ? handlers.map((h, i) => <p key={i}>{i + 1}. {graphs.find(g => g.id === h.graphId)?.name ?? '蓝图已不存在'}{h.nodeId ? ' · 控件点击事件' : ''}</p>) : <p>无点击蓝图</p>}
            {button.component.clickMode === 'replace' && <p className="muted">此前已停用的附加事件保持停用。</p>}
          </div>}
          <Field label="接入方式"><select aria-label="页面接入按钮方式" value={buttonMode} onChange={e => setButtonMode(e.target.value as typeof buttonMode)}><option value="append">追加：打开页面后继续原有绑定</option><option value="replace">替换：只执行新的页面入口</option></select></Field>
          <p className="muted">追加时先运行页面入口，再依次执行原有点击事件和主操作；替换时停用原点击回调。</p>
        </>}
        {(destination === 'beforeTitle' || destination === 'beforeNewGame') && <p className="muted">加入流程蓝图中“{destination === 'beforeTitle' ? '游戏启动 → 标题菜单' : '新游戏 → 故事入口'}”的末尾。可直接查看节点、改接连线，并在右侧编辑完成、取消和跳过设置。</p>}
        {destination !== 'resource' && <><UiPageArgumentsEditor project={project} pageId={pageId} values={inputs} onChange={setInputs} label="页面接入输入" />{pageId === 'ui:save' && <Field label="存读档用途"><select aria-label="接入存读档用途" value={saveMode} onChange={event => setSaveMode(event.target.value as 'save' | 'load')}><option value="load">读取存档</option><option value="save">保存游戏（游戏内）</option></select></Field>}<UiPageOpeningFields project={project} pageId={pageId} value={opening} onChange={setOpening} label="页面接入" /></>}
        {error && <p role="alert" className="game-flow-error">{error}</p>}
      </>}
      <details className="page-connection-usage" open><summary>打开位置 · {entries.length}</summary>{entries.length ? usageList(entries) : <p className="muted">{references.some(use => use.dynamic) ? '未找到固定打开位置；存在运行时决定目标的调用。' : '尚未接入，可从按钮、剧情或流程添加入口。'}</p>}</details>
      {references.length > 0 && <details className="page-connection-usage" open={!!onDelete}><summary>引用与其他方案 · {references.length}</summary><p className="muted">蓝图中的引用、未连接流程和其他方案不代表当前游戏一定会打开此页。</p>{usageList(references)}</details>}
      {!onDelete && !page?.template && <p className="muted">页面名称可修改，以上位置通过固定标识保持连接。</p>}
    </div>
    <footer><div className="spacer" /><button className="small-button" onClick={onClose}>{success ? '完成' : '取消'}</button>{onDelete ? <button className="primary" onClick={onDelete}>删除页面</button> : !success && <button className="primary" disabled={!page || destination !== 'resource' && !!openProblem} onClick={connect}>{destination === 'resource' ? '返回编辑' : '添加使用位置'}</button>}</footer>
  </dialog>, document.body);
}
