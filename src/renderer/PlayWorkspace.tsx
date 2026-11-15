import { BlueprintDebugPanel } from './BlueprintDebugPanel';
import type { BlueprintBreakpoint, BlueprintDebugSnapshot } from '../core/blueprint-debug';
import type { UiPreviewActionHandler } from '../core/ui-preview-actions';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, CircleAlert, ExternalLink, LoaderCircle, Pause, Play, RotateCcw, Square } from 'lucide-react';
import type { PreviewMode, PreviewOptions, PreviewPhase, RuntimeEvent, StudioBridge } from '../core/bridge';
import type { Project } from '../core/model';
import { gamePreviewOrigin } from '../core/preview-origin';

const phaseNames: Record<PreviewPhase, string> = { idle: '已停止', compiling: '准备中', starting: '启动中', running: '运行中', paused: '已暂停', failed: '启动失败' };
export function PlayWorkspace({ project, bridge, phase, message, mode, setMode, options, position, blocked, onBack, onRestart, onPause, onStop, onFocus, onLocate, debug, firstFramePending, debugEnabled, onDebugEnabled, debugPoints, onDebugPoints, onDebugAction }: {
  project: Project; bridge: StudioBridge; phase: PreviewPhase; message: string; mode: PreviewMode; setMode: (mode: PreviewMode) => void; options: PreviewOptions;
  debug?: BlueprintDebugSnapshot; firstFramePending?: boolean; debugEnabled: boolean; onDebugEnabled: (value: boolean) => void; debugPoints: BlueprintBreakpoint[]; onDebugPoints: (value: BlueprintBreakpoint[]) => void; onDebugAction: UiPreviewActionHandler;
  position?: RuntimeEvent; blocked: boolean; onBack: () => void; onRestart: () => void; onPause: () => void; onStop: () => void; onFocus: () => void; onLocate: () => void;
}) {
  const region = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [debugOpen, setDebugOpen] = useState(false);
  useEffect(() => { if (debug?.phase === 'paused') setDebugOpen(true); }, [debug?.phase]);
  const waiting = phase === 'compiling' || phase === 'starting';
  const active = waiting || phase === 'running' || phase === 'paused';
  const node = project.nodes.find(node => node.id === position?.nodeId);
  const origin = gamePreviewOrigin(project, options);
  useLayoutEffect(() => {
    const container = region.current!;
    const resize = () => {
      const bounds = container.getBoundingClientRect(), ratio = project.width / project.height;
      const width = Math.max(0, Math.min(bounds.width - 24, (bounds.height - 24) * ratio));
      const height = width / ratio;
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    return () => observer.disconnect();
  }, [project.width, project.height]);
  useLayoutEffect(() => {
    const report = () => {
      const bounds = viewport.current!.getBoundingClientRect();
      void bridge.setPreviewViewport?.({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, visible: !blocked && !(debugOpen && window.innerWidth < 980) });
    };
    report(); window.addEventListener('resize', report);
    const observer = new ResizeObserver(report); observer.observe(viewport.current!);
    return () => { observer.disconnect(); window.removeEventListener('resize', report); };
  }, [bridge, size, blocked, mode, debugOpen]);
  useEffect(() => () => { void bridge.setPreviewViewport?.({ x: 0, y: 0, width: 0, height: 0, visible: false }); }, [bridge]);
  return <section className="play-workspace" aria-label="实时试玩工作区" data-preview-state={phase}>
    <header className="play-toolbar">
      <button className="small-button" onClick={onBack}><ArrowLeft size={15} />返回编辑</button>
      <strong>实时试玩</strong><span className={`play-phase ${phase}`}>{waiting ? <LoaderCircle size={13} className="spin" /> : <span />}{phaseNames[phase]}</span>
      <div className="spacer" />
      <button className="small-button play-debug-toggle" aria-pressed={debugOpen} onClick={() => setDebugOpen(value => !value)}>蓝图调试</button>
      <select aria-label="试玩显示方式" value={mode} disabled={active} onChange={event => setMode(event.target.value as PreviewMode)}><option value="embedded">编辑器内</option><option value="window">独立窗口</option></select>
      <button className="small-button" disabled={waiting} onClick={onRestart}><RotateCcw size={14} />重新运行</button>
      <button className="small-button" disabled={!['running', 'paused'].includes(phase)} onClick={onPause}>{phase === 'paused' ? <Play size={14} /> : <Pause size={14} />}{phase === 'paused' ? '继续' : '暂停'}<kbd>F6</kbd></button>
      <button className="small-button play-stop" disabled={!active} onClick={onStop}><Square size={13} />停止<kbd>Shift+F5</kbd></button>
    </header>
    <div className={'play-body' + (debugOpen ? ' debug-open' : '')}>
      <div className="play-screen">
        <div className="play-canvas-region" ref={region}>
          <div className={`play-viewport ${phase}`} ref={viewport} style={size} aria-label="游戏画面" onClick={onFocus}>
            {(waiting || firstFramePending || phase === 'failed' || phase === 'idle' || mode === 'window') && <div className="play-placeholder">
              {waiting ? <LoaderCircle size={34} className="spin" /> : phase === 'failed' ? <CircleAlert size={34} /> : mode === 'window' && active ? <ExternalLink size={34} /> : <Play size={34} />}
              <strong>{firstFramePending && phase === 'paused' ? '蓝图在首帧前暂停' : waiting ? message : phase === 'failed' ? '试玩未能启动' : mode === 'window' && active ? '游戏正在独立窗口中运行' : '试玩已停止'}</strong>
              <p>{firstFramePending && phase === 'paused' ? '可在蓝图调试面板单步或继续；尚未生成游戏画面，不代表启动失败。' : phase === 'failed' ? message : waiting ? '画面就绪后会自动显示，准备期间可以停止。' : '修改内容后重新运行，即可验证最新效果。'}</p>
              {mode === 'window' && !waiting && active && <button className="primary" onClick={onFocus}>显示游戏窗口</button>}
              {phase === 'failed' && <button className="small-button" onClick={onBack}>返回编辑并查看问题</button>}
            </div>}
          </div>
        </div>
        <div className="play-hint"><span>{project.width} × {project.height} · {mode === 'embedded' ? '编辑器内试玩' : '独立窗口试玩'}</span><span>点击画面操作游戏 · Shift+F1 返回编辑器控制</span></div>
      </div>
      {debugOpen ? <div className="play-debug-pane"><BlueprintDebugPanel project={project} bridge={bridge} snapshot={debug} active={active} enabled={debugEnabled} onEnabled={onDebugEnabled} points={debugPoints} onPoints={onDebugPoints} onAction={onDebugAction} onClose={() => setDebugOpen(false)}/></div> : <aside className="play-watch" aria-label="试玩运行状态">
        <h3>预览起点</h3><div className="play-origin" role="note" aria-label="预览起点" data-preview-origin={origin.kind}><strong>{origin.label}</strong><p>{origin.detail}</p><span>新游戏后的剧情入口：{origin.storyEntry}</span></div>
        <h3>运行位置</h3><button className="play-location" disabled={!node} onClick={onLocate}>{node?.name ?? (active ? '尚未进入剧情（标题或页面流程）' : '尚未进入剧情')}{node?.kind === 'passage' && position?.lineId && <small>第 {node.lines.findIndex(line => line.id === position.lineId) + 1} 行 · 点击定位</small>}</button>
        <h3>剧情状态</h3>{project.variables.map(variable => <div className="play-variable" key={variable.id}><span>{variable.name}</span><output>{(() => { const value = position?.variables?.[variable.id] ?? variable.initial; return typeof value === 'boolean' ? value ? '是' : '否' : String(value); })()}</output></div>)}
        {!project.variables.length && <p className="muted">本工程没有剧情状态。</p>}
        <p className="play-note">每次试玩使用独立存档和首次执行标记，不影响真实玩家资料。返回编辑会暂停游戏，重新运行保留所选起点并采用最新修改。</p>
      </aside>}
    </div>
  </section>;
}
