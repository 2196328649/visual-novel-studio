import type { UiComponent } from './model';
import { bindingNames, componentName, uiPageNames } from './ui-names';

const requiredPages = {
  choiceList: 'choice', saveSlots: 'save', pauseMenu: 'pause', historyList: 'history', galleryGrid: 'gallery',
  musicTrackList: 'musicRoom', voiceCollection: 'voiceCollection', chapterList: 'chapterSelect', chapterTitle: 'chapterTitle',
  messageBox: 'messageBox', staffRoll: 'staff', keyboard: 'keyboard', flowchart: 'flowchart', gameOver: 'gameOver',
} as const;
const bindingPages = { title: 'main', confirmation: 'messageBox', speaker: 'say', dialogue: 'say' } as const;

export interface UiComponentPageProblem {
  path: 'page' | 'binding' | 'action';
  message: string;
}
interface UiComponentPageContext {
  kind: string; page: string; parameterId?: string; action?: string; binding?: string;
}

/** Only page-dependent rules belong here; an unfinished graph or source remains a valid editor draft. */
export function uiComponentPageProblems(component: UiComponentPageContext): UiComponentPageProblem[] {
  const problems: UiComponentPageProblem[] = [], requiredPage = Object.hasOwn(requiredPages, component.kind) ? requiredPages[component.kind as keyof typeof requiredPages] : undefined;
  if (requiredPage && component.page !== requiredPage) problems.push({ path: 'page', message: `该组件只能放在“${uiPageNames[requiredPage]}”页。` });
  if (['preference', 'preferenceChoice'].includes(component.kind) && !component.parameterId && !['preferences', 'voiceSettings'].includes(component.page)) {
    problems.push({ path: 'page', message: '玩家设置控件应放在设置或角色音量页；其他页面可使用绑定作品参数的控件。' });
  }
  if (['confirmYes', 'confirmNo'].includes(component.action ?? '') && component.page !== 'messageBox') {
    problems.push({ path: 'action', message: '确认和取消按钮应放在确认对话框页。' });
  }
  if (component.binding) {
    const customBinding = component.kind === 'text' && component.page === 'custom' && ['minigameTitle', 'minigamePrompt', 'minigameStatus'].includes(component.binding);
    const requiredBindingPage = Object.hasOwn(bindingPages, component.binding) ? bindingPages[component.binding as keyof typeof bindingPages] : undefined;
    const standardBinding = component.kind === 'text' && requiredBindingPage && component.page === requiredBindingPage;
    if (!customBinding && !standardBinding && !(component.kind === 'text' && component.binding === 'tooltip')) {
      const hint = requiredBindingPage ? `“${bindingNames[component.binding as keyof typeof bindingPages]}”需要“${uiPageNames[requiredBindingPage]}”页的内容。` : '';
      problems.push({ path: 'binding', message: `文字绑定必须匹配所属页面。${hint}` });
    }
  }
  return problems;
}

/** Validate every copied root and child before producing anything the editor can insert. */
export function prepareUiComponentsForPaste(components: readonly UiComponent[], page: UiComponent['page']): UiComponent[] {
  for (const component of components) {
    if (component.page === page) continue;
    const problem = uiComponentPageProblems({ ...component, page })[0];
    if (problem) throw new Error(`“${componentName(component)}”不能粘贴到“${uiPageNames[page]}”页：${problem.message}`);
  }
  return components.map(component => ({ ...component, page, editor: { ...component.editor, hidden: false, locked: false } }));
}
