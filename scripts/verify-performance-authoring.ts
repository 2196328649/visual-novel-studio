import { showCharacterFixtureId } from './lib/show-character-fixture';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type Project } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { saveProject } from '../src/desktop/project-store';
import { buildProject, runRenpy } from '../src/runtime/service';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts/performance-authoring', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
const templateRoot = path.join(root, 'resources/templates/aihong');
const template = JSON.parse(await fs.readFile(path.join(templateRoot, 'project.vns.json'), 'utf8')) as Project;
const project = createProject('演出封装与发言角色验证');
project.playerDefaults = { ...project.playerDefaults, masterVolume: 0, textSpeed: 0 };
project.ui.chapterTransition = structuredClone(template.ui.chapterTransition);
const character = structuredClone(template.characters.find(character => character.name === '苏怜烟')!);
character.expressions = []; delete character.blueprintId; delete character.features; delete character.baseCharacterId;
for (const [id, name, file] of [['test_normal', '通常', '21通常.png'], ['test_worried', '担忧', '31担忧.png']]) {
  const bytes = await fs.readFile(path.join('E:/Project/Model/SLY/T/texture/character/苏怜烟', file));
  const relative = `assets/portraits/${id}.png`, target = path.join(path.dirname(projectFile), relative); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes);
  project.assets.push({ id, name: `${character.name} · ${name}`, kind: 'image', category: 'portrait', path: relative, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
  character.expressions.push({ id: `expression_${id}`, name, assetId: id });
}
character.defaultExpressionId = character.expressions[0].id; project.characters.push(character);
const names = ['章节进场 · 夜宴庭院', '章节题字 · 记第一回 醉梦', '花街柳巷'];
const ids = [...Object.values(project.ui.chapterTransition ?? {}), ...character.expressions.map(expression => expression.assetId)];
for (const asset of template.assets.filter(asset => names.includes(asset.name) || ids.includes(asset.id))) {
  const target = path.join(path.dirname(projectFile), asset.path); await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(templateRoot, asset.path), target); project.assets.push(structuredClone(asset));
}
const source = `# 章节：第一章
# 小章节：庭院
# 段落：开场
@章节标题：第一章 · 酒醒城破｜庭院里的一夜｜1.2
@章节背景：章节进场 · 夜宴庭院
@章节题图：章节题字 · 记第一回 醉梦
@章节配乐：花街柳巷
${character.name}：第一句，天快亮了。
旁白：雨停在屋檐上。
${character.name}：第二句，我们出发吧。\n@返回标题界面`;
const initial = applyTextScript(project, source); expect(initial.issues).toEqual([]); await saveProject(projectFile, initial.project);
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } }); await server.listen();
const env = Object.fromEntries(Object.entries({ ...process.env, VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: path.join(output, 'profile'), VNS_DEV_URL: `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` }).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const checks: string[] = [], errors: string[] = [];
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 60_000 }); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 1020));
  await openStoryMode(page, 'text'); const input = page.getByLabel('中文文本剧本', { exact: true });
  const select = async (from: string, through = from) => {
    await input.evaluate((element, [from, through]) => { const input = element as HTMLTextAreaElement; const start = input.value.indexOf(from); const end = input.value.indexOf(through, start) + through.length; input.focus({ preventScroll: true }); input.setSelectionRange(start, end); input.dispatchEvent(new Event('select', { bubbles: true })); }, [from, through]);
  };
  phase = 'encapsulate chapter selection';
  await select('@章节标题', '@章节配乐：花街柳巷');
  await input.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 430, clientY: 300 })));
  await expect(page.getByRole('menu', { name: '文本编辑菜单' })).toBeInViewport();
  await page.getByRole('menuitem', { name: '封装选中演出为蓝图…' }).click();
  await page.getByLabel('蓝图名称', { exact: true }).fill('庭院入场'); await page.getByLabel('资源分组', { exact: true }).fill('演出 / 章节 / 庭院');
  await page.screenshot({ path: path.join(output, 'encapsulate-dialog.png') });
  await page.getByRole('button', { name: '封装并替换选中演出', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '封装演出为蓝图' })).toHaveCount(0);
  const encapsulated = await input.inputValue(); expect(encapsulated).toContain('@蓝图：庭院入场'); expect(encapsulated).not.toMatch(/【|@章节标题|# 段落：段落 \d/);
  await select('@蓝图：庭院入场'); await input.press('ArrowRight');
  await expect(page.locator('.chapter-preview.is-static')).toBeVisible();
  await page.getByRole('button', { name: '播放预览', exact: true }).click(); await expect(page.locator('.chapter-preview.is-playing')).toBeVisible();
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-phase', 'finished', { timeout: 10000 });
  await page.getByRole('button', { name: '撤销文本修改', exact: true }).click(); await expect(input).toHaveValue(source);
  await page.getByRole('button', { name: '重做文本修改', exact: true }).click(); await expect(input).toHaveValue(encapsulated);
  checks.push('四条章节指令封装成一条蓝图调用，原章节动画可预览；一次撤销及重做同时恢复文本和蓝图。');

  phase = 'ctrl click and group defaults';
  await select('@蓝图：庭院入场'); await input.dispatchEvent('click', { ctrlKey: true });
  await expect(page.getByLabel('演出目标')).toBeVisible();
  await page.getByRole('button', { name: '输入与输出', exact: true }).click();
  await expect(page.getByLabel('资源分组', { exact: true })).toHaveValue('演出 / 章节 / 庭院');
  await page.getByLabel('时长的默认值', { exact: true }).fill('1.3'); await page.getByLabel('时长的默认值', { exact: true }).press('Tab');
  await page.screenshot({ path: path.join(output, 'blueprint-parameters.png') });
  await openStoryMode(page, 'text'); await select('@蓝图：庭院入场'); await input.press('End'); await page.getByRole('button', { name: '插入指令', exact: true }).click();
  await page.getByLabel('筛选中文指令', { exact: true }).fill('tyrc');
  await expect(page.locator('.text-blueprint-folder[data-group="演出 / 章节 / 庭院"]')).toBeVisible();
  await page.getByRole('button', { name: /庭院入场.*7 个输入/ }).click();
  await expect(page.getByLabel('通用蓝图', { exact: true })).toBeVisible();
  await expect(page.getByLabel('时长', { exact: true })).toHaveValue('1.3');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  checks.push('Ctrl+点击打开对应蓝图；输入默认值可编辑，/ 菜单按嵌套资源分组显示，并支持拼音首字母搜索。');

  phase = 'batch selected lines from context menu';
  const beforeSelectedBatch = await input.inputValue();
  await select(`${character.name}：第一句，天快亮了。`, '旁白：雨停在屋檐上。');
  await input.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 430, clientY: 300 })));
  await page.getByRole('menuitem', { name: '为选中台词添加演出…', exact: true }).click();
  await expect(page.getByLabel('包含旁白')).not.toBeChecked();
  await expect(page.getByRole('button', { name: '添加到 1 句台词', exact: true })).toBeEnabled();
  await page.getByLabel('包含旁白').check();
  await expect(page.getByRole('button', { name: '添加到 2 句台词', exact: true })).toBeEnabled();
  await page.getByLabel('包含旁白').uncheck();
  await page.screenshot({ path: path.join(output, 'batch-selected-dialog.png') });
  await page.getByRole('button', { name: '添加到 1 句台词', exact: true }).click();
  expect((await input.inputValue()).match(/@蓝图：跟随发言人测试/g)).toHaveLength(1);
  await openStoryMode(page, 'script');
  await expect(page.locator('.story-line').filter({ hasText: '第一句，天快亮了。' }).locator('.line-effect-chip').filter({ hasText: '跟随发言人测试' })).toHaveCount(1);
  await expect(page.locator('.story-line').filter({ hasText: /雨停在屋檐上。|第二句，我们出发吧。/ }).locator('.line-effect-chip').filter({ hasText: '跟随发言人测试' })).toHaveCount(0);
  await page.getByRole('button', { name: '撤销文本修改', exact: true }).click();
  await openStoryMode(page, 'text');
  await expect(input).toHaveValue(beforeSelectedBatch);
  checks.push('右键只处理选中台词：包含旁白开关正确计算范围，默认只添加选中的发言句，不影响旁白和未选台词；一次撤销恢复。');

  phase = 'batch speaker and individual override';
  await page.getByRole('button', { name: '批量演出', exact: true }).click(); await expect(page.getByLabel('包含旁白')).not.toBeChecked();
  await page.getByRole('button', { name: '添加到 2 句台词', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '批量添加演出' })).toHaveCount(0);
  expect((await input.inputValue()).match(/@蓝图：跟随发言人测试/g)).toHaveLength(2);
  await openStoryMode(page, 'script');
  const second = page.locator('.story-line').filter({ hasText: '跟随发言人测试' }).last();
  await second.locator('.line-effect-chip').filter({ hasText: '跟随发言人测试' }).click();
  await second.getByLabel('单独设置表情', { exact: true }).check(); await second.getByLabel('表情', { exact: true }).selectOption(character.expressions[1].id);
  await expect(page.locator('.text-stage-actor img')).toHaveAttribute('alt', `${character.name}：${character.expressions[1].name}`);
  await page.screenshot({ path: path.join(output, 'per-line-expression.png') });
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
  const dialogue = saved.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);
  expect(dialogue.filter(line => !line.speakerId).every(line => !line.actions.some(action => action.kind === 'blueprint' && action.blueprintId === showCharacterFixtureId))).toBe(true);
  expect(dialogue.filter(line => line.speakerId)).toHaveLength(2);
  await page.reload(); await openStoryMode(page, 'text'); expect(await input.inputValue()).toContain(`表情=${character.expressions[1].name}`);
  expect(errors).toEqual([]);
  checks.push('批量添加默认排除旁白，自动匹配角色；模块里逐句设置表情会实时更新预览，保存重开保持参数。');
  await app.close(); app = undefined; await server.close();

  phase = 'native RenPy chapter and speaker runtime';
  const sdk = path.join(root, 'resources/runtime'), game = path.join(output, 'native');
  const built = await buildProject({ project: saved, projectDir: path.dirname(projectFile), sdkRoot: sdk, outputDir: game, development: true });
  await fs.writeFile(path.join(output, 'native-build.log'), built.log + '\n' + JSON.stringify(built.diagnostics)); expect(built.ok).toBe(true);
  const bgm = saved.assets.find(asset => asset.name === '花街柳巷')!;
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase chapter_and_speaker_blueprints:
    click id "vn_main_start"
    pause until screen "vn_chapter_title"
    assert eval (renpy.get_screen("vn_chapter_title").scope["duration"] == 1.3)
    screenshot "native-chapter.png"
    advance until "第一句，天快亮了。"
    assert eval (vn_current_speaker == "${character.id}")
    assert eval (renpy.get_attributes("vn_actor_${character.id}") == ("${character.expressions[0].id}",))
    assert eval (renpy.music.get_playing(channel="music") == ${JSON.stringify(bgm.path.replaceAll('\\', '/'))})
    run FileSave("speaker_first", confirm=False, slot=True)
    advance until "雨停在屋檐上。"
    assert eval (vn_current_speaker is None)
    advance until "第二句，我们出发吧。"
    assert eval (renpy.get_attributes("vn_actor_${character.id}") == ("${character.expressions[1].id}",))
    screenshot "native-expression-override.png"
    run FileLoad("speaker_first", confirm=False, slot=True)
    pause until "第一句，天快亮了。"
    assert eval (vn_current_speaker == "${character.id}")
    assert eval (renpy.get_attributes("vn_actor_${character.id}") == ("${character.expressions[0].id}",))
    run MainMenu(confirm=False)
    pause until screen "main_menu"
`);
  const lint = await runRenpy(sdk, game, ['lint']); await fs.writeFile(path.join(output, 'native-lint.log'), lint.log); expect(lint.code).toBe(0);
  const runtime = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000 });
  await fs.writeFile(path.join(output, 'native-test.log'), runtime.log); expect(runtime.code, runtime.log).toBe(0); expect(runtime.log).toMatch(/Test cases\s*:\s*1\s*\|\s*1 passed/);
  checks.push('实际 Ren’Py 试玩通过：章节蓝图时长参数、配乐、默认及覆盖表情、旁白跳过，以及存读档恢复。未打包或导出。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, packaged: false, userProjectModified: false }, null, 2)); console.log(`PASS: ${checks.length} checks. ${output}`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2)); console.error(error); console.log(output); process.exitCode = 1;
} finally { await app?.close(); await server.close(); }
