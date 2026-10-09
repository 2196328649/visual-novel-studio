import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createProject, projectSchema, type Project } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { performanceTimeline, timelineNodeActions } from '../src/core/performance-timeline';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), output = path.join(root, 'artifacts/template-authoring-editor', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const initialFile = path.join(output, 'initial.json'), templateFile = path.join(output, 'project/project.vns.json');
await fs.writeFile(initialFile, JSON.stringify(createProject('模板验收起点')));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server.listen();
const devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
let app: ElectronApplication | undefined, page!: Page, phase = 'create template';
const checks: string[] = [], errors: string[] = [];
const read = async (file: string): Promise<Project> => projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
const launch = async (file: string, profile: string) => {
  app = await launchDesktopFixture({ root, profile: path.join(output, profile), projectFile: file, devUrl });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 940));
  await expect(page.locator('.project-title strong')).toBeVisible({ timeout: 45000 });
};
const save = async (file: string) => {
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  return read(file);
};
const open = async (marker: string) => {
  const input = page.getByRole('textbox', { name: '中文文本剧本', exact: true });
  await input.evaluate((element, marker) => {
    const text = element as HTMLTextAreaElement, at = text.value.indexOf(marker);
    if (at < 0) throw new Error('Missing source marker: ' + marker);
    text.focus(); text.setSelectionRange(at, at); text.dispatchEvent(new Event('select', { bubbles: true }));
  }, marker);
  await input.dispatchEvent('contextmenu', { clientX: 450, clientY: 180 });
  await page.getByRole('menuitem', { name: '在蓝图中编辑演出…', exact: true }).click();
  await expect(page.locator('.timeline-clip')).toHaveCount(1);
};
try {
  await launch(initialFile, 'profile');
  await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.getByLabel('作品名称', { exact: true }).fill('模板文本同步验收');
  await page.getByLabel('工程模板', { exact: true }).selectOption('aihong');
  await app!.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, templateFile);
  await page.getByRole('button', { name: '创建作品', exact: true }).click();
  await expect(page.locator('.project-title strong')).toHaveText('模板文本同步验收', { timeout: 120000 });
  const original = await read(templateFile);
  await openStoryMode(page, 'text');
  const input = page.getByRole('textbox', { name: '中文文本剧本', exact: true });
  const source = await input.inputValue();
  assert.doesNotMatch(source, /@实例[:：]|@章节标题[:：]|@结局[:：]|@解锁CG[:：]/);
  assert.doesNotMatch(original.scriptText!.content, /@实例[:：]|@章节标题[:：]|@结局[:：]|@解锁CG[:：]/);
  assert.match(original.scriptText!.content, /@设置：远舟达成 = true/);
  assert.match(original.scriptText!.content, /@条件：谨慎.*>= 1/); assert.match(original.scriptText!.content, /@结局演出/); assert.match(original.scriptText!.content, /@返回标题界面/);
  await page.screenshot({ path: path.join(output, '01-template-source.png') });
  await open('@章节进入演出');
  await expect(page.locator('.timeline-clip')).toContainText('7.00s');
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '设置范围', exact: true })).toHaveValue('call');
  await expect(page.getByLabel('允许点击跳过独立演出', { exact: true })).not.toBeChecked();
  await page.screenshot({ path: path.join(output, '02-template-timeline.png') });
  await openStoryMode(page, 'text');
  await expect(input).toHaveValue(source);
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const viewed = await save(templateFile);
  assert.deepEqual(viewed.nodes, original.nodes); assert.deepEqual(viewed.blueprints, original.blueprints);
  assert.equal(viewed.scriptText!.content, original.scriptText!.content);
  checks.push('实际新建哀鸿模板使用新章节、条件和结局语法；仅进入时间轴和查看播放设置不会改稿');
  await page.locator('.scene-row button').filter({ hasText: '余波 · 三种归宿' }).first().click();
  await expect(input).toHaveValue(/@设置：远舟达成 = true/);
  await expect(input).toHaveValue(/@结局演出/);
  await expect(input).not.toHaveValue(/@结局[:：]|@解锁CG[:：]/);
  await input.focus(); await input.press('Control+End');
  await page.screenshot({ path: path.join(output, '05-template-ending-source.png') });
  await page.locator('.scene-row button').filter({ hasText: '夜宴 · 女儿红' }).first().click();
  await expect(input).toHaveValue(source);
  phase = 'template gallery conditions';
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '画廊' });
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await page.locator('[data-hierarchy-id="ai_gallery_items"]').click();
  const condition = page.locator('.gallery-unlock-fields[aria-label="分组解锁条件"]');
  for (const [groupId, parameterId, operator, value] of [
    ['cg_ee6637a978bd5e88', 'ai_chapter_progress', 'gte', '1'],
    ['cg_1affe40f5e7d6214', 'ai_chapter_progress', 'gte', '2'],
    ['cg_edbf046353cd230d', 'ai_ending_boat_reached', 'eq', 'true'],
    ['cg_016793a38697e585', 'ai_ending_boat_reached', 'eq', 'true'],
  ]) {
    await page.getByLabel(/^图鉴分组（/).selectOption(groupId);
    await expect(condition.getByRole('combobox', { name: '分组解锁条件', exact: true })).toHaveValue('parameter');
    await expect(condition.getByLabel('条件状态', { exact: true })).toHaveValue(parameterId);
    await expect(condition.getByLabel('比较方式', { exact: true })).toHaveValue(operator);
    await expect(condition.getByLabel('状态值', { exact: true })).toHaveValue(value);
  }
  await condition.getByLabel('条件状态', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, '04-gallery-conditions.png') });
  await openStoryMode(page, 'text');
  await expect(input).toHaveValue(source);
  const afterGallery = await save(templateFile);
  assert.deepEqual(afterGallery.ui, original.ui);
  checks.push('真实新建工程的图鉴已配置章节进度与远舟达成参数条件；查看条件不改项目');
  await app!.close(); app = undefined;

  phase = 'legacy chapter navigation';
  const legacy = structuredClone(original), node = legacy.nodes.find(node => node.id === 'ai_title_one');
  assert.ok(node?.kind === 'passage');
  const action = node.lines[0].actions[0]; assert.ok(action.kind === 'blueprint');
  const graph = legacy.blueprints.find(graph => graph.id === action.blueprintId)!;
  const chapterNode = graph.nodes.find(item => item.type === 'showChapter')!;
  const chapter = timelineNodeActions(legacy, graph, chapterNode).find(action => action.kind === 'chapter'); assert.ok(chapter);
  node.lines[0].actions = [chapter];
  legacy.blueprints = legacy.blueprints.filter(item => item.id !== graph.id);
  legacy.scriptText!.content = projectToText(legacy);
  const legacyFile = path.join(output, 'project/legacy.vns.json');
  await fs.writeFile(legacyFile, JSON.stringify(legacy, null, 2));
  await launch(legacyFile, 'legacy-profile');
  await openStoryMode(page, 'text');
  const legacyInput = page.getByRole('textbox', { name: '中文文本剧本', exact: true });
  const legacySource = await legacyInput.inputValue();
  assert.match(legacySource, /@章节标题：第一章 · 酒醒城破/);
  for (let repeat = 0; repeat < 2; repeat++) {
    await open('@章节标题：');
    await expect(page.locator('.timeline-clip')).toContainText('7.00s');
    await openStoryMode(page, 'text');
    await expect(legacyInput).toHaveValue(legacySource);
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
  }
  const legacyViewed = await save(legacyFile);
  assert.deepEqual(legacyViewed.nodes, JSON.parse(JSON.stringify(legacy.nodes))); assert.deepEqual(legacyViewed.blueprints, legacy.blueprints);
  assert.equal(legacyViewed.scriptText!.content, legacy.scriptText!.content);
  checks.push('旧章节连续查看两次、返回和保存后保持原始 @章节标题 文本及全部剧情数据');

  phase = 'materialize on edit';
  await open('@章节标题：');
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await page.getByLabel('允许点击跳过独立演出', { exact: true }).check();
  await expect(page.getByLabel('允许点击跳过独立演出', { exact: true })).toBeChecked();
  await page.locator('.timeline-clip').click();
  await page.getByRole('tab', { name: '片段属性', exact: true }).click();
  const duration = page.locator('.timeline-inspector').getByLabel('时长', { exact: true });
  await duration.fill('8'); await duration.press('Tab');
  await expect(page.locator('.timeline-clip')).toContainText('8.00s');
  const edited = await save(legacyFile);
  assert.equal(edited.blueprints.length, legacy.blueprints.length + 1);
  const changed = edited.nodes.find(item => item.id === node.id); assert.ok(changed?.kind === 'passage');
  assert.equal(changed.next, node.next); assert.equal(changed.lines[0].id, node.lines[0].id);
  assert.equal(changed.lines[0].playback?.clickSkip, true);
  const call = changed.lines[0].actions[0]; assert.ok(call.kind === 'blueprint');
  const savedGraph = edited.blueprints.find(item => item.id === call.blueprintId)!;
  assert.equal(performanceTimeline(edited, savedGraph).until, 8);
  assert.deepEqual(applyTextScript(edited, edited.scriptText!.content).issues, []);
  await openStoryMode(page, 'text');
  await expect(legacyInput).not.toHaveValue(legacySource);
  await page.screenshot({ path: path.join(output, '03-edited-source.png') });
  await app!.close(); app = undefined;
  await launch(legacyFile, 'legacy-profile');
  phase = 'reopen edited chapter';
  await openStoryMode(page, 'text');
  await open('@' + savedGraph.name);
  await expect(page.locator('.timeline-clip')).toContainText('8.00s');
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await expect(page.getByLabel('允许点击跳过独立演出', { exact: true })).toBeChecked();
  const reopened = await save(legacyFile);
  assert.equal(reopened.blueprints.length, edited.blueprints.length);
  assert.deepEqual(reopened.nodes, edited.nodes);
  checks.push('首次修改才保存时间轴；允许点击跳过、八秒时长、节点身份和连接保存重开后保持一致');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, templateFile }, null, 2));
  console.log(output);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2));
  console.log(output); throw error;
} finally {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
  await app?.close().catch(() => undefined); await server.close();
}
