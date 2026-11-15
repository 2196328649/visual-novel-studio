/** Vite's verification-only alias. It never enters the production module graph. */
import { BlueprintViewBaseline } from './blueprint-view-baseline';
export class BlueprintViewCache extends BlueprintViewBaseline {
  constructor(_options?: { assumeImmutable?: boolean }) { super(); }
}
export { reuseBlueprintEdges } from './blueprint-view-baseline';
export type { BlueprintNodeView, BlueprintViewActions } from './blueprint-view-baseline';
