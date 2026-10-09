import { normalizeProjectResources, projectGraphs, withProjectGraphs } from './project-resources';
import { canInterleaveTimeline } from './timeline-interleave';
import { canLaunchTimeline } from './timeline-launch';
import { makeId, actionSchema, type BlueprintGraph, type BlueprintNode, type Project, type StageAction, type VisualObject } from './model';
import { blueprintInputValue, blueprintNodeDefaults, connectBlueprintPins } from './blueprint';
import { performanceNode, savedBlueprintAction, rawSavedBlueprintAction } from './blueprint-authoring';
import { setVisualPropertiesAt, syncVisualPins, visualInputFields, type VisualCurveProperty } from './visual-object';
import { visualInstancePath } from './visual-selection';
import { actorKey, actorReference } from './actor-instance';
import { expandPreviewActions, previewActionContext } from './preview-actions';
import { performanceTiming, actionTiming } from './performance-timing';
import { placeTimelineClip, timelineOverlap } from './timeline-editing';

export const timelineNodeTypes = ['startDialogue', 'showBackground', 'showCharacter', 'hideCharacter', 'showChapter', 'camera', 'shake', 'playMusic', 'playSound', 'stopMusic'] as const;
export interface TimelineClip { nodeId: string; trackId: string; at: number; duration: number; entranceDuration?: number }
export interface TimelineTrack { id: string; name: string }
export interface TimelineLifetime { nodeId: string; instanceId: string; name: string; kind: 'actor' | 'visual'; at: number; until: number; openEnded: boolean; persistent?: boolean; depth?: number; objectPath?: number[] }
const actorActionKey = (action: StageAction) => {
  if (!['show', 'hide', 'animate', 'characterFeature'].includes(action.kind) || !('characterId' in action) || typeof action.characterId !== 'string') return;
  const instanceId = 'instanceId' in action && typeof action.instanceId === 'string' ? action.instanceId : undefined;
  return actorKey({ characterId: action.characterId, ...(instanceId ? { instanceId } : {}) });
};

/** Move an actor's display interval and its associated commands as one edit. */
export function moveTimelineActorLifetime(project: Project, graph: BlueprintGraph, sourceId: string, at: number) {
  const model = performanceTimeline(project, graph), rows = performanceLifetimes(project, graph);
  if (model.reason) throw new Error(model.reason);
  const row = rows.find(row => row.nodeId === sourceId && row.kind === 'actor');
  if (!row) throw new Error('角色显示区间已不存在。');
  if (!Number.isFinite(at) || at < 0) throw new Error('角色开始时间必须是有限的非负数。');
  const delta = at - row.at;
  if (!delta) return;
  const moved = new Set<string>();
  let reached = false;
  for (const clip of [...model.clips].sort((a, b) => a.at - b.at)) {
    if (clip.nodeId === sourceId) { reached = true; moved.add(sourceId); continue; }
    if (!reached) continue;
    const actions = timelineNodeActions(project, graph, graph.nodes.find(node => node.id === clip.nodeId)!);
    if (actions.some(action => action.kind === 'show' && actorKey(action) === row.instanceId || action.kind === 'background' && !row.persistent)) break;
    if (actions.some(action => actorActionKey(action) === row.instanceId)) moved.add(clip.nodeId);
  }
  if (graph.links.some(link => moved.has(link.toNodeId) && ['characterId', 'instanceId'].includes(link.toPinId))) throw new Error('关联动作的角色实例由数据连线控制，请在蓝图中调整关联时序。');
  const draft = structuredClone(graph);
  const draftProject = withProjectGraphs({ ...project }, projectGraphs(project).map(item => item.id === graph.id ? draft : item));
  arrangePerformanceTimeline(draftProject, draft, model.clips.map(clip => moved.has(clip.nodeId) ? { ...clip, at: Math.round((clip.at + delta) * 1000000) / 1000000 } : clip), model.tracks);
  // A replacement/background boundary is not owned by this interval. Create a
  // dedicated end if needed, and reject a move that a shared boundary cuts short.
  if (!row.openEnded) setTimelineActorEnd(draftProject, draft, sourceId, Math.round((row.until + delta) * 1000000) / 1000000);
  const nextClips = performanceTimeline(draftProject, draft).clips;
  if (model.clips.some(clip => !moved.has(clip.nodeId) && nextClips.find(next => next.nodeId === clip.nodeId)?.at !== clip.at)) throw new Error('移动需要改动未关联的边界动作，请先调整相邻区间。');
  const nextRows = performanceLifetimes(draftProject, draft);
  for (const other of rows.filter(item => item.kind === 'actor' && item.instanceId === row.instanceId && item.nodeId !== sourceId)) {
    const next = nextRows.find(item => item.nodeId === other.nodeId && item.instanceId === other.instanceId);
    if (!next || next.at !== other.at || next.openEnded !== other.openEnded || !other.openEnded && next.until !== other.until) throw new Error('移动会改变同一角色实例的其他显示区间，请先调整相邻区间或使用不同实例。');
  }
  const next = nextRows.find(item => item.nodeId === sourceId && item.instanceId === row.instanceId);
  if (!next || Math.abs(next.at - at) > 1e-6 || row.openEnded && !next.openEnded || !row.openEnded && Math.abs(next.until - row.until - delta) > 1e-6) throw new Error('移动后的区间会被其他动作截断，请先调整边界动作。');
  Object.assign(graph, draft);
}

