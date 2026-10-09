import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { assetFiles, effectiveUiComponents, projectSchema } from '../src/core/model';
import { assetSourcePath } from '../src/desktop/project-store';
import { installedExecutable, launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.');
const output = path.resolve('artifacts/ui-inspector-editor', new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const source = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? 'E:/Project/Visual Novel Studio/我的视觉小说1/project.vns.json');
const original = await fs.readFile(source), project = projectSchema.parse(JSON.parse(original.toString()));
const sourceSha256 = createHash('sha256').update(original).digest('hex');
project.name += ' · 属性面板验收';
project.assets = project.assets.map(asset => ({ ...asset, externalPath: assetSourcePath(path.dirname(source), asset),
  externalFiles: Object.fromEntries(assetFiles(asset).map(file => [file, assetSourcePath(path.dirname(source), asset, file)])),
}));
const components = effectiveUiComponents(project.ui);
const button = components.find(c => c.page === 'main' && c.kind === 'button' && c.action === 'start' && c.skin?.idle)!;
const picture = components.find(c => c.page === 'main' && c.kind === 'image' && !c.parentId)!;
assert.ok(button && picture);
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
await fs.writeFile(projectFile, JSON.stringify(project, null, 2));
const server = installedExecutable ? undefined : await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**', '**/work/**'] } } });
await server?.listen();
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const checks: string[] = [], errors: string[] = [];
const launch = async () => {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: server ? 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port : undefined });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('设计页面', { exact: true }).selectOption('main');
};
const close = async () => { await app?.close().catch(() => undefined); app = undefined; };
const row = (id: string) => page!.locator(`[data-hierarchy-id="${id}"]`);
const group = (title: string) => page!.locator('details.ui-inspector-group').filter({ has: page!.getByText(title, { exact: true }) });
const open = async (title: string) => { const item = group(title); if (!await item.evaluate(element => (element as HTMLDetailsElement).open)) await item.locator(':scope > summary').click(); return item; };
const save = async () => { await page!.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); };
const number = async (name: string, value: string) => { await page!.getByLabel(name, { exact: true }).fill(value); await page!.keyboard.press('Tab'); };
const checkWidth = async () => {
  const bounds = await page!.locator('.ui-inspector-shell .inspector-scroll').evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
  assert.ok(bounds.content <= bounds.width + 1, `Inspector horizontal overflow: ${JSON.stringify(bounds)}`);
};
try {
  await launch(); await row(button.id).click();
  phase = 'common-layout';
  await expect(page!.locator('.ui-inspector-shell > .panel-heading')).toHaveCount(0);
  await expect(group('内容与素材')).toHaveJSProperty('open', true);
  await expect(group('位置与大小')).toHaveJSProperty('open', true);
  for (const title of ['外观与状态', '点击与交互', '父级与子对象']) await expect(group(title)).toHaveJSProperty('open', false);
  await expect(page!.getByRole('combobox', { name: '按钮图片', exact: true })).toBeVisible();
  const tabBounds = await page!.getByRole('tablist', { name: '界面属性分类', exact: true }).evaluate(element => {
    const area = element.getBoundingClientRect();
    return { top: area.top, bottom: area.bottom, buttons: Array.from(element.querySelectorAll('button')).map(button => { const bounds = button.getBoundingClientRect(); return { top: bounds.top, bottom: bounds.bottom }; }) };
  });
  assert.ok(tabBounds.buttons.every(button => button.top >= tabBounds.top && button.bottom <= tabBounds.bottom), 'Tab buttons must stay inside their header without crossing the boundary');
  await checkWidth();
  await page!.screenshot({ path: path.join(output, '01-button.png') });
  checks.push('按钮名称、普通图片和位置在常用区；高级设置按用途收拢，去除重复标题与标签；分类按钮完整容纳在顶部区域');

  phase = 'geometry-undo-redo';
  const originalX = String(Number((button.x * 100).toFixed(2))), changedX = String(Number(originalX) + 1);
  await number('横向位置 %', changedX);
  await page!.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page!.getByLabel('横向位置 %', { exact: true })).toHaveValue(originalX);
  await page!.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page!.getByLabel('横向位置 %', { exact: true })).toHaveValue(changedX);
  checks.push('位置编辑和撤销重做继续使用原有数据提交路径');

  phase = 'appearance-and-interaction';
  await open('外观与状态');
  await expect(page!.getByRole('combobox', { name: '悬停图片', exact: true })).toBeVisible();
  await number('边框宽度', '2');
  await expect(group('外观与状态')).toHaveJSProperty('open', true);
  await group('外观与状态').locator(':scope > summary').click();
  await open('点击与交互');
  await page!.getByLabel('点击行为', { exact: true }).selectOption('load');
  await expect(group('点击与交互')).toContainText('读取存档');
  await page!.getByLabel('点击行为', { exact: true }).selectOption('start');
  await expect(page!.getByLabel('按钮悬停音效', { exact: true })).toBeVisible();
  checks.push('外观修改不会折叠当前分组；状态图片、悬停音效和点击行为在对应分组可编辑');

  phase = 'children';
  await open('父级与子对象');
  await page!.getByRole('button', { name: '添加子图片', exact: true }).click();
  const childId = await page!.locator('.ui-hierarchy-row.selected').getAttribute('data-hierarchy-id'); assert.ok(childId);
  await expect(page!.getByLabel('父对象', { exact: true })).toHaveValue(button.id);
  await expect(page!.getByLabel('子对象放置位置', { exact: true })).toHaveValue('foreground');
  await number('相对父级横向位置 %', '5');
  await expect(page!.locator(`.ui-canvas [data-component-id="${button.id}"] img`).first()).toBeVisible();
  checks.push('子对象默认显示父级设置，相对位置可以编辑，父按钮图片保留');
  await save();

  phase = 'picture-and-narrow-layout';
  await row(picture.id).click();
  await expect.poll(() => page!.locator('.ui-inspector-shell .inspector-scroll').evaluate(element => element.scrollTop)).toBe(0);
  await expect(page!.getByLabel('图片缩放', { exact: true })).toHaveCount(1);
  await expect(page!.getByRole('combobox', { name: '图片素材', exact: true })).toBeVisible();
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 780));
  await checkWidth();
  await page!.screenshot({ path: path.join(output, '02-picture-narrow.png') });
  checks.push('切换控件回到属性顶部；图片素材与缩放没有重复输入，小窗口无横向溢出');

  phase = 'game-groups-and-keyboard';
  await page!.getByRole('tab', { name: '游戏设置', exact: true }).click();
  await expect(group('玩家与菜单')).toHaveJSProperty('open', true);
  await open('标题与声音');
  await expect(page!.getByRole('combobox', { name: '标题背景', exact: true })).toBeVisible();
  await checkWidth();
  await page!.screenshot({ path: path.join(output, '03-game-settings.png') });
  await page!.getByRole('tab', { name: '游戏设置', exact: true }).focus();
  await page!.keyboard.press('ArrowLeft');
  await expect(page!.getByRole('tab', { name: '组件设置', exact: true })).toBeFocused();
  await expect(page!.getByRole('tab', { name: '组件设置', exact: true })).toHaveAttribute('aria-selected', 'true');
  checks.push('游戏设置按玩家、主题、标题声音、章节和对白框分组，分类可用键盘切换');

  phase = 'flow-style';
  const flow = components.find(c => c.kind === 'flowchart');
  if (flow) {
    await page!.getByLabel('设计页面', { exact: true }).selectOption(flow.page); await row(flow.id).click();
    await open('流程图框样式');
    await expect(page!.getByLabel('编辑框样式', { exact: true })).toBeVisible();
    await checkWidth(); checks.push('专用流程图框样式保留在独立分组');
  }

  phase = 'save-and-reopen';
  await close(); await launch(); await row(button.id).click();
  await expect(page!.getByLabel('横向位置 %', { exact: true })).toHaveValue(changedX);
  await open('外观与状态'); await expect(page!.getByLabel('边框宽度', { exact: true })).toHaveValue('2');
  await expect(row(childId)).toHaveAttribute('data-parent-id', button.id);
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const savedButton = effectiveUiComponents(saved.ui).find(c => c.id === button.id)!;
  assert.equal(savedButton.action, 'start'); assert.deepEqual(savedButton.skin, button.skin);
  assert.ok((await fs.readFile(source)).equals(original), 'Author project must remain unchanged');
  assert.deepEqual(errors, []);
  checks.push('保存重开保留位置、外观和父子关系，原工程逐字节保持原样');
  await group('外观与状态').locator(':scope > summary').click();
  await page!.screenshot({ path: path.join(output, '04-reopened.png') });
  const report = { status: 'passed', source, sourceSha256, projectFile, checks, errors, installedExecutable };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(output);
  if (process.argv.includes('--review')) {
    console.log('Review window ready; create ' + path.join(output, 'close-review') + ' to close.');
    const deadline = Date.now() + 1_800_000;
    while (Date.now() < deadline && !await fs.access(path.join(output, 'close-review')).then(() => true, () => false)) await new Promise(resolve => setTimeout(resolve, 1000));
  }
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'error.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2));
  console.error(output); throw error;
} finally { await close(); await server?.close(); }
