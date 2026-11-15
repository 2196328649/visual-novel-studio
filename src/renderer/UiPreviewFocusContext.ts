import { createContext } from 'react';

/** Where focus returns when a preview page closes. */
export interface UiPreviewFocusRestore { previous?: HTMLElement; frame?: HTMLElement | null }
export interface UiPreviewFocusController { depth: number; restores?: Map<HTMLElement, UiPreviewFocusRestore> }
export const UiPreviewFocusContext = createContext<UiPreviewFocusController | undefined>(undefined);

/** DOM focus/blur events still report observations, but must not synthesize user submissions. */
export function withUiProgrammaticFocus(controller: UiPreviewFocusController | undefined, action: () => void): void {
  if (controller) controller.depth++;
  try { action(); } finally { if (controller) controller.depth--; }
}