export function setTimelineActorEnd(project: Project, graph: BlueprintGraph, sourceId: string, end: number) {
  const model = performanceTimeline(project, graph), source = graph.nodes.find(node => node.id === sourceId);
  const sourceClip = model.clips.find(clip => clip.nodeId === sourceId);
  if (!source || !sourceClip) throw new Error('角色片段已不存在。');
  const actor = timelineNodeActions(project, graph, source).find(action => action.kind === 'show');
  if (!actor || actor.kind !== 'show') throw new Error('请选择角色显示区间。');
  if (!Number.isFinite(end) || end < sourceClip.at) throw new Error('隐藏时间不能早于角色显示时间。');
  if (graph.links.some(link => link.toNodeId === sourceId && ['characterId', 'instanceId'].includes(link.toPinId))) throw new Error('角色实例由数据连线控制，请在蓝图中连接对应隐藏动作。');
  const key = actorKey(actor);
  const persistent = performanceLifetimes(project, graph).find(row => row.nodeId === sourceId && row.instanceId === key)?.persistent;
  const hides: TimelineClip[] = [];
  let boundary: TimelineClip | undefined;
  let reachedSource = false;
  for (const clip of [...model.clips].sort((a, b) => a.at - b.at)) {
    if (clip.nodeId === sourceId) { reachedSource = true; continue; }
    if (!reachedSource) continue;
    const node = graph.nodes.find(node => node.id === clip.nodeId)!;
    const actions = timelineNodeActions(project, graph, node);
    if (actions.some(action => action.kind === 'show' && actorKey(action) === key || action.kind === 'background' && !persistent)) {
      if (end > clip.at) throw new Error('此角色会先被替换或随背景清除，隐藏时间不能越过该边界。');
      boundary = clip;
      break;
    }
    if (actions.some(action => action.kind === 'hide' && actorKey(action) === key)) hides.push(clip);
  }
  const hide = hides[0];
  if (hide) {
    // Later redundant hides must not preempt the requested new end. Keep them
    // in the graph and retain their order, but move any crossed hides together.
    const moved = new Set(hides.filter((clip, index) => index === 0 || clip.at < end).map(clip => clip.nodeId));
    if (graph.links.some(link => moved.has(link.toNodeId) && ['characterId', 'instanceId'].includes(link.toPinId))) throw new Error('隐藏目标由数据连线控制，请在蓝图中修改。');
    arrangePerformanceTimeline(project, graph, model.clips.map(clip => moved.has(clip.nodeId) ? { ...clip, at: end } : clip), model.tracks);
    return hide.nodeId;
  }
  // The existing replacement already closes this interval. Appending a hide at
  // that same instant would instead hide the newly displayed instance.
  if (boundary?.at === end) return sourceId;
  return insertTimelineAction(project, graph, { kind: 'hide', ...actorReference(actor), transition: 'none', duration: 0, wait: false }, end);
}

