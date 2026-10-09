import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createServer } from 'vite';
import { assetFiles, createProject, projectSchema, type VisualObject } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { isStandaloneNode } from '../src/core/standalone-performance';
import { assetSourcePath, parseProject } from '../src/desktop/project-store';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { launchDesktopFixture, installedExecutable } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const author = process.argv.includes('--author');
const root = path.resolve('.'), output = path.resolve('artifacts/inline-playback-editor', new Date().toISOString().replaceAll(':', '-') + '-' + (author ? 'author' : 'editor') + '-' + randomUUID().slice(0, 8));
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
const sourceFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? 'E:/Project/Visual Novel Studio/我的视觉小说1/project.vns.json');
const sourceBytes = author ? await fs.readFile(sourceFile) : undefined;
const legacy = '@等待：0.4\n@演出设置：允许点击跳过=否，结束后=继续剧情\n// 注释保留\n@演出转场：纯色，0.2，0.1，0.3，#102030\n@独立演出："开场，校验"\n旁白：后续第一句。\n旁白：后续第二句。\n@等待：0.2\n@独立演出：片尾\n@返回标题界面';
const project = author
  ? projectSchema.parse(JSON.parse(await fs.readFile(process.env.VNS_AUTHOR_CANDIDATE ?? sourceFile, 'utf8')))
  : applyTextScript(createProject('独立演出参数验收'), legacy).project;
