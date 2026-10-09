import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type Project } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { compileProject } from '../src/runtime/compiler';
import { saveProject } from '../src/desktop/project-store';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts/text-structure', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
const authored = `@入口：出发【departure】
# 章节：第一章【chapter_first】
# 小章节：门外【scene_outside】
# 段落：出发【departure】
${Array.from({ length: 60 }, (_, index) => `旁白：第 ${index + 1} 句，沿着河岸走向城门。`).join('\n')}\n\n# 章节：第二章【chapter_second】\n# 小章节：归城【scene_home】\n# 段落：抵达【arrival】\n旁白：终于抵达了归城的渡口。\n# 段落：天亮【ending】\n@返回标题界面\n`;
const initial = applyTextScript(createProject('目录与统一跳转验证'), authored);
expect(initial.issues).toEqual([]);
await saveProject(projectFile, initial.project);
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
  await expect(page.getByRole('button', { name: '添加小章节', exact: true })).toBeVisible();
  expect(original).toContain('# 小章节：归城');
  expect(original).not.toContain('【');
  const select = async (marker: string, length = 0) => {
    const offset = await input.evaluate((element, { marker, length }) => {
      const textarea = element as HTMLTextAreaElement;
      const offset = textarea.value.indexOf(marker);
      if (offset < 0) throw new Error(`Missing marker: ${marker}`);
      textarea.focus({ preventScroll: true }); textarea.setSelectionRange(offset, offset + length);
      textarea.scrollTop = Math.max(0, (textarea.value.slice(0, offset).split('\n').length - 6) * parseFloat(getComputedStyle(textarea).lineHeight));
      textarea.dispatchEvent(new Event('select', { bubbles: true })); textarea.dispatchEvent(new Event('scroll', { bubbles: true }));
      return offset;
    }, { marker, length });
    if (!length) { await input.press('ArrowRight'); await input.press('ArrowLeft'); }
    return offset;
  };
  const save = async () => {
    await page!.getByRole('button', { name: '保存工程', exact: true }).click();
    await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    return JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
  };

  phase = 'heading completion';
  await select('\n# 章节：第二章');
  await page.keyboard.type('#xzj');
  await expect(page.getByRole('listbox', { name: '文本补全建议' }).getByRole('option', { name: /小章节/ })).toBeVisible();
  await input.press('Tab');
  expect(await input.inputValue()).toContain('# 小章节：\n# 章节：第二章');
  await input.fill(original);
  checks.push('目录使用章节、小章节、段落；输入 # 和拼音首字母可补全目录声明。');

  phase = 'jump insertion and undo';
  await select('\n# 章节：第二章');
  const scrollBefore = await input.evaluate(element => element.scrollTop);
  await page.keyboard.type('/');
  const palette = page.getByRole('dialog', { name: '中文指令面板', exact: true });
  await expect(palette).toBeVisible();
  const beforeInsertion = await input.inputValue();
  for (const old of ['切换场景', '接下来', '目标']) await expect(palette.getByRole('button', { name: old, exact: true })).toHaveCount(0);
  await palette.getByRole('button', { name: '跳转', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '命令参数', exact: true });
  const destination = picker.getByRole('combobox', { name: '目标目录项', exact: true });
  expect(await destination.locator('optgroup').evaluateAll(groups => groups.map(group => group.getAttribute('label')))).toEqual(['章节', '小章节', '段落']);
  await destination.selectOption('chapter_second');
  await picker.getByLabel('跳转过渡', { exact: true }).selectOption('fade');
  await picker.getByLabel('过渡秒数', { exact: true }).fill('0.3');
  await picker.getByLabel('过渡颜色', { exact: true }).fill('#112233');
  await page.screenshot({ path: path.join(output, 'jump-picker.png') });
  await picker.getByRole('button', { name: '插入指令', exact: true }).click();
  const inserted = await input.inputValue();
  expect(inserted).toContain('@跳转：第二章-切换方式-淡入淡出-参数：时长=0.3，颜色=#112233');
  expect(inserted).not.toContain('【');
  expect(Math.abs(await input.evaluate(element => element.scrollTop) - scrollBefore)).toBeLessThan(50);
  await input.press('Control+z'); await expect(input).toHaveValue(beforeInsertion);
  await input.press('Control+Shift+z'); await expect(input).toHaveValue(inserted);
  checks.push('斜杠菜单统一为跳转，目标按三级目录分组；插入过渡参数后保持滚动位置，一次撤销与重做恢复整条指令。');

  phase = 'target completion and persistence';
  await select('第二章-切换方式', '第二章'.length);
  await page.keyboard.type('gc');
  await expect(page.getByRole('listbox', { name: '文本补全建议' }).getByRole('option', { name: /归城/ }).first()).toBeVisible();
  await input.press('Tab');
  expect(await input.inputValue()).toContain('@跳转：归城-切换方式-淡入淡出-参数：时长=0.3，颜色=#112233');
  await expect(page.locator('.text-issue.error')).toHaveCount(0);
  let stored = await save();
  expect(stored.scriptText!.content).toContain('@跳转：归城【scene_home】-切换方式-淡入淡出');
  const parsed = applyTextScript(stored, stored.scriptText!.content);
  expect(parsed.issues).toEqual([]);
  const jump = parsed.project.nodes.find(node => node.kind === 'jump');
  expect(jump?.kind === 'jump' && jump.target).toBe('arrival');
  expect(jump?.kind === 'jump' && jump.sceneTransition?.duration).toBe(.3);
  checks.push('目标支持拼音补全；替换目标保留过渡参数，保存的隐藏引用明确指向小章节及其实际入口。');

  phase = 'directory and shared editor';
  await page.locator('.story-directory .scene-row > button').filter({ hasText: '归城' }).click();
  await page.locator('.story-directory .tree-node').filter({ hasText: '抵达' }).click();
  expect(await input.evaluate(element => { const textarea = element as HTMLTextAreaElement; return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd); })).toBe('旁白：终于抵达了归城的渡口。');
  const arrival = parsed.project.nodes.find(node => node.id === 'arrival');
  if (arrival?.kind !== 'passage') throw new Error('Missing arrival passage');
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-key', `arrival/${arrival.lines[0].id}`);
  await page.getByRole('button', { name: '模块编辑', exact: true }).click();
  await page.locator(`#line-${arrival.lines[0].id} textarea`).fill('终于抵达了归城的渡口，天快亮了。');
  await page.getByRole('button', { name: '文本编辑', exact: true }).click();
  expect(await input.inputValue()).toContain('终于抵达了归城的渡口，天快亮了。');
  await input.press('Control+z');
  expect(await input.inputValue()).not.toContain('天快亮了。');
  stored = await save();
  const beforeReload = await input.inputValue();
  const runtime = compileProject(applyTextScript(stored, stored.scriptText!.content).project).files;
  await page.reload(); await openStoryMode(page, 'text');
  await expect(input).toHaveValue(beforeReload);
  const reloaded = await save();
  expect(compileProject(applyTextScript(reloaded, reloaded.scriptText!.content).project).files).toEqual(runtime);
  await expect(page.locator('.text-issue.error')).toHaveCount(0);
  checks.push('目录选择定位真实对白，模块与文本共用预览和撤销；保存、重新打开后连接和运行脚本保持一致。');

  phase = 'unlabeled operation navigation';
  const newSource = beforeReload.replace('旁白：终于抵达了归城的渡口。', '旁白：终于抵达了归城的渡口。\n@设置：谨慎 += 1');
  await input.fill(newSource);
  await page.locator('.story-directory .scene-row > button').filter({ hasText: '归城' }).click();
  await page.locator('.story-directory .tree-node').filter({ hasText: '修改 谨慎' }).click();
  expect(await input.evaluate(element => { const textarea = element as HTMLTextAreaElement; return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd); })).toBe('@设置：谨慎 += 1');
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-key', /^[a-z][a-z0-9_]*\/$/);
  checks.push('直接填写的流程指令也可从目录定位，光标与目录选择保持在对应流程节点。');
  await page.screenshot({ path: path.join(output, 'text-structure.png') });
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, packaged: false }, null, 2));
  console.log(`PASS: ${checks.length} checks. ${output}`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2));
  console.error(error); console.log(output); process.exitCode = 1;
} finally { await app?.close(); await server.close(); }
