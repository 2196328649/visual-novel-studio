import type { Project } from './model';
import type { BlueprintTraceEntry, BlueprintTraceFrame, BlueprintTraceSnapshot } from './blueprint-trace';
import { projectGraphs } from './project-resources';

export interface BlueprintBreakpoint { graphId: string; nodeId: string }
export type BlueprintDebugAction = 'continue' | 'pause' | 'stepInto' | 'stepOver' | 'stepOut' | 'clear' | 'breakpoints';
export interface BlueprintDebugRequest { sessionId: string; action: BlueprintDebugAction; breakpoints?: BlueprintBreakpoint[] }
export interface BlueprintDebugSite extends BlueprintBreakpoint { invocationId: number; stack: BlueprintTraceFrame[]; taskHandle?: string; entry: string; pageId?: string; pageInstance?: number }
export interface BlueprintDebugPacket {
  version: 1; sessionId: string; generation: number; revision: number; acknowledgement: number;
  phase: 'running' | 'paused' | 'stepping'; reason: string; site?: BlueprintDebugSite;
  entries: BlueprintTraceEntry[]; dropped: number; invocations: number; breakpoints: BlueprintBreakpoint[];
}
export interface BlueprintDebugSnapshot extends Omit<BlueprintDebugPacket, 'entries' | 'dropped' | 'invocations'> { trace: BlueprintTraceSnapshot }
export const blueprintDebugTraceLimit = 1600;
const actions: readonly string[] = ['continue', 'pause', 'stepInto', 'stepOver', 'stepOut', 'clear', 'breakpoints'];
const kinds = new Set(['event', 'enter', 'node', 'input', 'output', 'write', 'branch', 'wait', 'resume', 'return', 'stop', 'page']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, length = 240): value is string => typeof value === 'string' && value.length <= length;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const optionalText = (value: unknown) => value === undefined || text(value);
function breakpoint(raw: unknown): raw is BlueprintBreakpoint { return object(raw) && text(raw.graphId) && !!raw.graphId && text(raw.nodeId) && !!raw.nodeId; }
function frame(raw: unknown): raw is BlueprintTraceFrame {
  return object(raw) && count(raw.id) && text(raw.graphId) && optionalText(raw.pageId) && optionalText(raw.componentId) && optionalText(raw.trigger)
    && optionalText(raw.callNodeId) && (raw.parentId === undefined || count(raw.parentId)) && (raw.pageInstance === undefined || count(raw.pageInstance));
}
const frames = (raw: unknown): raw is BlueprintTraceFrame[] => Array.isArray(raw) && raw.length <= 32 && raw.every(frame);
function entry(raw: unknown): raw is BlueprintTraceEntry {
  if (!object(raw) || !text(raw.kind) || !kinds.has(raw.kind) || !count(raw.sequence) || typeof raw.time !== 'number' || !Number.isFinite(raw.time) || raw.time < 0 || !frames(raw.stack)) return false;
  for (const key of ['graphId', 'nodeId', 'pinId', 'sourceGraphId', 'sourceNodeId', 'sourcePinId', 'pageId', 'componentId', 'trigger', 'variableId', 'targetPageId', 'taskHandle']) if (!optionalText(raw[key])) return false;
  if (raw.scope !== undefined && !['call', 'page', 'project', 'player'].includes(String(raw.scope))) return false;
  for (const key of ['pageInstance', 'targetPageInstance', 'invocationId']) if (raw[key] !== undefined && !count(raw[key])) return false;
  if (raw.reason !== undefined && !text(raw.reason, 4000)) return false;
  if (raw.available !== undefined && typeof raw.available !== 'boolean' || raw.valueTruncated !== undefined && typeof raw.valueTruncated !== 'boolean') return false;
  return raw.value === undefined || typeof raw.value === 'boolean' || text(raw.value, 4000) || typeof raw.value === 'number' && Number.isFinite(raw.value);
}
function site(raw: unknown): raw is BlueprintDebugSite {
  return object(raw) && breakpoint(raw) && count(raw.invocationId) && frames(raw.stack) && text(raw.entry)
    && optionalText(raw.taskHandle) && optionalText(raw.pageId) && (raw.pageInstance === undefined || count(raw.pageInstance));
}
/** Untrusted game output is data, never renderer markup or an editor command. */
export function parseBlueprintDebugPacket(raw: unknown, sessionId?: string): BlueprintDebugPacket | undefined {
  if (!object(raw) || raw.version !== 1 || !text(raw.sessionId) || sessionId !== undefined && raw.sessionId !== sessionId) return;
  if (!count(raw.generation) || !count(raw.revision) || !count(raw.acknowledgement) || !count(raw.dropped) || !count(raw.invocations) || (raw.phase !== 'running' && raw.phase !== 'paused' && raw.phase !== 'stepping') || !text(raw.reason, 4000)) return;
  if (!Array.isArray(raw.entries) || raw.entries.length > 128 || !raw.entries.every(entry) || !Array.isArray(raw.breakpoints) || raw.breakpoints.length > 512 || !raw.breakpoints.every(breakpoint)) return;
  if (raw.site !== undefined && !site(raw.site)) return;
  // Reconstruct the allowlisted shape. Unknown fields never cross IPC, even if
  // they contain huge objects, prototype keys, or renderer-looking strings.
  const pick = <T extends object, K extends keyof T>(value: T, fields: readonly K[]): Pick<T, K> => Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]])) as Pick<T, K>;
  const copyFrames = (values: BlueprintTraceFrame[]) => values.map(value => pick(value, ['id', 'graphId', 'parentId', 'callNodeId', 'pageId', 'pageInstance', 'componentId', 'trigger']));
  const entryFields = ['sequence', 'time', 'kind', 'graphId', 'nodeId', 'pinId', 'value', 'available', 'valueTruncated', 'reason', 'sourceGraphId', 'sourceNodeId', 'sourcePinId', 'scope', 'variableId', 'targetPageId', 'targetPageInstance', 'pageId', 'pageInstance', 'componentId', 'trigger', 'invocationId', 'taskHandle'] as const;
  return {
    version: 1, sessionId: raw.sessionId, generation: raw.generation, revision: raw.revision, acknowledgement: raw.acknowledgement,
    phase: raw.phase, reason: raw.reason, dropped: raw.dropped, invocations: raw.invocations,
    entries: raw.entries.map(value => ({ ...pick(value, entryFields), stack: copyFrames(value.stack) })),
    breakpoints: raw.breakpoints.map(value => ({ graphId: value.graphId, nodeId: value.nodeId })),
    ...(raw.site ? { site: { ...pick(raw.site, ['graphId', 'nodeId', 'invocationId', 'entry', 'taskHandle', 'pageId', 'pageInstance']), stack: copyFrames(raw.site.stack) } } : {}),
  };
}
export function blueprintDebugBreakpointProblem(project: Project, point: BlueprintBreakpoint): string | undefined {
  const graph = projectGraphs(project).find(graph => graph.id === point.graphId), node = graph?.nodes.find(node => node.id === point.nodeId);
  if (!node) return '断点的蓝图或节点已不存在。';
  if (node.pins.every(pin => pin.dataType !== 'exec')) return '数据节点按需读取；请在使用它的执行节点暂停，并观察实际求值记录。';
}
export function checkedBlueprintDebugRequest(project: Project, raw: unknown, sessionId: string): BlueprintDebugRequest {
  if (!object(raw) || raw.sessionId !== sessionId || !actions.includes(String(raw.action))) throw new Error('调试会话已变化或命令无效，请重新选择当前试玩。');
  const request: BlueprintDebugRequest = { sessionId, action: raw.action as BlueprintDebugAction };
  if (request.action === 'breakpoints') {
    if (!Array.isArray(raw.breakpoints) || raw.breakpoints.length > 512 || !raw.breakpoints.every(breakpoint)) throw new Error('断点列表无效，最多 512 项。');
    const unique = new Map<string, BlueprintBreakpoint>();
    for (const point of raw.breakpoints) { const problem = blueprintDebugBreakpointProblem(project, point); if (problem) throw new Error(problem); unique.set(point.graphId + '\0' + point.nodeId, { graphId: point.graphId, nodeId: point.nodeId }); }
    request.breakpoints = [...unique.values()];
  }
  return request;
}
export function mergeBlueprintDebugPacket(previous: BlueprintDebugSnapshot | undefined, packet: BlueprintDebugPacket): BlueprintDebugSnapshot {
  const sameSession = previous?.sessionId === packet.sessionId;
  if (sameSession && (packet.generation < previous.generation || packet.revision <= previous.revision)) return previous;
  const same = sameSession && previous.generation === packet.generation;
  const entries = new Map<number, BlueprintTraceEntry>((same ? previous.trace.entries : []).map(entry => [entry.sequence, entry]));
  for (const entry of packet.entries) entries.set(entry.sequence, entry);
  const sorted = [...entries.values()].sort((a, b) => a.sequence - b.sequence), kept = sorted.slice(-blueprintDebugTraceLimit);
  const dropped = Math.max(packet.dropped, (same ? previous.trace.dropped : 0) + sorted.length - kept.length);
  const { entries: _entries, dropped: _dropped, invocations, ...state } = packet;
  return { ...state, trace: { entries: kept, dropped, invocations } };
}
