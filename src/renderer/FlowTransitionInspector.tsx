import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, ExternalLink, Pause, Play, RotateCcw, X } from 'lucide-react';
import type { PerformancePlayback, Project, StoryNode } from '../core/model';
import { defaultFlowTransition, flowTransitionDuration, flowTransitionSecondsText, flowTransitionSummary, flowTransitionWithDuration, setStoryTransition, storyTransition, storyTransitionPorts, type FlowTransition } from '../core/flow-transitions';
import { storyPortLabel } from '../core/story-graph';
import { findFlowStep, flowNodeIds, flowNodeName } from '../core/game-flow-graph';
import { gameFlowTransition, gameFlowTransitionSupport, setGameFlowTransition } from '../core/game-flow-transitions';
import { performancePlayback } from '../core/standalone-performance';
import type { Commit } from './editor';
import type { StudioEdge } from './SelectableEdge';
import { Field, IconButton } from './components';
import { NumberInput } from './NumberInput';
import './flow-transition.css';

type TransitionPreset = 'inherit' | 'none' | 'dissolve' | 'black' | 'white' | 'color';

function transitionPreset(transition?: FlowTransition): TransitionPreset {
  if (!transition) return 'inherit';
  if (transition.mode !== 'color') return transition.mode;
  const color = transition.color.toLowerCase();
  return color === '#000000' ? 'black' : color === '#ffffff' ? 'white' : 'color';
}

function fromPerformance(transition: NonNullable<PerformancePlayback['transition']>): FlowTransition {
  if (transition.mode === 'none') return { mode: 'none' };
  if (transition.mode === 'dissolve') return { mode: 'dissolve', duration: transition.outDuration };
  return { mode: 'color', outDuration: transition.outDuration, hold: transition.hold, inDuration: transition.inDuration, color: transition.color };
}

/** This is a local source summary, not a guess at the path's eventual winner. */
function originalTransition(project: Project, node: StoryNode, port: string): { source: string; transition: FlowTransition } | undefined {
  if (node.kind === 'jump' && port === 'target' && node.sceneTransition) {
    const original = node.sceneTransition;
    const transition: FlowTransition = original.mode === 'fade'
      ? { mode: 'color', outDuration: original.duration / 2, hold: 0, inDuration: original.duration / 2, color: original.color }
      : original.mode === 'dissolve' ? { mode: 'dissolve', duration: original.duration } : { mode: 'none' };
    return { source: '场景跳转', transition };
  }
  const lastLine = node.kind === 'passage' ? node.lines.at(-1) : undefined;
  const settings = lastLine?.silent ? performancePlayback(project, lastLine) : node.kind === 'chapterTitle' ? node.playback : undefined;
  return port === 'next' && settings?.onComplete !== 'title' && settings?.transition
    ? { source: '段落末尾的独立演出', transition: fromPerformance(settings.transition) } : undefined;
}

function TransitionPreview({ transition }: { transition: FlowTransition }) {
  const [progress, setProgress] = useState(0), [playing, setPlaying] = useState(false);
  const position = useRef(0);
  const duration = flowTransitionDuration(transition);
  const seek = (next: number) => { position.current = next; setProgress(next); };
  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      // Zero-duration cuts hold each sample briefly so the cut can be seen.
      const next = Math.min(1, position.current + (now - previous) / 1000 / (duration || .8));
      previous = now;
      position.current = next; setProgress(next);
      if (next < 1) frame = requestAnimationFrame(draw);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);
  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, []);

  let after = progress >= .5 ? 1 : 0, colorOpacity = 0;
  if (duration > 0 && transition.mode === 'dissolve') after = progress;
  else if (duration > 0 && transition.mode === 'color') {
    const elapsed = duration * progress, revealAt = transition.outDuration + transition.hold;
    after = elapsed >= revealAt ? 1 : 0;
    colorOpacity = elapsed < transition.outDuration ? elapsed / transition.outDuration
      : elapsed < revealAt ? 1 : transition.inDuration ? Math.max(0, 1 - (elapsed - revealAt) / transition.inDuration) : 0;
  }
  return <section className="flow-transition-preview" data-flow-transition-preview data-progress={progress} data-playing={playing} aria-label="效果示意">
    <div className="flow-transition-preview-heading"><h3>效果示意</h3><span>{duration ? `${flowTransitionSecondsText(duration)} 秒` : '直接切换'}</span></div>
    <div className="flow-transition-samples" role="img" aria-label="从样例画面 A 到样例画面 B 的过渡效果">
      <div className="flow-transition-sample before"><span>A · 上一画面</span></div>
      <div className="flow-transition-sample after" style={{ opacity: after }}><span>B · 下一画面</span></div>
      {transition.mode === 'color' && <div className="flow-transition-sample-color" style={{ background: transition.color, opacity: colorOpacity }} />}
    </div>
    <div className="flow-transition-preview-controls">
      <IconButton title={playing ? '暂停效果示意' : '播放效果示意'} onClick={() => { if (!playing && position.current >= 1) seek(0); setPlaying(!playing); }}>{playing ? <Pause size={14} /> : <Play size={14} />}</IconButton>
      <input aria-label="效果示意进度" aria-valuetext={`${Math.round(progress * 100)}%`} type="range" min={0} max={1000} step={1} value={Math.round(progress * 1000)} onPointerDown={() => setPlaying(false)} onChange={event => { setPlaying(false); seek(Number(event.target.value) / 1000); }} />
      <IconButton title="重播效果示意" onClick={() => { seek(0); setPlaying(true); }}><RotateCcw size={14} /></IconButton>
    </div>
    <p className="flow-transition-note">样例 A → 样例 B；实际剧情画面请试玩。</p>
  </section>;
}

