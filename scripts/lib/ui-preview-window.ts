import { expect, type ElectronApplication, type Page } from '@playwright/test';

/** Exercise the actual independent renderer rather than an embedded test preview. */
export async function openUiPreviewWindow(app: ElectronApplication, editor: Page): Promise<Page> {
 let preview = app.windows().find(page => page.url().endsWith('#ui-preview'));
 if (preview) await editor.getByRole('button', { name: '预览窗口', exact: true }).click();
 else {
  const opened = app.waitForEvent('window', { predicate: page => page !== editor });
  await editor.getByRole('button', { name: '预览窗口', exact: true }).click();
  preview = await opened;
 }
 await expect(preview.getByLabel('UI 交互预览', { exact: true })).toBeVisible();
 await expect(editor.locator('.ui-logic-preview')).toHaveCount(0);
 return preview;
}

export async function showUiPreviewTestData(preview: Page) {
 const data = preview.locator('.ui-preview-test-data');
 if (await data.getAttribute('open') === null) await data.locator(':scope > summary').click();
}