if (author) project.assets = project.assets.map(asset => ({ ...asset,
  externalPath: assetSourcePath(path.dirname(sourceFile), asset),
  externalFiles: Object.fromEntries(assetFiles(asset).map(file => [file, assetSourcePath(path.dirname(sourceFile), asset, file)])),
}));
else delete project.scriptText!.playbackSyntax;
await fs.writeFile(projectFile, JSON.stringify(project, null, 2));
const expected = parseProject(project).project;
const server = installedExecutable ? undefined : await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**', '**/work/**'] } } });
await server?.listen();
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const checks: string[] = [], errors: string[] = [];
const launch = async () => {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: server ? 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port : undefined });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1560, 1000));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
};
const close = async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined);
  await app?.close(); app = undefined;
};
const save = async () => {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
};
try {
  await launch(); await openStoryMode(page!, 'text');
  const input = page!.getByLabel('中文文本剧本', { exact: true });
  const initial = await input.inputValue();
  assert.doesNotMatch(initial, /^\s*@演出(?:设置|转场)[:：]/m);
  for (const command of expected.scriptText!.content.split(/\r?\n/).filter(l => /^\s*@独立演出/.test(l))) assert.ok(initial.includes(command), command);
  checks.push('打开工程自动将旧播放设置并入独立演出声明');
  if (author) {
    phase = 'author-project';
    assert.equal(project.nodes.length, 5); assert.ok(initial.includes('归'));
    await page!.screenshot({ path: path.join(output, 'author-text.png') });
    await openStoryMode(page!, 'script');
    await expect(page!.locator('.passage-section')).toHaveCount(5);
    const chapter = project.nodes.find(isStandaloneNode)!;
    const module = page!.locator('#node-' + chapter.id);
    await expect(module.getByLabel('独立演出结束转场', { exact: true })).toHaveValue('color');
    await expect(module.getByLabel('演出淡出秒数', { exact: true })).toHaveValue('0.5');
    await expect(module.getByLabel('演出淡入秒数', { exact: true })).toHaveValue('0.5');
    await module.scrollIntoViewIfNeeded();
    await page!.getByLabel('定位演出时间（秒）', { exact: true }).fill('2'); await page!.keyboard.press('Tab');
    await expect(page!.getByLabel('定位演出时间（秒）', { exact: true })).toHaveValue('2');
    const walk = (object: VisualObject): VisualObject[] => [object, ...(object.children?.flatMap(walk) ?? [])];
    const objects = expandPreviewActions(expected, chapter.lines.flatMap(line => line.actions), previewActionContext(expected)).filter(action => action.kind === 'visual').flatMap(walk);
    const era = objects.find(object => object.content === 'text' && object.name === '右侧字')!;
    assert.ok(era?.textItalic);
    const eraText = page!.locator('.story-preview-content [data-visual-text]').filter({ hasText: era.text });
    await expect(eraText).toHaveCount(1); await expect(eraText).toHaveCSS('font-style', 'italic');
    await expect(eraText).toHaveCSS('font-synthesis', 'style');
    await page!.evaluate(() => document.fonts.ready);
    await page!.screenshot({ path: path.join(output, 'author-module.png') });
    const slanted = PNG.sync.read(await eraText.screenshot({ path: path.join(output, 'author-era.png') }));
    await eraText.evaluate(element => { (element as HTMLElement).style.fontStyle = 'normal'; });
    const upright = PNG.sync.read(await eraText.screenshot({ path: path.join(output, 'author-era-upright-reference.png') }));
    await eraText.evaluate(element => { (element as HTMLElement).style.fontStyle = 'italic'; });
    assert.equal(slanted.width, upright.width); assert.equal(slanted.height, upright.height);
    let changedPixels = 0;
    for (let i = 0; i < slanted.data.length; i += 4) if ([0, 1, 2].some(channel => Math.abs(slanted.data[i + channel] - upright.data[i + channel]) > 12)) changedPixels++;
    assert.ok(changedPixels > 40, `Italic must change rendered glyphs, not only CSS: ${changedPixels}`);
    await fs.writeFile(path.join(output, 'era-pixels.json'), JSON.stringify({ changedPixels, width: slanted.width, height: slanted.height }, null, 2));
    assert.ok((await fs.readFile(sourceFile)).equals(sourceBytes!));
    checks.push('作者工程副本保留“归”、5 个节点及章节结束转场，原工程文件未被打开校验修改');
    checks.push('右侧年代按斜体显示，字形粒子沿用相同设置');
  } else {
    phase = 'completion';
    await input.evaluate(element => {
      const t = element as HTMLTextAreaElement, marker = '允许点击跳过=', position = t.value.indexOf(marker) + marker.length;
      t.focus(); t.setSelectionRange(position, position); t.dispatchEvent(new Event('select', { bubbles: true }));
    });
    await page!.keyboard.press('Control+Space');
    const menu = page!.getByRole('listbox', { name: '文本补全建议' });
    await expect(menu).toBeVisible(); await expect(menu).toContainText('是'); await expect(menu).toContainText('否');
    await expect(page!.getByRole('button', { name: '填写结束转场', exact: true })).toBeVisible();
    await expect(page!.getByRole('button', { name: '填写结束后', exact: true })).toHaveCount(0);
    await page!.screenshot({ path: path.join(output, 'unified-parameters.png') });
    await page!.keyboard.press('Escape');
    await input.fill(initial + '\n@'); await input.press('Control+End'); await page!.keyboard.press('Control+Space');
    await expect(menu).toBeVisible(); await expect(menu).toContainText('独立演出');
    await expect(menu).not.toContainText('演出设置'); await expect(menu).not.toContainText('演出转场');
    await page!.keyboard.press('Escape'); await input.fill(initial);
    await page!.getByRole('button', { name: '应用到项目', exact: true }).click();
    checks.push('独立演出统一参数与是/否值补全，旧单独指令退出补全列表');
    phase = 'module-editing';
    await openStoryMode(page!, 'script');
    const [first, last] = expected.nodes.filter(isStandaloneNode);
    const module = page!.locator('#node-' + first.id), skip = module.getByLabel('允许点击跳过独立演出', { exact: true });
    await expect(skip).not.toBeChecked(); await skip.check(); await expect(skip).toBeChecked();
    await page!.getByRole('button', { name: '撤销', exact: true }).click(); await expect(skip).not.toBeChecked();
    await page!.getByRole('button', { name: '重做', exact: true }).click(); await expect(skip).toBeChecked();
    await module.getByLabel('独立演出结束转场', { exact: true }).selectOption('dissolve');
    await module.getByLabel('演出淡出秒数', { exact: true }).fill('0.4'); await page!.keyboard.press('Tab');
    await expect(page!.getByLabel('独立演出结束后', { exact: true })).toHaveCount(0);
    await module.scrollIntoViewIfNeeded(); await page!.screenshot({ path: path.join(output, 'module-settings.png') });
    const saved = await save(), savedFirst = saved.nodes.find(n => n.id === first.id)!;
    assert.ok(isStandaloneNode(savedFirst));
    assert.deepEqual(savedFirst.lines[0].actions, first.lines[0].actions);
    assert.equal(savedFirst.lines[0].playback?.clickSkip, true);
    assert.equal(savedFirst.lines[0].playback?.transition?.mode, 'dissolve');
    assert.equal(savedFirst.lines[0].playback?.transition?.outDuration, .4);
    assert.equal(saved.nodes.length, expected.nodes.length);
    const savedLast = saved.nodes.find(n => n.id === last.id)!; assert.ok(isStandaloneNode(savedLast));
    assert.equal(savedLast.lines[0].playback?.onComplete, undefined);
    assert.equal(saved.nodes.find(node => node.id === savedLast.next)?.kind, 'end');
    assert.ok(saved.scriptText!.content.includes('@返回标题界面'));
    assert.deepEqual(saved.nodes.filter(n => n.kind === 'passage' && !isStandaloneNode(n)), expected.nodes.filter(n => n.kind === 'passage' && !isStandaloneNode(n)));
    assert.ok(saved.scriptText!.content.includes('// 注释保留'));
    assert.doesNotMatch(saved.scriptText!.content, /@演出(?:设置|转场)/);
    assert.match(saved.scriptText!.content, /@独立演出：[^\n]*允许点击跳过=是[^\n]*结束转场=溶解/);
    assert.deepEqual(applyTextScript(saved, saved.scriptText!.content).issues.filter(i => i.severity === 'error'), []);
    checks.push('模块编辑将跳过与转场写回同一声明，结束行为不再提供设置；后续返回标题指令、正文与注释保留，撤销重做有效');
    phase = 'reopen';
    await close(); await launch(); await openStoryMode(page!, 'script');
    const reopened = page!.locator('#node-' + first.id);
    await expect(reopened.getByLabel('允许点击跳过独立演出', { exact: true })).toBeChecked();
    await expect(reopened.getByLabel('独立演出结束转场', { exact: true })).toHaveValue('dissolve');
    await expect(reopened.getByLabel('演出淡出秒数', { exact: true })).toHaveValue('0.4');
    await expect(page!.getByLabel('独立演出结束后', { exact: true })).toHaveCount(0);
    const reopenedSaved = await save(); assert.deepEqual(reopenedSaved.nodes, saved.nodes);
    await openStoryMode(page!, 'text'); await page!.screenshot({ path: path.join(output, 'saved-reopened.png') });
    checks.push('退出并重开实际程序后设置一致，二次保存保持节点与连线');
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', author, checks, errors, projectFile,
    sourceFile: author ? sourceFile : undefined, sourceSha256: sourceBytes ? createHash('sha256').update(sourceBytes).digest('hex') : undefined }, null, 2));
  console.log(output);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, author, checks, errors, error: String(error) }, null, 2));
  console.log(output); throw error;
} finally { await close(); await server?.close(); }