function ReadonlyConnection({ edge, onInspectSource, onLocateStory }: { edge: StudioEdge; onInspectSource: () => void; onLocateStory: (id: string) => void }) {
  const port = edge.data?.storyPort ?? edge.sourceHandle;
  const explanation = edge.data?.pageEvent
    ? '这条线来自页面按钮的真实事件。页面的打开方式和覆盖层行为在原按钮或事件图中设置；这里暂不提供剧情画面的过渡。'
    : port === 'restore' ? '读档会恢复存档记录中的位置与画面，不会从固定剧情节点重新开始。这条系统恢复路径暂不提供连线过渡。'
    : port === 'returnCall' ? '返回位置由本次调用决定。请在调用节点的“返回后继续”连线上设置返回后的过渡。'
    : port === 'returnTitle' || edge.id === 'flow:story:returnTitle' ? '这条线结束当前剧情并返回标题菜单。标题和页面的切换遵循各自的运行流程，暂不提供剧情连线过渡。'
    : edge.id === 'story:entry' ? '这是新游戏进入故事入口的导航线。可在实际剧情节点的出口上设置画面过渡。'
    : !edge.data?.storySource ? '此导航不属于启动或新游戏流程的继续出口。请查看来源节点，编辑它的页面或事件行为。'
    : '这个出口目前不能执行剧情过渡。可以查看原节点，检查出口和结束方式。';
  return <div className="flow-transition-readonly"><p>{edge.data?.label}</p><p className="flow-transition-note">{explanation}</p>
    {edge.id === 'story:entry' && edge.data?.storyTarget
      ? <button className="small-button" onClick={() => onLocateStory(edge.data!.storyTarget!)}><ExternalLink size={14} />查看故事入口</button>
      : <button className="small-button" onClick={onInspectSource}><ExternalLink size={14} />{edge.data?.pageEvent ? '查看原按钮与事件' : '查看来源节点'}</button>}
  </div>;
}

