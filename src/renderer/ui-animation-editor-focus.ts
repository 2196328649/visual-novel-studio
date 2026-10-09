import type { UiAnimationSelection } from '../core/ai-selection';
import type { AiEditorResult } from '../core/ai-editor-commands';

export interface UiAnimationFocus extends UiAnimationSelection {
  label: string;
  active: () => boolean;
  finish: (result: AiEditorResult) => void;
}

/** Only the mounted animation editor can confirm that selection and seeking finished. */
export function requestUiAnimationFocus(target: UiAnimationSelection & { label: string }, open: (focus: UiAnimationFocus) => void, timeout = 8000): Promise<AiEditorResult> {
  return new Promise(resolve => {
    let pending = true;
    const finish = (result: AiEditorResult) => { if (!pending) return; pending = false; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => finish({ status: 'failed', message: '动画编辑器未完成定位，请检查当前页面后重试。' }), timeout);
    const focus = { ...target, active: () => pending, finish };
    try { open(focus); } catch (error) { finish({ status: 'failed', message: error instanceof Error ? error.message : String(error) }); }
  });
}
