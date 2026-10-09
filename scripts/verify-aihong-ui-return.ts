import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { projectSchema, orderedUiComponents, type UiComponent } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/aihong-ui-return', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const templateRoot = path.join(root, 'resources/templates/aihong'), templateFile = path.join(templateRoot, 'project.vns.json'), source = await fs.readFile(templateFile, 'utf8');
const project = projectSchema.parse(JSON.parse(source));
await fs.cp(path.join(templateRoot, 'assets'), path.join(output, 'assets'), { recursive: true });
const file = path.join(output, 'project.vns.json'), original = JSON.stringify(project); await fs.writeFile(file, original);
const app = await launchDesktopFixture({ root, projectFile: file, profile: path.join(output, 'profile') }), editor = await app.firstWindow(), errors: string[] = [], results: unknown[] = [];
editor.on('pageerror', error => errors.push(error.message));
const mode = (name: string) => editor.getByLabel('界面编辑模式').getByRole('button', { name, exact: true });
const components = orderedUiComponents(project.ui), pages = [...new Set(components.map(c => c.page))].filter(p => p !== 'custom');
const check = async (page: UiComponent['page']) => {
 const expected = components.filter(c => c.page === page && !c.editor?.hidden && (page !== 'save' || !c.saveMode || c.saveMode === 'save'));
 await expect(editor.locator('.ui-canvas [data-component-id]')).toHaveCount(expected.length);
 await expect.poll(() => editor.locator('.ui-canvas [data-component-id]').evaluateAll(elements => elements.every(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && Number.parseFloat(getComputedStyle(el).fontSize) > 0))).toBe(true);
 await expect.poll(() => editor.locator('.ui-canvas img').evaluateAll(images => images.every(el => { const image = el as HTMLImageElement; return image.complete && image.naturalWidth > 0; }))).toBe(true);
 const rows = await editor.locator('.ui-canvas [data-component-id]').evaluateAll(elements => elements.map(el => ({ id: el.getAttribute('data-component-id'), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
 results.push({ page, expected: expected.length, rows });
};
try {
 await expect(editor.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); await editor.locator('[data-workspace-tab="ui"]').click();
 for (const page of pages) {
  await mode('事件图').click(); await editor.getByLabel('事件图页面').selectOption('ui:' + page); await mode('设计').click(); await check(page);
  await mode('事件图').click(); await mode('设计').click(); await check(page);
  if (['main', 'say', 'voiceCollection', 'choice'].includes(page)) await editor.screenshot({ path: path.join(output, page + '-returned.png') });
 }
 await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768)); await mode('事件图').click(); await editor.getByLabel('事件图页面').selectOption('ui:main'); await mode('设计').click(); await check('main'); await editor.screenshot({ path: path.join(output, 'main-narrow.png') });
 assert.equal(await fs.readFile(file, 'utf8'), original); assert.equal(await fs.readFile(templateFile, 'utf8'), source); assert.deepEqual(errors, []);
 await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', renderer: 'dist', pages, checkedReturns: results.length, results, originalTemplateUnchanged: true, fixtureDiskUnchanged: true, errors }, null, 2));
} catch (error) { await editor.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); await fs.writeFile(path.join(output, 'failure.txt'), String(error)); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); console.log(output); }