/** Visible instance lifetimes, distinct from the duration of their appearance commands. */
export function performanceLifetimes(project: Project, graph: BlueprintGraph) {
  const model = performanceTimeline(project, graph), lifetimes: TimelineLifetime[] = [];
  const actors = new Map<string, { row: TimelineLifetime; persistent: boolean }>(), visuals = new Map<string, TimelineLifetime>();
  const objects = new Map<TimelineLifetime, VisualObject>();
  const close = (row: TimelineLifetime, at: number) => { row.until = Math.min(row.until, at); row.openEnded = false; };
  for (const clip of [...model.clips].sort((a, b) => a.at - b.at)) {
    const node = graph.nodes.find(node => node.id === clip.nodeId)!;
    let at = clip.at;
    for (const action of timelineNodeActions(project, graph, node)) {
      if (action.kind === 'background') {
        for (const row of visuals.values()) close(row, at);
        visuals.clear();
        for (const [id, actor] of actors) if (!actor.persistent) { close(actor.row, at); actors.delete(id); }
      } else if (action.kind === 'show') {
        const id = actorKey(action), prior = actors.get(id);
        if (prior) close(prior.row, at);
        const persistent = action.lifetime === 'persistent' || (action.lifetime === undefined && !!prior?.persistent);
        const row: TimelineLifetime = { nodeId: node.id, instanceId: id, name: project.characters.find(character => character.id === action.characterId)?.name ?? action.characterId, kind: 'actor', at, until: model.until, openEnded: true, persistent };
        lifetimes.push(row); actors.set(id, { row, persistent });
      } else if (action.kind === 'hide') {
        const id = actorKey(action), prior = actors.get(id);
        if (prior) close(prior.row, at);
        actors.delete(id);
      } else if (action.kind === 'visual') {
        const prior = visuals.get(action.instanceId); if (prior) close(prior, at);
        const row: TimelineLifetime = { nodeId: node.id, instanceId: action.instanceId, name: action.name, kind: 'visual', at, until: at + action.duration, openEnded: false };
        lifetimes.push(row); visuals.set(action.instanceId, row); objects.set(row, action);
      }
      at += performanceTiming([action]).at;
    }
  }
  const expand = (row: TimelineLifetime, object?: VisualObject): TimelineLifetime[] => {
    if (object?.content !== 'group') return [row];
    return [row, ...(object.children ?? []).flatMap((child, index) => {
      const at = row.at + (child.startAt ?? 0), until = Math.min(row.until, at + child.duration);
      if (at >= until) return [];
      return expand({ nodeId: row.nodeId, instanceId: child.instanceId, name: child.name, kind: 'visual', at, until, openEnded: false, depth: (row.depth ?? 0) + 1, objectPath: [...(row.objectPath ?? []), index] }, child);
    })];
  };
  return lifetimes.flatMap(row => expand(row, objects.get(row)));
}
export function insertTimelineAction(project: Project, graph: BlueprintGraph, action: StageAction, at: number, trackId?: string) {
  const model = performanceTimeline(project, graph);
  if (model.reason) throw new Error(model.reason);
  const node = performanceNode(project, action);
  if (action.kind === 'visual' || action.kind === 'audioClip') node.name = action.name;
  const last = graph.nodes.find(node => node.id === graph.timeline?.tailNodeId) ?? graph.nodes.find(node => node.id === model.clips.at(-1)?.nodeId) ?? graph.nodes.find(node => node.type === 'event')!;
  const pin = last.type === 'event' ? 'exec' : 'exec_out';
  const outgoing = graph.links.find(link => link.fromNodeId === last.id && link.fromPinId === pin);
  if (outgoing) graph.links = graph.links.filter(link => link.id !== outgoing.id);
  graph.nodes.push(node);
  connectBlueprintPins(graph, last.id, pin, node.id, 'exec_in');
  if (outgoing) connectBlueprintPins(graph, node.id, 'exec_out', outgoing.toNodeId, outgoing.toPinId);
  const updated = performanceTimeline(project, graph), clip = updated.clips.find(clip => clip.nodeId === node.id)!;
  const placed = placeTimelineClip({ ...clip, at, trackId: trackId ?? clip.trackId }, model.clips);
  const tracks = [...model.tracks, ...updated.tracks.filter(track => !model.tracks.some(old => old.id === track.id) && track.id === placed.trackId)];
  if (!tracks.some(track => track.id === placed.trackId)) tracks.push({ id: placed.trackId, name: action.kind === 'visual' ? action.name : '轨道 ' + (tracks.length + 1) });
  arrangePerformanceTimeline(project, graph, [...model.clips, placed], tracks);
  return node.id;
}
const executable = (node: BlueprintNode) => node.pins.some(pin => pin.dataType === 'exec');
const execLink = (graph: BlueprintGraph, id: string, pin: string) => graph.nodes.find(node => node.id === id)?.pins.find(p => p.id === pin)?.dataType === 'exec';
const supported = (node: BlueprintNode, project?: Project) => (node.type === 'callFunction' && !!projectGraphs(project).some(graph => graph.id === node.properties.graphId && (graph.timelineComponent || graph.timeline))) || node.type === 'savedAction' && ['audioClip', 'visual', 'camera', 'show'].includes(savedBlueprintAction(node)?.kind ?? '') || (timelineNodeTypes as readonly string[]).includes(node.type) || (node.type === 'savedAction' && savedBlueprintAction(node)?.kind === 'animate' && !(savedBlueprintAction(node) as Extract<StageAction, { kind: 'animate' }>).repeat);

