import { showCharacterFixtureId, createShowCharacterFixture } from './lib/show-character-fixture';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type Project } from '../src/core/model';
import { actionText, applyTextScript } from '../src/core/text-script';
import { textDocument } from '../src/core/text-document';
import { availablePerformanceBlueprints, installPerformanceBlueprint } from '../src/core/builtin-performances';
import { saveProject } from '../src/desktop/project-store';
import { buildProject, runRenpy } from '../src/runtime/service';
import { openStoryMode } from './lib/story-workspace';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { isolateRenpySaves } from './lib/renpy-saves';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

const root = path.resolve('.');
const output = path.join(root, 'artifacts/performance-authoring', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
const templateRoot = path.join(root, 'resources/templates/aihong');
const template = JSON.parse(await fs.readFile(path.join(templateRoot, 'project.vns.json'), 'utf8')) as Project;
const project = createProject('演出封装与发言角色验证');
project.playerDefaults = { ...project.playerDefaults, masterVolume: 0, textSpeed: 0 };
project.ui.chapterTransition = structuredClone(template.ui.chapterTransition);
const character = structuredClone(template.characters.find(character => character.name === '苏怜烟')!);
character.expressions = ['通常', '担忧'].map(name => character.expressions.find(expression => expression.name === name)!);
expect(character.expressions.every(Boolean)).toBe(true);
delete character.blueprintId; delete character.features; delete character.baseCharacterId;
character.defaultExpressionId = character.expressions[0].id; project.characters.push(character);
const names = ['章节进场 · 夜宴庭院', '章节题字 · 记第一回 醉梦', '花街柳巷'];
const ids = [...Object.values(project.ui.chapterTransition ?? {}), ...character.expressions.map(expression => expression.assetId)];
const fixtureAssets = new Set([...ids, ...names.map(name => template.assets.find(asset => asset.name === name)?.id)]);
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'prepare';
const checks: string[] = [], errors: string[] = [];
try {
for (const asset of template.assets.filter(asset => fixtureAssets.has(asset.id))) {
  const target = path.join(path.dirname(projectFile), asset.path); await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(templateRoot, asset.path), target); project.assets.push(structuredClone(asset));
}
installPerformanceBlueprint(project, createShowCharacterFixture());
const chapter = availablePerformanceBlueprints(project).find(graph => graph.id === 'builtin_chapter_text')!;
installPerformanceBlueprint(project, chapter);
const chapterCall = actionText(project, { kind: 'blueprint', blueprintId: chapter.id, inputs: {
  title: '第一章 · 酒醒城破', right_text: '庭院里的一夜', duration: 1.2,
  background: project.assets.find(asset => asset.name === names[0])!.id,
} });
const source = `# 章节：第一章
# 小章节：庭院
# 段落：开场
@背景：章节进场 · 夜宴庭院
@背景音乐：花街柳巷
${chapterCall}
${character.name}：第一句，天快亮了。
旁白：雨停在屋檐上。
${character.name}：第二句，我们出发吧。\n@返回标题界面`;
const initial = applyTextScript(project, source); expect(initial.issues).toEqual([]); await saveProject(projectFile, initial.project);
  phase = 'launch';
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 1020));
  await openStoryMode(page, 'text'); const input = page.getByLabel('中文文本剧本', { exact: true });
  const select = async (from: string, through = from) => {
    await input.evaluate((element, [from, through]) => { const input = element as HTMLTextAreaElement; const start = input.value.indexOf(from), last = input.value.indexOf(through, start); if (start < 0 || last < start) throw new Error('未找到选中指令：' + from); input.focus({ preventScroll: true }); input.setSelectionRange(start, last + through.length); input.dispatchEvent(new Event('select', { bubbles: true })); }, [from, through]);
  };
  const original = await input.inputValue();
  phase = 'encapsulate chapter selection';
  await select('@背景音乐：花街柳巷', textDocument(chapterCall).text);
  await input.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 430, clientY: 300 })));
  await expect(page.getByRole('menu', { name: '文本编辑菜单' })).toBeInViewport();
  await page.getByRole('menuitem', { name: '封装选中演出为蓝图…' }).click();
  await page.getByLabel('蓝图名称', { exact: true }).fill('庭院入场'); await page.getByLabel('资源分组', { exact: true }).fill('演出 / 章节 / 庭院');
  await page.screenshot({ path: path.join(output, 'encapsulate-dialog.png') });
  await page.getByRole('button', { name: '封装并替换选中演出', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '封装演出为蓝图' })).toHaveCount(0);
  const encapsulated = await input.inputValue(); expect(encapsulated).toContain('@庭院入场'); expect(encapsulated).not.toMatch(/【|@章节标题|# 段落：段落 \d/);
  await select('@庭院入场'); await input.press('ArrowRight');
  await page.getByRole('button', { name: '播放预览', exact: true }).click();
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-phase', /actions|dialogue/);
  await expect(page.locator('[data-visual-instance]').first()).toBeVisible();
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-phase', 'finished', { timeout: 10000 });
  await page.getByRole('button', { name: '撤销文本修改', exact: true }).click(); await expect(input).toHaveValue(original);
  await page.getByRole('button', { name: '重做文本修改', exact: true }).click(); await expect(input).toHaveValue(encapsulated);
  checks.push('章节时间轴与背景音乐封装成一条蓝图调用，章节组合可预览；一次撤销及重做同时恢复文本和蓝图。');

  phase = 'ctrl click and group defaults';
  await select('@庭院入场'); await input.dispatchEvent('click', { ctrlKey: true });
  await expect(page.getByLabel('演出目标')).toBeVisible();
  await expect(page.getByLabel('演出目标').locator('option:checked')).toHaveText('庭院入场');
  await page.getByRole('button', { name: '展开蓝图属性', exact: true }).click();
  await page.getByRole('button', { name: '输入与输出', exact: true }).click();
  await expect(page.getByLabel('蓝图资源分组', { exact: true })).toHaveValue('演出 / 章节 / 庭院');
  await page.getByLabel('时长的默认值', { exact: true }).fill('1.3'); await page.getByLabel('时长的默认值', { exact: true }).press('Tab');
  await page.screenshot({ path: path.join(output, 'blueprint-parameters.png') });
  await openStoryMode(page, 'text'); await input.press('Control+End'); await input.press('Enter'); await page.keyboard.insertText('/');
  await page.getByLabel('筛选中文指令', { exact: true }).fill('tyrc');
  await expect(page.locator('.node-picker .menu-group-toggle').filter({ hasText: '演出 / 章节 / 庭院' })).toBeVisible();
  await page.locator('.node-picker-results').getByRole('button', { name: /庭院入场.*个输入/ }).click();
  await expect(page.getByLabel('通用蓝图', { exact: true })).toBeVisible();
  await expect(page.getByLabel('时长', { exact: true })).toHaveValue('1.3');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '命令参数', exact: true })).toHaveCount(0);
  await input.fill((await input.inputValue()).replace(/\n\/$/, ''));
  checks.push('Ctrl+点击打开对应蓝图；输入默认值可编辑，/ 菜单按嵌套资源分组显示，并支持拼音首字母搜索。');

  phase = 'batch selected lines from context menu';
  const beforeSelectedBatch = await input.inputValue();
  await select(`${character.name}：第一句，天快亮了。`, '旁白：雨停在屋檐上。');
  await input.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 430, clientY: 300 })));
  await page.getByRole('menuitem', { name: '为选中台词添加演出…', exact: true }).click();
  await page.getByLabel('批量演出类型', { exact: true }).selectOption('blueprint');
  await page.getByLabel('批量演出蓝图', { exact: true }).selectOption(showCharacterFixtureId);
  await expect(page.getByLabel('包含旁白')).not.toBeChecked();
  await expect(page.getByRole('button', { name: '添加到 1 句台词', exact: true })).toBeEnabled();
  await page.getByLabel('包含旁白').check();
  await expect(page.getByRole('button', { name: '添加到 2 句台词', exact: true })).toBeEnabled();
  await page.getByLabel('包含旁白').uncheck();
  await page.screenshot({ path: path.join(output, 'batch-selected-dialog.png') });
  await page.getByRole('button', { name: '添加到 1 句台词', exact: true }).click();
  expect((await input.inputValue()).match(/@跟随发言人测试/g)).toHaveLength(1);
  const selectedBatch = await input.inputValue();
  await page.getByRole('button', { name: '撤销文本修改', exact: true }).click();
  await expect(input).toHaveValue(beforeSelectedBatch);
  await page.getByRole('button', { name: '重做文本修改', exact: true }).click();
  await expect(input).toHaveValue(selectedBatch);
  await openStoryMode(page, 'script');
  await expect(page.locator('.story-line').filter({ hasText: '第一句，天快亮了。' }).locator('.line-effect-chip').filter({ hasText: '跟随发言人测试' })).toHaveCount(1);
  await expect(page.locator('.story-line').filter({ hasText: /雨停在屋檐上。|第二句，我们出发吧。/ }).locator('.line-effect-chip').filter({ hasText: '跟随发言人测试' })).toHaveCount(0);
  await openStoryMode(page, 'text');
  // Entering module editing explicitly applies/normalizes the draft as its own
  // history entry. The atomic batch undo was checked before that separate step.
  await input.fill((await input.inputValue()).replace(/^@跟随发言人测试[^\r\n]*\r?\n/gm, ''));
  await page.getByRole('button', { name: '应用到项目', exact: true }).click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const resetBatch = JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
  const resetParsed = applyTextScript(resetBatch, resetBatch.scriptText!.content);
  await fs.writeFile(path.join(output, 'batch-input.json'), JSON.stringify({ source: resetBatch.scriptText!.content, issues: resetParsed.issues, sourceMap: resetParsed.sourceMap, chapters: resetParsed.project.chapters, nodes: resetParsed.project.nodes }, null, 2));
  expect(resetParsed.issues).toEqual([]);
  expect(resetParsed.project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []).filter(line => line.speakerId)).toHaveLength(2);
  checks.push('右键只处理选中台词：包含旁白开关正确计算范围，默认只添加选中的发言句，不影响旁白和未选台词；一次撤销恢复。');

  phase = 'batch speaker and individual override';
  await page.getByRole('button', { name: '批量演出', exact: true }).click(); await expect(page.getByLabel('包含旁白')).not.toBeChecked();
  await page.getByLabel('批量演出类型', { exact: true }).selectOption('blueprint');
  await page.getByLabel('批量演出蓝图', { exact: true }).selectOption(showCharacterFixtureId);
  await page.getByRole('button', { name: '添加到 2 句台词', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '批量添加演出' })).toHaveCount(0);
  expect((await input.inputValue()).match(/@跟随发言人测试/g)).toHaveLength(2);
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
  await app.close(); app = undefined;

  phase = 'native RenPy chapter and speaker runtime';
  const sdk = path.join(root, 'resources/runtime'), game = path.join(output, 'native');
  await isolateRenpySaves(output);
  const built = await buildProject({ project: saved, projectDir: path.dirname(projectFile), sdkRoot: sdk, outputDir: game, development: true });
  await fs.writeFile(path.join(output, 'native-build.log'), built.log + '\n' + JSON.stringify(built.diagnostics)); expect(built.ok).toBe(true);
  const bgm = saved.assets.find(asset => asset.name === '花街柳巷')!;
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
default qa_chapter = None
default qa_chapter_started = 0
init 100 python:
    qa_original_show_visual = vn_show_visual
    def qa_show_visual(data):
        global qa_chapter, qa_chapter_started
        if data.get("chapterPresentation"):
            qa_chapter = data
            qa_chapter_started = vn_bp_clock()
        return qa_original_show_visual(data)
    vn_show_visual = qa_show_visual
