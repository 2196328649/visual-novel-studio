import type { Page } from '@playwright/test';

export async function openStoryMode(page: Page, mode: 'script' | 'text') {
  await page.locator('.view-tabs').getByRole('button', { name: '剧本', exact: true }).click();
  await page.getByRole('group', { name: '剧本编辑模式' }).getByRole('button', { name: mode === 'text' ? '文本编辑' : '模块编辑', exact: true }).click();
}

export async function openStageEditing(page: Page) {
  if (!await page.locator('.story-preview-content').isVisible()) await openStoryMode(page, 'script');
  const toggle = page.locator('.story-preview-content').getByRole('button', { name: '编辑舞台', exact: true });
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
}
