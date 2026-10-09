import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type Project } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { validateProject } from '../src/core/validate';
import { saveProject } from '../src/desktop/project-store';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts/performance-workspace', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
const templateRoot = path.join(root, 'resources/templates/aihong');
const template = JSON.parse(await fs.readFile(path.join(templateRoot, 'project.vns.json'), 'utf8')) as Project;
const base = createProject('隐藏演出与可视化制作验证');
base.playerDefaults = { masterVolume: 0 };
base.ui.chapterTransition = structuredClone(template.ui.chapterTransition);
const names = ['章节进场 · 夜宴庭院', '章节题字 · 记第一回 醉梦', '花街柳巷'];
const masks = Object.values(base.ui.chapterTransition ?? {}).filter(value => typeof value === 'string');
for (const asset of template.assets.filter(asset => names.includes(asset.name) || masks.includes(asset.id))) {
  const file = path.join(path.dirname(projectFile), asset.path);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.copyFile(path.join(templateRoot, asset.path), file);
  base.assets.push(structuredClone(asset));
}
const button = { id: 'inventory_button', name: '打开背包', text: '背包', kind: 'button' as const, page: 'say' as const, x: .8, y: .1, width: .12, height: .08 };
base.ui.components.push(button);
base.ui.instances = [{ id: 'night_ui', name: '夜间界面', components: [{ ...button, name: '夜间背包' }] }];
base.ui.activeInstanceId = 'night_ui';
base.ui.customPages = [{ id: 'inventory_page', name: '背包页面', modal: true, components: [{ ...button, id: 'close_inventory', name: '关闭背包', page: 'custom', text: '关闭' }] }];
const source = `@入口：章节入场【opening】
@界面实例：夜间界面【night_ui】
# 章节：第一章【chapter_one】
# 小章节：夜宴【scene_one】
# 段落：章节入场【opening】
@章节标题：第一章 · 城破｜夜宴｜1.2
@章节背景：章节进场 · 夜宴庭院
@章节题图：章节题字 · 记第一回 醉梦
@章节配乐：花街柳巷
@章节动效：笔触消散
@跳转：正文【passage】
# 段落：正文【passage】
@对白标记：first_line
@背景：章节进场 · 夜宴庭院
@背景音乐：花街柳巷 循环
@震动：横向，0.6，20，否
旁白：相同的台词。
@对白标记：second_line
@等待：0.25
旁白：相同的台词。
@对白标记：last_line
@镜头：0.1，0.2，1.2，0.2，15，匀速，否
旁白：最后一句。
${Array.from({ length: 35 }, (_, index) => `@对白标记：extra_${index}\n旁白：用于检查滚动位置的第 ${index + 1} 句。`).join('\n')}\n@跳转：结束【ending】\n# 段落：结束【ending】\n@返回标题界面`;
const parsed = applyTextScript(base, source);
expect(parsed.issues).toEqual([]);
parsed.project.scriptText = { format: 'vns-text-1', content: source };
expect(validateProject(parsed.project).filter(issue => issue.severity === 'error')).toEqual([]);
await saveProject(projectFile, parsed.project);
const originalFile = await fs.readFile(projectFile, 'utf8');
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
  await expect(page.locator('.project-title strong')).toHaveText(parsed.project.name, { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 980));
  await openStoryMode(page, 'text');
  const input = page.getByLabel('中文文本剧本', { exact: true });
  const original = await input.inputValue();
  const selectText = async (text: string, occurrence = 0, includeNewline = false) => {
    await input.evaluate((element, data) => {
      const input = element as HTMLTextAreaElement;
      let at = input.value.indexOf(data.text);
      for (let index = 0; index < data.occurrence; index++) at = input.value.indexOf(data.text, at + 1);
      if (at < 0) throw new Error(`Missing text: ${data.text}`);
      input.focus({ preventScroll: true }); input.setSelectionRange(at, at + data.text.length + (data.includeNewline ? 1 : 0));
      input.scrollTop = Math.max(0, (input.value.slice(0, at).split('\n').length - 1) * 22 - 170);
      input.dispatchEvent(new Event('select', { bubbles: true }));
    }, { text, occurrence, includeNewline });
  };
  const caret = async (text: string) => { await selectText(text); await input.press('ArrowLeft'); };
  const save = async () => { await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); const stored = JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project; const applied = applyTextScript(stored, stored.scriptText!.content); expect(applied.issues).toEqual([]); return applied.project; };
  const line = (project: Project, id: string) => project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []).find(line => line.id === id)!;
  const openProblems = async () => { if (!await page!.locator('.problems-panel').count()) await page!.locator('.status-bar > button').first().click(); };
  const closeProblems = async () => { if (await page!.locator('.problems-panel').count()) await page!.getByRole('button', { name: '关闭问题面板', exact: true }).click(); };

  phase = 'hide projection and pinned preview';
  await caret('旁白：相同的台词。');
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-key', 'passage/first_line');
  await page.getByRole('button', { name: '隐藏演出', exact: true }).click();
  const hidden = await input.inputValue();
  expect(hidden).not.toMatch(/@背景|@等待|@震动|@镜头|@章节背景/);
  expect(hidden).toContain('@章节标题'); expect(hidden).toContain('@跳转');
  await expect(page.locator('.text-issue-list, .text-parse-status')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '所选段落演出', exact: true })).toBeVisible();
  await expect(page.locator('.passage-performance-line[data-line-id="first_line"] .line-effect-chip')).toHaveCount(3);
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  expect(await fs.readFile(projectFile, 'utf8')).toBe(originalFile);
  await page.getByLabel('跟随光标', { exact: true }).uncheck();
  await caret('旁白：最后一句。');
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-key', 'passage/first_line');
  await expect(page.locator('.passage-performance-line.active')).toHaveAttribute('data-line-id', 'first_line');
  await page.getByLabel('跟随光标', { exact: true }).check();
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-key', 'passage/last_line');
  checks.push('隐藏开关不改动工程；章节保留入口，预览和演出侧栏共同遵循跟随/固定选择。');

  phase = 'side parameters and play';
  await caret('旁白：相同的台词。');
  await page.locator('.passage-performance-line[data-line-id="first_line"]').getByRole('button', { name: /^编辑震动/ }).click();
  const shake = page.getByRole('region', { name: '编辑震动', exact: true });
  const amplitude = shake.getByRole('spinbutton').nth(1);
  await amplitude.fill(''); await expect(amplitude).toHaveValue(''); await amplitude.fill('45');
  const firstEdited = await save();
  expect(line(firstEdited, 'first_line').actions.find(action => action.kind === 'shake')?.amplitude).toBe(45);
  expect(await input.inputValue()).toBe(hidden);
  await page.getByRole('button', { name: '播放预览', exact: true }).click();
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-phase', /actions|dialogue/);
  await page.getByRole('button', { name: '停止预览', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'hidden-performance-sidebar.png') });
  await input.focus(); await input.press('Control+z');
  expect(line(await save(), 'first_line').actions.find(action => action.kind === 'shake')?.amplitude).toBe(20);
  checks.push('侧栏演出可展开调参、清空重输数值、播放与停止；原文保持隐藏，修改可撤销。');

  phase = 'edit and delete duplicate dialogue';
  await selectText('旁白：相同的台词。', 1);
  await page.keyboard.insertText('旁白：第二句改写。');
  const rewritten = await save();
  expect(line(rewritten, 'second_line').text).toBe('第二句改写。');
  expect(line(rewritten, 'second_line').actions).toEqual(line(parsed.project, 'second_line').actions);
  expect(line(rewritten, 'first_line')).toEqual(line(parsed.project, 'first_line'));
  await input.press('Control+z'); await expect(input).toHaveValue(hidden);
  await selectText('旁白：相同的台词。', 0, true); await input.press('Backspace');
  const deleted = await save(); expect(line(deleted, 'first_line')).toBeUndefined();
  expect(line(deleted, 'second_line')).toEqual(line(parsed.project, 'second_line'));
  await input.press('Control+z'); await expect(input).toHaveValue(hidden);
  checks.push('相同对白中的整句改写和整行删除操作命中正确台词，保留其他演出，Ctrl+Z 一次恢复。');

  phase = 'new command completion and caret';
  await caret('旁白：最后一句。');
  await page.keyboard.insertText('@等待：');
  expect(await input.inputValue()).toContain('@等待：旁白：最后一句。');
  await input.press('Control+z'); await expect(input).toHaveValue(hidden);
  await caret('旁白：最后一句。');
  await page.getByRole('button', { name: '插入指令', exact: true }).click();
  const palette = page.getByRole('dialog', { name: '中文指令面板' });
  await palette.getByLabel('筛选中文指令').fill('等待');
  await palette.getByRole('button').filter({ hasText: /^等待/ }).click();
  await page.getByRole('button', { name: '插入指令', exact: true }).last().click();
  await expect(input).toBeFocused();
  expect((await save()).scriptText!.content).toContain('@等待');
  const selectedRow = await input.evaluate(element => { const input = element as HTMLTextAreaElement; return input.value.slice(0, input.selectionStart).split('\n').length; });
  expect(selectedRow).toBeLessThan(hidden.split('\n').length - 20);
  await input.press('Control+z'); await expect(input).toHaveValue(hidden);
  checks.push('隐藏模式仍支持插入指令与未完成输入，保留编辑位置和撤销。');

  phase = 'diagnostic locations';
  await save(); await openProblems();
  const problems = page.locator('.problems-panel');
  await expect(problems.locator('[data-code="ui.button.unbound"]')).toHaveCount(3);
  const customWarning = problems.locator('[data-component-id="close_inventory"]');
  await expect(customWarning).toContainText('背包页面 / 自定义页面 / 关闭背包');
  await customWarning.locator('.diagnostic-main').click();
  await expect(page.locator('.ui-hierarchy-row[data-hierarchy-id="close_inventory"]')).toHaveClass(/selected/);
  await expect(page.locator('.inspector').getByLabel('控件名称', { exact: true })).toHaveValue('关闭背包');
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const themeWarning = problems.locator('[data-component-id="inventory_button"]:not([data-ui-instance-id])');
  await themeWarning.locator('.diagnostic-main').click();
  await expect(page.locator('.ui-hierarchy-row[data-hierarchy-id="inventory_button"]')).toHaveClass(/selected/);
  await expect(page.getByLabel('选择界面实例', { exact: true })).toHaveValue('');
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  await expect(page.getByLabel('点击行为', { exact: true })).toBeFocused();
  await page.getByLabel('点击行为', { exact: true }).selectOption('history');
  const repairedUi = await save();
  expect(repairedUi.ui.components.find(component => component.id === 'inventory_button')?.action).toBe('history');
  expect(repairedUi.ui.instances![0].components[0].action).toBeUndefined();
  expect(repairedUi.ui.activeInstanceId).toBe('night_ui');
  await expect(themeWarning).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(themeWarning).toHaveCount(1);
  const override = problems.locator('[data-component-id="inventory_button"][data-ui-instance-id="night_ui"]');
  await override.locator('.diagnostic-main').click();
  await expect(page.getByLabel('选择界面实例', { exact: true })).toHaveValue('night_ui');
  expect((await save()).ui.activeInstanceId).toBe('night_ui');
  await closeProblems();
  await page.screenshot({ path: path.join(output, 'ui-diagnostic-control.png') });
  checks.push('问题集中于左下角；按钮警告区分自定义页、主题默认和实例覆盖，点击定位页面及层级，检查不会更改游戏使用的实例。');

  phase = 'chapter workspace parameter editing';
  await openStoryMode(page, 'text');
  await caret('@章节标题');
  await input.dispatchEvent('contextmenu', { clientX: 460, clientY: 160 });
  await page.getByRole('menuitem', { name: '在演出工作区编辑…', exact: true }).click();
  await expect(page.getByRole('region', { name: '演出工作区', exact: true })).toBeVisible();
  await expect(page.locator('.chapter-preview.is-static')).toBeVisible();
  await page.getByRole('spinbutton', { name: '章节时长（秒）', exact: true }).fill('1.8');
  const chapterSaved = await save();
  const chapter = chapterSaved.nodes.find(node => node.id === 'opening'); expect(chapter?.kind === 'chapterTitle' && chapter.duration).toBe(1.8);
  expect(chapterSaved.scriptText!.content.slice(chapterSaved.scriptText!.content.indexOf('# 段落：正文'))).toBe(source.slice(source.indexOf('# 段落：正文')));
  await page.getByText('章节蒙板与渐变素材 · 全作品', { exact: true }).click();
  await expect(page.getByLabel('渐变纹理', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '播放预览', exact: true }).click();
  await expect(page.locator('.chapter-preview.is-playing')).toBeVisible();
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-phase', 'finished', { timeout: 7000 });
  await page.screenshot({ path: path.join(output, 'chapter-performance-workspace.png') });
  checks.push('章节指令直接进入独立演出工作区，可调标题、时长和素材并预览蒙板渐变，保留其他段落原文。');

  phase = 'chapter encapsulation and graph preview';
  await page.getByRole('button', { name: '封装为蓝图…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '封装演出为蓝图', exact: true });
  await dialog.getByLabel('蓝图名称', { exact: true }).fill('城破入场演出');
  for (const checkbox of await dialog.getByRole('checkbox').all()) await checkbox.uncheck();
  await dialog.getByRole('button', { name: '封装并替换选中演出', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.performance-authoring.graph .react-flow')).toBeVisible();
  const converted = await save();
  const graph = converted.blueprints.find(graph => graph.name === '城破入场演出')!;
  expect(graph).toBeTruthy(); expect(converted.entryId).toBe('opening');
  expect(converted.nodes.find(node => node.id === 'opening')?.kind).toBe('passage');
  expect(converted.scriptText!.content).toContain('@城破入场演出');
  const chapterNode = graph.nodes.find(node => node.type === 'showChapter')!;
  const card = page.locator(`.react-flow__node[data-id="${chapterNode.id}"]`);
  const title = card.getByRole('textbox').first();
  await title.fill('蓝图中的章节标题');
  const updated = await save();
  expect(updated.blueprints.find(item => item.id === graph.id)!.nodes.find(node => node.id === chapterNode.id)!.properties.title).toBe('蓝图中的章节标题');
  await page.getByRole('button', { name: '播放预览', exact: true }).click();
  await expect(page.locator('.chapter-preview.is-playing')).toBeVisible();
  await page.getByRole('button', { name: '停止预览', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'chapter-blueprint-preview.png') });
  checks.push('章节可封装为真实演出蓝图，保留入口和后续连接；节点内编辑参数可立即播放预览。');

  phase = 'new standalone performance and switching graphs';
  await page.getByRole('button', { name: '新建演出', exact: true }).click();
  const withNew = await save();
  const created = withNew.blueprints.find(item => item.id !== graph.id)!;
  expect(created?.kind).toBe('effect');
  await expect(page.locator('.performance-authoring.timeline')).toBeVisible();
  await expect(page.getByLabel('演出目标', { exact: true })).toHaveValue(`graph:${created.id}`);
  await expect(page.getByLabel('演出预览台词', { exact: true })).toBeVisible();
  await page.getByLabel('演出目标', { exact: true }).selectOption(`graph:${graph.id}`);
  await expect(page.getByLabel('演出目标', { exact: true })).toHaveValue('graph:' + graph.id);
  await expect(page.locator(`.react-flow__node[data-id="${chapterNode.id}"]`)).toBeVisible();
  checks.push('可新建独立演出并使用测试台词预览；切换演出目标时蓝图画布和预览同步切换。');

  phase = 'persistence and small viewport';
  await page.getByRole('button', { name: '返回剧本', exact: true }).click();
  await expect(input).toBeVisible();
  await expect(page.getByRole('button', { name: '隐藏演出', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '隐藏演出', exact: true }).click();
  expect(await input.inputValue()).toContain('@城破入场演出');
  await page.getByRole('button', { name: '隐藏演出', exact: true }).click();
  await caret('旁白：相同的台词。');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800));
  await expect(page.locator('.passage-performance-line.active')).toBeInViewport();
  await page.screenshot({ path: path.join(output, 'hidden-performance-1280.png') });
  const stored = await save();
  const verified = applyTextScript(stored, stored.scriptText!.content);
  expect(verified.issues).toEqual([]); expect(projectToText(verified.project)).toBe(projectToText(stored));
  await page.reload(); await openStoryMode(page, 'text');
  await expect(page.getByRole('button', { name: '隐藏演出', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
  checks.push('显示偏好在切换窗口和重开后保留；1280×800 可编辑侧栏，保存后文本和工程一致，无前端异常。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, packaged: false, userProjectModified: false }, null, 2));
  console.log(`PASS: ${checks.length} checks. ${output}`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2));
  console.error(error); console.log(output); process.exitCode = 1;
} finally { await app?.close(); await server.close(); }
