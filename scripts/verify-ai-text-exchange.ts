import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, type Page } from '@playwright/test';
import { createServer as createViteServer } from 'vite';
import { createProject, type Project } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { currentTextProject, dialogueRows } from '../src/core/text-exchange';
import { defaultAiConfig } from '../src/core/ai';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.');
const output = path.join(root, 'artifacts/ai-text-exchange', new Date().toISOString().replaceAll(':', '-'));
const profile = path.join(output, 'profile'), projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(profile, { recursive: true });
const project = applyTextScript(createProject('AI文本交换验收'), "# 段落：开场\n甲：你回来就好。\n@等待：0.5\n甲：我们走吧。\n旁白：夜色\n@续行：渐深\n@返回标题界面").project;
project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
await saveProject(projectFile, project);
const staging = (value: Project) => dialogueRows(currentTextProject(value)).map(({ line }) => ({ id: line.id, speakerId: line.speakerId, voiceId: line.voiceId, actions: line.actions }));
const originalStaging = staging(project);
const commands = ['exportScript', 'exportDialogue', 'exportRevision', 'importText', 'undo', 'redo', 'openUi', 'openScript'];
const mock = createServer(async (req, res) => {
  for await (const chunk of req) { /* Consume this local request. */ }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ message: '可以导出三种格式或选择文本后审阅导入。', operations: [], editorCommands: commands }) }, finish_reason: 'stop' }] }));
});
mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
await fs.writeFile(path.join(profile, 'ai-settings.json'), JSON.stringify({ version: 1, config: { ...defaultAiConfig, baseUrl: 'http://127.0.0.1:' + (mock.address() as { port: number }).port + '/v1', model: 'local-mock', rememberKey: false } }));
const server = await createViteServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server.listen();
const app = await launchDesktopFixture({ root, profile, projectFile, devUrl: process.env.VNS_TEST_COMPILED ? undefined : 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port });
const page = await app.firstWindow(); let assistant: Page | undefined;
const checks: string[] = [];
const chooser = async (state: Record<string, unknown>) => app.evaluate((_electron, state) => Object.assign((globalThis as any).textChoice, state), state);
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  const before = await fs.readFile(projectFile, 'utf8');
  await app.evaluate(({ dialog }) => {
    const state: any = (globalThis as any).textChoice = { saveCalls: 0, openCalls: 0, savePath: '', openPath: '', cancelSave: false, cancelOpen: false, hold: false };
    dialog.showSaveDialog = async () => {
      state.saveCalls++;
      if (state.hold) return await new Promise<Electron.SaveDialogReturnValue>(resolve => { state.finishSave = () => { state.hold = false; resolve({ canceled: false, filePath: state.savePath }); }; });
      return { canceled: state.cancelSave, filePath: state.cancelSave ? '' : state.savePath };
    };
    dialog.showOpenDialog = async () => { state.openCalls++; return { canceled: state.cancelOpen, filePaths: state.cancelOpen ? [] : [state.openPath] }; };
  });
  await openStoryMode(page, 'text');
  const source = page.getByLabel('中文文本剧本', { exact: true });
  const opened = app.waitForEvent('window'); await page.getByRole('button', { name: 'AI 助手', exact: true }).click(); assistant = await opened;
  await assistant.getByLabel('发给 AI 的内容', { exact: true }).fill('输出完整脚本、纯对白和修订稿，并打开文本交换');
  await assistant.getByRole('button', { name: '发送', exact: true }).click();
  const click = async (name: string) => assistant!.getByRole('button', { name, exact: true }).click();
  const status = assistant.locator('.ai-editor-commands [role="status"]');
  const snapshot = async () => (await assistant!.evaluate(async () => (await window.studio?.getAiContext?.())?.project))!;

  await source.fill((await source.inputValue()).replace('我们走吧。', '未保存的台词。'));
  const fullFile = path.join(output, '完整脚本.txt'), plainFile = path.join(output, '纯对白.txt'), revisionFile = path.join(output, '修订稿.txt');
  await chooser({ savePath: fullFile, hold: true }); await click('导出完整脚本');
  await expect.poll(() => app.evaluate(() => typeof (globalThis as any).textChoice.finishSave)).toBe('function');
  await expect(assistant.getByRole('button', { name: '导出纯对白', exact: true })).toBeDisabled();
  await expect(status).not.toContainText('文本已导出'); await expect(fs.readFile(fullFile)).rejects.toThrow();
  await app.evaluate(() => (globalThis as any).textChoice.finishSave()); await expect(status).toContainText('文本已导出');
  const full = await fs.readFile(fullFile, 'utf8'); expect(full).toContain('未保存的台词。'); expect(full).toContain('@等待：0.5');
  expect(await fs.readFile(projectFile, 'utf8')).toBe(before); await expect(page.locator('.dirty-dot')).toHaveCount(1);
  for (const [name, file] of [['导出纯对白', plainFile], ['导出对白修订稿', revisionFile]]) {
    await chooser({ savePath: file }); await click(name); await expect(status).toContainText(file);
    expect(JSON.parse(await fs.readFile(file + '.vns-lines.json', 'utf8')).entries).toHaveLength(3);
  }
  const plain = await fs.readFile(plainFile, 'utf8'), revision = await fs.readFile(revisionFile, 'utf8');
  expect(plain).not.toContain('@'); expect(plain).toContain('未保存的台词。'); expect(revision).toContain('@对白标记：'); expect(revision).toContain('@续行：渐深');
  checks.push('三个导出按钮实际写出当前未保存内容与正确格式/对应表；等待文件选择期间不提前报告成功，工程磁盘和未保存状态保持');

  await chooser({ cancelSave: true }); await click('导出完整脚本'); await expect(status).toContainText('已取消导出');
  const blocker = path.join(output, 'existing-file'); await fs.writeFile(blocker, 'fixture');
  await chooser({ cancelSave: false, savePath: path.join(blocker, 'cannot-write.txt') }); await click('导出完整脚本');
  await expect(status).toContainText(/EEXIST|ENOTDIR/); expect(await fs.readFile(projectFile, 'utf8')).toBe(before);
  await chooser({ cancelOpen: true }); await click('导入文本…'); await expect(status).toContainText('已取消选择文本文件');
  checks.push('导出取消、真实文件写入错误及导入文件选择取消均回传实际结果');

  await fs.writeFile(revisionFile, revision.replace('未保存的台词。', '回填后的台词。'));
  await chooser({ cancelOpen: false, openPath: revisionFile }); await click('导入文本…');
  const review = page.getByRole('dialog', { name: '导入文本', exact: true });
  await expect(review).toContainText('将更新 1 句台词'); await expect(review.getByLabel('文本导入方式', { exact: true })).toHaveValue('revision');
  await expect(assistant.getByRole('button', { name: '导出纯对白', exact: true })).toBeDisabled();
  expect(dialogueRows(await snapshot())[1].line.text).toBe('未保存的台词。');
  await review.getByRole('button', { name: '取消', exact: true }).click(); await expect(status).toContainText('已取消导入');
  await expect(source).toHaveValue(/未保存的台词。/);
  await click('导入文本…'); await expect(review).toContainText('将更新 1 句台词'); await page.screenshot({ path: path.join(output, 'revision-review.png') });
  await review.getByRole('button', { name: '应用导入', exact: true }).click(); await expect(status).toContainText('更新 1 句台词已应用');
  await expect(source).toHaveValue(/回填后的台词。/); expect(staging(await snapshot())).toEqual(originalStaging);
  await click('撤销上次修改'); await expect(source).toHaveValue(/未保存的台词。/);
  await click('重做上次修改'); await expect(source).toHaveValue(/回填后的台词。/); expect(staging(await snapshot())).toEqual(originalStaging);
  expect(await fs.readFile(projectFile, 'utf8')).toBe(before);
  checks.push('修订稿先审阅，取消保留文本，应用只回填指定台词并保留行ID/角色/演出；撤销重做及未保存状态正确');

  await fs.writeFile(fullFile, full.replace('未保存的台词。', '整篇导入后的台词。').replace('@等待：0.5', '@等待：1.25'));
  await chooser({ openPath: fullFile }); await click('导入文本…'); await review.getByLabel('文本导入方式', { exact: true }).selectOption('replace');
  await review.getByRole('button', { name: '应用导入', exact: true }).click(); await expect(status).toContainText('导入文本 完整脚本.txt已应用');
  await expect(source).toHaveValue(/整篇导入后的台词。/); expect(dialogueRows(await snapshot())[1].line.actions).toContainEqual({kind:'pause',seconds:1.25});
  await click('撤销上次修改'); await expect(source).toHaveValue(/回填后的台词。/); expect(staging(await snapshot())).toEqual(originalStaging);
  checks.push('完整脚本替换实际应用对白与演出指令，整批撤销恢复导入前结构');

  await click('打开界面编辑'); await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.getByLabel('添加组件菜单', { exact: true }).getByRole('button', { name: '文字', exact: true }).click();
  await chooser({ savePath: plainFile }); await click('导出纯对白'); await expect(status).toContainText(plainFile);
  await expect(page.getByRole('button', { name: '保存界面', exact: true })).toBeEnabled(); await expect(page.locator('[data-hierarchy-id]')).toHaveCount(1);
  const openCalls = await app.evaluate(() => (globalThis as any).textChoice.openCalls);
  await click('导入文本…'); await expect(status).toContainText('界面有未保存'); expect(await app.evaluate(() => (globalThis as any).textChoice.openCalls)).toBe(openCalls);
  await page.locator('[data-workspace-tab="script"]').click(); await page.getByRole('dialog', { name: '保存界面修改', exact: true }).getByRole('button', { name: '不保存', exact: true }).click();
  await openStoryMode(page, 'text'); await source.fill((await source.inputValue()) + '\n@不存在的命令：故意无效');
  const saveCalls = await app.evaluate(() => (globalThis as any).textChoice.saveCalls);
  await click('导出完整脚本'); await expect(status).toContainText('请先修正当前剧本'); expect(await app.evaluate(() => (globalThis as any).textChoice.saveCalls)).toBe(saveCalls);
  await expect(source).toHaveValue(/@不存在的命令/); expect(await fs.readFile(projectFile, 'utf8')).toBe(before);
  checks.push('导出保留UI草稿；脏UI阻止文本导入；已有导出按钮对后续无效文本重新校验且不覆盖草稿或弹出保存窗口');
  await assistant.screenshot({ path: path.join(output, 'assistant-results.png') });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', compiled: !!process.env.VNS_TEST_COMPILED, externalApiCalled: false, nativeFileChoicesInjected: true, checks }, null, 2));
  console.log(output);
} catch (error) {
  console.error(error); await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); await assistant?.screenshot({ path: path.join(output, 'failure-assistant.png') }).catch(() => undefined); throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
  await app.close(); await server.close(); mock.closeAllConnections(); mock.close();
}