testsuite global:
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
    pause until eval qa_chapter is not None
    assert eval qa_chapter["duration"] == 1.3
    screenshot "native-chapter.png"
    pause until "第一句，天快亮了。"
    $ print("QA_CHAPTER_WAIT", vn_bp_clock() - qa_chapter_started, flush=True)
    assert eval vn_bp_clock() - qa_chapter_started >= 1.2
    assert eval (vn_current_speaker == "${character.id}")
    assert eval renpy.showing("vn_actor_${character.id}") and vn_actor_instances["vn_actor_${character.id}"]["expressionId"] == "${character.expressions[0].id}"
    assert eval (renpy.music.get_playing(channel="music") == ${JSON.stringify(bgm.path.replaceAll('\\', '/'))})
    run FileSave("speaker_first", confirm=False, slot=True)
    advance until "雨停在屋檐上。"
    assert eval (vn_current_speaker is None)
    assert eval "vn_actor_${character.id}" not in vn_actor_instances
    advance until "第二句，我们出发吧。"
    assert eval renpy.showing("vn_actor_${character.id}") and vn_actor_instances["vn_actor_${character.id}"]["expressionId"] == "${character.expressions[1].id}"
    screenshot "native-expression-override.png"
    run FileLoad("speaker_first", confirm=False, slot=True)
    pause until "第一句，天快亮了。"
    assert eval (vn_current_speaker == "${character.id}")
    assert eval renpy.showing("vn_actor_${character.id}") and vn_actor_instances["vn_actor_${character.id}"]["expressionId"] == "${character.expressions[0].id}"
    run MainMenu(confirm=False)
    pause until screen "main_menu"