export function FlowTransitionInspector({ project, edge, gameFlowSource, multiple = false, commit, onLocateStory, onLocateGameFlow, onInspectSource, report }: {
  project: Project; edge?: StudioEdge; gameFlowSource?: string; multiple?: boolean; commit: Commit;
  onLocateStory: (id: string) => void; onLocateGameFlow: (id: string) => void; onInspectSource: () => void; report: (error: string) => void;
}) {
  const source = edge?.data?.storySource ? project.nodes.find(node => node.id === edge.data!.storySource) : undefined;
  const flowSource = gameFlowSource ?? edge?.data?.gameFlowSource;
  const flowSupport = flowSource ? gameFlowTransitionSupport(project, flowSource, edge?.sourceHandle ?? 'next') : undefined;
  const flowSupported = !!flowSupport?.supported && !edge?.data?.readonly;
  const port = flowSource ? 'next' : edge?.data?.storyPort;
  const target = edge?.data?.storyTarget ? project.nodes.find(node => node.id === edge.data!.storyTarget) : undefined;
  const storySupported = !!source && !!port && !edge?.data?.readonly && storyTransitionPorts(source, project).some(item => item.port === port);
  const supported = flowSupported || storySupported;
  const disabledTimeout = source?.kind === 'interaction' && port === 'timeout' && source.timeoutSeconds === 0;
  const transition = flowSupported ? gameFlowTransition(project, flowSource!) : storySupported ? storyTransition(source!, port!) : undefined;
  const original = storySupported ? originalTransition(project, source!, port!) : undefined;
  const sourceId = flowSource ?? source?.id;
  const targetId = flowSupport?.supported ? flowSupport.target : edge?.data?.storyTarget;
  const targetExists = flowSupported ? !!targetId && (targetId === flowNodeIds.title || targetId === flowNodeIds.story || !!findFlowStep(project, targetId)) : !!target;
  const locate = flowSupported ? onLocateGameFlow : onLocateStory;
  const update = (value: FlowTransition | undefined, label: string, separate = false) => {
    if (!supported || !sourceId || !port) return;
    try { commit(label, draft => { if (flowSupported) setGameFlowTransition(draft, sourceId, value); else setStoryTransition(draft, sourceId, port, value); }, { separate }); report(''); }
    catch (error) { report(error instanceof Error ? error.message : String(error)); }
  };
  const choosePreset = (preset: TransitionPreset) => {
    if (preset === 'inherit') { update(undefined, '移除连线单独过渡', true); return; }
    if (preset === 'none') { update({ mode: 'none' }, '设置连线过渡方式', true); return; }
    const previous = transition ?? original?.transition;
    const duration = previous && previous.mode !== 'none' ? flowTransitionDuration(previous) : flowTransitionDuration(defaultFlowTransition('dissolve'));
    if (preset === 'dissolve') { update(flowTransitionWithDuration(defaultFlowTransition('dissolve'), duration), '设置连线过渡方式', true); return; }
    const colorTransition = previous?.mode === 'color' ? previous : flowTransitionWithDuration(defaultFlowTransition('color'), duration);
    if (colorTransition.mode !== 'color') return;
    const color = preset === 'black' ? '#000000' : preset === 'white' ? '#ffffff'
      : !['#000000', '#ffffff'].includes(colorTransition.color.toLowerCase()) ? colorTransition.color : '#283d4a';
    update({ ...colorTransition, color }, '设置连线过渡方式', true);
  };
  const sample = transition ?? original?.transition;
  return <aside className="inspector flow-transition-inspector" aria-label="连线过渡属性" data-flow-transition-inspector data-flow-transition-kind={flowSource ? 'game' : 'story'} data-flow-transition-source={sourceId} data-flow-transition-port={port} data-flow-transition-target={targetId}>
    <div className="panel-heading"><ArrowRightLeft size={15} /><h2>连线过渡</h2></div>
    <div className="inspector-scroll">
      {multiple ? <p className="flow-transition-note">选中一条连线，查看它的来源、去向和过渡设置。</p>
        : !edge && !flowSource ? <p className="flow-transition-note">选择流程节点之间的连线，可设置这次衔接的画面过渡。</p>
        : !supported ? edge ? <ReadonlyConnection edge={edge} onInspectSource={onInspectSource} onLocateStory={onLocateStory} /> : <p className="flow-transition-note">{flowSupport && !flowSupport.supported ? flowSupport.reason : '此出口目前不可编辑。'}</p>
        : <>
          <dl className="flow-transition-route">
            <dt>从</dt><dd><button type="button" title={flowSupported ? '定位来源流程节点' : '定位来源剧情节点'} onClick={() => locate(sourceId!)}>{flowSupported ? flowNodeName(project, sourceId!) : source!.name}<ExternalLink size={12} /></button></dd>
            <dt>出口</dt><dd>{flowSupported ? edge?.data?.caption || '继续' : storyPortLabel(source!, port!)}</dd>
            <dt>到</dt><dd>{targetExists ? <button type="button" title={flowSupported ? '定位目标流程节点' : '定位目标剧情节点'} onClick={() => locate(targetId!)}>{flowSupported ? flowNodeName(project, targetId!) : target!.name}<ExternalLink size={12} /></button> : <span className="flow-transition-warning">{targetId ? '目标已不存在' : '尚未连接'}</span>}</dd>
          </dl>
          {!flowSupported && !target && <p className="flow-transition-note">目标已不存在，此设置暂不生效。改接到有效目标后会继续使用。</p>}
          {flowSupport?.supported && flowSupport.inactiveReason && <p className="flow-transition-note">{flowSupport.inactiveReason}</p>}
          {disabledTimeout && <p className="flow-transition-note">此互动没有启用超时计时，当前不会经过这条线。启用计时后会使用这里保留的设置。</p>}
          <Field label="过渡方式"><select aria-label="过渡方式" value={transitionPreset(transition)} onChange={event => choosePreset(event.target.value as TransitionPreset)}>
            <option value="inherit">不单独设置</option><option value="none">直接切换</option><option value="dissolve">叠化</option><option value="black">淡黑</option><option value="white">淡白</option><option value="color">经过颜色</option>
          </select></Field>
          {!transition && <p className="flow-transition-note" data-flow-transition-inheritance>此线不额外指定过渡。到达下一画面前，流程中已有且尚未播放的过渡仍会生效；没有时按原页面或演出的规则衔接。要明确取消这次画面过渡，请选“直接切换”。</p>}
          {transition && transition.mode !== 'none' && <Field label="总时长（秒）"><NumberInput aria-label="总时长（秒）" min={0} step={.1} value={flowTransitionSecondsText(flowTransitionDuration(transition))} onChange={event => update(flowTransitionWithDuration(transition, event.target.valueAsNumber), '调整连线过渡总时长')} /></Field>}
          {transition?.mode === 'color' && <details className="flow-transition-details"><summary>分段时间与颜色</summary>
            <Field label="淡出（秒）"><NumberInput aria-label="淡出（秒）" min={0} step={.1} value={flowTransitionSecondsText(transition.outDuration)} onChange={event => update({ ...transition, outDuration: event.target.valueAsNumber }, '调整连线过渡淡出')} /></Field>
            <Field label="停留（秒）"><NumberInput aria-label="停留（秒）" min={0} step={.1} value={flowTransitionSecondsText(transition.hold)} onChange={event => update({ ...transition, hold: event.target.valueAsNumber }, '调整连线过渡停留')} /></Field>
            <Field label="淡入（秒）"><NumberInput aria-label="淡入（秒）" min={0} step={.1} value={flowTransitionSecondsText(transition.inDuration)} onChange={event => update({ ...transition, inDuration: event.target.valueAsNumber }, '调整连线过渡淡入')} /></Field>
            <Field label="过渡颜色"><input aria-label="过渡颜色" type="color" value={transition.color} onChange={event => update({ ...transition, color: event.target.value }, '调整连线过渡颜色')} /></Field>
            <p className="flow-transition-note">总时长 = 淡出 + 停留 + 淡入。调整总时长会等比例缩放这三段。</p>
          </details>}
          {(original || transition) && <div className="flow-transition-original" data-flow-transition-original>{original && <><span>此出口原有过渡 · {original.source}</span><strong>{flowTransitionSummary(original.transition)}</strong></>}
            {transition && <small>{transition.mode === 'none' ? '此出口已指定直接切换。' : '此出口已指定上方的过渡。'}选择“不单独设置”可移除此处的覆盖。</small>}
            {original && !transition && <small>这里只显示此出口原有的过渡；实际路径上最后一个明确设置生效。</small>}
          </div>}
          {sample ? <TransitionPreview key={JSON.stringify(sample)} transition={sample} /> : <div className="flow-transition-preview-empty"><h3>效果示意</h3><p className="flow-transition-note">选择具体过渡后，可用样例画面查看效果。</p></div>}
          <details className="flow-transition-details flow-transition-rules"><summary>生效规则</summary>{flowSupported ? <><p>沿当前模块的继续出口，衔接下一处实际画面，包括页面、视频、动画演出、标题菜单或故事入口。过渡作用于整个画面；开场动画到游戏菜单就在这条线上设置。</p><p>只有逻辑而没有画面的模块会继续执行，以到达画面前最后一个明确设置为准。页面自动循环的 Spine 和视频在进入画面时开始播放；页面停留计时、初次进入事件和一次性媒体从入场完成后开始。不等待关闭的覆盖层呈现后立即继续。</p><p>标题菜单音乐从进入标题画面时开始；开场音乐由开场自身设置。取消后直接进入标题、读取存档和标题菜单按钮使用各自的行为。</p><p>改接目标会保留源出口的设置。在线上插入模块后，原过渡用于来源到新模块；删除模块时仅移除该模块自己的过渡。</p></> : <><p>过渡在从此出口到达下一处剧情画面或交互时执行。经过条件判断、参数赋值等节点时，以这段路径上最后一个明确设置为准。</p><p>改接目标会保留此出口的设置；改换源出口时，设置仍留在原出口。打组和解组不会改变设置。</p><p>音乐按原规则继续播放。这里的设置控制剧情画面，页面和覆盖层使用自己的打开与关闭行为。</p></>}</details>
        </>}
    </div>
  </aside>;
}

