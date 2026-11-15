import { cloneData } from "../core/project-mutation";
import {
  ChevronRight,
  GitBranch,
  MessageSquare,
  Plus,
  Settings2,
  Clapperboard,
  Trash2,
} from "lucide-react";
import {
  makeId,
  type NodeKind,
  type Project,
  type StoryNode,
  type StoryLine,
} from "../core/model";
import { formatCondition, nodeNames, type Commit } from "./editor";
import { Empty, IconButton } from "./components";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { copyStoryModule, createStoryModule, insertStoryModule, removeStoryModule, type ModuleKind, type ModulePlacement } from '../core/story-modules';
import { LineEffects } from './LineEffects';
import { Inspector } from './Inspector';
import type { AssetUrl } from './StageEditor';
import { editorPalette, readEditorTheme } from './editor-theme';
import { isStandaloneNode } from '../core/standalone-performance';
import type { PerformanceTarget } from '../core/performance-workspace';
import { sameScriptRowContext } from '../core/script-row-context';
import { ScriptLine, type ScriptTextSelection } from './ScriptLine';
import { useStableCallbacks } from './useStableCallbacks';

export function ScriptEditorActions({ project, sceneId, addNode }: { project: Project; sceneId: string; addNode: (kind: NodeKind) => void }) {
  const count = project.nodes.filter(n => n.sceneId === sceneId).reduce((total, node) => total + (node.kind === 'passage' ? node.lines.filter(line => !line.silent).length : 0), 0);
  return <><span className="muted module-line-count">{count} 行对白</span><div className="spacer" /><button type="button" className="small-button" onClick={() => addNode('passage')}><Plus size={15} />段落</button><select aria-label="添加剧情节点" value="" onChange={event => { if (event.target.value) addNode(event.target.value as NodeKind); }}><option value="">添加节点</option>{(['choice', 'condition', 'set', 'jump', 'call', 'return', 'interaction', 'end'] as NodeKind[]).map(kind => <option key={kind} value={kind}>{nodeNames[kind]}</option>)}</select></>;
}

