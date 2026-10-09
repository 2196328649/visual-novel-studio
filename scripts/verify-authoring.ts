import { openStageEditing, openStoryMode } from './lib/story-workspace';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { projectSchema, type Project, type NodeKind } from '../src/core/model';
import { validateProject } from '../src/core/validate';
import { runRenpy } from '../src/runtime/service';

const require = createRequire(import.meta.url);
const executeFile = promisify(execFile);
const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = new Date().toISOString().replaceAll(':', '-');
const output = path.join(studio, 'artifacts', 'authoring-verification', runId);
const userData = path.join(output, 'user-data');
const projectFile = path.join(output, 'created-project', 'project.vns.json');
const exportDirectory = path.join(output, 'exports');
const sdk = path.join(studio, 'resources', 'runtime');
const checks: string[] = [];
const errors: string[] = [];
const events: { at: string; phase: string; kind: string; detail: unknown }[] = [];
const record = (kind: string, detail: unknown) => events.push({ at: new Date().toISOString(), phase, kind, detail });
let application: ElectronApplication | undefined;
let page!: Page;
let phase = 'prepare';
async function main() {
await fs.mkdir(path.join(output, 'imports'), { recursive: true });
const example = projectSchema.parse(JSON.parse(await fs.readFile(path.join(studio, 'resources/example/project.vns.json'), 'utf8')));
const importFiles: string[] = [];
for (const asset of example.assets) {
  const destination = path.join(output, 'imports', asset.name + path.extname(asset.path));
  await fs.copyFile(path.join(studio, 'resources/example', asset.path), destination);
  importFiles.push(destination);
}
const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, VNS_USER_DATA: userData, VNS_RENPY_SDK: sdk }).filter((entry): entry is [string, string] => entry[1] !== undefined));
delete env.VNS_PROJECT_PATH;
delete env.VNS_TEST_ROOT;
delete env.VNS_DEV_URL;