`);
  const lint = await runRenpy(sdk, game, ['lint']); await fs.writeFile(path.join(output, 'native-lint.log'), lint.log); expect(lint.code).toBe(0);
  const runtime = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000 });
  await fs.writeFile(path.join(output, 'native-test.log'), runtime.log); expect(runtime.code, runtime.log).toBe(0); expect(runtime.log).toMatch(/Test cases\s*:\s*1\s*\|\s*1 passed/);
  checks.push('实际 Ren’Py 试玩通过：章节蓝图时长参数、配乐、默认及覆盖表情、旁白跳过，以及存读档恢复。未打包或导出。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, packaged: false, userProjectModified: false }, null, 2)); console.log(`PASS: ${checks.length} checks. ${output}`);
} catch (error) {
  if (page && !page.isClosed()) await fs.writeFile(path.join(output, 'failure.html'), await page.content()).catch(() => {});
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2)); console.error(error); console.log(output); process.exitCode = 1;
} finally {
  await app?.close();
  const runtime = path.join(output, 'native');
  for (const name of ['tests', 'log.txt', 'errors.txt', 'traceback.txt']) {
    const file = path.join(runtime, name);
    if (await fs.stat(file).then(() => true).catch(() => false)) await fs.cp(file, path.join(output, name === 'tests' ? 'runtime-tests' : 'runtime-' + name), { recursive: true });
  }
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile', 'native', 'saves', 'renpy-saves']);
  expect(cleanup.errors).toEqual([]);
}
