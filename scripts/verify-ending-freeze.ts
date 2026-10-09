import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { assetFiles, projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), original = 'C:/Users/LiuXiangdong/OneDrive/文档/Visual Novel Studio/我的视觉小说1';
const output = path.join(root, 'artifacts/ending-freeze-editor', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const snapshot = process.argv[2] ?? 'artifacts/text-ending-freeze/2026-10-04T18-15-05Z/project.vns.json.autosave';
const raw = JSON.parse(await fs.readFile(snapshot, 'utf8')), project = projectSchema.parse(raw.project ?? raw);
for (const asset of project.assets) {
  asset.externalPath = path.join(original, asset.path);
  if (asset.spine) asset.externalFiles = Object.fromEntries(assetFiles(asset).map(file => [file, path.join(original, file)]));
}
const file = path.join(output, 'project.vns.json'); await fs.writeFile(file, JSON.stringify(project));
const app = await launchDesktopFixture({ root, projectFile: file, profile: path.join(output, 'profile') });
const page = await app.firstWindow(); page.setDefaultTimeout(10000);
const errors: string[] = [], checks: string[] = []; page.on('pageerror', error => errors.push(error.message));
let phase = 'launch';
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await openStoryMode(page, 'text');
  const input = page.getByLabel('中文文本剧本', { exact: true });
  const source = await input.inputValue();
  phase = 'scroll to bottom'; console.log(phase);
  await input.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.mouse.move(570, 600); await page.mouse.wheel(0, 12000);
  await expect.poll(() => input.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 3)).toBe(true);
  await page.screenshot({ path: path.join(output, 'bottom.png'), timeout: 10000 });
  phase = 'caret to last line'; console.log(phase);
  await input.press('Control+End');
  await expect.poll(() => input.evaluate(el => (el as HTMLTextAreaElement).selectionStart)).toBe(source.length);
  phase = 'select each ending'; console.log(phase);
  for (const name of ['隐藏演出', '彩色标注']) await page.getByRole('button', { name, exact: true }).click();
  const visible = await input.inputValue();
  for (let at = visible.indexOf('@独立演出：结局演出'); at >= 0; at = visible.indexOf('@独立演出：结局演出', at + 1)) {
    await input.evaluate((el, at) => { const text = el as HTMLTextAreaElement; text.focus(); text.setSelectionRange(at, at); text.dispatchEvent(new Event('select', { bubbles: true })); }, at);
    await page.waitForTimeout(40);
  }
  const endingCount = (content: string) => (content.match(/^@结局演出/gm) ?? []).length;
  const expected = endingCount(project.scriptText!.content);
  for (const paused of [false, true]) for (const hidden of [false, true]) for (const colorful of [false, true]) {
    phase = `bottom editing: paused=${paused}, hidden=${hidden}, colorful=${colorful}`; console.log(phase);
    for (const [button, enabled] of [[page.locator('.preview-suspend-toggle'), paused], [page.getByRole('button', { name: '隐藏演出', exact: true }), hidden], [page.getByRole('button', { name: '彩色标注', exact: true }), colorful]] as const) {
      if (await button.getAttribute('aria-pressed') !== String(enabled)) await button.click();
    }
    for (let round = 0; round < 3; round++) {
      await input.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
      await input.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
    }
    await input.press('Control+End'); await input.press('Enter');
    // Insert the comment prefix atomically; a single slash is the command-palette shortcut.
    await page.keyboard.insertText('// '); await input.pressSequentially('freeze regression', { delay: 20 });
    const draft = await input.inputValue();
    await expect.poll(async () => {
      try { const auto = JSON.parse(await fs.readFile(file + '.autosave', 'utf8')); return auto.project.scriptText.content.includes('// freeze regression'); }
      catch { return false; }
    }, { timeout: 15000 }).toBe(true);
    const auto = JSON.parse(await fs.readFile(file + '.autosave', 'utf8'));
    assert.equal(endingCount(auto.project.scriptText.content), expected, 'Autosave must not insert performances');
    assert.equal(auto.project.scriptText.standaloneSyntax, 'module-names');
    assert.equal(auto.project.scriptText.performanceSyntax, 'explicit');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(endingCount(saved.scriptText.content), expected, 'Saving must not insert performances');
    assert.equal(await input.inputValue(), draft);
    await page.reload(); await openStoryMode(page, 'text');
    await expect(input).toHaveValue(draft);
    checks.push(phase + ': scroll, input, autosave, save and reopen remain responsive and do not add endings');
  }
  await page.screenshot({ path: path.join(output, 'verified-bottom.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), checks, errors }, null, 2));
  throw error;
} finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); console.log(output); }
