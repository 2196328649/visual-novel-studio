import type { BlueprintNode, Project } from './model';
import type { GameFlowStep } from './game-flow-schema';
import { uiPageOpeningSchema, type ResolvedUiPageOpening, type UiPageOpening } from './ui-page-opening-schema';
import { uiPage } from './ui-pages';

export { uiPageOpeningSchema, type ResolvedUiPageOpening, type UiPageOpening } from './ui-page-opening-schema';
export const uiPageOpeningPresets = {
  page: { name: '独立界面', hint: '显示页面背景，等待操作完成。', value: { presentation: 'page', wait: true, input: 'block', lifetime: 'owner', closeOnEscape: true, autoClose: 0 } },
  dialog: { name: '叠加弹窗', hint: '保留底层画面，等待关闭，拦截底层操作。', value: { presentation: 'overlay', wait: true, input: 'block', lifetime: 'owner', closeOnEscape: true, autoClose: 0 } },
  hud: { name: '常驻覆盖层', hint: '显示后继续，仅操作本层控件，跨小章节保留。', value: { presentation: 'overlay', wait: false, input: 'controls', lifetime: 'game', closeOnEscape: false, autoClose: 0 } },
  notice: { name: '临时提示', hint: '显示后继续，不接收输入，三秒后关闭。', value: { presentation: 'overlay', wait: false, input: 'none', lifetime: 'owner', closeOnEscape: false, autoClose: 3 } },
} satisfies Record<string, { name: string; hint: string; value: ResolvedUiPageOpening }>;
export type UiPageOpeningPreset = keyof typeof uiPageOpeningPresets;

export function uiPageOpeningDefaults(project: Project, pageId: string): ResolvedUiPageOpening {
  const custom = project.ui.customPages.find(page => page.id === pageId);
  return { ...uiPageOpeningPresets.page.value, input: custom?.modal === false ? 'controls' : 'block', ...custom?.opening };
}
export function resolveUiPageOpening(project: Project, pageId: string, overrides?: UiPageOpening): ResolvedUiPageOpening {
  return { ...uiPageOpeningDefaults(project, pageId), ...uiPageOpeningSchema.parse(overrides ?? {}) };
}
export function uiPageOpeningProblem(project: Project, pageId: string, value: UiPageOpening): string | undefined {
  const parsed = uiPageOpeningSchema.safeParse(value);
  if (!parsed.success) return '页面打开设置无效，请检查显示方式、输入和自动关闭秒数。';
  const page = uiPage(project, pageId), settings = resolveUiPageOpening(project, pageId, value);
  if (!page) return '页面已不存在。';
  if (settings.wait && settings.lifetime !== 'owner') return '等待关闭的页面需跟随打开者；跨小章节保留请使用显示后继续。';
  if (page.template && (settings.presentation !== 'page' || !settings.wait || settings.input !== 'block' || settings.lifetime !== 'owner' || settings.autoClose > 0 || !settings.closeOnEscape)) return '这个内置页面使用系统菜单，等待关闭并接管输入；覆盖层请使用自定义界面。';
}
export const openingInputFromModal = (mode: unknown): UiPageOpening['input'] => mode === 'modal' ? 'block' : mode === 'modeless' ? 'controls' : mode === 'passthrough' ? 'none' : undefined;
export const openingModalFromInput = (input: UiPageOpening['input']) => input === 'block' ? 'modal' : input === 'controls' ? 'modeless' : input === 'none' ? 'passthrough' : 'page';

export function blueprintPageOpening(project: Project, pageId: string, node: Pick<BlueprintNode, 'properties' | 'pageOpening'>): ResolvedUiPageOpening {
  return resolveUiPageOpening(project, pageId, blueprintPageOpeningOverrides(node));
}
export function blueprintPageOpeningOverrides(node: Pick<BlueprintNode, 'properties' | 'pageOpening'>): UiPageOpening {
  const wait = node.properties.wait, input = openingInputFromModal(node.properties.modalMode);
  return { ...node.pageOpening, ...(typeof wait === 'boolean' ? { wait } : {}), ...(input ? { input } : {}) };
}
export function setBlueprintPageOpening(node: BlueprintNode, opening?: UiPageOpening) {
  node.pageOpening = opening;
  if (opening?.wait === undefined) delete node.properties.wait; else node.properties.wait = opening.wait;
  node.properties.modalMode = openingModalFromInput(opening?.input);
}
export function flowPageOpening(project: Project, step: Extract<GameFlowStep, { kind: 'page' }>): ResolvedUiPageOpening {
  return resolveUiPageOpening(project, step.pageId, flowPageOpeningOverrides(step));
}
export function flowPageOpeningOverrides(step: Extract<GameFlowStep, { kind: 'page' }>): UiPageOpening {
  return step.opening ?? { wait: step.wait, ...(step.modal === undefined ? {} : { input: step.modal ? 'block' : 'controls' }) };
}
export function setFlowPageOpening(step: Extract<GameFlowStep, { kind: 'page' }>, value?: UiPageOpening) {
  // An empty new object means inheritance; absence denotes the legacy wait/modal fields.
  step.opening = value ?? {};
  if (value?.wait !== undefined) step.wait = value.wait;
  if (value?.input !== undefined) step.modal = value.input === 'block';
}
export function uiPageOpeningSummary(settings: ResolvedUiPageOpening) {
  return `${settings.presentation === 'overlay' ? '覆盖层' : '独立界面'} · ${settings.wait ? '等待关闭' : '显示后继续'} · ${settings.input === 'block' ? '拦截底层' : settings.input === 'controls' ? '仅本层控件' : '输入穿透'}`;
}
