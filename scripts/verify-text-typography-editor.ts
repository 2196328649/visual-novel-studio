import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Locator } from '@playwright/test';
import { PNG } from 'pngjs';
import { projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { assertGlyphChange, glyphDifference, sha256, textInk, typographyFixture, typographyWords } from './lib/text-typography';

// Computed fontWeight/fontStyle alone missed the original failure: the root
// disabled font synthesis. Check actual ink, positions and the real import flow.
const root = path.resolve('.'), baseline = process.argv.includes('--baseline');
const at = process.argv.indexOf('--source'), source = path.resolve(at < 0 ? 'resources/templates/aihong/project.vns.json' : process.argv[at + 1]);
const output = path.resolve('artifacts/text-typography-editor', new Date().toISOString().replaceAll(':', '-') + (baseline ? '-baseline' : ''));
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
const fixture = await typographyFixture(source, directory), { project } = fixture;
await fs.writeFile(projectFile, JSON.stringify(project));
const checks: string[] = [], errors: string[] = [], evidence: Record<string, unknown> = { source, sourceHash: fixture.originalHash };
let app: ElectronApplication | undefined, phase = 'launch';
try {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.webContents.setBackgroundThrottling(false); window.setContentSize(1600, 1050); });
  await openStoryMode(page, 'script');
  const row = page.locator('#line-typography'), input = row.locator('.dialogue-input');
  await input.click();
  await row.getByRole('button', { name: '展开第1行台词文字演出', exact: true }).click();
  const editor = row.getByRole('region', { name: '第1行台词文字演出', exact: true });
  const sample = editor.locator('.text-look-sample-stage');
  const dialogue = page.locator('[data-preview-component-id="typography_dialogue"] .ui-text-content');
  const capture = async (scope: Locator, name: string) => {
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await scope.scrollIntoViewIfNeeded();
    const image = PNG.sync.read(await scope.screenshot({ path: path.join(output, name + '.png') }));
    assert.ok(textInk(image).pixels > 40, name + ': no text pixels');
    return image;
  };
  const positions = async (scope: Locator) => scope.evaluate(element => {
    const container = element.getBoundingClientRect(), css = getComputedStyle(element);
    const chars = Array.from(element.querySelectorAll('.styled-char')).map(char => { const r = char.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width }; });
    const lines: { y: number; left: number; right: number }[] = [];
    for (const char of chars) {
      const line = lines.find(line => Math.abs(line.y - char.y) < 2);
      if (line) { line.left = Math.min(line.left, char.x); line.right = Math.max(line.right, char.x + char.width); }
      else lines.push({ y: char.y, left: char.x, right: char.x + char.width });
    }
    return { left: container.x + parseFloat(css.paddingLeft), right: container.right - parseFloat(css.paddingRight), align: css.textAlign, lines };
  });
  const assertAlign = async (scope: Locator, align: 'left' | 'center' | 'right', name: string) => {
    const result = await positions(scope);
    if (!baseline) for (const line of result.lines) {
      const gap = align === 'left' ? line.left - result.left : align === 'right' ? result.right - line.right : (line.left + line.right - result.left - result.right) / 2;
      assert.ok(Math.abs(gap) < 2, name + ': ' + JSON.stringify(result));
    }
    evidence[name] = result;
  };
  const chooseFont = async (id?: string) => {
    if (baseline) { await editor.getByLabel('文字演出字体', { exact: true }).selectOption(id ?? ''); return; }
    await editor.getByRole('button', { name: '浏览文字演出字体', exact: true }).click();
    const browser = page.getByRole('dialog', { name: '文字演出字体资源浏览器', exact: true });
    await expect(browser.getByRole('button', { name: /^预览资源 / })).toHaveCount(project.assets.length);
    if (id) await browser.getByRole('button', { name: '预览资源 ' + project.assets.find(asset => asset.id === id)!.name, exact: true }).dblclick();
    else await browser.locator('.asset-picker-card').filter({ hasText: '对话框字体' }).dblclick();
  };
  phase = 'alignment';
  if (!baseline) {
    await expect(editor.getByLabel('对齐', { exact: true })).toHaveValue('right');
    await assertAlign(sample, 'right', 'inherited-sample');
    await assertAlign(dialogue, 'right', 'inherited-dialogue');
  }
  await chooseFont(fixture.regular?.id);
  for (const text of [typographyWords, '春江花月夜\nAa']) {
    await input.fill(text); await input.press('Tab');
    for (const align of ['left', 'center', 'right'] as const) {
      await editor.getByLabel('对齐', { exact: true }).selectOption(align);
      const name = (text.includes('\n') ? 'multiline-' : '') + align;
      await assertAlign(sample, align, name + '-sample');
      await assertAlign(dialogue, align, name + '-dialogue');
      await capture(dialogue, name + '-dialogue');
    }
  }
  if (!baseline) {
    await editor.locator('.text-look-row', { has: page.getByLabel('对齐', { exact: true }) }).getByRole('button', { name: '恢复为继承值', exact: true }).click();
    await expect(editor.getByLabel('对齐', { exact: true })).toHaveValue('right');
  }
  checks.push(baseline ? '旧构建：记录整句与多行的实际字符位置，不断言新行为' : '整句与多行的左中右对齐、恢复对话框继承，测量实际字符位置');
  await input.fill(typographyWords); await input.press('Tab');
  await editor.getByLabel('对齐', { exact: true }).selectOption('left');
  phase = 'glyphs';
  // Every project face is selectable; verify synthetic glyphs even for calligraphy
  // and files that already contain bold shapes. Clearing bold returns to that file.
  for (const asset of project.assets) {
    await chooseFont(asset.id);
    await editor.getByLabel('粗体', { exact: true }).uncheck();
    await editor.getByLabel('斜体', { exact: true }).uncheck();
    const plain = await capture(sample, asset.id + '-plain-sample');
    const plainDialogue = await capture(dialogue, asset.id + '-plain-dialogue');
    for (const kind of ['bold', 'italic'] as const) {
      await editor.getByLabel(kind === 'bold' ? '粗体' : '斜体', { exact: true }).check();
      const changed = await capture(sample, asset.id + '-' + kind + '-sample');
      const changedDialogue = await capture(dialogue, asset.id + '-' + kind + '-dialogue');
      const compare = baseline ? (a: PNG, b: PNG) => glyphDifference(a, b) : (a: PNG, b: PNG) => assertGlyphChange(a, b, kind, asset.name);
      evidence[asset.id + '-' + kind] = { name: asset.name, sample: compare(plain, changed), dialogue: compare(plainDialogue, changedDialogue) };
      await editor.getByLabel(kind === 'bold' ? '粗体' : '斜体', { exact: true }).uncheck();
    }
    const restored = await capture(sample, asset.id + '-restored-sample');
    assert.equal(textInk(restored).hash, textInk(plain).hash, 'clearing styles should restore the original face');
  }
  evidence.synthesis = await sample.locator('.styled-text').evaluate(node => getComputedStyle(node).fontSynthesis);
  checks.push(baseline ? '旧构建：记录全部字体的粗体、斜体截图差异，不断言新行为' : '项目中每份字体的整句粗体、斜体在小样本和舞台里实际改变像素，取消后恢复');

  if (!baseline) {
    phase = 'screen placement';
    await editor.getByRole('tab', { name: '位置', exact: true }).click();
    await editor.getByLabel('显示位置', { exact: true }).selectOption('screen');
    await editor.getByRole('tab', { name: '文字样式', exact: true }).click();
    await editor.locator('.text-look-row', { has: page.getByRole('combobox', { name: '文字演出字体', exact: true }) }).getByRole('button', { name: '恢复为继承值', exact: true }).click();
    const screen = page.locator('.dialogue-screen-text');
    // The screen line inherits the page font, not the custom dialogue component's.
    assert.match(await sample.evaluate(node => getComputedStyle(node).fontFamily), /vns_runtime_default/);
    assert.match(await screen.evaluate(node => getComputedStyle(node).fontFamily), /vns_runtime_default/);
    for (const align of ['left', 'center', 'right'] as const) {
      await editor.getByLabel('对齐', { exact: true }).selectOption(align);
      await assertAlign(screen, align, 'screen-' + align);
    }
    await editor.getByLabel('对齐', { exact: true }).selectOption('left');
    const plain = await capture(screen, 'default-plain-screen');
    for (const kind of ['bold', 'italic'] as const) {
      await editor.getByLabel(kind === 'bold' ? '粗体' : '斜体', { exact: true }).check();
      evidence['default-' + kind] = assertGlyphChange(plain, await capture(screen, 'default-' + kind + '-screen'), kind, 'default font');
      await editor.getByLabel(kind === 'bold' ? '粗体' : '斜体', { exact: true }).uncheck();
    }
    checks.push('画面文字使用页面字体，默认字体粗斜体及左中右实际位置通过');
    await editor.getByRole('tab', { name: '位置', exact: true }).click();
    await editor.getByLabel('显示位置', { exact: true }).selectOption('dialogue');
    await editor.getByRole('tab', { name: '文字样式', exact: true }).click();

    phase = 'font import';
    const imports = path.join(output, 'imports'); await fs.mkdir(imports, { recursive: true });
    const newFont = path.join(imports, '新导入的中文字体.ttf');
    await fs.copyFile(path.join(root, 'resources/runtime/sdk-fonts/SourceHanSansLite.ttf'), newFont);
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, newFont);
    await editor.getByRole('button', { name: '浏览文字演出字体', exact: true }).click();
    await page.getByRole('dialog', { name: '文字演出字体资源浏览器', exact: true }).getByRole('button', { name: '选择项目外素材', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '文字演出字体资源浏览器', exact: true })).toHaveCount(0);
    await expect(editor.getByRole('combobox', { name: '文字演出字体', exact: true })).toHaveValue('新导入的中文字体');
    const save = async () => {
      await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
      return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
    };
    const imported = (await save()).assets.find(asset => asset.name === '新导入的中文字体')!;
    assert.ok(imported?.kind === 'font');
    assert.equal(sha256(await fs.readFile(path.join(directory, imported.path))), sha256(await fs.readFile(newFont)));
    checks.push('实际导入项目外TTF字体并立即选用，复制文件正确，保存后字体引用仍在');

    phase = 'part-line styles';
    await input.click(); await input.press('Control+Home');
    for (let index = 0; index < 2; index++) await input.press('Shift+ArrowRight');
    const toolbar = row.getByRole('toolbar', { name: '选中文字效果', exact: true });
    await expect(toolbar).toBeVisible();
    const partialPlain = await capture(dialogue, 'partial-plain');
    for (const kind of ['bold', 'italic'] as const) {
      await toolbar.getByLabel(kind === 'bold' ? '局部粗体' : '局部斜体', { exact: true }).click();
      evidence['partial-' + kind] = assertGlyphChange(partialPlain, await capture(dialogue, 'partial-' + kind), kind, 'selected words');
      await expect(dialogue.locator('[data-text-span]')).toHaveCount(2);
      const rest = dialogue.locator('.styled-char-loop').nth(2);
      assert.equal(await rest.evaluate(node => getComputedStyle(node).fontWeight), '400');
      assert.equal(await rest.evaluate(node => getComputedStyle(node).fontStyle), 'normal');
      await toolbar.getByLabel(kind === 'bold' ? '局部粗体' : '局部斜体', { exact: true }).click();
    }
    await toolbar.getByRole('button', { name: '浏览局部文字字体', exact: true }).click();
    const partialBrowser = page.getByRole('dialog', { name: '局部文字字体资源浏览器', exact: true });
    await expect(partialBrowser.getByRole('button', { name: /^预览资源 / })).toHaveCount(project.assets.length + 1);
    await partialBrowser.getByLabel('搜索可选资源', { exact: true }).fill(fixture.regular!.name);
    await partialBrowser.getByRole('button', { name: '预览资源 ' + fixture.regular!.name, exact: true }).dblclick();
    await toolbar.getByLabel('局部粗体', { exact: true }).click();
    await toolbar.getByLabel('局部斜体', { exact: true }).click();
    await editor.getByLabel('对齐', { exact: true }).selectOption('center');
    const saved = await save(), line = saved.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []).find(line => line.id === 'typography')!;
    assert.equal(line.textPresentation?.fontAssetId, imported.id);
    assert.equal(line.textPresentation?.align, 'center');
    assert.deepEqual(line.textSpans, [{ start: 0, end: 2, style: { fontAssetId: fixture.regular!.id, bold: true, italic: true } }]);
    await fs.writeFile(path.join(output, 'saved-project.json'), JSON.stringify(saved, null, 2));
    await openStoryMode(page, 'text');
    await expect(page.locator('.text-source-panel')).toContainText('对齐=居中');
    await expect(page.locator('.text-source-panel')).toContainText('粗体，斜体');
    await openStoryMode(page, 'script');
    await row.getByRole('button', { name: '展开第1行台词文字演出', exact: true }).click();
    await page.screenshot({ path: path.join(output, 'font-controls.png') });
    checks.push('局部粗斜体改变选中字形，其余字保持常规；局部字体可搜索全库，保存和文本往返保留');

    phase = 'reopen';
    await app.close(); app = undefined;
    app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile-reopen') });
    const reopened = await app.firstWindow();
    await expect(reopened.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
    await openStoryMode(reopened, 'script');
    await reopened.locator('#line-typography .dialogue-input').click();
    await reopened.getByRole('button', { name: '展开第1行台词文字演出', exact: true }).click();
    await expect(reopened.getByRole('combobox', { name: '文字演出字体', exact: true })).toHaveValue(imported.name);
    await expect(reopened.getByLabel('对齐', { exact: true })).toHaveValue('center');
    await expect(reopened.locator('.ui-dialogue-preview [data-text-span]')).toHaveCount(2);
    checks.push('重开工程后字体、对齐和局部粗斜体仍然生效');
  }
  assert.deepEqual(errors, []);
  assert.equal(sha256(await fs.readFile(source)), fixture.originalHash);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: baseline ? 'baseline' : 'passed', checks, evidence, errors }, null, 2));
} catch (error) {
  await app?.firstWindow().then(page => page.screenshot({ path: path.join(output, 'failure.png') })).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), checks, evidence, errors }, null, 2));
  throw error;
} finally {
  await app?.close();
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile', 'profile-reopen', 'imports']);
  assert.deepEqual(cleanup.errors, []);
  console.log(output);
}
