import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type Diagnostic, type Project } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { compileProject } from '../src/runtime/compiler';
import { saveProject } from '../src/desktop/project-store';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts/diagnostic-navigation', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
const source = `@入口：开场【main】
# 章节：第一章【chapter_main】
# 小章节：主线【scene_main】
# 段落：开场【main】
${Array.from({ length: 28 }, (_, index) => `@对白标记：main_line_${index}\n旁白：主线第 ${index + 1} 句。`).join('\n')}
@跳转：结束【ending】
# 章节：第二章【chapter_extra】
# 小章节：备用内容【scene_extra】
${Array.from({ length: 12 }, (_, index) => `# 段落：备用段落 ${index + 1}【unused_${index}】\n@对白标记：unused_line_${index}\n@等待：0.1\n旁白：这是备用段落 ${index + 1} 的对白。`).join('\n')}\n# 段落：结束【ending】\n@返回标题界面`;
const initial = applyTextScript(createProject('问题提示与故事入口验证'), source);
expect(initial.issues).toEqual([]);
const graph = createBlueprintGraph('function', '诊断定位蓝图');
initial.project.blueprints.push(graph);
const assetPath = path.join(output, 'project/test.png');
await fs.writeFile(assetPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=', 'base64'));
initial.project.assets.push({ id: 'test_asset', name: '诊断定位图片', kind: 'image', category: 'ui', path: 'test.png' });
initial.project.scriptText = { format: 'vns-text-1', content: projectToText(initial.project) };
expect(compileProject(initial.project).diagnostics.filter(issue => issue.severity === 'error')).toEqual([]);
await saveProject(projectFile, initial.project);
const initialFile = await fs.readFile(projectFile, 'utf8');
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server.listen();
const env = Object.fromEntries(Object.entries({ ...process.env, VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: path.join(output, 'profile'), VNS_DEV_URL: `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` }).filter((entry): entry is [string, string] => entry[1] !== undefined));
delete env.ELECTRON_RUN_AS_NODE;
let app: ElectronApplication | undefined, page: Page | undefined;
const checks: string[] = [], errors: string[] = [];
let phase = 'launch';
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 60000 });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(initial.project.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
  await openStoryMode(page, 'text');
  const input = page.getByLabel('中文文本剧本', { exact: true });
  const original = await input.inputValue();
  const selectedText = () => input.evaluate(element => { const textarea = element as HTMLTextAreaElement; return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd); });
  const rightWarning = (index: number) => page!.locator('.problems-panel').locator(`[data-node-id="unused_${index}"] .diagnostic-main`);
  const save = async () => {
    await page!.getByRole('button', { name: '保存工程', exact: true }).click();
    await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    return JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
  };

  phase = 'all warnings and visible text locations';
  await expect(page.locator('.text-issue-list, .text-diagnostic-summary')).toHaveCount(0);
  await page.locator('.status-bar > button').first().click();
  expect(original).not.toContain('【'); expect(original).not.toContain('@对白标记');
  await expect(page.locator('.problems-panel .diagnostic.warning')).toHaveCount(12);
  await expect(rightWarning(11)).toBeEnabled();
  await rightWarning(11).click();
  await expect(input).toBeFocused();
  expect(await selectedText()).toBe('# 段落：备用段落 12');
  await expect(page.locator('.problems-panel [data-node-id="unused_11"]')).toContainText('第二章 / 备用内容 / 备用段落 12');
  await expect(page.locator('.problems-panel [data-node-id="unused_11"] .diagnostic-details')).toContainText('不阻止试玩');
  await expect(page.locator('.problems-panel [data-node-id="unused_11"] .diagnostic-details')).toBeInViewport();
  expect(await input.inputValue()).toBe(original);
  expect(await fs.readFile(projectFile, 'utf8')).toBe(initialFile);
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const targetLine = original.split('\n').findIndex(line => line === '# 段落：备用段落 12') + 1;
  await expect(rightWarning(11)).toContainText('文本第 ' + targetLine + ' 行');
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-key', /^unused_11\//);
  await page.screenshot({ path: path.join(output, 'text-warning-navigation.png') });
  checks.push('全部 12 条提醒均可滚动查看；点击第 12 条定位可见段落行、目录与预览，隐藏编号不影响行号。');

  phase = 'bottom diagnostics and live draft';
  await expect(page.locator('.problems-panel .diagnostic.warning')).toHaveCount(12);
  const bottom = page.locator('.problems-panel [data-node-id="unused_2"] .diagnostic-main');
  await bottom.focus(); await bottom.press('Enter');
  expect(await selectedText()).toBe('# 段落：备用段落 3');
  await expect(input).toBeVisible();
  await input.fill(original.replace('@跳转：结束', '@跳转：备用段落 1'));
  await expect(page.locator('.problems-panel .diagnostic.warning')).toHaveCount(0);
  await expect(page.locator('.problems-panel .diagnostic.warning')).toHaveCount(0);
  await input.press('Control+z'); await expect(input).toHaveValue(original);
  await expect(page.locator('.problems-panel .diagnostic.warning')).toHaveCount(12);
  await input.fill(original.replace('旁白：主线第 1 句。', '@不存在的指令：主线第 1 句。'));
  await page.locator('.problems-panel .diagnostic.error').first().click();
  expect(await selectedText()).toBe('@不存在的指令：主线第 1 句。');
  await input.press('Control+z'); await expect(input).toHaveValue(original);
  await page.getByRole('button', { name: '关闭问题面板', exact: true }).click();
  checks.push('底部列表支持键盘定位并保留文本模式；未应用的跳转修改即时更新问题提示，定位后仍可撤销，语法错误定位正确。');

  phase = 'cross-scene module navigation';
  await openStoryMode(page, 'script');
  await page.locator('.status-bar > button').first().click();
  await rightWarning(11).click();
  await expect(page.locator('#node-unused_11')).toHaveClass(/active/);
  await expect(page.locator('#node-unused_11')).toBeInViewport();
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-key', /^unused_11\//);
  await expect(input).toHaveCount(0);
  await page.getByRole('button', { name: '关闭问题面板', exact: true }).click();
  await expect(page.locator('.problems-panel')).toHaveCount(0);
  await page.locator('.status-bar > button').first().click();
  await expect(page.locator('.problems-panel .diagnostic.warning')).toHaveCount(12);
  await rightWarning(0).click();
  await page.screenshot({ path: path.join(output, 'module-warning-navigation.png') });
  checks.push('模块模式定位跨章节内容并选中对应模块；问题列表可收起和重新展开。');

  phase = 'entry meaning, persistence, and undo';
  await page.getByRole('button', { name: '故事入口：开场', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '作品设置', exact: true });
  await expect(settings).toContainText('冒号后的「开始」是段落名称');
  await expect(settings).toContainText('不要求添加 @开始');
  await settings.getByRole('combobox', { name: '故事入口', exact: true }).selectOption('unused_0');
  await page.screenshot({ path: path.join(output, 'entry-explanation.png') });
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '故事入口：备用段落 1', exact: true })).toBeVisible();
  expect((await save()).entryId).toBe('unused_0');
  await openStoryMode(page, 'text');
  expect(await input.inputValue()).toContain('@入口：备用段落 1');
  await input.press('Control+z');
  await expect(page.getByRole('button', { name: '故事入口：开场', exact: true })).toBeVisible();
  await expect(input).toHaveValue(original);
  checks.push('故事入口可直达作品设置，说明名称与流程起点的区别；改变入口同步到文本并保存，也可撤销。');

  phase = 'entry completion';
  await input.evaluate(element => { const input = element as HTMLTextAreaElement; input.focus(); input.setSelectionRange(1, 3); input.scrollTop = 0; input.dispatchEvent(new Event('select', { bubbles: true })); });
  await page.keyboard.type('rk');
  const completion = page.getByRole('listbox', { name: '文本补全建议' }).getByRole('option').filter({ hasText: /^入口/ });
  await expect(completion).toContainText('整部作品');
  await input.press('Tab');
  expect(await input.inputValue()).toContain('@入口：开场');
  await input.fill(original);
  await save();
  checks.push('入口指令支持拼音首字母补全并展示用途，补全保留目标名称。');

  phase = 'runtime locations and explanatory fallback';
  const runtimeIssues: Diagnostic[] = [
    { severity: 'error', message: '运行中的对白错误', nodeId: 'unused_11', lineId: 'unused_line_11' },
    { severity: 'error', message: '无法读取测试素材', assetId: 'test_asset' },
    { severity: 'error', message: '蓝图参数需要检查', nodeId: graph.nodes[0].id },
    { severity: 'warning', message: '作品检查示例' },
  ];
  await app.evaluate(({ BrowserWindow }, diagnostics) => BrowserWindow.getAllWindows()[0].webContents.send('studio:runtime', { kind: 'diagnostics', message: '', diagnostics }), runtimeIssues);
  await page.locator('.problems-panel .diagnostic-main').filter({ hasText: '运行中的对白错误' }).click();
  expect(await selectedText()).toBe('旁白：这是备用段落 12 的对白。');
  const beforeExplanation = await selectedText();
  await page.locator('.problems-panel .diagnostic-main').filter({ hasText: '作品检查示例' }).click();
  await expect(page.locator('.problems-panel .diagnostic-item').filter({ hasText: '作品检查示例' }).locator('.diagnostic-details')).toBeVisible();
  expect(await selectedText()).toBe(beforeExplanation);
  await page.locator('.problems-panel .diagnostic').filter({ hasText: '无法读取测试素材' }).click();
  await expect(input).toHaveCount(0);
  await expect(page.locator('.content-browser')).toBeVisible();
  await page.locator('.problems-panel .diagnostic').filter({ hasText: '蓝图参数需要检查' }).click();
  await expect(page.locator(`.react-flow__node[data-id="${graph.nodes[0].id}"]`)).toHaveClass(/selected/);
  await page.screenshot({ path: path.join(output, 'blueprint-diagnostic-navigation.png') });
  checks.push('运行时对白错误定位对应句子，素材和蓝图诊断切换到正确编辑区；没有具体位置的提示展开说明。');

  phase = 'reload and smaller window';
  await page.reload(); await openStoryMode(page, 'text');
  await page.locator('.status-bar > button').first().click();
  await expect(input).toHaveValue(original);
  await expect(page.locator('.problems-panel .diagnostic.warning')).toHaveCount(12);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800));
  await rightWarning(11).click();
  expect(await selectedText()).toBe('# 段落：备用段落 12');
  await expect(page.getByRole('button', { name: '故事入口：开场', exact: true })).toBeInViewport();
  await page.screenshot({ path: path.join(output, 'diagnostics-1280.png') });
  expect(errors).toEqual([]);
  const stored = await save();
  expect(stored.nodes).toEqual(initial.project.nodes);
  expect(stored.entryId).toBe(initial.project.entryId);
  const reparsed = applyTextScript(stored, stored.scriptText!.content);
  expect(reparsed.issues).toEqual([]);
  expect(reparsed.project.nodes).toEqual(initial.project.nodes);
  expect(compileProject(reparsed.project).files).toEqual(compileProject(initial.project).files);
  checks.push('保存重开保留完整剧情与连接；1280×800 下仍可查看全部提示并定位。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, packaged: false, userProjectModified: false }, null, 2));
  console.log(`PASS: ${checks.length} checks. ${output}`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2));
  console.error(error); console.log(output); process.exitCode = 1;
} finally { await app?.close(); await server.close(); }