/** A track is an ordinary execution chain; branching and interactive graphs stay intact. */
export function timelinePath(graph: BlueprintGraph, project?: Project) {
  const result: BlueprintNode[] = [], seen = new Set<string>();
  let node = graph.nodes.find(node => node.type === 'event');
  if (!node) return { nodes: result, reason: '请先在蓝图中添加开始事件。' };
  while (node) {
    if (seen.has(node.id)) return { nodes: result, reason: '这张蓝图有循环路径，请在蓝图模式编辑循环。' };
    seen.add(node.id);
    if (!['event', 'delay', 'return'].includes(node.type) && !supported(node, project)) return { nodes: result, reason: '这张蓝图包含分支、交互或复合调用；请在蓝图模式编辑这些逻辑。可另建演出轨道，再通过蓝图调用。' };
    if (node.type === 'delay' && graph.links.some(link => link.toNodeId === node!.id && link.toPinId === 'seconds')) return { nodes: result, reason: '此蓝图的等待时间由数据连线控制，请在蓝图模式调整它。' };
    if (graph.links.some(link => link.toNodeId === node!.id && link.toPinId === 'wait')) return { nodes: result, reason: '此蓝图的等待方式由输入连线控制；固定时间轨道需要先在蓝图模式解除该等待连线。' };
    result.push(node);
    const links = graph.links.filter(link => link.fromNodeId === node!.id && execLink(graph, link.fromNodeId, link.fromPinId));
    if (links.length > 1) return { nodes: result, reason: '此蓝图有多个执行分支，请在蓝图模式编辑。' };
    node = graph.nodes.find(candidate => candidate.id === links[0]?.toNodeId);
  }
  if (graph.nodes.some(node => executable(node) && !seen.has(node.id))) return { nodes: result, reason: '蓝图中有未连接的执行节点，先在蓝图模式连接或移除这些节点。' };
  return { nodes: result };
}

export function timelineNodeActions(project: Project, graph: BlueprintGraph, node: BlueprintNode, visualTimeScales?: Map<string, number>) {
  const event = graph.nodes.find(node => node.type === 'event')!;
  const isolated: BlueprintGraph = { ...graph, timeline: undefined, links: graph.links.filter(link => !execLink(graph, link.fromNodeId, link.fromPinId)).concat({ id: 'timeline_sample', fromNodeId: event.id, fromPinId: 'exec', toNodeId: node.id, toPinId: 'exec_in' }) };
  if (graph.timeline && node.type === 'callFunction') {
    // Sample the same private expansion as playback so per-call identities also
    // match the track visibility and audio controls in the editor.
    const tail = blueprintNodeDefaults('delay'); tail.id = graph.id + '_sample_tail'; tail.properties.seconds = 0;
    isolated.nodes = [...graph.nodes.filter(item => item.id === event.id || item.id === node.id || !executable(item)), tail];
    isolated.links.push({ id: 'timeline_sample_end', fromNodeId: node.id, fromPinId: 'exec_out', toNodeId: tail.id, toPinId: 'exec_in' });
    isolated.timeline = { tracks: graph.timeline.tracks, clips: graph.timeline.clips.filter(clip => clip.nodeId === node.id), tailNodeId: tail.id };
  }
  const context = previewActionContext(project);
  context.samplingTimelineNode = true;
  context.visualTimeScales = visualTimeScales;
  context.speakerId = project.characters[0]?.id;
  return expandPreviewActions(withProjectGraphs({ ...project }, [...projectGraphs(project).filter(item => item.id !== graph.id), isolated]), [{ kind: 'blueprint', blueprintId: graph.id }], context);
}
/** Resolve an object's property clock using the same inputs as preview execution. */
export function timelinePropertyObject(project: Project, graph: BlueprintGraph, nodeId: string, path: number[], at: number) {
  const node = graph.nodes.find(node => node.id === nodeId); if (!node) return;
  const scales = new Map<string, number>();
  let action = timelineNodeActions(project, graph, node, scales).find(action => action.kind === 'visual' || action.kind === 'animate');
  if (!action || (action.kind !== 'visual' && action.kind !== 'animate')) return;
  for (const index of path) {
    if (action.kind !== 'visual' || !action.children?.[index]) return;
    action = action.children[index]; at += action.startAt ?? 0;
  }
  return { action, at, scale: action.kind === 'visual' ? scales.get(action.instanceId) ?? 1 : 1 };
}

