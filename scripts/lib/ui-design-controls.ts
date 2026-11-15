import { expect, type Page } from '@playwright/test';

export async function openUiPageOptions(page: Page, section?: string) {
  const button = page.getByRole('button', { name: '页面选项', exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  const menu = page.getByRole('dialog', { name: '页面选项', exact: true });
  await expect(menu).toBeVisible();
  if (section) {
    const details = menu.locator('details').filter({ has: page.locator(':scope > summary', { hasText: section }) });
    if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  }
  return menu;
}

export async function selectUiDesignScheme(page: Page, id: string) {
  if (!await page.getByRole('button', { name: '页面选项', exact: true }).count()) { await page.getByLabel('选择界面实例', { exact: true }).selectOption(id); return; }
  const menu = await openUiPageOptions(page, '界面方案');
  await menu.getByLabel('选择界面实例', { exact: true }).selectOption(id);
  if (await menu.isVisible()) await page.getByRole('button', { name: '关闭页面选项', exact: true }).click();
}

export async function setUiCanvasPreview(page: Page, label: string, value: string) {
  const button = page.getByRole('button', { name: '画布预览', exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  const menu = page.getByRole('dialog', { name: '画布预览', exact: true });
  await menu.getByLabel(label, { exact: true }).selectOption(value);
  await menu.getByRole('button', { name: '关闭画布预览', exact: true }).click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
}

export async function openUiPageUsage(page: Page) {
  if (await page.getByRole('button', { name: '页面选项', exact: true }).count()) await openUiPageOptions(page);
  await page.getByRole('button', { name: '页面使用位置', exact: true }).click();
}

export async function setUiNativeContent(page: Page, enabled: boolean) {
  const settings = await openUiPageSettings(page, '页面行为');
  await settings.getByLabel('显示系统默认内容', { exact: true }).setChecked(enabled);
}

export async function openUiPageSettings(page: Page, section?: string) {
  const tab = page.getByRole('tab', { name: '页面设置', exact: true });
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  const settings = page.getByLabel('当前页面设置', { exact: true });
  await expect(settings).toBeVisible();
  if (section) {
    const group = settings.locator('details.ui-inspector-group').filter({ has: page.locator(':scope > summary .ui-group-title', { hasText: section }) });
    if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click();
  }
  return settings;
}

export async function openUiGlobalSettings(page: Page) {
  await page.getByRole('button', { name: '作品设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '作品设置', exact: true });
  await dialog.getByRole('button', { name: '全局界面', exact: true }).click();
  return dialog;
}

export async function resetUiPanelLayout(page: Page) {
  const menu = await openUiPageOptions(page);
  await menu.getByRole('button', { name: '恢复面板布局', exact: true }).click();
  await expect(page.getByRole('button', { name: '页面选项', exact: true })).toHaveAttribute('aria-expanded', 'false');
}
