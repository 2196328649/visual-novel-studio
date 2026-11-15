import { expect, type Locator, type Page } from '@playwright/test';

/** Reveal an already mounted field through its real parent summary buttons. */
export async function openDisclosureAncestors(target: Locator) {
  await expect(target).toHaveCount(1);
  const ancestors = target.locator('xpath=ancestor::details');
  for (let index = 0; index < await ancestors.count(); index++) {
    const details = ancestors.nth(index);
    if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
    await expect(details).toHaveJSProperty('open', true);
  }
}

/** Open a native disclosure through the same entry point used by the editor,
 * expanding any collapsed parent groups first, as an author would. */
export async function openDisclosure(page: Page, label: string) {
  // A collection part retains the root inspector with hidden/inert. Its groups
  // must never win over the visible part, even when their titles are identical.
  const summary = page.locator('summary:not([hidden] *, [inert] *)').filter({ hasText: label }).first();
  if (!await summary.count()) {
    // Lazy groups do not mount their nested disclosures until first revealed.
    // Use the actual property search, then clear it and persist the parent
    // openings through their summaries. This leaves normal authoring navigation
    // behind, without changing the project or forcing DOM open attributes.
    const search = page.getByRole('searchbox', { name: '搜索控件属性', exact: true });
    await expect(search).toBeVisible();
    await search.fill(label); await expect(summary).toHaveCount(1);
    await page.getByRole('button', { name: '清除属性搜索', exact: true }).click();
  }
  await expect(summary).toHaveCount(1);
  // XPath returns these ancestors in document order, outermost first. Clicking
  // each summary also waits for layout, so sticky headers cannot cover targets.
  await openDisclosureAncestors(summary);
  await expect(summary).toBeVisible();
}

export async function clickUiButtonEvent(page: Page, label: string) {
  if (label !== '点击时 · OnClicked') await openDisclosure(page, '更多按钮事件');
  await page.getByRole('button', { name: label, exact: true }).click();
}

export async function openContentFilters(surface: Page | Locator) {
  const toggle = surface.locator('.content-filter-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}