/** Edit a nested display interval in timeline seconds without baking resolved inputs. */
export function editTimelineVisualLifetime(project: Project, graph: BlueprintGraph, nodeId: string, instanceId: string, delta: number, resizing: boolean) {
  const node = graph.nodes.find(node => node.id === nodeId), root = node && rawSavedBlueprintAction(node);
  if (!node || root?.kind !== 'visual') throw new Error('找不到视觉对象来源。');
  const path = visualInstancePath(root, instanceId);
  if (!path?.length) throw new Error('找不到组合内的子对象。');
  if (!Number.isFinite(delta)) throw new Error('时间调整必须是有限数值。');
  if (graph.links.some(link => link.toNodeId === nodeId && link.toPinId.startsWith('object_'))) throw new Error('组合参数由连线控制，请在动画属性或蓝图中修改。');
  const model = performanceTimeline(project, graph), clip = model.clips.find(clip => clip.nodeId === nodeId);
  const row = performanceLifetimes(project, graph).find(row => row.nodeId === nodeId && row.instanceId === instanceId);
  if (model.reason || !clip || !row) throw new Error(model.reason ?? '找不到子对象的显示区间。');
  const parent = timelinePropertyObject(project, graph, nodeId, path.slice(0, -1), clip.at);
  if (!parent || parent.action.kind !== 'visual' || !(parent.scale > 0)) throw new Error('无法确定组合的时间比例。');
  if (delta === 0) return;
  let child = root; for (const index of path) child = child.children![index];
  const candidate = { ...node, properties: { ...node.properties }, pins: structuredClone(node.pins) };
  if (resizing) {
    const fieldPath = [...path.flatMap(index => ['children', index]), 'duration'].join('/');
    const field = visualInputFields(root).find(field => field.path.join('/') === fieldPath)!;
    // The child's own duration override retimes its animation; only ancestors
    // scale the duration value itself, so do not divide by the child's scale.
    candidate.properties['object_' + field.key] = Math.max(.05, row.until - row.at + delta) / parent.scale;
  } else {
    child.startAt = Math.max(0, (child.startAt ?? 0) + delta / parent.scale);
    candidate.properties.action = JSON.stringify(actionSchema.parse(root));
  }
  if (!savedBlueprintAction(candidate)) throw new Error('子对象的显示区间无效。');
  syncVisualPins(candidate, root);
  Object.assign(node, candidate);
}