export function ScriptEditor({
  project,
  sceneId,
  selectedNodeId,
  selectedLineId,
  revealRequest,
  commit,
  playbackCommit,
  select,
  addNode,
  modeControls,
  embedded = false,
  assetUrl,
  openBlueprint,
  openPerformance,
}: {
  project: Project;
  sceneId: string;
  selectedNodeId?: string;
  selectedLineId?: string;
  /** Directory requests also reveal a destination that is already selected. */
  revealRequest?: number;
  commit: Commit;
  playbackCommit?: Commit;
  select: (nodeId: string, lineId?: string) => void;
  addNode: (kind: NodeKind) => void;
  modeControls?: ReactNode;
  embedded?: boolean;
  assetUrl: AssetUrl;
  openBlueprint?: (id: string) => void;
  openPerformance?: (target: PerformanceTarget) => void;
}) {
  const nodes = project.nodes.filter((n) => n.sceneId === sceneId);
  const [properties, setProperties] = useState<string>();
  const [textSelection, setTextSelection] = useState<ScriptTextSelection>();
  const [openLines, setOpenLines] = useState<ReadonlySet<string>>(() => new Set());
  const toggleLine = (id: string) => setOpenLines(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ id: string; name: string }>();
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string; lineId?: string }>();
  const [clipboard, setClipboard] = useState<StoryNode>();
  const [lineClipboard, setLineClipboard] = useState<StoryLine>();
  const localSelection = useRef<{ projectId: string; nodeId: string; lineId: string; request?: number } | undefined>(undefined);
  const revealFrame = useRef<number | undefined>(undefined);
  const activateLine = (nodeId: string, lineId: string) => {
    // A click or native focus already reached this row. Revealing its complete
    // (possibly very tall) settings again forces layout and moves the viewport.
    if (revealFrame.current !== undefined) cancelAnimationFrame(revealFrame.current);
    revealFrame.current = undefined;
    localSelection.current = nodeId !== selectedNodeId || lineId !== selectedLineId ? { projectId: project.id, nodeId, lineId, request: revealRequest } : undefined;
    select(nodeId, lineId);
  };
  const rowContext = useRef(project);
  if (!sameScriptRowContext(rowContext.current, project)) rowContext.current = project;
  const handlers = useStableCallbacks({
    getProject: () => project, commit, playbackCommit: playbackCommit ?? commit, assetUrl, select, activate: activateLine,
    openBlueprint: (id: string) => openBlueprint?.(id),
    openPerformance: (target: PerformanceTarget) => openPerformance?.(target),
    focus: (nodeId: string, lineId: string) => { activateLine(nodeId, lineId); setTextSelection(current => current?.lineId === lineId ? current : undefined); },
    toggle: (nodeId: string, lineId: string) => { activateLine(nodeId, lineId); toggleLine(lineId); },
    contextMenu: (nodeId: string, lineId: string, x: number, y: number) => setMenu({ nodeId, lineId, x, y }),
    selectText: (lineId: string, start: number, end: number) => {
      setTextSelection(current => end <= start ? undefined : current?.lineId === lineId && current.start === start && current.end === end ? current : { lineId, start, end });
      if (end > start) setOpenLines(current => current.has(lineId) ? current : new Set(current).add(lineId));
    },
  });
  useEffect(() => { setCollapsed(new Set()); setOpenLines(new Set()); setTextSelection(undefined); setClipboard(undefined); setLineClipboard(undefined); setMenu(undefined); }, [project.id]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!(event.target as Element).closest('.module-context-menu')) setMenu(undefined); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(undefined); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [menu]);
  const toggle = (id: string) => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const rename = () => {
    if (renaming?.name.trim()) commit('重命名模块', draft => { const node = draft.nodes.find(node => node.id === renaming.id); if (node) node.name = renaming.name.trim(); });
    setRenaming(undefined);
  };
  const insert = (kind: ModuleKind | 'paste', placement: ModulePlacement, anchorId = menu?.nodeId) => {
    if (kind === 'paste' && !clipboard) return;
    const node = kind === 'paste' ? copyStoryModule(clipboard!) : createStoryModule(kind, sceneId);
    commit(kind === 'paste' ? '粘贴模块' : '添加模块', draft => { insertStoryModule(draft, node, sceneId, anchorId, placement); });
    select(node.id); setMenu(undefined);
  };
  const insertLine = (placement: ModulePlacement, paste = false) => {
    if (!menu?.nodeId || !menu.lineId || paste && !lineClipboard) return;
    const { nodeId, lineId } = menu;
    const line: StoryLine = { ...(paste ? cloneData(lineClipboard!) : { text: '', actions: [] }), id: makeId('line') };
    commit(paste ? '粘贴台词' : '插入台词', draft => {
      const node = draft.nodes.find(node => node.id === nodeId);
      if (node?.kind === 'passage') node.lines.splice(node.lines.findIndex(line => line.id === lineId) + (placement === 'below' ? 1 : 0), 0, line);
    });
    select(nodeId, line.id); setMenu(undefined);
  };
  const menuNode = project.nodes.find(node => node.id === menu?.nodeId);
  const menuLine = menuNode?.kind === 'passage' ? menuNode.lines.find(line => line.id === menu?.lineId) : undefined;
  const [palette, setPalette] = useState(() => editorPalette(readEditorTheme()));
  useEffect(() => {
    const refresh = () => setPalette(editorPalette(readEditorTheme()));
    window.addEventListener('editor-theme-change', refresh);
    return () => window.removeEventListener('editor-theme-change', refresh);
  }, []);
  useLayoutEffect(() => {
    const local = localSelection.current;
    localSelection.current = undefined;
    if (local && local.projectId === project.id && local.nodeId === selectedNodeId && local.lineId === selectedLineId && local.request === revealRequest) return;
    if (selectedNodeId) setCollapsed(current => {
      if (!current.has(selectedNodeId)) return current;
      const next = new Set(current); next.delete(selectedNodeId); return next;
    });
    // Directory navigation and newly inserted/copied rows still reveal their
    // destination, after React has committed its layout for this selection.
    revealFrame.current = requestAnimationFrame(() => {
      revealFrame.current = undefined;
      const section = selectedNodeId ? document.getElementById(`node-${selectedNodeId}`) : undefined;
      const target = (selectedLineId ? document.getElementById(`line-${selectedLineId}`) : undefined)
        ?? section?.querySelector('.passage-heading-row') ?? section;
      target?.scrollIntoView({ block: 'nearest' });
    });
    return () => {
      if (revealFrame.current !== undefined) cancelAnimationFrame(revealFrame.current);
      revealFrame.current = undefined;
    };
  }, [project.id, selectedNodeId, selectedLineId, sceneId, revealRequest]);
  return (
    <div className="script-workspace">
      {!embedded && <div className="workspace-toolbar">
        {modeControls ?? <span>
          <MessageSquare size={16} />
          {project.scenes.find((s) => s.id === sceneId)?.name ?? "剧本"}
        </span>}
        <span className="muted">
          {nodes.reduce(
            (n, node) => n + (node.kind === "passage" ? node.lines.filter(line => !line.silent).length : 0),
            0,
          )}{" "}
          行
        </span>
        <div className="spacer" />
        <button className="small-button" onClick={() => addNode("passage")}>
          <Plus size={15} />
          段落
        </button>
        <select
          aria-label="添加剧情节点"
          value=""
          onChange={(e) => {
            if (e.target.value) addNode(e.target.value as NodeKind);
          }}
        >
          <option value="">添加节点</option>
          {(
            [
              "choice",
              "condition",
              "set",
              "jump",
              "call",
              "return",
              "interaction",
              "end",
            ] as NodeKind[]
          ).map((kind) => (
            <option key={kind} value={kind}>
              {nodeNames[kind]}
            </option>
          ))}
        </select>
      </div>}
      <div className="script-scroll">
        {!nodes.length && (
          <Empty title="这个场景尚无剧情">
            <button className="primary" onClick={() => addNode("passage")}>
              <Plus size={16} />
              创建第一段
            </button>
          </Empty>
        )}
        {nodes.map((node, index) => (
          <section
            key={node.id}
            id={`node-${node.id}`}
            className={`passage-section ${node.textHeading === false ? 'implicit-passage' : ''} ${node.id === selectedNodeId ? "active" : ""}`}
            data-node-kind={isStandaloneNode(node) ? 'standalone' : node.kind}
            onContextMenu={event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id }); }}
          >
            {(node.textHeading !== false || isStandaloneNode(node) || node.kind !== 'passage') && <div className="passage-heading-row"><button className="module-fold-toggle" aria-label={collapsed.has(node.id) ? '展开模块' : '收起模块'} aria-expanded={!collapsed.has(node.id)} onClick={() => toggle(node.id)}><ChevronRight size={15} style={{ transform: collapsed.has(node.id) ? undefined : 'rotate(90deg)' }} /></button>{renaming?.id === node.id ? <input autoFocus className="module-name-input" aria-label="模块名称" value={renaming.name} maxLength={120} onChange={event => setRenaming({ ...renaming, name: event.target.value })} onBlur={rename} onKeyDown={event => { if (event.key === 'Enter') rename(); if (event.key === 'Escape') setRenaming(undefined); }} /> : <button
              className="passage-header"
              title="双击修改模块名称"
              onDoubleClick={() => setRenaming({ id: node.id, name: node.name })}
              onClick={() =>
                select(
                  node.id,
                  node.kind === "passage" ? node.lines[0]?.id : undefined,
                )
              }
            >
              <strong>{node.textHeading === false && !isStandaloneNode(node) ? nodeNames[node.kind] : node.name}</strong>
            </button>}</div>}
            <div className="module-body" hidden={collapsed.has(node.id)}>
            {isStandaloneNode(node) ? <div className="standalone-node-card">
              <LineEffects project={project} nodeId={node.id} line={node.lines[0]} number={1} commit={commit} playbackCommit={playbackCommit} assetUrl={assetUrl} select={() => select(node.id, node.lines[0].id)} openBlueprint={openBlueprint} openPerformance={openPerformance} autoExpand />
            </div> : node.kind === "passage" ? (
              <div className="story-lines">
                {node.lines.map((line, lineIndex) => <ScriptLine key={line.id}
                  context={rowContext.current} getProject={handlers.getProject}
                  nodeId={node.id} line={line} index={lineIndex} lineCount={node.lines.length}
                  selected={node.id === selectedNodeId && line.id === selectedLineId}
                  expanded={openLines.has(line.id)} textSelection={textSelection?.lineId === line.id ? textSelection : undefined}
                  palette={palette} commit={handlers.commit} playbackCommit={handlers.playbackCommit}
                  assetUrl={handlers.assetUrl} select={handlers.select} activate={handlers.activate} focus={handlers.focus}
                  toggle={handlers.toggle} selectText={handlers.selectText} contextMenu={handlers.contextMenu}
                  openBlueprint={openBlueprint ? handlers.openBlueprint : undefined}
                  openPerformance={openPerformance ? handlers.openPerformance : undefined}
                />)}
                <button
                  className="add-line"
                  onClick={() => {
                    const id = makeId("line");
                    commit("添加对白", (p) => {
                      const n = p.nodes.find((n) => n.id === node.id);
                      if (n?.kind === "passage")
                        n.lines.push({ id, text: "", actions: [] });
                    });
                    select(node.id, id);
                  }}
                >
                  <Plus size={15} />
                  添加对白
                </button>
              </div>
            ) : (
              <button className="node-summary" aria-expanded={properties === node.id} onClick={() => { select(node.id); setProperties(current => current === node.id ? undefined : node.id); }}>
                {summary(project, node)}
              </button>
            )}
            </div>
          </section>
        ))}
        <button className="add-module" onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); setMenu({ x: bounds.left, y: bounds.bottom }); }}><Plus size={16} />添加模块</button>
      </div>
      {properties && createPortal(<div className="modal-backdrop" onClick={() => setProperties(undefined)}><div className="dialog module-content-dialog" role="dialog" aria-label="编辑模块内容" onClick={event => event.stopPropagation()}><button className="small-button" onClick={() => setProperties(undefined)}>完成</button><Inspector project={project} nodeId={properties} view="script" projectSettings={false} hideDialogue commit={commit} assetUrl={assetUrl} selectNode={select} selectResource={() => {}} /></div></div>, document.body)}
      {menu && createPortal(<div className="performance-context-menu module-context-menu" role="menu" aria-label={menuLine ? '台词菜单' : '模块菜单'} style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 255)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 480)) }}>
        {menuLine ? <>
          <button role="menuitem" onClick={() => insertLine('above')}>在上方插入新台词</button><button role="menuitem" onClick={() => insertLine('below')}>在下方插入新台词</button><hr />
          <button role="menuitem" onClick={() => { setLineClipboard(cloneData(menuLine)); setMenu(undefined); }}>复制台词</button>
          <button role="menuitem" onClick={() => { setLineClipboard(cloneData(menuLine)); commit('剪切台词', draft => { const node = draft.nodes.find(node => node.id === menuNode!.id); if (node?.kind === 'passage') node.lines = node.lines.filter(line => line.id !== menuLine.id); }); setMenu(undefined); }}>剪切台词</button>
          <button role="menuitem" disabled={!lineClipboard} onClick={() => insertLine('above', true)}>粘贴到台词上方</button><button role="menuitem" disabled={!lineClipboard} onClick={() => insertLine('below', true)}>粘贴到台词下方</button>
          <button role="menuitem" onClick={() => { commit('删除台词', draft => { const node = draft.nodes.find(node => node.id === menuNode!.id); if (node?.kind === 'passage') node.lines = node.lines.filter(line => line.id !== menuLine.id); }); setMenu(undefined); }}>删除台词</button>
        </> : <>
          {menuNode && <>
            <button role="menuitem" onClick={() => { setRenaming({ id: menuNode.id, name: menuNode.name }); setMenu(undefined); }}>重命名</button>
            <button role="menuitem" onClick={() => { toggle(menuNode.id); setMenu(undefined); }}>{collapsed.has(menuNode.id) ? '展开模块' : '收起模块'}</button>
            <button role="menuitem" disabled={menuNode.kind === 'start'} onClick={() => { setClipboard(cloneData(menuNode)); setMenu(undefined); }}>复制模块</button>
            <button role="menuitem" disabled={menuNode.kind === 'start'} onClick={() => { setClipboard(cloneData(menuNode)); commit('剪切模块', draft => removeStoryModule(draft, menuNode.id)); setMenu(undefined); }}>剪切模块</button>
            <button role="menuitem" disabled={menuNode.kind === 'start'} onClick={() => { commit('删除模块', draft => removeStoryModule(draft, menuNode.id)); setMenu(undefined); }}>删除模块</button><hr />
            {menuNode.kind !== 'passage' && menuNode.kind !== 'start' && <button role="menuitem" onClick={() => { setProperties(menuNode.id); setMenu(undefined); }}>编辑内容…</button>}
          </>}
          {(menuNode ? ['above', 'below'] as const : ['below'] as const).map(placement => <div key={placement}>
            <button role="menuitem" onClick={() => insert('dialogue', placement)}>{menuNode ? placement === 'above' ? '在上方添加' : '在下方添加' : '添加'}剧情模块</button>
            <button role="menuitem" onClick={() => insert('standalone', placement)}>{menuNode ? placement === 'above' ? '在上方添加' : '在下方添加' : '添加'}独立演出模块</button>
            <button role="menuitem" disabled={!clipboard} onClick={() => insert('paste', placement)}>{menuNode ? placement === 'above' ? '粘贴到模块上方' : '粘贴到模块下方' : '粘贴模块'}</button>
          </div>)}
        </>}
      </div>, document.body)}
    </div>
  );
}