/** Disconnected and obsolete lifecycle settings remain discoverable even when
 * their source no longer has a visible wire or node on the canvas. */
export function GameFlowInactiveTransitions({ project, commit, onEdit, report }: { project: Project; commit: Commit; onEdit: (source: string) => void; report: (error: string) => void }) {
  const inactive = Object.entries(project.gameFlow?.transitions ?? {}).flatMap(([source, transition]) => {
    const support = gameFlowTransitionSupport(project, source);
    const reason = support.supported ? support.inactiveReason : support.reason;
    return reason ? [{ source, transition, reason, editable: support.supported }] : [];
  });
  if (!inactive.length) return null;
  return <details className="flow-transition-inactive" data-flow-transition-inactive data-game-flow-inactive open><summary>未启用的过渡 · {inactive.length}</summary>
    <p>设置保留在来源的继续出口。接回有效流程后继续使用，也可以移除。</p>
    {inactive.map(item => <div className="flow-transition-inactive-item" key={item.source} data-flow-transition-inactive-source={item.source} data-flow-transition-inactive-port="next"><div>
      {item.editable ? <button type="button" className="flow-transition-inactive-source" onClick={() => onEdit(item.source)}>{flowNodeName(project, item.source)} · 继续<ExternalLink size={11} /></button> : <strong>来源已不可用 · {item.source}</strong>}
      <span>{item.reason}</span><span>{flowTransitionSummary(item.transition)}</span></div>
      <IconButton title="移除未启用过渡" onClick={() => {
        try { commit('移除未启用的连线过渡', draft => { setGameFlowTransition(draft, item.source, undefined); }, { separate: true }); report(''); }
        catch (error) { report(error instanceof Error ? error.message : String(error)); }
      }}><X size={14} /></IconButton>
    </div>)}
  </details>;
}

