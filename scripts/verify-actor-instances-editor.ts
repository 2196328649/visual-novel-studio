import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { projectToText } from '../src/core/text-script';
import { linePreviewSnapshot } from '../src/core/line-preview';
import { launchDesktopFixture, installedExecutable } from './lib/desktop-fixture';
import { openStoryMode, openStageEditing } from './lib/story-workspace';
import { verifyInstanceExport } from './lib/verify-instance-export';

const root = path.resolve('.'), output = path.join(root, 'artifacts/actor-instances-editor', new Date().toISOString().replaceAll(':', '-'));
const template = installedExecutable ? path.join(path.dirname(installedExecutable), 'resources/resources/templates/aihong') : path.join(root, 'resources/templates/aihong');
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
await fs.cp(template, directory, { recursive: true });
const p = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
p.id = 'actor_editor_qa'; p.name = '角色实例与章节效果验收';
const hero = p.characters.find(c => c.name === '林翩翩')!, normal = hero.defaultExpressionId ?? hero.expressions[0].id;
const passage = p.nodes.find(n => n.kind === 'passage')!; p.entryId = passage.id;
passage.lines = [
  { id: 'first', text: '左右两个持续实例，添加一个本句副本。', actions: ['left', 'right'].map(instanceId => ({ kind: 'show' as const, characterId: hero.id, expressionId: normal, instanceId, lifetime: 'persistent' as const, presetId: instanceId, x: .5, y: 1, scale: 1, layer: 10, transition: 'none' as const })) },
  { id: 'second', text: '本句副本清除，左右继续显示。', actions: [{ kind: 'background', assetId: 'ai_presentation_chapter_two', transition: 'none' }] },
  { id: 'third', text: '右侧隐藏后，左侧仍然显示。', actions: [] },
];
p.scriptText = { format: 'vns-text-1', content: projectToText(p) };
await fs.writeFile(projectFile, JSON.stringify(p, null, 2));
const server = installedExecutable ? undefined : await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server?.listen();
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const checks: string[] = [], errors: string[] = [];
let exported: Awaited<ReturnType<typeof verifyInstanceExport>> | undefined;
const launch = async () => {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl: server ? `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` : undefined });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(p.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 980));
};
try {
  await launch();
  phase = 'create and independently control instances';
  await openStoryMode(page!, 'script'); await page!.locator('#line-first textarea').click(); await openStageEditing(page!);
  const preview = page!.locator('.story-preview-content');
  await expect(preview.locator('.text-stage-actor')).toHaveCount(2);
  await preview.getByLabel('舞台添加角色', { exact: true }).selectOption(hero.id);
  await expect(preview.locator('[data-instance-id="actor_1"]')).toBeVisible();
  await expect(preview.getByLabel('舞台显示范围', { exact: true })).toHaveValue('line');
  await preview.getByLabel('舞台显示范围', { exact: true }).selectOption('persistent');
  await preview.getByLabel('舞台显示范围', { exact: true }).selectOption('line');
  await preview.getByLabel('舞台选择角色', { exact: true }).selectOption('instance:right');
  const leftStyle = await preview.locator('[data-instance-id="left"]').getAttribute('style');
  await preview.getByLabel('角色横向位置 %', { exact: true }).fill('82');
  expect(await preview.locator('[data-instance-id="left"]').getAttribute('style')).toBe(leftStyle);
  await preview.getByLabel('角色表情', { exact: true }).selectOption(hero.expressions.at(-1)!.id);
  await expect(preview.locator('[data-instance-id="right"] img')).toHaveAttribute('alt', `${hero.name}：${hero.expressions.at(-1)!.name}`);
  await preview.locator('.text-stage').screenshot({ path: path.join(output, 'three-instances.png') });
  await page!.locator('#line-second textarea').click();
  await expect(preview.locator('.text-stage-actor')).toHaveCount(2);
  await expect(preview.locator('[data-instance-id="actor_1"]')).toHaveCount(0);
  await preview.locator('.text-stage').screenshot({ path: path.join(output, 'background-keeps-persistent.png') });
  await page!.locator('#line-third textarea').click();
  await preview.getByLabel('舞台选择角色', { exact: true }).selectOption('instance:right');
  await preview.getByRole('button', { name: '隐藏角色', exact: true }).click();
  await expect(preview.locator('.text-stage-actor')).toHaveCount(1);
  await expect(preview.locator('[data-instance-id="left"]')).toBeVisible();
  await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  expect(saved.scriptText!.content).toContain('实例ID=right');
  expect(saved.scriptText!.content).toContain('显示范围=持续显示');
  expect(linePreviewSnapshot(saved, { nodeId: passage.id, lineId: 'third' }).after.actors.size).toBe(1);
  checks.push('舞台新增同角色副本，切换两种范围，按实例单独移动/换表情/隐藏；跨背景保留及本句自动清除。');
  phase = 'saved instance fields after restart';
  await app!.close(); app = undefined; await launch();
  await openStoryMode(page!, 'script'); await page!.locator('#line-third textarea').click();
  await expect(page!.locator('.story-preview-content [data-instance-id="left"]')).toBeVisible();
  await expect(page!.locator('.story-preview-content .text-stage-actor')).toHaveCount(1);
  checks.push('真实保存并重启应用，文本 ID、显示范围与舞台状态保留。');
  phase = 'chapter animation';
  await page!.locator('.view-tabs').getByRole('button', { name: '界面', exact: true }).click();
  await page!.locator('.ui-toolbar').getByRole('button', { name: '章节标题', exact: true }).click();
  await page!.getByRole('button', { name: '播放进场', exact: true }).click();
  const chapterPreview = page!.getByLabel('章节进场预览', { exact: true });
  for (const [label, time] of [['move', .8], ['hold', 2.3], ['emit', 3.0], ['drift', 3.8], ['fade', 5.9]] as const) {
    await expect.poll(async () => Number(await chapterPreview.getAttribute('data-elapsed')), { intervals: [20], timeout: 9000 }).toBeGreaterThanOrEqual(time);
    if (label === 'emit') expect(await chapterPreview.locator('.chapter-preview-particle').count()).toBeGreaterThan(50);
    if (label === 'hold') expect(await chapterPreview.locator('.chapter-preview-letters').first().evaluate(e => getComputedStyle(e).filter)).toMatch(/^url\(/);
    await page!.locator('.ui-canvas').screenshot({ path: path.join(output, `chapter-${label}.png`) });
  }
  await expect(chapterPreview).toHaveCount(0, { timeout: 9000 });
  checks.push('编辑器实际播放原作七秒时序、噪声消散与柔边粒子，并正常结束。');
  if (installedExecutable) {
    phase = 'export from the installed application';
    const exports = path.join(output, 'exports'); await fs.mkdir(exports, { recursive: true });
    await app!.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, exports);
    const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
    const result = await page!.evaluate(project => window.studio!.exportGame(project), saved);
    await fs.writeFile(path.join(output, 'export.log'), result?.log ?? 'No result');
    expect(result?.ok, JSON.stringify(result?.diagnostics)).toBe(true);
    const zip = (await fs.readdir(exports)).find(name => name.endsWith('.zip'))!; expect(zip).toBeTruthy();
    exported = await verifyInstanceExport(path.join(exports, zip), output, saved.id);
    checks.push('安装版实际导出 Windows ZIP；独立 EXE 在仅系统 PATH 下完成多实例显示、跨背景保留、隐藏与存读档。');
  }
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', installedExecutable, checks, errors, exported }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2));
  console.error(phase + ': ' + String(error)); process.exitCode = 1;
} finally { await app?.close(); await server?.close(); }
console.log('REPORT ' + path.join(output, 'report.json'));
