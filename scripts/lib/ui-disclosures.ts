import type { Locator, Page } from '@playwright/test';

/** Open a native disclosure through the same entry point used by the editor. */
export async function openDisclosure(page: Page, label: string) {
  const summary = page.locator('summary').filter({ hasText: label });
  const details = summary.locator('..');
  if (await details.getAttribute('open') === null) await summary.click();
}

export async function clickUiButtonEvent(page: Page, label: string) {
  if (label !== '点击时 · OnClicked') await openDisclosure(page, '更多按钮事件');
  await page.getByRole('button', { name: label, exact: true }).click();
}

export async function openContentFilters(surface: Page | Locator) {
  const toggle = surface.locator('.content-filter-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}
