import { endingVisible, endingTestHelper } from './lib/ending-fixture';
import { openStoryMode } from './lib/story-workspace';
import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema, type Project, type NodeKind, type StoryNode } from '../src/core/model';
import { validateProject } from '../src/core/validate';
import { runRenpy } from '../src/runtime/service';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = path.join(root, 'resources', 'runtime');
const output = path.join(root, 'artifacts', 'interaction-authoring-verification', new Date().toISOString().replaceAll(':', '-'));
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-ia-'));
const projectDir = path.join(work, 'project');
const projectFile = path.join(projectDir, 'project.vns.json');
const userData = path.join(work, 'profile');
const exportDir = path.join(work, 'exports');
const checks: string[] = [];
const errors: string[] = [];
const phases: { phase: string; at: string }[] = [];
const report: Record<string, unknown> = { passed: false, output, work, projectFile, checks, errors, phases, scope: 'Actual Electron UI authoring and native save/export. Only OS chooser replies are supplied; every project mutation uses visible controls. The exact saved snapshot and native release are tested with RenPy and the exported ZIP executable.' };
let phase = 'prepare';
let app: ElectronApplication | undefined;
let page: Page | undefined;
const setPhase = (next: string) => { phase = next; phases.push({ phase, at: new Date().toISOString() }); console.log(phase); };
const hash = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const inspector = () => page!.locator('.inspector');
const field = (label: string, scope: Locator = inspector()) => scope.getByLabel(label, { exact: true });
const action = (name: string, scope: Locator = inspector()) => scope.locator('.action-editor').filter({ has: page!.locator('.action-editor-header > strong').filter({ hasText: new RegExp(`^(?:\\d+\\. )?${name}$`) }) });
const selectNode = async (name: string) => { await page!.locator('.tree-node').filter({ has: page!.getByText(name, { exact: true }) }).click(); };
const selectTarget = async (label: string, name: string, scope: Locator = inspector()) => { await field(label, scope).selectOption({ label: name }); };
async function addNode(kind: NodeKind, name: string) {
  await page!.getByLabel('添加剧情节点', { exact: true }).selectOption(kind);
  await field('名称').fill(name);
}
async function save() {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 15_000 });
  return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
}
async function capture(name: string) { await page!.screenshot({ path: path.join(output, `${name}.png`) }); }

async function runExecutable(executable: string, args: string[], cwd: string, extraEnv: Record<string, string> = {}) {
  return new Promise<{ code: number; log: string }>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...extraEnv };
    delete env.PYTHONHOME; delete env.PYTHONPATH; delete env.RENPY_BASE;
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180_000);
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', (text: string) => { log = (log + text).slice(-1_000_000); process.stdout.write(text); });
    }
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: timedOut ? 124 : code ?? 1, log }); });
  });
}