/** Write the sampled timeline pose back to the original object's unscaled clock. */
export function setTimelineVisualPropertiesAt(project: Project, graph: BlueprintGraph, nodeId: string, instanceId: string, time: number, patch: Partial<Record<VisualCurveProperty, number>>) {
  const node = graph.nodes.find(node => node.id === nodeId), root = node && rawSavedBlueprintAction(node);
  if (!node || root?.kind !== 'visual') throw new Error('找不到视觉对象来源。');
  const path = visualInstancePath(root, instanceId);
  if (!path) throw new Error('对象已移除或实例标识重复。');
  const model = performanceTimeline(project, graph), clip = model.clips.find(clip => clip.nodeId === nodeId);
  if (model.reason || !clip) throw new Error(model.reason ?? '找不到对象片段。');
  const resolved = timelinePropertyObject(project, graph, nodeId, path, clip.at);
  const lifetime = performanceLifetimes(project, graph).find(row => row.nodeId === nodeId && row.instanceId === instanceId);
  if (!resolved || !lifetime || !Number.isFinite(time) || time < lifetime.at || time > lifetime.until || lifetime.until <= lifetime.at) throw new Error('请把播放头移到对象的存续区间内。');
  let object = root; for (const index of path) object = object.children![index];
  const originalPatch = { ...patch };
  if (originalPatch.rippleSpeed !== undefined) originalPatch.rippleSpeed *= resolved.scale;
  setVisualPropertiesAt(object, (time - resolved.at) / resolved.scale, originalPatch);
  node.properties.action = JSON.stringify(actionSchema.parse(root));
}
function trackFor(project: Project, node: BlueprintNode): TimelineTrack {
  const type = node.type;
  const visual = savedBlueprintAction(node);
  if (visual?.kind === 'audioClip') return { id: 'audio_' + visual.bus, name: { music: '音乐', sound: '音效', voice: '语音' }[visual.bus] };
  if (visual?.kind === 'visual') return { id: visual.instanceId, name: visual.name };
  if (visual?.kind === 'camera') return { id: 'track_camera', name: '镜头' };
  if (type === 'callFunction') return { id: 'track_component', name: '演出组件' };
  if (type === 'startDialogue') return { id: 'track_dialogue', name: '台词' };
  if (type === 'showChapter') return { id: 'track_chapter', name: '章节' };
  if (type === 'showBackground') return { id: 'track_background', name: '背景' };
  if (['showCharacter', 'hideCharacter', 'savedAction'].includes(type)) {
    const saved = savedBlueprintAction(node);
    const id = String(node.properties.characterId ?? (saved?.kind === 'animate' || saved?.kind === 'show' ? saved.characterId : 'speaker'));
    const instance = String(node.properties.instanceId ?? (saved?.kind === 'animate' || saved?.kind === 'show' ? saved.instanceId ?? '' : ''));
    return { id: 'track_actor_' + (instance ? 'instance_' + instance : id), name: '角色 · ' + (project.characters.find(c => c.id === id)?.name ?? '发言角色') + (instance ? ' · ' + instance : '') };
  }
  if (type === 'camera' || type === 'shake') return { id: 'track_' + type, name: type === 'camera' ? '镜头' : '震动' };
  return { id: 'track_' + (type === 'playSound' ? 'sound' : 'music'), name: type === 'playSound' ? '音效' : '音乐' };
}

/** Add motion for the selected appearance without changing its instance identity. */
export function addTimelineActorAnimation(project: Project, graph: BlueprintGraph, sourceId: string) {
  const source = graph.nodes.find(node => node.id === sourceId);
  const model = performanceTimeline(project, graph);
  if (model.reason) throw new Error(model.reason);
  const sourceClip = model.clips.find(clip => clip.nodeId === sourceId);
  if (!source || !sourceClip || source.type !== 'showCharacter') throw new Error('请先选择显示角色片段。');
  if (graph.links.some(link => link.toNodeId === sourceId && ['characterId', 'instanceId', 'x', 'y', 'scale', 'presetId'].includes(link.toPinId))) throw new Error('角色或初始位置由蓝图输入控制，请先在蓝图中确定动画目标与初始位置。');
  const actor = timelineNodeActions(project, graph, source).find(action => action.kind === 'show');
  if (!actor || actor.kind !== 'show') throw new Error('角色或表情不可用，请先补全显示角色参数。');
  const first = { x: actor.x, y: actor.y, scale: actor.scale, rotation: 0, opacity: 1, duration: 0, easing: 'ease' as const };
  const animation = performanceNode(project, { kind: 'animate', ...actorReference(actor), wait: false, repeat: false, keyframes: [first, { ...first, duration: 1 }] });
  animation.name = '角色关键帧';
  const previous = graph.nodes.find(node => node.id === graph.timeline?.tailNodeId) ?? graph.nodes.find(node => node.id === model.clips.at(-1)?.nodeId) ?? graph.nodes.find(node => node.type === 'event')!;
  const output = previous.type === 'event' ? 'exec' : 'exec_out';
  const outgoing = graph.links.find(link => link.fromNodeId === previous.id && link.fromPinId === output);
  if (outgoing) graph.links = graph.links.filter(link => link.id !== outgoing.id);
  graph.nodes.push(animation);
  connectBlueprintPins(graph, previous.id, output, animation.id, 'exec_in');
  if (outgoing) connectBlueprintPins(graph, animation.id, 'exec_out', outgoing.toNodeId, outgoing.toPinId);
  const track = { id: makeId('track_motion'), name: '关键帧 · ' + (actor.instanceId ?? project.characters.find(c => c.id === actor.characterId)?.name ?? actor.characterId) };
  arrangePerformanceTimeline(project, graph, [...model.clips, { nodeId: animation.id, trackId: track.id, at: sourceClip.at, duration: 1 }], [...model.tracks, track]);
  return animation.id;
}
export function performanceTimeline(project: Project, graph: BlueprintGraph) {
  const path = timelinePath(graph, project), tracks = [...(graph.timeline?.tracks ?? [])], clips: TimelineClip[] = [];
  const actionsByNode = new Map<string, StageAction[]>();
  let at = 0, until = 0;
  for (const node of path.nodes) {
    if (node.type === 'delay') { at = node.id === graph.timeline?.tailNodeId ? Math.max(at, until) : at + Math.max(0, Number(blueprintInputValue(node, 'seconds') ?? 0)); continue; }
    if (!supported(node, project)) continue;
    const actions = timelineNodeActions(project, graph, node), timing = performanceTiming(actions);
    actionsByNode.set(node.id, actions);
    const entrance = actions.length === 1 && actions[0].kind === 'show' && actions[0].afterOffsets ? actionTiming(actions[0]).duration : undefined;
    const assigned = graph.timeline?.clips.find(clip => clip.nodeId === node.id)?.trackId;
    const track = tracks.find(track => track.id === assigned) ?? trackFor(project, node);
    if (!tracks.some(item => item.id === track.id)) tracks.push(track);
    clips.push({ nodeId: node.id, trackId: track.id, at, duration: timing.until, ...(entrance !== undefined ? { entranceDuration: entrance } : {}) });
    until = Math.max(until, at + timing.until); const child=node.type==='callFunction'&&projectGraphs(project).find(g=>g.id===node.properties.graphId);at += child&&node.properties.wait===false&&canInterleaveTimeline(project,child)?0:timing.at;
  }
  if (!tracks.length) tracks.push({ id: 'track_performance', name: '演出' });
  // Old timelines allowed overlapping clips in one row. Give them separate rows
  // without changing any authored start or end time, until the next edit is saved.
  const placed: TimelineClip[] = [];
  for (const clip of [...clips].sort((a, b) => a.at - b.at)) {
    if (timelineOverlap([...placed, clip])) {
      const source = tracks.find(track => track.id === clip.trackId)!;
      let lane = 2;
      while (true) {
        const id = source.id + '_lane_' + lane;
        if (!timelineOverlap([...placed, { ...clip, trackId: id }])) {
          if (!tracks.some(track => track.id === id)) tracks.push({ id, name: source.name + ' · ' + lane });
          clip.trackId = id; break;
        }
        lane++;
      }
    }
    placed.push(clip);
  }
  return { tracks, clips, until: Math.max(until, at), reason: path.reason, actionsByNode };
}

