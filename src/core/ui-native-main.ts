import { effectiveUiComponents, localUiComponents, makeId, uiComponentLimit, type Project, type UiComponent } from './model';
import { uiMainButtons } from './ui-page-catalog';
import { uiActionAvailable } from './ui-availability';
import { uiPageTheme } from './ui-page-settings';
import { dialogueLayout } from './ui';

export const mainButtonSlot = (action: string) => 'main:' + action;
export function replacesMainButton(component: UiComponent, action: string) {
  return component.page === 'main' && component.kind === 'button' && (component.nativeSlot ? component.nativeSlot === mainButtonSlot(action) : component.action === action);
}

/** The default menu and its editable replacements use the same identities and geometry. */
export function nativeMainButtons(project: Project, authored = effectiveUiComponents(project.ui).filter(c => c.page === 'main')): UiComponent[] {
  const theme = uiPageTheme(project, 'ui:main');
  if (theme.disabledPages?.includes('main') || theme.pages?.main?.layout === 'custom') return [];
  const { width, height } = project, { margin, contentWidth } = dialogueLayout(width, height, theme);
  const buttons = uiMainButtons.filter(([action]) => uiActionAvailable(theme, action));
  const h = Math.max(24, Math.min(50, Math.floor((height * .7 - 40) / 6))), w = Math.min(260, contentWidth);
  const top = (height - (buttons.length * h + Math.max(0, buttons.length - 1) * 8)) * .82;
  const occupied = new Set([...effectiveUiComponents(project.ui), ...project.ui.customPages.flatMap(p => p.components)].map(c => c.id));
  return buttons.flatMap(([action, text], index) => {
    if (authored.some(c => replacesMainButton(c, action))) return [];
    let id = '__preview_native_main_' + action; while (occupied.has(id)) id += '_'; occupied.add(id);
    return [{
    id, nativeSlot: mainButtonSlot(action), page: 'main' as const, kind: 'button' as const, name: text, text, action,
    x: margin / width, y: (top + index * (h + 8)) / height, width: w / width, height: h / height,
    style: { fontSize: Math.min(24, theme.fontSize, Math.max(14, h - 16)), textColor: theme.textColor, background: '#283133', hoverBackground: theme.accent, align: 'center' as const },
  }]; });
}

export function materializeMainButton(project: Project, slot: string): UiComponent {
  const existing = effectiveUiComponents(project.ui).find(c => c.nativeSlot === slot && c.page === 'main');
  if (existing) throw new Error('这个系统按钮已经转为可编辑控件，请重新选择。');
  const source = nativeMainButtons(project).find(c => c.nativeSlot === slot);
  if (!source) throw new Error('这个系统按钮已不存在或被自制控件替代。');
  const local = localUiComponents(project.ui);
  if (local.length >= uiComponentLimit) throw new Error('当前界面方案的控件数量已达上限。');
  const component = { ...source, id: makeId('ui'), style: { ...source.style } };
  local.push(component);
  return component;
}