function driverFor(project: Project) {
  const named = <K extends StoryNode['kind']>(name: string, kind: K) => {
    const node = project.nodes.find(node => node.name === name);
    if (node?.kind !== kind) throw new Error(`Missing UI-authored ${name}`);
    return node as Extract<StoryNode, { kind: K }>;
  };
  const hotspot = named('作者点击互动', 'interaction');
  const actorHotspot = hotspot.hotspots.find(item => item.characterId)!;
  const sceneHotspot = hotspot.hotspots.find(item => !item.characterId)!;
  const background = project.effects.find(effect => effect.name === '共享入场镜头')!.actions!.find(item => item.kind === 'background')!;
  const password = named('作者密码锁', 'minigame');
  const timed = named('作者限时点击', 'minigame');
  const success = named('作者成功', 'passage');
  const failure = named('作者失败', 'passage');
  const cancel = named('作者取消', 'passage');
  const title = project.ui.components.find(component => component.text === '互动作者验收')!;
  const begin = `    click id "vn_main_start"
    advance until "共享演出第二次调用。"
    advance until screen "vn_interaction"
`;
  const reachPassword = `${begin}    click id "vn_hotspot_${actorHotspot.id}"
    pause until screen "vn_minigame_password"
`;
  const reachTimed = `${reachPassword}    run Function(vn_authoring_text, "归来")
    pause until eval (vn_minigame_answer == "归来")
    click id "vn_minigame_submit"
    pause until screen "vn_minigame_timed_clicks"
`;
  const end = (node: Extract<StoryNode, { kind: 'passage' }>) => `    pause until eval ${endingVisible(project, node)}
    assert eval (vn_current_node == ${JSON.stringify(node.id)})
    assert eval ${endingVisible(project, node)}
`;
  return `${endingTestHelper}
init python:
    import pygame_sdl2 as vn_authoring_pygame
    def vn_authoring_text(value):
        vn_authoring_pygame.event.post(vn_authoring_pygame.event.Event(vn_authoring_pygame.TEXTINPUT, text=value, test=True))
    def vn_authoring_actor():
        return renpy.game.context().scene_lists.get_displayable_by_tag("master", "vn_actor_char_yu").state
    def vn_authoring_actor_x():
        value = vn_authoring_actor().xpos
        return getattr(value, "relative", value)
    def vn_authoring_camera():
        return renpy.game.context().scene_lists.layer_transform["master"].state
    def vn_authoring_has_text(displayable, text):
        if displayable is None:
            return False
        if isinstance(displayable, renpy.text.text.Text) and text in displayable.get_all_text():
            return True
        return any(vn_authoring_has_text(child, text) for child in displayable.visit())

testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
        if not screen "main_menu":
            run MainMenu(confirm=False)
    teardown:
        exit

testcase authored_success:
    pause until screen "main_menu"
    assert eval vn_authoring_has_text(renpy.get_widget("main_menu", "vn_component_${title.id}"), "互动作者验收")
    assert eval (renpy.get_widget("main_menu", "vn_component_${title.id}") is not None)
    screenshot "authored-title.png"
    click id "vn_main_start"
    advance until "演出已就绪，开始互动。"
    pause until eval (abs(vn_authoring_actor_x() - 0.6) < 0.000001)
    pause until eval (abs(vn_authoring_camera().zoom - 1.08) < 0.000001)
    $ print("AUTHORED_TRANSFORM", vn_authoring_actor_x(), vn_authoring_actor().zoom, vn_authoring_actor().rotate, vn_authoring_actor().alpha, vn_authoring_camera().zoom, vn_authoring_camera().xoffset)
    assert eval (abs(vn_authoring_actor().zoom - 0.75) < 0.01)
    assert eval (abs(vn_authoring_actor().rotate - 4.0) < 0.01 and abs(vn_authoring_actor().alpha - 0.9) < 0.01)
    assert eval (abs(vn_authoring_camera().zoom - 1.08) < 0.01 and abs(vn_authoring_camera().xoffset - ${project.width * 0.03}) < 0.1)
    screenshot "authored-effect-first.png"
    advance until "共享演出第二次调用。"
    pause until eval (abs(vn_authoring_actor_x() - 0.6) < 0.000001)
    pause until eval (abs(vn_authoring_camera().zoom - 1.08) < 0.000001)
    assert eval (abs(vn_authoring_camera().zoom - 1.08) < 0.01)
    advance until screen "vn_interaction"
    assert eval (vn_current_node == "${hotspot.id}")
    assert eval renpy.showing("vn_actor_char_yu")
    screenshot "authored-hotspot.png"
    run FileSave("authored_stage", confirm=False, slot=True)
    click id "vn_hotspot_${actorHotspot.id}"
    pause until screen "vn_minigame_password"
    run FileLoad("authored_stage", confirm=False, slot=True)
    pause until screen "vn_interaction"
    assert eval (renpy.showing("vn_background_${background.assetId}") and renpy.showing("vn_actor_char_yu"))
    assert eval (abs(vn_authoring_actor_x() - 0.6) < 0.01 and abs(vn_authoring_actor().alpha - 0.9) < 0.01)
    assert eval (abs(vn_authoring_camera().zoom - 1.08) < 0.01)
    screenshot "authored-restored-stage.png"
    click id "vn_hotspot_${actorHotspot.id}"
    pause until screen "vn_minigame_password"
    assert eval (vn_current_node == "${password.id}" and vn_minigame_remaining == 2)
    run Function(vn_authoring_text, "归来")
    pause until eval (vn_minigame_answer == "归来")
    screenshot "authored-password.png"
    click id "vn_minigame_submit"
    pause until screen "vn_minigame_timed_clicks"
    assert eval (vn_current_node == "${timed.id}" and vn_minigame_clicks == 0)
    click id "vn_minigame_click"
    assert eval (vn_minigame_clicks == 1)
    screenshot "authored-timed.png"
    click id "vn_minigame_click"
    click id "vn_minigame_click"
${end(success)}
testcase authored_scene_hotspot:
${begin}    assert eval renpy.showing("vn_background_${background.assetId}")
    click id "vn_hotspot_${sceneHotspot.id}"
    pause until screen "vn_minigame_password"
    assert eval (vn_current_node == "${password.id}")
    click id "vn_minigame_cancel"
${end(cancel)}
testcase authored_hotspot_cancel:
${begin}    click id "vn_interaction_cancel"
${end(cancel)}
testcase authored_hotspot_timeout:
${begin}    pause until eval (vn_current_node == "${failure.id}")
${end(failure)}
testcase authored_password_failure:
${reachPassword}    type "wrong" id "vn_minigame_input"
    click id "vn_minigame_submit"
    assert eval (vn_minigame_remaining == 1)
    type "wrong" id "vn_minigame_input"
    click id "vn_minigame_submit"
${end(failure)}
testcase authored_password_cancel:
${reachPassword}    click id "vn_minigame_cancel"
${end(cancel)}
testcase authored_timed_failure:
${reachTimed}    pause until eval (vn_current_node == "${failure.id}")
${end(failure)}
testcase authored_timed_cancel:
${reachTimed}    click id "vn_minigame_cancel"
${end(cancel)}
`;
}