/** Retained settings must remain visible and removable after disconnecting. */
export function StoryInactiveTransitions({ project, node, commit, report }: { project: Project; node: StoryNode; commit: Commit; report: (error: string) => void }) {
  const ports = storyTransitionPorts(node, project);
  const inactive = Object.entries(node.transitions ?? {}).flatMap(([port, transition]) => {
    const output = ports.find(item => item.port === port);
    const reason = !output ? '出口已不可用' : !output.target ? '未连接' : !project.nodes.some(item => item.id === output.target) ? '目标已不存在'
      : node.kind === 'interaction' && port === 'timeout' && node.timeoutSeconds === 0 ? '未启用超时' : undefined;
    return reason ? [{ port, transition, reason }] : [];
  });
  if (!inactive.length) return null;
  return <details className="flow-transition-inactive" data-flow-transition-inactive open><summary>未启用的过渡 · {inactive.length}</summary>
    <p>保留在原出口，当前不会播放。恢复可用出口和有效目标后继续使用，也可以移除。</p>
    {inactive.map(item => <div className="flow-transition-inactive-item" key={item.port} data-flow-transition-inactive-port={item.port}><div><strong>{storyPortLabel(node, item.port)} · {item.reason}</strong><span>{flowTransitionSummary(item.transition)}</span></div>
      <IconButton title="移除未启用过渡" onClick={() => {
        try { commit('移除未启用的连线过渡', draft => { setStoryTransition(draft, node.id, item.port, undefined); }, { separate: true }); report(''); }
        catch (error) { report(error instanceof Error ? error.message : String(error)); }
      }}><X size={14} /></IconButton>
    </div>)}
  </details>;
}
