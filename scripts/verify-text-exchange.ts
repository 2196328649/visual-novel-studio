import { openDisclosure } from './lib/ui-disclosures';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema, type Project } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { currentTextProject, dialogueRows } from '../src/core/text-exchange';
import { saveProject } from '../src/desktop/project-store';
import { installedExecutable, launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts/text-exchange', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
const plainFile = path.join(output, '对白.txt'), commandFile = path.join(output, '完整剧本.txt');
await fs.mkdir(output, { recursive: true });
const sourceDirectory = path.join(root, 'resources/example');
const example = projectSchema.parse(JSON.parse(await fs.readFile(path.join(sourceDirectory, 'project.vns.json'), 'utf8')));
let project = applyTextScript(createProject('文本交换桌面验证'), "# 段落：开场\n甲：你回来就好。\n@等待：0.5\n甲：我们走吧。\n旁白：夜色\n@续行：渐深\n@返回标题界面").project;
const voice = example.assets.find(asset => asset.kind === 'audio')!;
project.assets.push(voice); dialogueRows(project)[1].line.voiceId = voice.id;
project.scriptText = { format: 'vns-text-1', content: projectToText(project).replace('@等待：0.5', '// 保留演出说明\n@等待：0.5') };
await saveProject(projectFile, project, sourceDirectory);
project = currentTextProject(projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))));
const original = structuredClone(project);
const staging = (value: Project) => dialogueRows(value).map(({ line }) => ({ id: line.id, speakerId: line.speakerId, voiceId: line.voiceId, actions: line.actions }));
const server = installedExecutable ? undefined : await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } }); await server?.listen();
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const checks: string[] = [], errors: string[] = [];
const setFile = async (file: string) => app!.evaluate((_electron, file) => { (globalThis as any).vnsExchangeFile = file; }, file);
const saved = async () => {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  return currentTextProject(projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))));
};
const importFile = async (file: string) => {
  await setFile(file); await openDisclosure(page!, '文本文件'); await page!.getByRole('button', { name: '导入文本', exact: true }).click();
  const dialog = page!.getByRole('dialog', { name: '导入文本', exact: true }); await expect(dialog).toBeVisible(); return dialog;
};
try {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: server && 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 950);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [(globalThis as any).vnsExchangeFile] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: (globalThis as any).vnsExchangeFile });
  });
  phase = 'export formats through actual desktop IPC';
  for (const [mode, file] of [['commands', commandFile], ['dialogue', plainFile]] as const) {
    await setFile(file); await openDisclosure(page!, '文本文件'); await page.getByRole('button', { name: '导出文本', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导出文本', exact: true });
    await dialog.getByLabel('文本导出格式', { exact: true }).selectOption(mode);
    await dialog.getByRole('button', { name: '保存 TXT', exact: true }).click(); await expect(dialog).toHaveCount(0);
  }
  const commands = await fs.readFile(commandFile, 'utf8'), plain = await fs.readFile(plainFile, 'utf8');
  expect(commands).toContain('@等待：0.5'); expect(commands).toContain('@配音：'); expect(plain).not.toContain('@');
  expect(JSON.parse(await fs.readFile(plainFile + '.vns-lines.json', 'utf8')).entries).toHaveLength(3);
  checks.push('完整文本和纯台词经桌面文件保存接口导出；纯台词同时生成对应表。');

  phase = 'plain revision preview, apply and undo';
  await fs.writeFile(plainFile, plain.replace('我们走吧。', '等天亮再走吧。'));
  let dialog = await importFile(plainFile);
  await expect(dialog.getByLabel('文本导入方式', { exact: true })).toHaveValue('revision');
  await expect(dialog).toContainText('将更新 1 句台词');
  await expect(dialog.locator('ins')).toContainText('等天亮再走吧。');
  expect(dialogueRows(projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))))[1].line.text).toBe('我们走吧。');
  await page.screenshot({ path: path.join(output, 'dialogue-revision.png') });
  await dialog.getByRole('button', { name: '应用导入', exact: true }).click(); await expect(dialog).toHaveCount(0);
  let next = await saved();
  expect(staging(next)).toEqual(staging(original)); expect(dialogueRows(next)[1].line.text).toBe('等天亮再走吧。');
  expect(next.scriptText!.content).toContain('// 保留演出说明\n@等待：0.5');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(dialogueRows(await saved()).map(({ line }) => line.text)).toEqual(dialogueRows(original).map(({ line }) => line.text));
  await page.getByRole('button', { name: '重做', exact: true }).click(); next = await saved();
  expect(dialogueRows(next)[1].line.text).toBe('等天亮再走吧。');
  checks.push('导入先显示逐句预览；应用仅替换台词并保留行 ID、角色、配音、演出和注释，可一次撤销与重做。');

  phase = 'command script dialogue-only update';
  await fs.writeFile(commandFile, commands.replace('我们走吧。', '这次从北门走。').replace('@等待：0.5', '@等待：9.5'));
  dialog = await importFile(commandFile);
  await dialog.getByLabel('文本导入方式', { exact: true }).selectOption('revision');
  await expect(dialog).toContainText('将更新 1 句台词');
  await dialog.getByRole('button', { name: '应用导入', exact: true }).click(); next = await saved();
  expect(staging(next)).toEqual(staging(original)); expect(dialogueRows(next)[1].line.text).toBe('这次从北门走。');
  checks.push('含指令剧本可选择仅更新台词，导入文件中的不同等待时长不会覆盖原演出。');

  phase = 'full script import';
  dialog = await importFile(commandFile);
  await dialog.getByLabel('文本导入方式', { exact: true }).selectOption('replace');
  await dialog.getByRole('button', { name: '应用导入', exact: true }).click(); next = await saved();
  expect(dialogueRows(next)[1].line.actions).toContainEqual({ kind: 'pause', seconds: 9.5 });
  await page.getByRole('button', { name: '撤销', exact: true }).click(); next = await saved(); expect(staging(next)).toEqual(staging(original));
  checks.push('选择完整导入时正确应用指令，撤销恢复导入前的演出。');

  phase = 'ambiguous revision is blocked';
  await fs.writeFile(plainFile, plain + '甲：新增台词\n');
  dialog = await importFile(plainFile);
  await expect(dialog.getByRole('alert')).toContainText('数量'); await expect(dialog.getByRole('button', { name: '应用导入', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name);
  expect(staging(await saved())).toEqual(staging(original));
  checks.push('对白数量变化时阻止按顺序错配；保存重开后演出、配音与已修订台词保留。');
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, userProjectModified: false, installedExecutable, packaged: !!installedExecutable }, null, 2));
  console.log('PASS: ' + checks.length + ' desktop checks. ' + output);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2));
  console.error(error); console.log(output); process.exitCode = 1;
} finally { await app?.close(); await server?.close(); }
