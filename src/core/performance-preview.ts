import { effectiveUiTheme, type PerformancePlayback, type Project } from './model';
import { clonePreviewStage, finishPreviewPerformance, initialPreviewStage, linePreviewSnapshot, linePlaybackPlan, sampleLinePlayback, type LinePlaybackPlan, type PreviewSelection, type PreviewStage } from './line-preview';
import { matches } from './preview-route';

export function performanceTransitionDuration(settings?: PerformancePlayback): number {
  const transition = settings?.transition;
  return !transition || transition.mode === 'none' ? 0 : transition.mode === 'dissolve' ? transition.outDuration * 1000 : (transition.outDuration + transition.hold + transition.inDuration) * 1000;
}

/** Resolve the next authored frame through deterministic flow; menus keep their own preview. */
export function followingPerformancePreview(project: Project, selection: PreviewSelection, settings: PerformancePlayback, snapshot?: ReturnType<typeof linePreviewSnapshot>) {
  if (settings.onComplete === 'title') return { title: true as const, sample: { state: { ...initialPreviewStage(), backgroundId: effectiveUiTheme(project.ui).menuBackgroundId }, visuals: [], shake: { x: 0, y: 0 } } };
  snapshot ??= linePreviewSnapshot(project, selection);
  const values = { ...snapshot.context.variables };
  const owner = project.nodes.find(node => node.id === selection.nodeId);
  let selected: PreviewSelection | undefined;
  if (owner?.kind === 'passage') {
    const next = owner.lines[owner.lines.findIndex(line => line.id === selection.lineId) + 1];
    if (next) selected = { ...selection, lineId: next.id };
  }
  let nextId = owner && 'next' in owner ? owner.next : undefined;
  const visited = new Set<string>();
  while (!selected && nextId && !visited.has(nextId) && visited.size < 256) {
    visited.add(nextId);
    const node = project.nodes.find(node => node.id === nextId);
    if (node?.kind === 'end') return { title: true as const, sample: { state: { ...initialPreviewStage(), backgroundId: effectiveUiTheme(project.ui).menuBackgroundId }, visuals: [], shake: { x: 0, y: 0 } } };
    if (!node || node.kind === 'return' || node.kind === 'choice' || node.kind === 'interaction' || node.kind === 'minigame') break;
    if (node.kind === 'passage' && node.lines[0]) { selected = { ...selection, nodeId: node.id, lineId: node.lines[0].id }; break; }
    if (node.kind === 'chapterTitle') {
      const before = clonePreviewStage(snapshot.after); finishPreviewPerformance(before, snapshot.actions);
      return { sample: sampleLinePlayback(before, linePlaybackPlan(before, [{ ...node, kind: 'chapter', wait: true }]), 0) };
    }
    if (node.kind === 'set' && (!node.when || matches(node.when, values))) values[node.variableId] = node.operation === 'add' ? Number(values[node.variableId]) + Number(node.value) : node.value;
    nextId = node.kind === 'condition' ? matches(node.condition, values) ? node.yes : node.no : node.kind === 'jump' || node.kind === 'call' ? node.target : 'next' in node ? node.next : undefined;
  }
  if (!selected) {
    const state = clonePreviewStage(snapshot.after); finishPreviewPerformance(state, snapshot.actions);
    return { sample: { state, visuals: [...state.visuals.values()], shake: { x: 0, y: 0 } } };
  }
  const next = linePreviewSnapshot(project, selected), before = clonePreviewStage(next.before);
  finishPreviewPerformance(before, snapshot.actions);
  const plan = linePlaybackPlan(before, next.actions);
  // This is the following dialogue's static frame, revealed by the outgoing
  // performance transition. Sampling at zero freezes a blocking background
  // dissolve fully transparent and exposes the empty stage after the cover fades.
  return { line: next.line, sample: sampleLinePlayback(before, plan, plan.dialogueAt) };
}

export function samplePerformanceTransition(before: PreviewStage, plan: LinePlaybackPlan, settings: PerformancePlayback, milliseconds: number) {
  const end = Math.max(plan.until, plan.dialogueAt), transition = settings.transition;
  const duration = performanceTransitionDuration(settings), outgoing = milliseconds >= end;
  const time = Math.max(0, milliseconds - end);
  const showingNext = outgoing && (!transition || transition.mode === 'none' || transition.mode === 'dissolve' || time >= (transition.outDuration + transition.hold) * 1000);
  const coverOpacity = !outgoing || transition?.mode !== 'color' ? 0 : time < transition.outDuration * 1000 ? time / Math.max(1, transition.outDuration * 1000) : time < (transition.outDuration + transition.hold) * 1000 ? 1 : Math.max(0, 1 - (time - (transition.outDuration + transition.hold) * 1000) / Math.max(1, transition.inDuration * 1000));
  const previousOpacity = transition?.mode === 'dissolve' && outgoing ? Math.max(0, 1 - time / Math.max(1, duration)) : 1;
  return { sample: sampleLinePlayback(before, plan, Math.min(milliseconds, Math.max(0, end - .01))), outgoing, showingNext, coverOpacity, previousOpacity, duration, end };
}
