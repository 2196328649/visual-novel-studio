import { AuthoringIndexCache } from '../core/authoring-index';

/** Renderer props are immutable project snapshots. Do not use this cache inside draft edits. */
export const immutableAuthoringIndex = new AuthoringIndexCache({ assumeImmutable: true });
