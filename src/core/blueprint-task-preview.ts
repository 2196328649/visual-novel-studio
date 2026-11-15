import type { VariableValue } from './model';
import type { BlueprintTaskCompletion, BlueprintTaskConflict, BlueprintTaskScope } from './blueprint-tasks';

export interface PreviewCallLease { id: number; graphId: string; alive: boolean }
export interface PreviewTaskSubmission { scope: BlueprintTaskScope; pageId?: string; sourceGraphId: string; nodeId: string; graphId: string; inputs: Record<string, VariableValue>; seconds: number; conflict: BlueprintTaskConflict; call: PreviewCallLease }
/** Implemented by the timed page session, not by static action expansion. */
export interface BlueprintTaskPreviewHost {
  enterCall(graphId: string): PreviewCallLease;
  leaveCall(call: PreviewCallLease): void;
  start(submission: PreviewTaskSubmission): { handle: string; output: 'exec_out' | 'blocked' } | undefined;
  cancel(handle: string): boolean;
  result(handle: string, graphId?: string): BlueprintTaskCompletion;
}