function summary(project: Project, node: StoryNode) {
  if (node.kind === 'chapterTitle') return <><p>{node.title}</p>{node.subtitle && <p className="muted">{node.subtitle}</p>}<span className="muted">章节演出 · {node.duration} 秒{node.soundId ? ' · ' + (project.assets.find(asset => asset.id === node.soundId)?.name ?? '章节音效') : ''}</span></>;
  if (node.kind === "interaction") return <>
    <p>{node.prompt || "点击互动"}</p>
    {node.hotspots.map((hotspot, index) => <span className="choice-summary" key={hotspot.id}><b>{index + 1}</b>{hotspot.name || `区域 ${index + 1}`}<ChevronRight size={13} /><span className="muted">{project.nodes.find(target => target.id === hotspot.target)?.name ?? "未连接"}</span></span>)}
    <span className="muted">{node.timeoutSeconds > 0 ? `${node.timeoutSeconds} 秒后超时` : "不限时"} · {node.showHints ? "显示区域提示" : "隐藏区域提示"}</span>
  </>;
  if (node.kind === "minigame") return <>
    <p>{node.title || (node.template === "password" ? "密码锁" : node.template === "custom" ? "自定义小游戏" : "限时点击")}</p>
    <p>{node.template === "password" ? `密码锁 · ${node.attempts} 次尝试` : node.template === "custom" ? "自定义 UI · 蓝图或脚本" : `${node.timeLimit} 秒内点击 ${node.targetClicks} 次`}</p>
    {([['success', '成功'], ['failure', '失败'], ['cancel', '取消']] as const).map(([port, label]) => <span className="choice-summary" key={port}>{label}<ChevronRight size={13} /><span className="muted">{project.nodes.find(target => target.id === node[port])?.name ?? "未连接"}</span></span>)}
  </>;
  if (node.kind === "choice")
    return (
      <>
        <p>{node.prompt || "玩家选择"}</p>
        {node.choices.map((c, i) => (
          <span key={c.id} className="choice-summary">
            <b>{i + 1}</b>
            {c.text}
            <ChevronRight size={13} />
            <span className="muted">
              {project.nodes.find((n) => n.id === c.target)?.name ?? "未连接"}
            </span>
          </span>
        ))}
      </>
    );
  if (node.kind === "condition")
    return formatCondition(project, node.condition);
  if (node.kind === "set")
    return `${project.variables.find((v) => v.id === node.variableId)?.name ?? "未选择状态"} ${node.operation === "add" ? "增加" : "设为"} ${String(node.value)}`;
  if (node.kind === "end") return "返回标题界面";
  if (node.kind === "return") return "返回调用处";
  const target =
    node.kind === "jump" || node.kind === "call"
      ? node.target
      : "next" in node
        ? node.next
        : undefined;
  return target
    ? `前往 ${project.nodes.find((n) => n.id === target)?.name ?? "缺失的节点"}`
    : "尚未连接";
}
