import { _electron as electron, expect, type ElectronApplication, type Page, type Locator } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type Project } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { assignBlueprintGroup } from '../src/core/blueprint-authoring';
import { saveProject } from '../src/desktop/project-store';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts/blueprint-interactions-editor', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
const project = createProject('蓝图交互编辑验收');
project.assets = [{ id: 'portrait', name: '测试立绘', kind: 'image', category: 'portrait', path: 'assets/portrait.png', width: 1, height: 1 }];
project.characters = [{ id: 'su', name: '苏怜烟', color: '#ddaaaa', defaultExpressionId: 'normal', expressions: [{ id: 'normal', name: '通常', assetId: 'portrait' }, { id: 'worried', name: '担忧', assetId: 'portrait' }] }];
const params = createBlueprintGraph('effect', '参数验收'), wire = createBlueprintGraph('function', '接线验收'), rain = createBlueprintGraph('effect', '雨夜演出');
const actor = blueprintNodeDefaults('showCharacter'); actor.x = 500; actor.y = 80; Object.assign(actor.properties, { characterId: 'su', expressionId: 'normal' });
params.nodes.push(actor); connectBlueprintPins(params, params.nodes[0].id, 'exec', actor.id, 'exec_in');
const delay = blueprintNodeDefaults('delay'); delay.x = 500; delay.properties.seconds = 0.2; rain.nodes.push(delay); connectBlueprintPins(rain, rain.nodes[0].id, 'exec', delay.id, 'exec_in');
project.blueprints = [params, wire, rain]; assignBlueprintGroup(project, rain.id, '演出验收');
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [
  { id: 'rename_first', text: '文字里的 @雨夜演出 是台词。', actions: [{ kind: 'blueprint', blueprintId: rain.id }] },
  { id: 'rename_second', speakerId: 'su', text: '另一处调用也会一起改名。', actions: [{ kind: 'blueprint', blueprintId: rain.id }] },
];
await fs.mkdir(path.join(path.dirname(projectFile), 'assets'), { recursive: true });
await fs.writeFile(path.join(path.dirname(projectFile), 'assets/portrait.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1cAAAAASUVORK5CYII=', 'base64'));
await saveProject(projectFile, project);
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } }); await server.listen();
const env = Object.fromEntries(Object.entries({ ...process.env, VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: path.join(output, 'profile'), VNS_TEST_ROOT: path.join(output, 'created-projects'), VNS_DEV_URL: `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` }).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const checks: string[] = [], errors: string[] = [];
const launch = async () => {
  app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 60000 });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000);
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1560, 1000));
};
const record = (message: string) => { checks.push(message); console.log(`PASS ${checks.length}: ${message}`); };
const save = async () => {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  return JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
};
const undo = () => page!.getByRole('button', { name: '撤销', exact: true }).click();
const redo = () => page!.getByRole('button', { name: '重做', exact: true }).click();
const graph = (saved: Project, id: string) => saved.blueprints.find(item => item.id === id)!;
const node = (id: string) => page!.locator(`.react-flow__node[data-id="${id}"]`);
const fit = async () => {
  await page!.getByRole('button', { name: '框选全部节点', exact: true }).click();
  await expect.poll(() => page!.evaluate(() => {
    const canvas = document.querySelector('.generic-blueprint-workspace .flow-container')!.getBoundingClientRect();
    return [...document.querySelectorAll('.generic-blueprint-workspace .react-flow__node')].every(node => { const box = node.getBoundingClientRect(); return box.left >= canvas.left && box.right <= canvas.right && box.top >= canvas.top && box.bottom <= canvas.bottom; });
  })).toBe(true);
};
const openGraph = async (id: string) => {
  await page!.locator('.view-tabs').getByRole('button', { name: '蓝图', exact: true }).click();
  if (await page!.getByLabel('蓝图类型', { exact: true }).isVisible()) await page!.getByLabel('蓝图类型', { exact: true }).selectOption('graph');
  await page!.getByLabel('演出目标', { exact: true }).selectOption('graph:' + id); await fit();
};
const dragToBlank = async (id: string, pin: string) => {
  await fit();
  const handle = node(id).locator(`.react-flow__handle[data-handleid="${pin}"]`), from = await handle.boundingBox();
  expect(from).not.toBeNull();
  const to = await page!.evaluate(() => {
    const box = document.querySelector('.generic-blueprint-workspace .flow-container')!.getBoundingClientRect();
    for (const [x, y] of [[0.85, 0.3], [0.08, 0.7], [0.75, 0.75], [0.1, 0.15]]) {
      const at = { x: box.left + box.width * x, y: box.top + box.height * y }, element = document.elementFromPoint(at.x, at.y);
      if (element?.closest('.flow-container') && !element.closest('.react-flow__node, .react-flow__controls, .react-flow__minimap')) return at;
    }
    throw new Error('No empty canvas position.');
  });
  await page!.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2); await page!.mouse.down(); await page!.mouse.move(to.x, to.y, { steps: 24 }); await page!.mouse.up();
  await expect(page!.getByRole('dialog', { name: '添加蓝图节点', exact: true })).toBeVisible();
};
const textInput = () => page!.getByLabel('中文文本剧本', { exact: true });
const focusEnd = async (input: Locator) => { await input.focus(); await input.press('Control+End'); };
const commandContext = async (name: string) => {
  const text = textInput(); await text.focus();
  const point = await text.evaluate((element: HTMLTextAreaElement, name) => {
    const at = element.value.indexOf(`@${name}`), before = element.value.slice(0, at), style = getComputedStyle(element), lineHeight = parseFloat(style.lineHeight);
    if (at < 0) throw new Error(`Command ${name} missing.`);
    const top = parseFloat(style.paddingTop) + (before.split('\n').length - 1) * lineHeight;
    element.scrollTop = Math.max(0, top - element.clientHeight / 2); element.setSelectionRange(at + 1, at + 1);
    return { x: parseFloat(style.paddingLeft) + 30, y: top - element.scrollTop + lineHeight / 2 };
  }, name);
  await text.click({ position: point }); await text.press('Escape'); await text.click({ position: point, button: 'right' });
};

