import type { VariableValue } from './model';
import type { BlueprintStateScope } from './blueprint-state';

export type BlueprintTraceKind = 'event' | 'enter' | 'node' | 'input' | 'output' | 'write' | 'branch' | 'wait' | 'resume' | 'return' | 'stop' | 'page';
export interface BlueprintTraceLocation {
  pageId?: string; pageInstance?: number; componentId?: string; trigger?: string;
}
export interface BlueprintTraceFrame extends BlueprintTraceLocation {
  id: number; graphId: string; parentId?: number; callNodeId?: string;
}
export interface BlueprintTraceData extends BlueprintTraceLocation {
  kind: BlueprintTraceKind; graphId?: string; nodeId?: string; pinId?: string; taskHandle?: string;
  value?: VariableValue; available?: boolean; valueTruncated?: boolean; reason?: string;
  sourceGraphId?: string; sourceNodeId?: string; sourcePinId?: string;
  scope?: BlueprintStateScope; variableId?: string; targetPageId?: string; targetPageInstance?: number;
}
export interface BlueprintTraceEntry extends BlueprintTraceData {
  sequence: number; time: number; invocationId?: number; stack: BlueprintTraceFrame[];
}
export interface BlueprintTraceSnapshot { entries: BlueprintTraceEntry[]; dropped: number; invocations: number }

/** Observations only: never evaluates pins, mutates author/player values, or stores live references. */
export class BlueprintTraceRecorder {
  private readonly entries: BlueprintTraceEntry[] = [];
  private offset = 0;
  private sequence = 0;
  private invocations = 0;
  private readonly limit: number;
  constructor(private readonly options: { limit?: number; time?: () => number } = {}) {
    this.limit = Math.max(1, Math.min(10000, Number.isFinite(options.limit) ? Math.floor(options.limit!) : 1600));
  }
  frame(graphId: string, stack: readonly BlueprintTraceFrame[], origin: BlueprintTraceLocation = {}, callNodeId?: string): BlueprintTraceFrame {
    return { pageId: origin.pageId, pageInstance: origin.pageInstance, componentId: origin.componentId, trigger: origin.trigger,
      id: ++this.invocations, graphId, parentId: stack.at(-1)?.id, callNodeId };
  }
  record(stack: readonly BlueprintTraceFrame[], data: BlueprintTraceData) {
    const frame = stack.at(-1), rawTime = this.options.time?.() ?? 0;
    const valueTruncated = typeof data.value === 'string' && data.value.length > 4000;
    const entry: BlueprintTraceEntry = { pageId: frame?.pageId, pageInstance: frame?.pageInstance, componentId: frame?.componentId, trigger: frame?.trigger,
      ...data, graphId: data.graphId ?? frame?.graphId,
      value: valueTruncated ? (data.value as string).slice(0, 4000) : data.value, valueTruncated: valueTruncated || undefined,
      sequence: ++this.sequence, time: Number.isFinite(rawTime) ? Math.max(0, rawTime) : 0,
      invocationId: frame?.id, stack: stack.map(frame => ({ ...frame })),
    };
    if (this.entries.length < this.limit) this.entries.push(entry);
    else { this.entries[this.offset] = entry; this.offset = (this.offset + 1) % this.limit; }
  }
  snapshot(): BlueprintTraceSnapshot {
    const entries = this.offset ? [...this.entries.slice(this.offset), ...this.entries.slice(0, this.offset)] : [...this.entries];
    return { entries: entries.map(entry => ({ ...entry, stack: entry.stack.map(frame => ({ ...frame })) })), dropped: this.sequence - entries.length, invocations: this.invocations };
  }
}