/** Preview the displayed rows of an old overlapping timeline without editing its source. */
export function timelinePreviewLayout(project: Project, graph: BlueprintGraph, model?: ReturnType<typeof performanceTimeline>): Project {
  if (!graph.timeline) return project;
  model ??= performanceTimeline(project, graph);
  if (model.reason) return project;
  return withProjectGraphs({ ...project }, projectGraphs(project).map(item => item.id === graph.id ? { ...graph, timeline: { ...graph.timeline!, tracks: model.tracks, clips: model.clips.map(({ nodeId, trackId }) => ({ nodeId, trackId })) } } : item));
}

/** Use the same legacy row separation for every playback path, including nested calls.
 * Node sampling skips this pass: layers do not affect timing, and sampling must
 * not recursively rebuild the layouts it is currently measuring. */
export function timelinePlaybackLayout(project: Project): Project {
  let changed = false;
  const blueprints = projectGraphs(project).map(graph => {
    if (!graph.timeline) return graph;
    const model = performanceTimeline(project, graph);
    if (model.reason) return graph;
    const clips = model.clips.map(({ nodeId, trackId }) => ({ nodeId, trackId }));
    if (JSON.stringify(graph.timeline.tracks) === JSON.stringify(model.tracks) && JSON.stringify(graph.timeline.clips) === JSON.stringify(clips)) return graph;
    changed = true;
    return { ...graph, timeline: { ...graph.timeline, tracks: model.tracks, clips } };
  });
  return changed ? withProjectGraphs({ ...project }, blueprints) : project;
}

