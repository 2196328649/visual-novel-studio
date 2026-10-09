import { openContentFilters } from './lib/ui-disclosures';
import { openStoryMode } from './lib/story-workspace';
import { _electron as electron, expect, type ElectronApplication } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, type Project } from '../src/core/model';
import { organizeAssetLibrary, assetGroupPath } from '../src/core/asset-library';
import { projectToText } from '../src/core/text-script';
import { textDocument } from '../src/core/text-document';
import { saveProject } from '../src/desktop/project-store';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts/resource-workspace', new Date().toISOString().replaceAll(':', '-'));
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
const project = createProject('资源与文本回归验证');
function wav(sample: number) {
  const data = Buffer.alloc(44 + 800); data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(800, 40); data.fill(sample, 44); return data;
}
for (const [id, name, category, sourcePath] of [['background', '方院背景', 'scene', '方院.png'], ['ui', '对白底框', 'ui', '对话/底框.png'], ['portrait', '通常', 'portrait', '苏怜烟/通常.png'], ['bgm', '章节音乐', 'bgm', '章节.wav'], ['voice', '问候', 'voice', '苏怜烟/问候.wav'], ['sound', '开门', 'sound', '环境/开门.wav']] as const) {
  const audio = ['bgm', 'voice', 'sound'].includes(category), relative = `assets/${id}.${audio ? 'wav' : 'png'}`;
  if (audio) await fs.writeFile(path.join(directory, relative), wav(id.length));
  else { const image = new PNG({ width: 128, height: 96 }); for (let i = 0; i < image.data.length; i += 4) { image.data[i] = 70 + id.length * 8; image.data[i + 1] = 95; image.data[i + 2] = 105; image.data[i + 3] = 255; } await fs.writeFile(path.join(directory, relative), PNG.sync.write(image)); }
  project.assets.push({ id, name, kind: audio ? 'audio' : 'image', category, path: relative, sourcePath, ...(!audio ? { width: 128, height: 96 } : {}) });
}
project.characters = [{ id: 'su', name: '苏怜烟', color: '#83bda6', expressions: [{ id: 'expression', name: '通常', assetId: 'portrait' }] }];
project.variables = [{ id: 'favor', name: '好感度', type: 'number', initial: 0, persistent: false }];
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = Array.from({ length: 160 }, (_, index) => ({ id: `line_${index}`, text: `第${String(index).padStart(3, '0')}句：在长篇剧本中插入指令，光标和滚动位置应保持稳定。`, actions: [] }));
passage.lines[0].actions = [{ kind: 'background', assetId: 'background', transition: 'none' }];
organizeAssetLibrary(project); project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
const original = textDocument(project.scriptText.content).text;
await saveProject(projectFile, project);
const dropFile = path.join(output, '拖入的配音.wav'); await fs.writeFile(dropFile, wav(21));
const folderSource = path.join(output, '配音'); await fs.mkdir(path.join(folderSource, '苏怜烟', '第二章'), { recursive: true });
await fs.writeFile(path.join(folderSource, '苏怜烟', '第二章', '002.wav'), wav(22));
await fs.writeFile(path.join(folderSource, '说明.txt'), 'non-asset');
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server.listen(); const address = server.httpServer!.address() as { port: number };
const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: path.join(output, 'profile'), VNS_DEV_URL: `http://127.0.0.1:${address.port}` }).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
let app: ElectronApplication | undefined;
const checks: string[] = [], errors: string[] = [];
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 60000 });
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
  const tabs = page.locator('.view-tabs .tabs');
  await expect(tabs.locator('button')).toHaveText(['剧本', '蓝图', '界面', '素材', '角色', '状态']);
  await page.getByRole('button', { name: '收起剧情目录', exact: true }).click();
  await expect(page.locator('.story-directory')).toHaveCount(0);
  await tabs.getByRole('button', { name: '角色', exact: true }).click(); await expect(page.getByLabel('搜索角色', { exact: true })).toBeVisible();
  await tabs.getByRole('button', { name: '状态', exact: true }).click(); await expect(page.locator('.variables-table')).toBeVisible();
  await tabs.getByRole('button', { name: '界面', exact: true }).click(); await expect(page.locator('.story-directory-rail')).toHaveCount(0);
  await openStoryMode(page, 'text'); await expect(page.locator('.story-directory')).toHaveCount(0);
  await page.getByRole('button', { name: '展开剧情目录', exact: true }).click();
  await expect(page.locator('.story-directory')).toBeVisible();
  checks.push('七个工作区位于同一标签栏；剧本的模块、文本两种模式共用剧情目录和折叠状态。');

  const source = page.getByLabel('中文文本剧本', { exact: true });
  await page.locator('.story-directory .tree-node').last().click();
  expect(await source.evaluate(element => { const input = element as HTMLTextAreaElement; return input.value.slice(input.selectionStart, input.selectionEnd); })).toContain('# 段落：结局');
  const positionAt = async (marker: string) => source.evaluate((element, marker) => {
    const input = element as HTMLTextAreaElement, offset = input.value.indexOf(marker);
    if (offset < 0) throw new Error('Marker missing');
    input.focus({ preventScroll: true }); input.setSelectionRange(offset, offset);
    input.scrollTop = input.value.slice(0, offset).split('\n').length * parseFloat(getComputedStyle(input).lineHeight) - 180;
    input.dispatchEvent(new Event('select', { bubbles: true })); input.dispatchEvent(new Event('scroll', { bubbles: true }));
    return { offset, top: input.scrollTop, left: input.scrollLeft };
  }, marker);
  const position = await positionAt('旁白：第080句');
  await page.locator('.text-editor-toolbar').getByRole('button', { name: '插入指令', exact: true }).click();
  await page.getByRole('button', { name: '等待', exact: true }).click(); await page.getByLabel('秒数', { exact: true }).fill('0.75');
  await page.getByRole('dialog', { name: '命令参数' }).getByRole('button', { name: '插入指令', exact: true }).click();
  const inserted = original.slice(0, position.offset) + '@等待：0.75\n' + original.slice(position.offset);
  await expect(source).toHaveValue(inserted);
  await expect.poll(() => source.evaluate(element => (element as HTMLTextAreaElement).scrollTop)).toBeCloseTo(position.top, 0);
  expect(await source.evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(position.offset + '@等待：0.75\n'.length);
  await source.press('Control+z'); await expect(source).toHaveValue(original);
  await expect.poll(() => source.evaluate(element => (element as HTMLTextAreaElement).scrollTop)).toBeCloseTo(position.top, 0);
  await source.press('Control+Shift+z'); await expect(source).toHaveValue(inserted);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(source).toHaveValue(original);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(source).toHaveValue(inserted);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(source).toHaveValue(original);
  const slashPosition = await positionAt('旁白：第110句'); await source.press('/');
  await page.getByRole('button', { name: '等待', exact: true }).click();
  await page.getByRole('dialog', { name: '命令参数' }).getByRole('button', { name: '插入指令', exact: true }).click();
  await expect.poll(() => source.evaluate(element => (element as HTMLTextAreaElement).scrollTop)).toBeCloseTo(slashPosition.top, 0);
  await source.press('Control+z'); await expect(source).toHaveValue(original.slice(0, slashPosition.offset) + '/' + original.slice(slashPosition.offset));
  await source.press('Control+z'); await expect(source).toHaveValue(original);
  await page.screenshot({ path: path.join(output, 'text-scroll-undo.png') });
  checks.push('长文本中间通过工具栏、斜杠插入均保持光标和滚动位置；键盘及顶部按钮可撤销、重做，指令与输入分开撤销。');

  await positionAt('旁白：第080句');
  await page.locator('.text-editor-toolbar').getByRole('button', { name: '插入指令', exact: true }).click(); await page.getByRole('button', { name: '配音', exact: true }).click();
  await expect(page.getByLabel('配音素材', { exact: true }).locator('option')).toHaveText(['选择音频', '问候']);
  await expect(page.getByLabel('配音素材', { exact: true }).locator('optgroup')).toHaveAttribute('label', '配音 / 苏怜烟');
  await page.getByRole('button', { name: '浏览配音素材', exact: true }).click();
  await expect(page.getByLabel('可选素材分类')).toHaveValue('voice');
  await expect(page.locator('.asset-picker-group h3')).toHaveText(['配音 / 苏怜烟']);
  await expect(page.locator('.asset-picker-grid')).not.toContainText('章节音乐');
  await page.getByRole('button', { name: '预览资源 问候', exact: true }).click(); await expect(page.getByLabel('试听 问候')).toBeVisible();
  await page.screenshot({ path: path.join(output, 'voice-picker.png') });
  await page.getByRole('button', { name: '关闭资源浏览器', exact: true }).click(); await page.getByRole('button', { name: '关闭参数面板', exact: true }).click();
  checks.push('配音指令只列出配音，按“配音 / 苏怜烟”分组；弹窗可试听且不混入 BGM。');

  await tabs.getByRole('button', { name: '素材', exact: true }).click();
  await expect(page.locator('.content-workspace')).toBeVisible(); await expect(page.locator('.story-directory')).toHaveCount(0);
  await openContentFilters(page);await page.getByLabel('资源分类筛选').selectOption('bgm'); await expect(page.locator('.content-item:not(.folder-item)')).toHaveCount(1);
  await expect(page.locator('.content-item:not(.folder-item)')).toHaveAttribute('data-content-key', 'asset:bgm');
  await page.locator('[data-content-key="asset:bgm"]').dblclick();
  await expect(page.getByRole('dialog', { name: '资源详情 章节音乐' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '资源详情 章节音乐' }).locator('audio')).toBeVisible();
  await page.getByRole('button', { name: '关闭资源预览', exact: true }).click();
  await page.getByRole('navigation', { name: '资源文件夹' }).getByRole('button', { name: '配音', exact: true }).click();
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'native-file-source'; input.hidden = true; document.body.append(input); });
  await page.locator('#native-file-source').setInputFiles(dropFile);
  const nativePath = await page.evaluate(() => { const file = (document.getElementById('native-file-source') as HTMLInputElement).files![0]; const sourcePath = window.studio!.pathForFile!(file); const dataTransfer = new DataTransfer(); dataTransfer.items.add(file); document.querySelector('.content-items')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })); return sourcePath; });
  expect(path.resolve(nativePath)).toBe(path.resolve(dropFile));
  await expect(page.locator('.status-message')).toContainText('已导入 1 项');
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  const saved = async (): Promise<Project> => JSON.parse(await fs.readFile(projectFile, 'utf8'));
  await expect.poll(async () => (await saved()).assets.length).toBe(7);
  const dropped = (await saved()).assets.find(asset => asset.name === '拖入的配音')!; expect(dropped.category).toBe('voice'); expect(await fs.readFile(path.join(directory, dropped.path))).toEqual(await fs.readFile(dropFile));
  const cdp = await page.context().newCDPSession(page);
  const dropArea = (await page.locator('.content-items').boundingBox())!;
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) await cdp.send('Input.dispatchDragEvent', { type, x: dropArea.x + 60, y: dropArea.y + 180, data: { items: [], files: [folderSource], dragOperationsMask: 1 } });
  await cdp.detach();
  await expect(page.locator('.status-message')).toContainText('忽略 1 个非素材文件');
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect.poll(async () => (await saved()).assets.length).toBe(8);
  const importedProject = await saved(), nested = importedProject.assets.find(asset => asset.name === '002')!;
  expect(assetGroupPath(importedProject, nested)).toBe('配音 / 苏怜烟 / 第二章');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folderSource);
  await page.getByRole('button', { name: '导入文件夹（保留子文件夹）', exact: true }).click(); await expect(page.locator('.status-message')).toContainText('跳过 1 项重复素材');
  checks.push('Electron 真实磁盘 File 拖放，以及 CDP 原生目录拖放均经 preload 和 IPC 复制成功；保留两层角色目录，文件夹按钮跳过重复与非素材文件，保存后数据完整。');
  for (const width of [1024, 1280, 1600]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator('.content-main').boundingBox())!.width).toBeGreaterThan(350);
    await page.screenshot({ path: path.join(output, `resources-${width}.png`) });
  }
  expect(errors).toEqual([]); checks.push('1024、1280、1600 宽度下标签栏和资源工作区没有页面横向溢出。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
  console.log(`PASS: ${checks.length} checks. ${output}`);
} catch (error) {
  if (app) await app.firstWindow().then(page => page.screenshot({ path: path.join(output, 'failure.png') })).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, errors, error: String(error) }, null, 2));
  console.error(error); console.log(output); process.exitCode = 1;
} finally { await app?.close(); await server.close(); }
