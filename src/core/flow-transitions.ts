import { targets, type Project, type StoryNode } from './model';
import { flowTransitionSchema, type FlowTransition } from './flow-transition-schema';
import { performancePlayback } from './standalone-performance';

export { flowTransitionSchema, flowTransitionsSchema, type FlowTransition } from './flow-transition-schema';

export function flowTransitionDuration(transition?: FlowTransition): number {
  if (!transition || transition.mode === 'none') return 0;
  return transition.mode === 'dissolve' ? transition.duration : transition.outDuration + transition.hold + transition.inDuration;
}

export function flowTransitionName(transition?: FlowTransition): string {
  if (!transition) return '不单独设置';
  if (transition.mode === 'none') return '直接切换';
  return transition.mode === 'dissolve' ? '叠化' : transition.color.toLowerCase() === '#000000' ? '淡黑' : transition.color.toLowerCase() === '#ffffff' ? '淡白' : '经过颜色';
}

/** Format display values without rounding the stored time or hiding tiny positive durations. */
export function flowTransitionSecondsText(seconds: number): string {
  const rounded = Number(seconds.toPrecision(12));
  // Rounding Number.MAX_VALUE upwards must not turn a valid input into Infinity.
  return String(Number.isFinite(rounded) ? rounded : seconds);
}

export function flowTransitionSummary(transition?: FlowTransition): string {
  const name = flowTransitionName(transition);
  if (!transition || transition.mode === 'none') return name;
  return `${name} · ${flowTransitionSecondsText(flowTransitionDuration(transition))} 秒`;
}

export function defaultFlowTransition(mode: FlowTransition['mode']): FlowTransition {
  if (mode === 'none') return { mode };
  if (mode === 'dissolve') return { mode, duration: 0.8 };
  return { mode, outDuration: 0.4, hold: 0, inDuration: 0.4, color: '#000000' };
}

/** Changing total duration preserves the authored balance between color phases. */
export function flowTransitionWithDuration(transition: FlowTransition, duration: number): FlowTransition {
  if (!Number.isFinite(duration) || duration < 0) throw new Error('过渡时长需要是不小于 0 的有限数值。');
  const valid = flowTransitionSchema.parse(transition);
  if (valid.mode === 'none') return valid;
  if (valid.mode === 'dissolve') return { ...valid, duration };
  const total = flowTransitionDuration(valid);
  if (!total) return { ...valid, outDuration: duration / 2, hold: 0, inDuration: duration - duration / 2 };
  const phases = [valid.outDuration, valid.hold, valid.inDuration];
  const longest = phases.indexOf(Math.max(...phases)), factor = duration / total;
  // Multiply first when the scale has normal precision, preserving tiny phases
  // next to large ones; ratio-first avoids overflowing or subnormal scales.
  const scaled = phases.map(phase => factor >= 2 ** -1022 && Number.isFinite(factor) ? phase * factor : phase / total * duration);
  // Compensate the longest phase rather than subtracting a tiny final phase
  // from the total. Group the other two additions to avoid cancellation noise.
  const others = scaled.reduce((sum, phase, index) => index === longest ? sum : sum + phase, 0);
  scaled[longest] = Math.max(0, duration - others);
  return { ...valid, outDuration: scaled[0], hold: scaled[1], inDuration: scaled[2] };
}

/** Disconnected real ports retain their settings for a later reconnection. */
export function storyTransitionPorts(node: StoryNode, project?: Project): { port: string; target?: string }[] {
  if (project && node.kind === 'passage' && node.lines.some(line => line.silent && performancePlayback(project, line).onComplete === 'title')) return [];
  return targets(node);
}

export function storyTransition(node: StoryNode, port: string): FlowTransition | undefined {
  return node.transitions && Object.hasOwn(node.transitions, port) ? node.transitions[port] : undefined;
}

/** Validate the whole edit before mutating, so one history entry is sufficient. */
export function setStoryTransition(project: Project, nodeId: string, port: string, transition: FlowTransition | undefined): boolean {
  const node = project.nodes.find(item => item.id === nodeId);
  if (!node) throw new Error('找不到需要设置过渡的剧情模块。');
  let parsed: FlowTransition | undefined;
  if (transition !== undefined) {
    if (!storyTransitionPorts(node, project).some(item => item.port === port)) throw new Error('这个剧情模块没有可用的该出口，无法设置连线过渡。');
    const result = flowTransitionSchema.safeParse(transition);
    if (!result.success) throw new Error('连线过渡无效：时长必须是不小于 0 的有限数值，纯色必须使用六位颜色。');
    parsed = result.data;
  }
  const before = storyTransition(node, port);
  if (before === undefined && parsed === undefined) return false;
  if (before?.mode === 'none' && parsed?.mode === 'none'
    || before?.mode === 'dissolve' && parsed?.mode === 'dissolve' && before.duration === parsed.duration
    || before?.mode === 'color' && parsed?.mode === 'color' && before.outDuration === parsed.outDuration && before.hold === parsed.hold && before.inDuration === parsed.inDuration && before.color === parsed.color) return false;
  const transitions = { ...node.transitions };
  if (parsed === undefined) delete transitions[port];
  else transitions[port] = parsed;
  if (Object.keys(transitions).length) node.transitions = transitions;
  else delete node.transitions;
  return true;
}

/** Copies preserve settings, but branch settings follow their new stable IDs. */
export function remapStoryTransitionPorts(node: StoryNode, ports: ReadonlyMap<string, string>): void {
  if (!node.transitions || !ports.size) return;
  node.transitions = Object.fromEntries(Object.entries(node.transitions).map(([port, transition]) => [ports.get(port) ?? port, transition]));
}