try {
  await launch();
  phase = 'inline number drafts and selectors';
  await openGraph(params.id);
  const y = node(actor.id).getByLabel('显示角色 · 纵向位置', { exact: true });
  await expect(y).toHaveValue('1'); expect(await y.getAttribute('min')).toBeNull(); expect(await y.getAttribute('max')).toBeNull();
  await y.fill(''); await expect(y).toHaveValue(''); await y.pressSequentially('-2.75', { delay: 35 }); await expect(y).toHaveValue('-2.75');
  expect(graph(await save(), params.id).nodes.find(item => item.id === actor.id)!.properties.y).toBe(-2.75);
  await y.fill('12.5'); await undo(); await expect(y).toHaveValue('-2.75'); await redo(); await expect(y).toHaveValue('12.5');
  await y.fill(''); await node(actor.id).locator('.graph-node-title').click(); await expect(y).toHaveValue('12.5');
  await node(actor.id).getByLabel('显示角色 · 表情', { exact: true }).selectOption('worried');
  await node(actor.id).getByLabel('显示角色 · 过渡', { exact: true }).selectOption('none');
  let saved = await save(); let savedActor = graph(saved, params.id).nodes.find(item => item.id === actor.id)!;
  expect(savedActor.properties.y).toBe(12.5); expect(savedActor.properties.expressionId).toBe('worried'); expect(savedActor.properties.transition).toBe('none');
  await page!.screenshot({ path: path.join(output, 'inline-parameters.png') });
  record('节点上可清空并重新输入负数、小数和超出原范围的数值；撤销重做、表情和过渡选择、原生保存通过。');

  phase = 'drag exec to empty canvas';
  await openGraph(wire.id); await dragToBlank(wire.nodes[0].id, 'exec');
  await page!.getByLabel('搜索要添加的节点', { exact: true }).fill('hmzd');
  await expect(page!.locator('.node-picker-results button[data-active=true]')).toContainText('画面震动');
  await page!.getByLabel('搜索要添加的节点', { exact: true }).press('Space');
  await expect(page!.getByRole('dialog', { name: '添加蓝图节点', exact: true })).toHaveCount(0);
  saved = await save(); let wired = graph(saved, wire.id); expect(wired.nodes.length).toBe(2); expect(wired.links.length).toBe(1);
  const shake = wired.nodes.find(item => item.type === 'shake')!;
  expect(wired.links[0]).toMatchObject({ fromNodeId: wire.nodes[0].id, fromPinId: 'exec', toNodeId: shake.id, toPinId: 'exec_in' });
  await fit(); await node(shake.id).getByLabel('画面震动 · 方向', { exact: true }).selectOption('horizontal');
  record('执行线拖到空白处打开兼容节点菜单；拼音首字母搜索与空格选择后自动接线。');

  phase = 'reverse data drag and atomic undo';
  await dragToBlank(shake.id, 'duration');
  await expect(page!.locator('.node-picker-results')).not.toContainText('画面震动');
  await page!.getByLabel('搜索要添加的节点', { exact: true }).fill('gdz'); await page!.getByLabel('搜索要添加的节点', { exact: true }).press('Enter');
  saved = await save(); wired = graph(saved, wire.id); const literal = wired.nodes.find(item => item.type === 'literal')!;
  expect(literal.pins[0].dataType).toBe('number'); expect(wired.links).toContainEqual(expect.objectContaining({ fromNodeId: literal.id, toNodeId: shake.id, toPinId: 'duration' }));
  await undo(); saved = await save(); expect(graph(saved, wire.id).nodes.length).toBe(2); expect(graph(saved, wire.id).links.length).toBe(1);
  await redo(); saved = await save(); expect(graph(saved, wire.id).nodes.length).toBe(3); expect(graph(saved, wire.id).links.length).toBe(2);
  await fit(); await node(literal.id).getByLabel('固定值 · 值', { exact: true }).fill('4.75'); await save();
  await expect(node(shake.id).getByLabel('画面震动 · 时长', { exact: true })).toHaveCount(0);
  await page!.screenshot({ path: path.join(output, 'wire-and-inline-value.png') });
  record('从数值输入反向拖出可创建数值型固定值；创建和接线一次撤销/重做，连接后由数据线提供参数。');

  phase = 'rename in text context menu';
  await openStoryMode(page!, 'text'); const text = textInput();
  const callCount = (source: string, name: string) => source.split('\n').filter(line => line.startsWith(`@${name}`)).length;
  expect(callCount(await text.inputValue(), '雨夜演出')).toBe(2);
  await commandContext('雨夜演出'); await page!.getByRole('menuitem', { name: '修改蓝图名称…', exact: true }).click();
  const rename = page!.getByRole('dialog', { name: '修改蓝图名称', exact: true });
  await rename.getByLabel('蓝图名称', { exact: true }).fill('雨夜登场'); await rename.getByRole('button', { name: '修改并替换调用', exact: true }).click();
  await expect.poll(async () => callCount(await text.inputValue(), '雨夜登场')).toBe(2);
  await expect(text).toHaveValue(/文字里的 @雨夜演出 是台词。/);
  await undo(); await expect.poll(async () => callCount(await text.inputValue(), '雨夜演出')).toBe(2); await redo();
  await commandContext('雨夜登场'); await page!.getByRole('menuitem', { name: '修改调用名称…', exact: true }).click();
  const callRename = page!.getByRole('dialog', { name: '修改调用名称', exact: true });
  await callRename.getByLabel('调用名称', { exact: true }).fill('夜雨'); await callRename.getByRole('button', { name: '修改并替换调用', exact: true }).click();
  await expect.poll(async () => callCount(await text.inputValue(), '夜雨')).toBe(2); saved = await save();
  expect(graph(saved, rain.id).name).toBe('雨夜登场'); expect(graph(saved, rain.id).callName).toBe('夜雨');
  await openGraph(rain.id); await page!.getByRole('button', { name: '输入与输出', exact: true }).click();
  await page!.getByLabel('调用名称', { exact: true }).fill('雨中登场'); await page!.getByLabel('调用名称', { exact: true }).press('Enter');
  saved = await save(); expect(graph(saved, rain.id).callName).toBe('雨中登场');
  await openStoryMode(page!, 'text'); await expect.poll(async () => callCount(await text.inputValue(), '雨中登场')).toBe(2);
  record('文本右键改蓝图名和调用名会更新两处已有指令且保留对白；可整体撤销，蓝图设置修改也同步。');

  phase = 'grouped command palette and wheel keyboard selection';
  const baseline = await text.inputValue(); await focusEnd(text); await text.press('Enter'); await text.pressSequentially('/');
  const palette = page!.getByRole('dialog', { name: '中文指令面板', exact: true }); await expect(palette).toBeVisible();
  const baseGroup = palette.getByRole('button', { name: /^基础/ }); await baseGroup.click(); await expect(baseGroup).toHaveAttribute('aria-expanded', 'false');
  await expect(palette.getByRole('button', { name: /^显示角色/ })).toHaveCount(0); await baseGroup.press('Space'); await expect(baseGroup).toHaveAttribute('aria-expanded', 'true');
  const manualGroup = palette.getByRole('button', { name: /^演出验收/ }); await manualGroup.click(); await expect(manualGroup).toHaveAttribute('aria-expanded', 'false'); await manualGroup.press('Enter'); await expect(manualGroup).toHaveAttribute('aria-expanded', 'true');
  const search = palette.getByLabel('筛选中文指令', { exact: true }); await search.focus();
  const active = palette.locator('.node-picker-results button[data-active=true]'), first = await active.textContent(), scroll = await text.evaluate(element => element.scrollTop);
  await search.press('ArrowDown'); expect(await active.textContent()).not.toBe(first); await search.press('ArrowUp'); await expect(active).toHaveText(first!);
  await palette.locator('.node-picker-heading').hover(); await page!.mouse.wheel(0, 120); await expect(active).not.toHaveText(first!); expect(await text.evaluate(element => element.scrollTop)).toBe(scroll);
  await search.fill('yzdc'); await expect(active).toContainText('雨中登场'); await search.press('Space');
  await expect(palette).toHaveCount(0); expect(callCount(await text.inputValue(), '雨中登场')).toBe(3);
  await text.fill(baseline); await save();
  record('基础和自定义分组可鼠标/键盘折叠；滚轮、上下键改变选项且正文不滚动，空格插入直接调用。');

  phase = 'inline completions and named arguments';
  await focusEnd(text); await text.press('Enter'); await text.pressSequentially('@xsjs');
  const suggestions = page!.getByRole('listbox', { name: '文本补全建议', exact: true });
  await expect(suggestions.getByRole('option', { name: /显示角色/ })).toBeVisible(); await text.press('Enter');
  await expect(text).toHaveValue(/@显示角色：$/); await expect(page!.getByRole('note', { name: '指令参数提示', exact: true })).toContainText('纵向');
  await text.pressSequentially('sly'); await expect(suggestions.getByRole('option', { name: /苏怜烟/ })).toBeVisible(); await text.press('Space');
  await expect(text).toHaveValue(/@显示角色：苏怜烟/);
  await text.fill(baseline); await focusEnd(text); await text.press('Enter'); await text.pressSequentially('@yzdc');
  await expect(suggestions.getByRole('option', { name: /雨中登场/ })).toBeVisible(); await text.press('Enter'); expect(callCount(await text.inputValue(), '雨中登场')).toBe(3);
  await text.fill(baseline); await save();
  record('指令和蓝图支持中文首字母补全，回车采用建议；角色参数可用首字母与空格选择并显示参数提示。');

  phase = 'editor themes and persistence';
  const originalUi = (await save()).ui;
  const assistantOpened = app!.waitForEvent('window'); await page!.getByRole('button', { name: 'AI 助手', exact: true }).click(); const assistant = await assistantOpened;
  assistant.on('pageerror', error => errors.push(error.message)); await expect(assistant.locator('.ai-assistant-window')).toBeVisible(); await page!.bringToFront();
  for (const [id, name] of [['studio', '工坊深色'], ['ue5', 'UE5 石墨'], ['codexDark', 'Codex 深色'], ['codexLight', 'Codex 浅色']]) {
    await page!.getByRole('button', { name: '作品设置', exact: true }).click(); await page!.getByRole('button', { name: '编辑器外观', exact: true }).click();
    await page!.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await expect(page!.locator('html')).toHaveAttribute('data-editor-theme', id); await expect(assistant.locator('html')).toHaveAttribute('data-editor-theme', id); await page!.getByRole('button', { name: '完成', exact: true }).click();
    await page!.screenshot({ path: path.join(output, `theme-${id}.png`) });
  }
  expect((await save()).ui).toEqual(originalUi);
  expect(await page!.locator('.text-source-input').evaluate(element => getComputedStyle(element).webkitTextFillColor)).toBe('rgba(0, 0, 0, 0)');
  await assistant.screenshot({ path: path.join(output, 'assistant-theme-light.png') }); await assistant.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
  record('四套配色立即生效并同步 AI 独立窗口，主题不会改动游戏 UI；文本高亮层保持可见，开发窗口截图已生成。');

  phase = 'ordinary blueprint game and parallel examples';
  await openGraph(wire.id); const beforeExample = await save();
  await page!.getByLabel('添加蓝图示例', { exact: true }).selectOption('interaction');
  await expect(page!.getByLabel('演出目标', { exact: true }).locator('option:checked')).toContainText('限时点亮');
  saved = await save(); const game = saved.blueprints.find(item => item.name === '限时点亮')!;
  expect(game.kind).toBe('function'); expect(saved.minigames).toEqual(beforeExample.minigames); expect(saved.ui.customPages.length).toBe(beforeExample.ui.customPages.length + 1);
  expect(game.nodes.some(item => item.type === 'eventClick')).toBe(true); expect(game.nodes.some(item => item.type === 'eventKey')).toBe(true); expect(game.nodes.some(item => item.type === 'eventTimer')).toBe(true);
  await undo(); saved = await save(); expect(saved.blueprints.length).toBe(beforeExample.blueprints.length); expect(saved.ui.customPages.length).toBe(beforeExample.ui.customPages.length);
  await redo(); await save();
  await page!.getByLabel('添加蓝图示例', { exact: true }).selectOption('motion');
  await expect(page!.getByLabel('演出目标', { exact: true }).locator('option:checked')).toContainText('镜头震动同播');
  await fit(); saved = await save(); const motion = saved.blueprints.find(item => item.name === '镜头震动同播')!;
  expect(motion.nodes.find(item => item.type === 'camera')!.properties.wait).toBe(false); expect(motion.nodes.find(item => item.type === 'shake')!.properties.wait).toBe(true);
  await page!.screenshot({ path: path.join(output, 'parallel-motion-example.png') });
  record('可从工具栏添加普通蓝图小游戏与并行演出示例，界面和变量一并加入且能整体撤销，未创建小游戏定义。');

  phase = 'restart';
  await app!.close(); app = undefined; await launch();
  await expect(page!.locator('html')).toHaveAttribute('data-editor-theme', 'codexLight');
  await openStoryMode(page!, 'text'); await expect.poll(async () => callCount(await textInput().inputValue(), '雨中登场')).toBe(2);
  saved = await save(); expect(graph(saved, params.id).nodes.find(item => item.id === actor.id)!.properties.y).toBe(12.5);
  expect(graph(saved, rain.id).callName).toBe('雨中登场'); expect(errors).toEqual([]);
  record('完整重启后编辑器主题、蓝图调用名、文本引用和超出原范围的数值均保留。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, packaged: false, userProjectModified: false, output }, null, 2)); console.log(output);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error), output }, null, 2)); console.error(error); console.log(output); process.exitCode = 1;
} finally { await app?.close(); await server.close(); }
