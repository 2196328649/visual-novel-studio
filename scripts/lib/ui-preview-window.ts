import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';

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

/** The preview follows the editor's page after a short delay and restarts there, closing the test values again. */
export async function followUiPreviewPage(preview: Page, pageName: string) {
 await expect(preview.getByLabel('当前预演页面', { exact: true })).toHaveText(pageName);
 await showUiPreviewTestData(preview);
}

const watched = new WeakSet<Page>();
/** Open the preview window as the page under test: its errors count with the editor's, and its test values are shown. */
export async function openUiPreviewForTest(app: ElectronApplication, editor: Page, errors?: string[]): Promise<Page> {
 const preview = await openUiPreviewWindow(app, editor);
 if (errors && !watched.has(preview)) { watched.add(preview); preview.on('pageerror', error => errors.push(error.message)); }
 await showUiPreviewTestData(preview);
 return preview;
}

/** A previewed control's drawn top-left as a fraction of its page. Layout geometry places
 * controls with a transform from the page origin; `left`/`top` hold only the remainder. */
export async function uiPreviewPlacement(target: Locator) {
 return target.evaluate(element => {
  const style = getComputedStyle(element), matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
  const page = getComputedStyle(element.parentElement!);
  return { x: (parseFloat(style.left) + matrix.e) / parseFloat(page.width), y: (parseFloat(style.top) + matrix.f) / parseFloat(page.height), opacity: Number((element as HTMLElement).style.opacity) };
 });
}
