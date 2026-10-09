import { openStoryMode } from './lib/story-workspace';
import { _electron as electron, expect, type ElectronApplication } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type Project } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { textDocument } from '../src/core/text-document';
import { saveProject } from '../src/desktop/project-store';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts/text-document', new Date().toISOString().replaceAll(':', '-'));
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
const project = createProject('文本隐藏编号验证');
const voice = Buffer.alloc(844);
voice.write('RIFF'); voice.writeUInt32LE(836, 4); voice.write('WAVEfmt ', 8); voice.writeUInt32LE(16, 16); voice.writeUInt16LE(1, 20); voice.writeUInt16LE(1, 22); voice.writeUInt32LE(8000, 24); voice.writeUInt32LE(16000, 28); voice.writeUInt16LE(2, 32); voice.writeUInt16LE(16, 34); voice.write('data', 36); voice.writeUInt32LE(800, 40);
await fs.writeFile(path.join(directory, 'assets/voice.wav'), voice);
project.assets.push({ id: 'voice', name: '问候', kind: 'audio', category: 'voice', path: 'assets/voice.wav' });
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [
  { id: 'line_first', text: '第一句。', voiceId: 'voice', actions: [{ kind: 'shake', direction: 'horizontal' }] },
  { id: 'line_duplicate_one', text: '相同的对白。', actions: [] },
  { id: 'line_duplicate_two', text: '相同的对白。', actions: [] },
  { id: 'line_last', text: '最后一句。', actions: [] },
];
project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
await saveProject(projectFile, project);
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server.listen(); const address = server.httpServer!.address() as { port: number };
const env = Object.fromEntries(Object.entries({ ...process.env, VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: path.join(output, 'profile'), VNS_DEV_URL: `http://127.0.0.1:${address.port}` }).filter((entry): entry is [string, string] => entry[1] !== undefined));
delete env.ELECTRON_RUN_AS_NODE;
let app: ElectronApplication | undefined;
const checks: string[] = [], errors: string[] = [];
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 60000 });
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
  const tabs = page.locator('.view-tabs .tabs');
  await expect(tabs.locator('button')).toHaveText(['剧本', '演出', '蓝图', '界面', '素材', '角色', '状态']);
  await openStoryMode(page, 'text');
  const input = page.getByLabel('中文文本剧本', { exact: true });
  const original = textDocument(project.scriptText.content).text;
  await expect(input).toHaveValue(original);
  expect(await input.inputValue()).not.toContain('@对白标记');
  expect(await input.inputValue()).not.toMatch(/【[a-z][a-z0-9_]*】/);
  await expect(page.getByRole('button', { name: '文本编辑', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.text-code-gutter')).toBeVisible();
  await expect(page.locator('.code-token-heading').first()).toBeVisible();
  await expect(page.locator('.code-token-command').first()).toBeVisible();
  const select = async (text: string, length = 0) => input.evaluate((element, args) => {
    const textarea = element as HTMLTextAreaElement, start = textarea.value.indexOf(args.text);
    if (start < 0) throw new Error(`Missing text: ${args.text}`);
    textarea.focus({ preventScroll: true }); textarea.setSelectionRange(start, start + args.length);
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
    return start;
  }, { text, length });
  const saved = async () => {
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    return JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
  };
  const lines = (stored: Project) => {
    const parsed = applyTextScript(stored, stored.scriptText!.content);
    expect(parsed.issues.filter(issue => issue.severity === 'error')).toEqual([]);
    const node = parsed.project.nodes.find(node => node.id === passage.id)!;
    if (node.kind !== 'passage') throw new Error('Passage missing');
    return node.lines;
  };

  await select('旁白：第一句。', '旁白：第一句。'.length);
  await page.keyboard.insertText('旁白：直接在文本里修改后的第一句。');
  await expect(input).toHaveValue(original.replace('第一句。', '直接在文本里修改后的第一句。'));
  let stored = await saved();
  expect(stored.scriptText!.content).toContain('@对白标记：line_first');
  expect(lines(stored)[0]).toEqual({ ...passage.lines[0], text: '直接在文本里修改后的第一句。' });
  checks.push('日常正文没有对白标记；直接改写后，保存的工程仍保留原编号、配音和演出。');

  await openStoryMode(page, 'script');
  stored = await saved();
  const applied = stored.nodes.find(node => node.id === passage.id)!;
  expect(applied.kind === 'passage' && applied.lines[0]).toEqual(lines(stored)[0]);
  await openStoryMode(page, 'text');
  const beforeDelete = await input.inputValue();
  await select('旁白：相同的对白。', '旁白：相同的对白。\n'.length);
  await input.press('Delete');
  stored = await saved();
  expect(lines(stored).map(line => line.id)).toEqual(['line_first', 'line_duplicate_two', 'line_last']);
  await input.press('Control+z'); await expect(input).toHaveValue(beforeDelete);
  stored = await saved();
  expect(lines(stored).map(line => line.id)).toEqual(passage.lines.map(line => line.id));
  await input.press('Control+Shift+z');
  stored = await saved();
  expect(lines(stored).map(line => line.id)).toEqual(['line_first', 'line_duplicate_two', 'line_last']);
  await input.press('Control+z'); await expect(input).toHaveValue(beforeDelete);
  await saved();
  checks.push('文本与剧本切换保持数据一致；删除两句相同对白中的前一句后，原来的后一句编号不变，撤销和重做能恢复隐藏编号。');

  const lastOffset = await select('旁白：最后一句。');
  const lastLine = beforeDelete.slice(0, lastOffset).split('\n').length;
  // Native cursor movement lets React observe the selection set by the helper.
  await input.press('ArrowRight'); await input.press('ArrowLeft');
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-key', `${passage.id}/line_last`);
  await expect(page.locator('.preview-source-position')).toHaveText(`第 ${lastLine} 行`);
  await page.getByRole('button', { name: '模块编辑', exact: true }).click();
  await expect(page.locator('#line-line_last')).toHaveClass(/selected/);
  await page.locator('#line-line_last textarea').fill('在模块编辑中修改的末句。');
  await page.getByRole('button', { name: '文本编辑', exact: true }).click();
  await expect(input).toHaveValue(beforeDelete.replace('最后一句。', '在模块编辑中修改的末句。'));
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-key', `${passage.id}/line_last`);
  await input.press('Control+z'); await expect(input).toHaveValue(beforeDelete);
  await select('旁白：最后一句。');
  checks.push('剧本与文本合为一个工作区；模式切换保持当前对白，模块修改即时出现在文本模式，撤销使用同一份历史。');
  await page.keyboard.insertText('@背景：不存在的场景\n');
  await page.locator('.status-bar > button').first().click();
  const issue = page.locator('.problems-panel .diagnostic-main').filter({ hasText: '不存在的场景' }).first();
  await expect(issue).toContainText(`第 ${lastLine} 行`);
  await issue.click();
  expect(await input.evaluate(element => { const t = element as HTMLTextAreaElement; return t.value.slice(t.selectionStart, t.selectionEnd); })).toBe('@背景：不存在的场景');
  await page.getByRole('button', { name: '模块编辑', exact: true }).click();
  await expect(page.getByRole('button', { name: '文本编辑', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(issue).toBeVisible();
  await input.press('Control+z'); await expect(input).toHaveValue(beforeDelete);
  await page.getByRole('button', { name: '关闭问题面板', exact: true }).click();
  checks.push('光标预览显示正文行号，错误提示与点击定位指向隐藏编号后的正确可见行。');

  await input.press('Control+h');
  await page.getByLabel('查找内容', { exact: true }).fill('相同的对白');
  await page.getByLabel('替换为', { exact: true }).fill('查找替换后的对白');
  await expect(page.locator('.text-find-row small')).toHaveText('2 处');
  await page.getByRole('button', { name: '全部替换', exact: true }).click();
  await expect(input).toHaveValue(beforeDelete.replaceAll('相同的对白', '查找替换后的对白'));
  stored = await saved();
  expect(lines(stored).map(line => line.id)).toEqual(passage.lines.map(line => line.id));
  expect(lines(stored)[0].voiceId).toBe('voice');
  await input.press('Control+z'); await expect(input).toHaveValue(beforeDelete);
  await page.getByRole('button', { name: '关闭查找', exact: true }).click();
  await select('@震动：横向'); await input.press('Tab');
  await expect(input).toHaveValue(beforeDelete.replace('@震动：横向', '  @震动：横向'));
  await input.press('Control+z'); await expect(input).toHaveValue(beforeDelete);
  checks.push('IDE 行号、语法颜色、Ctrl+H 批量替换和 Tab 缩进正常；批量编辑保留内部引用、配音和对白编号，并可一步撤销。');

  await select('旁白：最后一句。');
  await page.keyboard.insertText('旁白：在末句之前新插入一行。\n');
  stored = await saved();
  const inserted = lines(stored);
  expect(inserted.at(-1)).toEqual(passage.lines.at(-1));
  expect(passage.lines.some(line => line.id === inserted.at(-2)?.id)).toBe(false);
  const beforeReload = await input.inputValue();
  await page.reload();
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await openStoryMode(page, 'text');
  await expect(input).toHaveValue(beforeReload);
  expect(await input.inputValue()).not.toContain('@对白标记');
  await page.screenshot({ path: path.join(output, 'clean-text.png') });
  expect(errors).toEqual([]);
  checks.push('粘贴新对白不会挪用原来的编号；保存并重新打开后保持简洁正文和全部已有配音、演出。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
  console.log(`PASS: ${checks.length} checks. ${output}`);
} catch (error) {
  if (app) await app.firstWindow().then(page => page.screenshot({ path: path.join(output, 'failure.png') })).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, errors, error: String(error) }, null, 2));
  console.error(error); console.log(output); process.exitCode = 1;
} finally { await app?.close(); await server.close(); }
