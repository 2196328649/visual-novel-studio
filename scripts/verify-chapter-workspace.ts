import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createServer } from 'vite';
import { createProject, projectSchema } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { launchDesktopFixture, installedExecutable } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { colorContrast } from '../src/renderer/editor-theme';

const root = path.resolve('.'), output = path.join(root, 'artifacts/chapter-workspace', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
const project = createProject('章节长文本与外观验收');
const passage = project.nodes.find(node => node.kind === 'passage')!;
const counts = [100, 5000, 300];
project.chapters = counts.map((_, index) => ({ id: `chapter_${index}`, name: `第${index + 1}章` }));
project.scenes = counts.map((_, index) => ({ id: `scene_${index}`, chapterId: `chapter_${index}`, name: `场景${index + 1}` }));
project.nodes = counts.map((count, index) => ({ ...structuredClone(passage), id: `passage_${index}`, name: `段落${index + 1}`, sceneId: `scene_${index}`, next: index < 2 ? `passage_${index + 1}` : undefined,
  lines: Array.from({ length: count }, (_, line) => ({ id: `line_${index}_${line}`, text: `第${index + 1}章第${line + 1}句，章节内编辑检查。`, actions: [] })),
}));
project.entryId = 'passage_0'; project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
await fs.writeFile(projectFile, JSON.stringify(project));
const server = installedExecutable ? undefined : await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server?.listen();
const launch = () => launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl: server ? `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` : undefined });
let app = await launch(), page = await app.firstWindow(), phase = 'launch';
const errors: string[] = [], checks: string[] = [], metrics: Record<string, unknown> = {};
page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 980));
  phase = 'chapter navigation and long text';
  await openStoryMode(page, 'text');
  const input = page.getByRole('textbox', { name: '中文文本剧本', exact: true }), chapter = page.getByLabel('文本章节', { exact: true });
  await expect(chapter).toHaveValue('chapter:chapter_0:0');
  expect(await input.inputValue()).not.toContain('第2章第1句');
  const started = Date.now(); await chapter.selectOption('chapter:chapter_1:0');
  await expect(input).toHaveValue(/第2章第5000句/);
  metrics.chapterSwitchMs = Date.now() - started;
  expect(await input.inputValue()).not.toContain('第3章第1句');
  expect(await page.locator('.text-code-line').count()).toBeLessThan(100);
  const before = await input.inputValue();
  const changed = before.replace('第2章第2500句，', '本章修改后的第2500句，');
  metrics.input = await input.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight, readOnly: (element as HTMLTextAreaElement).readOnly, disabled: (element as HTMLTextAreaElement).disabled }));
  const editStarted = Date.now();
  await input.focus();
  await input.evaluate(element => { const text = element as HTMLTextAreaElement, start = text.value.indexOf('第2章第2500句，'); text.setSelectionRange(start, start + '第2章第2500句，'.length); });
  await page.keyboard.insertText('本章修改后的第2500句，');
  await expect.poll(async () => await input.inputValue() === changed, { timeout: 15_000 }).toBe(true);
  metrics.largeChapterEditMs = Date.now() - editStarted;
  await input.evaluate(element => { (element as HTMLTextAreaElement).setSelectionRange(2200, 2200); element.scrollTop = 1800; element.dispatchEvent(new Event('scroll')); });
  await chapter.selectOption('chapter:chapter_2:0');
  await expect(input).toHaveValue(/第3章第300句/);
  await chapter.selectOption('chapter:chapter_1:0');
  expect(await input.evaluate(element => element.scrollTop)).toBeGreaterThan(1500);
  await page.getByRole('button', { name: '结构', exact: true }).click();
  await expect(page.getByLabel('当前章节结构')).toBeVisible();
  expect(await page.locator('.text-preview-row').count()).toBeLessThan(100);
  await page.getByLabel('当前章节结构').evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('.text-preview-row').filter({ hasText: '第2章第5000句' })).toBeVisible();
  await page.getByRole('button', { name: '画面', exact: true }).click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0, { timeout: 20_000 });
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  assert.ok(saved.scriptText?.content.includes('本章修改后的第2500句，'));
  const effective = applyTextScript(saved, saved.scriptText!.content).project;
  const original = applyTextScript(project, project.scriptText!.content).project;
  const first = effective.nodes.find(node => node.id === 'passage_0'), last = effective.nodes.find(node => node.id === 'passage_2');
  assert.deepEqual(first, original.nodes.find(node => node.id === 'passage_0'));
  assert.deepEqual(last, original.nodes.find(node => node.id === 'passage_2'));
  const middle = effective.nodes.find(node => node.id === 'passage_1');
  assert.equal(middle?.kind === 'passage' && middle.lines[2499].text, '本章修改后的第2500句，章节内编辑检查。');
  checks.push('默认按章显示；5000 句章节可切换和编辑，渲染行数少于 100；换章恢复滚动位置，实际保存保留其他章节与稳定对白编号。');
  await page.screenshot({ path: path.join(output, 'chapter-5000.png') });

  phase = 'all appearance presets';
  await page.evaluate('globalThis.__name = (value) => value');
  const contrasts: Record<string, unknown> = {};
  const paletteContrasts: Record<string, unknown> = {};
  for (const [id, label] of [['codexDark', '黑白'], ['codexLight', '亮白'], ['ue5', '石墨'], ['studio', '蓝灰'], ['custom', '自定义']] as const) {
    await page.getByRole('button', { name: '作品设置', exact: true }).click();
    await page.getByRole('button', { name: '编辑器外观', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    if (id === 'custom') for (const [name, color] of Object.entries({ 工作区背景: '#ffffff', 面板: '#000000', 工具栏: '#000000', 输入框: '#ffffff', 文字: '#ffffff', 次要文字: '#ffffff', 重点色: '#ffffff', 选中背景: '#000000' })) {
      await page.getByLabel(`自定义${name}`, { exact: true }).fill(color);
    }
    await expect(page.locator('html')).toHaveAttribute('data-editor-theme', id);
    const paletteColors = await page.locator('.editor-theme-card').first().evaluate(element => ({ background: getComputedStyle(element).backgroundColor,
      title: getComputedStyle(element.querySelector('strong')!).color, description: getComputedStyle(element.querySelector(':scope > small')!).color }));
    const hex = (color: string) => '#' + color.match(/[\d.]+/g)!.slice(0, 3).map(value => Number(value).toString(16).padStart(2, '0')).join('');
    const titleContrast = colorContrast(hex(paletteColors.title), hex(paletteColors.background)), descriptionContrast = colorContrast(hex(paletteColors.description), hex(paletteColors.background));
    expect(titleContrast, `${id}: theme card title`).toBeGreaterThanOrEqual(4.5);
    expect(descriptionContrast, `${id}: theme card description`).toBeGreaterThanOrEqual(4.5);
    paletteContrasts[id] = { titleContrast, descriptionContrast };
    await page.screenshot({ path: path.join(output, `appearance-${id}.png`) });
    await page.getByRole('button', { name: '关闭作品设置', exact: true }).click();
    const measured = await page.evaluate(() => {
      const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
      const lum = (value: number[]) => value.slice(0, 3).map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
      return ['.text-chapter-bar label', '.text-panel-heading strong', '.story-directory-heading strong', '.text-chapter-bar select', '.text-source-help', '.text-editor-toolbar .primary'].map(selector => {
        const element = document.querySelector<HTMLElement>(selector)!;
        const foreground = rgb(getComputedStyle(element).color);
        let parent: HTMLElement | null = element, background: number[] = [];
        while (parent) { background = rgb(getComputedStyle(parent).backgroundColor); if (background.length === 3 || background[3] >= .99) break; parent = parent.parentElement; }
        const a = lum(foreground), b = lum(background);
        return { selector, foreground, background, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
      });
    });
    contrasts[id] = measured;
    for (const measure of measured) expect(measure.contrast, `${id}: ${JSON.stringify(measure)}`).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: path.join(output, `workspace-${id}.png`) });
  }
  metrics.contrasts = contrasts;
  metrics.paletteContrasts = paletteContrasts;
  checks.push('四种内置外观与黑白混合的极端自定义配色均可使用，关键编辑控件文字对比度至少 4.5，分别保留设置页与长文本截图。');
  phase = 'saved chapter preference after restart';
  await app.close(); app = await launch(); page = await app.firstWindow();
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await openStoryMode(page, 'text');
  await expect(page.getByLabel('文本章节', { exact: true })).toHaveValue('chapter:chapter_1:0');
  await expect(page.getByRole('textbox', { name: '中文文本剧本', exact: true })).toHaveValue(/本章修改后的第2500句/);
  await expect(page.locator('html')).toHaveAttribute('data-editor-theme', 'custom');
  await page.getByRole('button', { name: '应用到项目', exact: true }).click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  await app.close(); app = await launch(); page = await app.firstWindow();
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await openStoryMode(page, 'text');
  await expect(page.getByLabel('文本章节', { exact: true })).toHaveValue('chapter:chapter_1:0');
  expect(errors).toEqual([]);
  checks.push('关闭并重开真实编辑器后，章节选择、配色与保存的对白仍然正确。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, metrics, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, metrics, errors, error: String(error) }, null, 2));
  console.error(phase + ': ' + String(error).slice(0, 1600)); process.exitCode = 1;
} finally { await app.close(); await server?.close(); }
console.log('REPORT ' + path.join(output, 'report.json'));