await fs.mkdir(output, { recursive: true });
try {
  setPhase('launch native editor from an unchanged bundled example copy');
  await fs.cp(path.join(root, 'resources', 'example'), projectDir, { recursive: true });
  const original = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, VNS_USER_DATA: userData, VNS_PROJECT_PATH: projectFile, VNS_RENPY_SDK: sdk }).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.VNS_DEV_URL; delete env.VNS_TEST_ROOT;
  app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await expect(page.locator('.project-title strong')).toHaveText(original.name);
  await app.evaluate(({ dialog }, data) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: data.projectFile });
    dialog.showOpenDialog = async (...args: unknown[]) => {
      const options = args.at(-1) as { title?: string };
      return { canceled: false, filePaths: options.title === '选择游戏导出目录' ? [data.exportDir] : [data.projectFile] };
    };
  }, { projectFile, exportDir });

  setPhase('author two animation keyframes, camera and a reusable effect through visible controls');
  await openStoryMode(page, 'script');
  await selectNode('雨停了');
  const opening = page.locator('#node-opening');
  await opening.getByLabel('第1行对白', { exact: true }).fill('演出已就绪，开始互动。');
  await action('显示角色').getByLabel('横向位置 %', { exact: true }).fill('45');
  await action('显示角色').getByLabel('缩放 %', { exact: true }).fill('70');
  await action('显示角色').getByLabel('角色过渡 · 入场过渡', { exact: true }).selectOption('none');
  await action('切换背景').getByLabel('转场', { exact: true }).selectOption('none');
  await page.getByLabel('添加演出动作', { exact: true }).selectOption('animate');
  const animation = action('角色动画');
  await animation.getByLabel('完成动画后继续', { exact: true }).check();
  for (const [index, x, scale, rotation, opacity, duration] of [[0, 45, 70, 0, 100, 0.1], [1, 60, 75, 4, 90, 0.2]]) {
    await animation.getByLabel('横向位置 %', { exact: true }).nth(index).fill(String(x));
    await animation.getByLabel('缩放 %', { exact: true }).nth(index).fill(String(scale));
    await animation.getByLabel('旋转 度', { exact: true }).nth(index).fill(String(rotation));
    await animation.getByLabel('不透明度 %', { exact: true }).nth(index).fill(String(opacity));
    await animation.getByLabel('到达时长 秒', { exact: true }).nth(index).fill(String(duration));
  }
  await page.getByLabel('添加演出动作', { exact: true }).selectOption('camera');
  const camera = action('镜头');
  await camera.getByLabel('横向偏移 %', { exact: true }).fill('3');
  await camera.getByLabel('镜头缩放 %', { exact: true }).fill('112');
  await camera.getByLabel('运动时长 秒', { exact: true }).fill('0.2');
  await camera.getByLabel('完成运动后继续', { exact: true }).check();
  await capture('01-authored-animation-camera');
  await inspector().getByRole('button', { name: '保存为效果', exact: true }).click();
  await field('新效果名称').fill('作者共享演出');
  await inspector().getByRole('button', { name: '保存效果', exact: true }).click();
  await opening.getByLabel('第2行对白', { exact: true }).fill('共享演出第二次调用。');
  await page.getByLabel('添加演出动作', { exact: true }).selectOption('effect');
  await field('效果实例').selectOption({ label: '作者共享演出' });
  await page.getByRole('button', { name: '管理效果', exact: true }).click();
  const manager = page.getByRole('dialog', { name: '管理效果', exact: true });
  await manager.getByLabel('效果名称', { exact: true }).fill('共享入场镜头');
  await manager.getByLabel('镜头缩放 %', { exact: true }).fill('108');
  await expect(manager.locator('.effect-manager-references li')).toHaveCount(2);
  await capture('02-authored-shared-effect');
  await manager.getByRole('button', { name: '保存修改', exact: true }).click();
  checks.push('Edited two character keyframes and camera parameters through forms; captured the action group as one shared effect, referenced it on two lines, then changed the shared camera zoom through the effect manager.');

  setPhase('author hotspot, password, timed-click configuration and all exits through visible controls');
  await openStoryMode(page, 'text');
  const endingSource = page.getByRole('textbox', { name: '中文文本剧本', exact: true });
  for (const [name, text] of [['作者成功', '作者配置的互动成功。'], ['作者失败', '作者配置的互动失败。'], ['作者取消', '作者配置的互动已取消。']]) {
    await endingSource.fill((await endingSource.inputValue()) + `\n# 段落：${name}\n@结局演出：文字=${JSON.stringify(text)}\n@独立演出：${name}\n@返回标题界面\n`);
  }
  await openStoryMode(page, 'script');
  await addNode('interaction', '作者点击互动');
  await field('互动提示').fill('点击小雨继续');
  await field('超时秒数（0 为不限时）').fill('3');
  await field('区域名称').fill('小雨入口');
  await field('关联角色').selectOption({ label: '小雨' });
  await field('左侧位置 %').fill('45');
  await field('顶部位置 %').fill('20');
  await field('区域宽度 %').fill('30');
  await field('区域高度 %').fill('45');
  await inspector().getByRole('button', { name: '添加互动区域', exact: true }).click();
  const sceneRegion = inspector().locator('.choice-editor').nth(1);
  await field('区域名称', sceneRegion).fill('查看校门');
  await field('关联角色', sceneRegion).selectOption('');
  await field('左侧位置 %', sceneRegion).fill('5');
  await field('顶部位置 %', sceneRegion).fill('20');
  await field('区域宽度 %', sceneRegion).fill('25');
  await field('区域高度 %', sceneRegion).fill('40');
  await addNode('minigame', '作者密码锁');
  await field('小游戏标题').fill('归来的口令');
  await field('小游戏提示').fill('请输入中文口令');
  await field('正确密码').fill('归来');
  await field('允许尝试次数').fill('2');
  await capture('03-authored-password');
  await addNode('minigame', '作者限时点击');
  await field('小游戏类型').selectOption('timedClicks');
  await field('小游戏标题').fill('完成三次点击');
  await field('小游戏提示').fill('三秒内完成三次点击');
  await field('目标点击次数').fill('3');
  await field('限时秒数').fill('3');
  for (const [name, target] of [['作者密码锁', '作者限时点击'], ['作者限时点击', '作者成功']]) {
    await selectNode(name);
    await selectTarget('成功后前往', target);
    await selectTarget('失败后前往', '作者失败');
    await selectTarget('取消后前往', '作者取消');
  }
  await selectNode('作者点击互动');
  for (const index of [0, 1]) await selectTarget('点击后前往', '作者密码锁', inspector().locator('.choice-editor').nth(index));
  await selectTarget('超时后前往', '作者失败');
  await selectTarget('取消后前往', '作者取消');
  await capture('04-authored-hotspot');
  await selectNode('雨停了');
  await selectTarget('接下来', '作者点击互动');
  checks.push('Created separate character-linked and scene-only hotspots, Chinese password, timed-click game and three endings; connected success, failure, cancel and timeout ports through their visible selectors.');

  setPhase('author a Chinese title-page component, save and reload the same project');
  await page.getByRole('button', { name: '界面', exact: true }).click();
  await page.getByRole('button', { name: '添加文字', exact: true }).click();
  await field('文字').fill('互动作者验收');
  await field('横向位置 %').fill('6');
  await field('纵向位置 %').fill('30');
  await field('宽度 %').fill('40');
  await capture('05-authored-title');
  const authored = await save();
  assert.deepEqual(validateProject(authored).filter(issue => issue.severity === 'error'), []);
  const effect = authored.effects.find(item => item.name === '共享入场镜头')!;
  assert.ok(effect.actions?.some(item => item.kind === 'animate' && item.keyframes.length === 2 && item.keyframes[1].x === 0.6));
  assert.ok(effect.actions?.some(item => item.kind === 'camera' && item.zoom === 1.08 && item.wait));
  const authoredOpening = authored.nodes.find(node => node.id === 'opening');
  assert.ok(authoredOpening?.kind === 'passage' && authoredOpening.lines.every(line => line.actions.some(item => item.kind === 'effect' && item.effectId === effect.id)));
  assert.equal(authored.nodes.filter(node => node.kind === 'interaction').length, 1);
  const authoredHotspot = authored.nodes.find(node => node.kind === 'interaction');
  assert.ok(authoredHotspot?.kind === 'interaction' && authoredHotspot.hotspots.length === 2 && authoredHotspot.hotspots.some(item => item.characterId) && authoredHotspot.hotspots.some(item => !item.characterId));
  assert.equal(authored.nodes.filter(node => node.kind === 'minigame').length, 2);
  const snapshot = path.join(output, 'ui-authored-project.vns.json');
  await fs.copyFile(projectFile, snapshot);
  const snapshotHash = await hash(snapshot);
  Object.assign(report, { snapshot, snapshotSha256: snapshotHash, authored: { projectId: authored.id, nodes: authored.nodes.length, effectId: effect.id, uiComponents: authored.ui.components.length } });
  await page.reload();
  await expect(page.locator('.project-title strong')).toHaveText(authored.name);
  assert.deepEqual(projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))), authored);
  checks.push('Authored a Chinese title-page text component, saved via native IPC, copied the exact saved snapshot for evidence, and reloaded it without changing project data.');

  setPhase('export the UI-authored snapshot through the native export command');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByRole('dialog', { name: '作品设置', exact: true }).getByRole('button', { name: '选择目录并导出', exact: true }).click();
  await expect(page.locator('.status-message')).toContainText('游戏已导出', { timeout: 300_000 });
  assert.equal(await hash(projectFile), snapshotHash);
  const releaseParent = path.join(userData, 'builds', authored.id, 'release');
  const releases = await fs.readdir(releaseParent);
  assert.equal(releases.length, 1);
  const release = path.join(releaseParent, releases[0]);
  const zipName = (await fs.readdir(exportDir)).find(file => file.endsWith('-win.zip'))!;
  assert.ok(zipName);
  const zipPath = path.join(exportDir, zipName);
  const zipHash = await hash(zipPath);
  const exportedZip = path.join(output, zipName);
  await fs.copyFile(zipPath, exportedZip);
  const driver = driverFor(authored);
  await fs.writeFile(path.join(output, 'authored-testcases.rpy'), driver);
  const expectedAssertions = driver.split('\n').filter(line => /^\s+assert\s/.test(line)).length;
  const story = await fs.readFile(path.join(release, 'game', 'story.rpy'), 'utf8');
  assert.ok(story.includes('zoom 1.08') && story.includes('rotate 4 alpha 0.9') && story.includes('xpos 0.600000'));
  await fs.copyFile(path.join(release, 'game', 'story.rpy'), path.join(output, 'authored-story.rpy'));
  await fs.copyFile(path.join(release, 'game', 'screens.rpy'), path.join(output, 'authored-screens.rpy'));
  Object.assign(report, { release, zipPath: exportedZip, zipSha256: zipHash, cases: 8, assertionsPerRun: expectedAssertions });
  await app.close(); app = undefined; page = undefined;

  setPhase('run eight routes and numeric animation/camera assertions in the native release');
  await fs.writeFile(path.join(release, 'game', 'testcases.rpy'), driver);
  const tested = await runRenpy(sdk, release, ['test', '--report-detailed'], { savedir: path.join(work, 'sdk-saves'), timeoutMs: 180_000, onData: text => process.stdout.write(text) });
  await fs.writeFile(path.join(output, 'native-release-tests.log'), tested.log);
  assert.equal(tested.code, 0);
  assert.match(tested.log, /Test cases\s*:\s*8\s*\|\s*8 passed/);
  assert.match(tested.log, new RegExp(`Assertions\\s*:\\s*${expectedAssertions}\\s*\\|\\s*${expectedAssertions} passed`));

  setPhase('extract outside the source tree and execute the same eight routes with the ZIP executable');
  const unpack = path.join(work, 'unpacked');
  const entriesPath = path.join(output, 'zip-entries.json');
  const extracted = await runExecutable('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$archive = [System.IO.Compression.ZipFile]::OpenRead($env:VNS_IA_ZIP)',
    'try {',
    '  $names = @($archive.Entries | ForEach-Object { $_.FullName })',
    '  [System.IO.File]::WriteAllText($env:VNS_IA_ENTRIES, (ConvertTo-Json -InputObject $names), [System.Text.UTF8Encoding]::new($false))',
    '} finally { $archive.Dispose() }',
    '[System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_IA_ZIP, $env:VNS_IA_UNPACK)',
  ].join('\n')], work, { VNS_IA_ZIP: zipPath, VNS_IA_ENTRIES: entriesPath, VNS_IA_UNPACK: unpack });
  assert.equal(extracted.code, 0);
  const entries = JSON.parse(await fs.readFile(entriesPath, 'utf8')) as string[];
  assert.deepEqual(entries.filter(file => /^[^/]+\/(game\/(testcases\.rpyc?|saves)|tests|player-saves|sdk-saves|verification)(\/|$)/i.test(file)), []);
  const directories = (await fs.readdir(unpack, { withFileTypes: true })).filter(item => item.isDirectory());
  assert.equal(directories.length, 1);
  const unpackedProject = path.join(unpack, directories[0].name);
  assert.ok(path.relative(root, unpackedProject).startsWith(`..${path.sep}`) || path.isAbsolute(path.relative(root, unpackedProject)));
  for (const file of ['story.rpy', 'screens.rpy', 'options.rpy']) assert.equal(await hash(path.join(unpackedProject, 'game', file)), await hash(path.join(release, 'game', file)));
  await fs.writeFile(path.join(unpackedProject, 'game', 'testcases.rpy'), driver);
  const packaged = await runExecutable(path.join(unpackedProject, `${authored.id}.exe`), ['--savedir', path.join(work, 'package-saves'), unpackedProject, 'test', '--report-detailed'], unpackedProject);
  await fs.writeFile(path.join(output, 'exported-executable-tests.log'), packaged.log);
  assert.equal(packaged.code, 0);
  assert.match(packaged.log, /Test cases\s*:\s*8\s*\|\s*8 passed/);
  assert.match(packaged.log, new RegExp(`Assertions\\s*:\\s*${expectedAssertions}\\s*\\|\\s*${expectedAssertions} passed`));
  assert.equal(await hash(zipPath), zipHash);
  assert.equal(await hash(exportedZip), zipHash);
  assert.equal(await hash(projectFile), snapshotHash);
  assert.deepEqual(errors, []);
  await fs.cp(path.join(unpackedProject, 'tests', 'screenshots'), path.join(output, 'export-screenshots'), { recursive: true });
  Object.assign(report, { passed: true, unpackedProject, archiveUnchanged: true, archiveExcludesTestsAndSaves: true, snapshotUnchanged: true });
  checks.push('The saved UI snapshot compiled through native export; both its release and its ZIP executable passed all eight routes, title-page assertions, shared-camera values and character final transform values.');
  checks.push('Both scene and character hotspots are clicked in the saved game; a save/load round trip restores the background, visible character, character position/opacity and camera zoom before the success route continues. Detailed timer and minigame-progress recovery remain covered by the separate 14-case interaction runtime verification.');
  checks.push('ZIP contains no authored testcases or saves, extracted game code matches the native release, and snapshot plus original ZIP hashes remain unchanged.');
} catch (error) {
  report.error = String(error).slice(0, 5000);
  report.failedPhase = phase;
  if (page && !page.isClosed()) await capture('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