async function launch(savePath = projectFile) {
  const started = Date.now();
  record('launch-request', { savePath });
  application = await electron.launch({ executablePath: require('electron'), args: [studio], cwd: studio, env });
  record('process-started', { pid: application.process().pid, mainPid: await application.evaluate(() => process.pid), elapsedMs: Date.now() - started });
  application.process().stdout?.on('data', data => record('main-stdout', String(data)));
  application.process().stderr?.on('data', data => record('main-stderr', String(data)));
  application.process().on('exit', (code, signal) => record('process-exit', { code, signal }));
  page = await application.firstWindow();
  record('first-window', { url: page.url(), elapsedMs: Date.now() - started });
  page.on('pageerror', error => { errors.push(error.message); record('pageerror', error.stack ?? error.message); });
  page.on('console', message => record(`renderer-${message.type()}`, message.text()));
  page.on('requestfailed', request => record('requestfailed', { url: request.url(), failure: request.failure() }));
  page.on('crash', () => record('renderer-crash', { url: page.url() }));
  page.on('domcontentloaded', () => record('domcontentloaded', { url: page.url() }));
  page.on('dialog', async dialog => { await dialog.accept(); });
  await expect(page.locator('.project-title strong')).not.toBeEmpty({ timeout: 30000 });
  record('editor-ready', { title: await page.locator('.project-title strong').textContent(), elapsedMs: Date.now() - started });
  // Only OS chooser responses are supplied by the harness; project mutations use visible controls.
  await application.evaluate(({ dialog, shell }, data) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as any;
    shell.openPath = async () => '';
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: data.savePath });
    dialog.showOpenDialog = async (...args: unknown[]) => {
      const options = args.at(-1) as { title?: string };
      const filePaths = options.title === '导入素材' ? data.importFiles
        : options.title === '选择游戏导出目录' ? [data.exportDirectory] : [data.savePath];
      return { canceled: false, filePaths };
    };
  }, { savePath, importFiles, exportDirectory });
}
const inspector = () => page.locator('.inspector');
const field = (name: string) => inspector().locator('.field').filter({ has: page.locator('.field-label').filter({ hasText: new RegExp(`^${name}$`) }) }).locator('input, select, textarea').first();
const node = (name: string) => page.locator('.tree-node').filter({ has: page.getByText(name, { exact: true }) });
async function selectNode(name: string) { await node(name).click(); }
async function selectScene(name: string) {
  await page.locator('.sidebar').getByRole('button', { name: '剧情', exact: true }).click();
  await page.locator('.scene-row > button').filter({ has: page.getByText(name, { exact: true }) }).click();
}
async function renameScene(name: string) {
  await page.locator('.scene-row.active > button').first().dblclick();
  await page.locator('.dialog').getByLabel('名称', { exact: true }).fill(name);
  await page.locator('.dialog').getByRole('button', { name: '确定', exact: true }).click();
}
async function addNode(kind: Exclude<NodeKind, 'start' | 'passage'>, name: string) {
  await page.getByLabel('添加剧情节点', { exact: true }).selectOption(kind);
  await field('名称').fill(name);
}
async function target(label: string, name: string) {
  const select = field(label);
  const option = select.locator('option').filter({ hasText: new RegExp(`^${name}$`) });
  await select.selectOption((await option.getAttribute('value'))!);
}
async function saved(): Promise<Project> {
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0, { timeout: 15000 });
  return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
}
async function closeNormally(savePath?: string) {
  const current = application!;
  record('normal-close-request', { pid: current.process().pid });
  const exited = new Promise<void>(resolve => current.process().once('exit', () => resolve()));
  await current.evaluate(({ BrowserWindow, dialog }, savePath) => { if (savePath) dialog.showSaveDialog = async () => ({ canceled: false, filePath: savePath }); BrowserWindow.getAllWindows()[0].close(); }, savePath);
  await Promise.race([exited, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Close recovery handshake timed out')), 15000).unref())]);
  application = undefined;
}
async function newProject(name: string) {
  await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.locator('.dialog').getByLabel('作品名称', { exact: true }).fill(name);
  await page.getByRole('button', { name: '创建作品', exact: true }).click();
  await openStoryMode(page, 'script');
  await expect(page.locator('.project-title strong')).toHaveText(name);
}

try {
  phase = 'create blank and import';
  await launch();
  await newProject('雨后的约定');
  const blank = await saved();
  if (blank.assets.length || blank.characters.length || blank.nodes.length !== 3) throw new Error('New project did not start blank.');
  await page.locator('.sidebar').getByRole('button', { name: '素材', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: '导入素材', exact: true }).click();
  await expect(page.locator('.sidebar .resource-row')).toHaveCount(7);
  checks.push('Created a blank project and imported seven image/audio files through native IPC.');

  phase = 'characters and state';
  for (const [name, expression] of [['小雨', '小雨 · 平静'], ['林夏', '林夏 · 微笑']]) {
    await page.locator('.sidebar').getByRole('button', { name: '角色', exact: true }).click();
    await page.locator('.sidebar').getByRole('button', { name: '添加角色', exact: true }).click();
    await field('角色名称').fill(name);
    await inspector().getByRole('button', { name: '添加表情', exact: true }).click();
    await inspector().getByLabel('表情名称').fill('平静');
    await inspector().locator('.expression-editor select').selectOption({ label: expression });
  }
  await page.locator('.sidebar').getByRole('button', { name: '状态', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: '添加状态', exact: true }).click();
  await field('状态名称').fill('好感度');
  await page.locator('.sidebar').getByRole('button', { name: '添加状态', exact: true }).click();
  await field('状态名称').fill('已来过');
  await field('类型').selectOption('boolean');
  await inspector().getByLabel('跨周目保留').check();
  checks.push('Created two characters with expressions, affection, and a persistent switch through forms.');

  phase = 'story structure';
  await selectScene('开场');
  await renameScene('校门');
  await openStoryMode(page, 'script');
  await selectNode('第一段');
  await field('名称').fill('初次见面');
  await page.getByLabel('第1行对白', { exact: true }).fill('雨停了，一起去图书室吗？');
  await page.getByLabel('第1行说话人', { exact: true }).selectOption({ label: '小雨' });
  await selectNode('结局');
  await field('名称').fill('独自回家');
  await field('结局文字').fill('今天先回家，下次再见。');
  await addNode('choice', '是否同行');
  await field('选择提示').fill('接下来去哪里？');
  await inspector().locator('.choice-editor').nth(0).getByLabel('文字', { exact: true }).fill('一起去图书室');
  await inspector().locator('.choice-editor').nth(1).getByLabel('文字', { exact: true }).fill('今天先回家');
  await addNode('set', '第一次好感');
  await field('操作').selectOption('add');
  await inspector().getByLabel('状态值', { exact: true }).fill('1');

  await page.getByRole('button', { name: '添加小章节', exact: true }).click();
  await renameScene('图书室');
  await field('名称').fill('窗边的对话');
  await page.getByLabel('第1行对白', { exact: true }).fill('谢谢你陪我来，还要留下来帮忙吗？');
  await page.getByLabel('第1行说话人', { exact: true }).selectOption({ label: '林夏' });
  await addNode('choice', '是否帮忙');
  await inspector().locator('.choice-editor').nth(0).getByLabel('文字', { exact: true }).fill('留下来帮忙');
  await inspector().locator('.choice-editor').nth(1).getByLabel('文字', { exact: true }).fill('约好下次再来');
  await addNode('set', '第二次好感');
  await field('操作').selectOption('add');
  await inspector().getByLabel('状态值', { exact: true }).fill('1');

  await page.getByRole('button', { name: '添加小章节', exact: true }).click();
  await renameScene('归途');
  await field('名称').fill('经过草地');
  await page.getByLabel('第1行对白', { exact: true }).fill('走过草地时，阳光终于照了下来。');
  await addNode('condition', '好感结局');
  await inspector().getByLabel('比较方式').selectOption('gte');
  await inspector().getByLabel('状态值', { exact: true }).fill('2');
  await addNode('end', '温暖结局');
  await field('结局文字').fill('雨后，我们的故事刚刚开始。');
  await addNode('end', '朋友结局');
  await field('结局文字').fill('我们约好了，下次再见。');

  const snapshot = await saved();
  const byName = (name: string) => snapshot.nodes.find(n => n.name === name)!;
  for (const [scene, source, label, destination] of [
    ['校门', '初次见面', '接下来', '是否同行'],
    ['校门', '第一次好感', '接下来', '窗边的对话'],
    ['图书室', '窗边的对话', '接下来', '是否帮忙'],
    ['图书室', '第二次好感', '接下来', '经过草地'],
    ['归途', '经过草地', '接下来', '好感结局'],
    ['归途', '好感结局', '满足时前往', '温暖结局'],
    ['归途', '好感结局', '不满足时前往', '朋友结局'],
  ]) {
    await selectScene(scene);
    await selectNode(source);
    await target(label, destination);
  }
  for (const [scene, source, destinations] of [
    ['校门', '是否同行', ['第一次好感', '独自回家']],
    ['图书室', '是否帮忙', ['第二次好感', '经过草地']],
  ] as const) {
    await selectScene(scene);
    await selectNode(source);
    for (const [i, destination] of destinations.entries()) await inspector().locator('.choice-editor').nth(i).locator('select').first().selectOption(byName(destination).id);
  }
  checks.push('Authored and connected three scenes, two choices, two state changes, a condition, and three endings through the editor.');

  phase = 'stage and audio';
  for (const [scene, passage, background] of [['校门', '初次见面', '校门'], ['图书室', '窗边的对话', '图书室'], ['归途', '经过草地', '草地']]) {
    await selectScene(scene);
    await selectNode(passage);
    await openStageEditing(page);
    await page.getByLabel('舞台背景').selectOption({ label: background });
    if (scene === '校门') {
      for (const [name, x] of [['小雨', 25], ['林夏', 75]] as const) {
        await page.getByLabel('舞台添加角色').selectOption({ label: name });
        await page.locator('.story-preview-content').getByLabel('角色横向位置 %').fill(String(x));
        await page.locator('.story-preview-content').getByLabel('角色缩放 %').fill('70');
      }
      for (const name of ['播放音乐', '播放音效']) {
        await page.locator('.story-line.selected .add-line-effect').click();
        await page.getByRole('menuitem', { name, exact: true }).click();
        await page.locator('.story-line.selected').getByRole('button', { name: '收起演出编辑', exact: true }).click();
      }
      const firstActor = page.locator('.text-stage-actor').first();
      const box = (await firstActor.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 22, box.y + box.height / 3, { steps: 6 });
      await page.mouse.up();
    }
    await expect.poll(() => page.locator('.text-stage img').evaluateAll(images => images.filter(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0).length)).toBeGreaterThan(0);
    await page.screenshot({ path: path.join(output, `stage-${scene}.png`) });
  }
  const authored = await saved();
  const problems = validateProject(authored).filter(d => d.severity === 'error');
  if (problems.length) throw new Error(JSON.stringify(problems));
  if (authored.scenes.length !== 3 || authored.characters.length !== 2 || authored.nodes.filter(n => n.kind === 'end').length !== 3) throw new Error('Authored project structure mismatch.');
  const opening = authored.nodes.find(n => n.name === '初次见面');
  if (opening?.kind !== 'passage' || !opening.lines[0].actions.some(a => a.kind === 'music') || !opening.lines[0].actions.some(a => a.kind === 'sound')) throw new Error('Stage/audio actions were not authored.');
  checks.push('Added backgrounds, two positioned characters, stage dragging, music and sound; image protocol rendered actual assets.');

  phase = 'native reload and diagnostics';
  await page.reload();
  await expect(page.locator('.project-title strong')).toHaveText('雨后的约定');
  await page.getByRole('button', { name: '蓝图', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(authored.nodes.filter(n => n.sceneId === opening.sceneId).length);
  await page.screenshot({ path: path.join(output, 'authored-blueprint.png') });
  const assetFile = path.join(path.dirname(projectFile), authored.assets[0].path);
  await fs.rename(assetFile, `${assetFile}.temporarily-missing`);
  try {
    await page.getByRole('button', { name: '试玩', exact: true }).click();
    const missing = page.locator('.diagnostic').filter({ hasText: '找不到素材' });
    await expect(missing).toBeVisible({ timeout: 15000 });
    await missing.click();
    await expect(inspector().getByText('素材属性', { exact: true })).toBeVisible();
  } finally { await fs.rename(`${assetFile}.temporarily-missing`, assetFile); }
  await page.getByRole('button', { name: '关闭问题面板', exact: true }).click();
  checks.push('Saved and reloaded the complete project, displayed authored blueprint edges, and located a genuinely missing asset from build diagnostics.');

  phase = 'native export';
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByRole('dialog', { name: '作品设置', exact: true }).getByRole('button', { name: '选择目录并导出', exact: true }).click();
  await expect(page.locator('.status-message')).toContainText('游戏已导出', { timeout: 300000 });
  const archives = (await fs.readdir(exportDirectory)).filter(name => name.endsWith('-win.zip'));
  if (!archives.length) throw new Error('Native export created no Windows package.');
  const releaseRoot = path.join(userData, 'builds', authored.id, 'release');
  const builds = await fs.readdir(releaseRoot);
  const releaseBuild = path.join(releaseRoot, builds.at(-1)!);
  const affection = authored.variables.find(v => v.name === '好感度')!.id;
  const endingId = (name: string) => authored.nodes.find(n => n.name === name)!.id;
  const testcases = `testsuite global:
    before testcase:
        $ _test.timeout = 10.0
        $ _test.transition_timeout = 0.05
        $ preferences.text_cps = 0
        if not screen "main_menu":
            run MainMenu(confirm=False)
    teardown:
        exit
testcase alone:
    click id "vn_main_start"
    advance until screen "choice"
    click "今天先回家"
    assert eval vn_current_node == "${endingId('独自回家')}"
    assert eval vn_var_${affection} == 0
    assert "今天先回家，下次再见。"
testcase friends:
    click id "vn_main_start"
    advance until screen "choice"
    click "一起去图书室"
    advance until screen "choice"
    click "约好下次再来"
    advance until eval vn_current_node == "${endingId('朋友结局')}"
    assert eval vn_var_${affection} == 1
    assert "我们约好了，下次再见。"
testcase warm:
    click id "vn_main_start"
    advance until screen "choice"
    click "一起去图书室"
    advance until screen "choice"
    click "留下来帮忙"
    advance until eval vn_current_node == "${endingId('温暖结局')}"
    assert eval vn_var_${affection} == 2
    assert "雨后，我们的故事刚刚开始。"
`;
  await fs.writeFile(path.join(releaseBuild, 'game/testcases.rpy'), testcases);
  const played = await runRenpy(sdk, releaseBuild, ['test'], { timeoutMs: 120000, savedir: path.join(output, 'game-test-saves') });
  await fs.writeFile(path.join(output, 'authored-game-tests.log'), played.log);
  if (played.code !== 0 || !/Test cases\s*:\s*3\s*\|\s*3 passed/.test(played.log) || !/Status:\s+PASSED/.test(played.log)) throw new Error(`Authored game test failed: ${played.log}`);
  checks.push('Exported through the editor and executed all three authored endings in real RenPy (three cases).');

  phase = 'close and crash recovery';
  await openStoryMode(page, 'script');
  await selectScene('校门');
  await selectNode('初次见面');
  await page.getByLabel('第1行对白', { exact: true }).fill('关闭前最后一次修改。');
  await closeNormally();
  await launch();
  await expect(page.getByLabel('第1行对白', { exact: true })).toHaveValue('关闭前最后一次修改。');
  await saved();
  await page.getByLabel('第1行对白', { exact: true }).fill('崩溃后可恢复的内容。');
  await expect.poll(async () => fs.readFile(`${projectFile}.autosave`, 'utf8').catch(() => '')).toContain('崩溃后可恢复的内容。');
  const crashed = application!;
  const crashedMainPid = await crashed.evaluate(() => process.pid);
  record('forced-termination', { pid: crashed.process().pid, mainPid: crashedMainPid, method: process.platform === 'win32' ? 'taskkill /T /F' : 'SIGKILL' });
  const exited = new Promise<void>(resolve => crashed.process().once('exit', () => resolve()));
  // The Windows Electron launcher can parent the actual app process.
  if (process.platform === 'win32') {
    const termination = await executeFile('taskkill', ['/PID', String(crashed.process().pid), '/T', '/F']);
    record('terminated-process-tree', termination.stdout);
  } else crashed.process().kill('SIGKILL');
  await exited;
  await expect.poll(() => { try { process.kill(crashedMainPid, 0); return true; } catch { return false; } }).toBe(false);
  await crashed.close().catch(() => undefined);
  application = undefined;
  await launch();
  await expect(page.getByLabel('第1行对白', { exact: true })).toHaveValue('崩溃后可恢复的内容。');
  await saved();
  checks.push('Actual window-close handshake captured the latest unsaved edit; actual process termination recovered the autosaved edit on relaunch.');

  phase = 'save unsaved draft on close';
  await newProject('未保存草稿验收');
  await page.getByLabel('第1行对白', { exact: true }).fill('尚未选择保存位置的草稿。');
  await closeNormally(path.join(output, 'draft-saved/project.vns.json'));
  await launch(path.join(output, 'draft-saved/project.vns.json'));
  await expect(page.locator('.project-title strong')).toHaveText('未保存草稿验收');
  await expect(page.getByLabel('第1行对白', { exact: true })).toHaveValue('尚未选择保存位置的草稿。');
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const draftSaved = projectSchema.parse(JSON.parse(await fs.readFile(path.join(output, 'draft-saved/project.vns.json'), 'utf8')));
  assert.equal(draftSaved.name, '未保存草稿验收');
  assert.ok(draftSaved.nodes.some(node => node.kind === 'passage' && node.lines.some(line => line.text === '尚未选择保存位置的草稿。')));
  checks.push('A new project with no saved file was saved through the close prompt and reopened from that file.');
  await closeNormally();
  if (errors.length) throw new Error(errors.join('\n'));
  const report = { passed: true, runId, projectFile, exportDirectory, archives, checks, errors, events, note: 'UI automation with supplied OS chooser responses and real Electron IPC/filesystem/runtime. This is not a human novice usability study.' };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(studio, 'artifacts/authoring-verification/verification-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  if (page && !page.isClosed()) await fs.writeFile(path.join(output, 'failure.html'), await page.content().catch(() => ''));
  const windows = await application?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ id: window.id, destroyed: window.isDestroyed(), url: window.webContents.getURL(), loading: window.webContents.isLoading(), crashed: window.webContents.isCrashed() }))).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, phase, checks, errors, events, windows, failure: String(error) }, null, 2));
  throw error;
} finally { await application?.close().catch(() => undefined); }
}

main().catch(error => {
  console.error(String(error));
  process.exitCode = 1;
});
