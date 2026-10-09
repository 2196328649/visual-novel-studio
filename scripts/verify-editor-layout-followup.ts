import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
const root = path.resolve('.'), output = path.resolve('artifacts/editor-layout-followup', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const source = '#章节(流程图=是，显示名称=序幕): 第一章\n#小章节: 开场\n' + Array.from({ length: 70 }, (_, i) => `旁白：第 ${i + 1} 句，` + 'LongWordWithoutSpaces中文混合文本。'.repeat(i % 4 + 3)).join('\n');
const parsed = applyTextScript(createProject('编辑布局验收'), source); assert.deepEqual(parsed.issues, []);
const file = path.join(output, 'project.vns.json'); await fs.writeFile(file, JSON.stringify(parsed.project));
const app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile: file }), page = await app.firstWindow();
const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(parsed.project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await openStoryMode(page, 'text');
  const input = page.getByLabel('中文文本剧本', { exact: true }); const before = await input.inputValue();
  const wrap = page.getByRole('button', { name: '自动换行', exact: true }); await wrap.click();
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  await expect(input).toHaveAttribute('wrap', 'soft'); assert.equal(await input.inputValue(), before);
  const checkAlignment = async () => {
    await expect.poll(() => page.locator('.text-code-highlight .text-code-line').first().evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(0);
    return page.evaluate(() => {
      const input = document.querySelector<HTMLTextAreaElement>('.text-source-input')!;
      const rows = [...document.querySelectorAll<HTMLElement>('.text-code-highlight .text-code-line')];
      const gutter = [...document.querySelectorAll<HTMLElement>('.text-gutter-row')];
      const styles = [input, rows[0], rows[0].parentElement!].map(e => { const s = getComputedStyle(e); return { font: s.font, fontWeight: s.fontWeight, fontSize: s.fontSize, width: s.width, padding: s.padding, boxSizing: s.boxSizing, fontVariantLigatures: s.fontVariantLigatures, whiteSpace: s.whiteSpace, wordBreak: s.wordBreak }; });
      return { width: input.clientWidth, scrollWidth: input.scrollWidth, styles, wrapped: rows.some(row => row.getBoundingClientRect().height > 22), deltas: rows.map((r, i) => Math.abs(r.getBoundingClientRect().height - gutter[i].getBoundingClientRect().height)) };
    });
  };
  let layout = await checkAlignment(); assert.ok(layout.wrapped); assert.ok(layout.scrollWidth <= layout.width + 1); assert.ok(layout.deltas.every(d => d < 1), JSON.stringify(layout));
  const separator = page.getByRole('separator', { name: '调整文本与预览宽度' });
  const box = await separator.boundingBox(), oldWidth = await input.evaluate(e => e.clientWidth); assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 140, box.y + 100, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => input.evaluate(e => e.clientWidth)).toBeGreaterThan(oldWidth + 100);
  layout = await checkAlignment(); assert.ok(layout.deltas.every(d => d < 1), JSON.stringify(layout)); assert.equal(await input.inputValue(), before);
  await input.focus(); await input.press('Control+End');
  await expect(page.getByRole('button', { name: '转到第 72 行', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '转到第 72 行', exact: true }).click();
  assert.ok((await input.evaluate(e => (e as HTMLTextAreaElement).value.slice((e as HTMLTextAreaElement).selectionStart, (e as HTMLTextAreaElement).selectionEnd))).includes('第 70 句'));
  await page.screenshot({ path: path.join(output, 'wrapped-1440.png') });
  await wrap.click(); assert.equal(await input.inputValue(), before); await expect(input).toHaveAttribute('wrap', 'off');
  await separator.dblclick(); await expect(separator).toHaveAttribute('aria-valuenow', '51');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720)); await wrap.click();
  await input.press('Control+Home'); layout = await checkAlignment(); assert.ok(layout.deltas.every(d => d < 1), JSON.stringify(layout));
  await page.screenshot({ path: path.join(output, 'wrapped-1280.png') });
  await openStoryMode(page, 'script'); await expect(page.locator('.implicit-passage[data-node-kind=passage] .passage-heading-row')).toHaveCount(0);
  await page.screenshot({ path: path.join(output, 'modules-1280.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['soft wrap keeps source intact', 'gutter/highlights align across viewport resizing', 'drag and double click splitter', 'logical line selection after scrolling', 'implicit paragraphs have no fake headings'], layout, errors }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); console.log(output); }