/** One history transaction rewrites only timing links, preserving inputs and node IDs. */
export function arrangePerformanceTimeline(project: Project, graph: BlueprintGraph, clips: TimelineClip[], tracks: TimelineTrack[]) {
  const path = timelinePath(graph, project);
  if (path.reason) throw new Error(path.reason);
  if (clips.length > 240 || tracks.length > 64) throw new Error('一张演出轨道最多 240 个片段、64 条轨道。');
  if (clips.some(clip => !Number.isFinite(clip.at) || clip.at < 0 || !Number.isFinite(clip.duration) || clip.duration < 0)) throw new Error('片段开始时间和时长必须是零或正数。');
  if (new Set(clips.map(clip => clip.nodeId)).size !== clips.length || new Set(tracks.map(track => track.id)).size !== tracks.length) throw new Error('片段和轨道不能重复。');
  if (timelineOverlap(clips)) throw new Error('同一轨道的片段不能重叠，请缩短片段或移到空位、其他轨道。');
  let blockedUntil = 0;
  for (const clip of [...clips].sort((a, b) => a.at - b.at)) {
    const node = graph.nodes.find(node => node.id === clip.nodeId);
    if (!node || !supported(node, project) || !tracks.some(track => track.id === clip.trackId)) throw new Error('演出片段或轨道已不存在，请重新选择。');
    if (clip.at < blockedUntil - .00001) throw new Error('子时间轴含内部延迟，暂不能与后续片段重叠。');
    const target = node.type === 'callFunction' && projectGraphs(project).find(graph => graph.id === node.properties.graphId);
    blockedUntil = clip.at + (target && !canInterleaveTimeline(project, target) ? performanceTiming(timelineNodeActions(project, graph, node)).at : 0);
  }
  const clipIds = new Set(clips.map(clip => clip.nodeId));
  const oldDelays = new Set(graph.nodes.filter(node => node.type === 'delay' || node.type === 'return' || (supported(node, project) && !clipIds.has(node.id))).map(node => node.id));
  const links = graph.links.filter(link => !oldDelays.has(link.fromNodeId) && !oldDelays.has(link.toNodeId) && !execLink(graph, link.fromNodeId, link.fromPinId));
  graph.nodes = graph.nodes.filter(node => !oldDelays.has(node.id));
  graph.links = links;
  let previous = graph.nodes.find(node => node.type === 'event')!, at = 0;
  const append = (node: BlueprintNode) => {
    if (!graph.nodes.some(item => item.id === node.id)) graph.nodes.push(node);
    const error = connectBlueprintPins(graph, previous.id, previous.type === 'event' ? 'exec' : 'exec_out', node.id, 'exec_in');
    if (error) throw new Error(error);
    previous = node;
  };
  for (const clip of [...clips].sort((a, b) => a.at - b.at)) {
    const node = graph.nodes.find(node => node.id === clip.nodeId);
    if (!node || !supported(node, project) || !tracks.some(track => track.id === clip.trackId)) throw new Error('演出片段或轨道已不存在，请重新选择。');
    if (clip.at < at - .00001) throw new Error('子时间轴与后续片段重叠，请先把后续片段移到子时间轴结束之后。');
    if (clip.at > at + .00001) {
      const delay = blueprintNodeDefaults('delay'); delay.properties.seconds = Number((clip.at - at).toFixed(4));
      delay.x = 280 + clip.at * 160; delay.y = 80; append(delay);
    }
    if (node.type === 'savedAction') {
      const action = actionSchema.parse(JSON.parse(String(node.properties.action)));
      node.properties.action = JSON.stringify({ ...action, wait: false });
    } else node.properties.wait = false;
    // An exposed wait flag would contradict an absolute clip start.
    graph.links = graph.links.filter(link => !(link.toNodeId === node.id && link.toPinId === 'wait'));
    node.x = 360 + clip.at * 160; node.y = 220 + Math.max(0, tracks.findIndex(track => track.id === clip.trackId)) * 210;
    const child=node.type==='callFunction'&&projectGraphs(project).find(g=>g.id===node.properties.graphId);
    append(node); at = clip.at + (child&&!canInterleaveTimeline(project,child) ? performanceTiming(timelineNodeActions(project, graph, node)).at : 0);
  }
  const tail = blueprintNodeDefaults('delay');
  tail.id = graph.timeline?.tailNodeId ?? makeId('timeline_end'); tail.name = '等待全部轨道结束';
  tail.properties.seconds = Math.max(0, ...clips.map(clip => clip.at + clip.duration)) - at;
  tail.x = previous.x + 360; tail.y = 80; append(tail);
  graph.timeline = { tracks, clips: clips.map(({ nodeId, trackId }) => ({ nodeId, trackId })), tailNodeId: tail.id };
  normalizeProjectResources(project);
  if (graph.nodes.length > 512) throw new Error('蓝图节点数量已达上限。');
}
