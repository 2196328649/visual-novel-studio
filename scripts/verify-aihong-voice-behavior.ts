import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { parseProject } from '../src/desktop/project-store';
import { buildProject, runRenpy } from '../src/runtime/service';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';
import { createAihongVoiceBehaviorFixture } from './lib/aihong-voice-behavior-fixture';

const root = path.resolve('.'), reuse = process.env.VNS_VOICE_BEHAVIOR_REUSE;
const output = reuse ? path.resolve(reuse) : path.join(root, 'artifacts/aihong-voice-behavior', new Date().toISOString().replaceAll(':', '-'));
assert.ok(output.startsWith(path.join(root, 'artifacts', 'aihong-voice-behavior') + path.sep));
const fixture = path.join(output, 'project'), project = reuse ? projectSchema.parse(JSON.parse(await fs.readFile(path.join(fixture, 'project.vns.json'), 'utf8'))) : await createAihongVoiceBehaviorFixture(root, fixture);
const projectFile = path.join(fixture, 'project.vns.json');
const prompt = '删除 [name] {b} 收藏吗？';
if (!reuse) {
await fs.writeFile(projectFile, JSON.stringify(project, null, 2));
const before = await fs.readFile(projectFile, 'utf8');
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
const editor = await app.firstWindow(), errors: string[] = []; let page = editor;
page.on('pageerror', e => errors.push(e.message));
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
 const openEditor = async () => {
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '语音收藏' });
  await page.locator('[data-hierarchy-id="voice_list"]').click();
  await page.getByText('收藏条目与分页', { exact: true }).click();
 };
 await openEditor();
 const order = page.getByLabel('收藏排列顺序', { exact: true }), confirm = page.getByLabel('删除收藏前确认', { exact: true });
 await expect(order).toHaveValue('favorites'); await expect(confirm).toBeChecked();
 await order.selectOption('source'); await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(order).toHaveValue('favorites');
 await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(order).toHaveValue('source'); await order.selectOption('favorites');
 await confirm.uncheck(); await expect(page.getByLabel('删除收藏提示', { exact: true })).toHaveCount(0);
 await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(confirm).toBeChecked();
 await page.getByLabel('删除收藏提示', { exact: true }).fill(prompt);
 expect(await fs.readFile(projectFile, 'utf8')).toBe(before);
 await page.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
 const savedText = await fs.readFile(projectFile, 'utf8'), saved = projectSchema.parse(JSON.parse(savedText));
 expect(saved.ui.components.find(c => c.id === 'voice_list')!.list?.voiceRemoveMessage).toBe(prompt);
 expect(saved.nodes).toEqual(parseProject(structuredClone(project)).project.nodes); expect(saved.assets).toEqual(project.assets);
 await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); await openEditor();
 await expect(order).toHaveValue('favorites'); await expect(confirm).toBeChecked(); await expect(page.getByLabel('删除收藏提示', { exact: true })).toHaveValue(prompt);
 await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768));
 await page.screenshot({ path: path.join(output, 'editor-narrow.png') });
 await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 960));
 await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
 await page.getByLabel('事件图页面').selectOption('ui:main'); page = await openUiPreviewWindow(app, editor); await showUiPreviewTestData(page);
 const frame = page.getByLabel('参数联动预演画面', { exact: true }), audio = page.getByLabel('语音预演播放器', { exact: true });
 const control = (id: string) => frame.locator('[data-voice-control="' + id + '"]'), rows = frame.locator('[data-voice-entry]');
 const ids = () => rows.evaluateAll(elements => elements.map(e => e.getAttribute('data-voice-entry')));
 const playing = async (id: number) => { await expect.poll(() => audio.evaluate((e, id) => { const a = e as HTMLAudioElement; return !a.paused && a.currentTime > .01 && a.currentSrc.includes('voice_' + id + '.wav'); }, id)).toBe(true); };
 await frame.getByRole('button', { name: '打开语音收藏', exact: true }).click(); await expect(frame).toContainText('尚未收藏语音');
 const showData = async () => {
  const data = page.locator('.ui-gallery-preview-data').filter({ has: page.getByText('语音测试数据', { exact: true }) });
  if (await data.getAttribute('open') === null) await page.getByText('语音测试数据', { exact: true }).click();
 };
 await showData();
 const addFavorite = async (id: number) => {
  await showData();
  await page.getByRole('button', { name: '浏览添加测试收藏', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '预览资源 测试语音 ' + (id + 1), exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '使用所选资源', exact: true }).click();
 };
 for (const id of [2, 0, 1]) await addFavorite(id);
 expect(await ids()).toEqual(['voice_2', 'voice_0', 'voice_1']);
 await control('play:voice_2').click(); await playing(2); await control('favorite:voice_0').click();
 await expect(frame).toContainText(prompt); await expect(rows).toHaveCount(3); await playing(2);
 await frame.getByRole('button', { name: '取消', exact: true }).click(); await expect(rows).toHaveCount(3); await playing(2);
 await control('favorite:voice_0').click(); await page.keyboard.press('Escape'); await expect(rows).toHaveCount(3); await playing(2);
 await control('favorite:voice_0').click(); await frame.screenshot({ path: path.join(output, 'delete-confirm.png') });
 await frame.getByRole('button', { name: '确认', exact: true }).click(); expect(await ids()).toEqual(['voice_2', 'voice_1']); await playing(2);
 await control('favorite:voice_2').click(); await frame.getByRole('button', { name: '确认', exact: true }).click(); await expect(audio).not.toHaveAttribute('src');
 await addFavorite(0); expect(await ids()).toEqual(['voice_1', 'voice_0']);
 await frame.locator('[data-preview-component="ai_voicecollection_buttonback"]').click();
 await frame.getByRole('button', { name: '打开语音收藏', exact: true }).click(); expect(await ids()).toEqual(['voice_1', 'voice_0']);
 await showData(); await page.getByRole('button', { name: '收藏全部语音', exact: true }).click(); await control('page:1').click(); await expect(rows).toHaveCount(1);
 await control('favorite:voice_12').click(); await expect(rows).toHaveCount(1); await expect(control('page:1')).toHaveCount(1);
 await frame.getByRole('button', { name: '确认', exact: true }).click(); await expect(rows).toHaveCount(12); await expect(control('page:1')).toHaveCount(0);
 await showData(); await page.getByLabel('全部语音已解锁', { exact: true }).uncheck(); await expect(control('play:voice_0')).toBeDisabled();
 await control('favorite:voice_0').click(); await frame.getByRole('button', { name: '确认', exact: true }).click(); await expect(rows).toHaveCount(11);
 await frame.screenshot({ path: path.join(output, 'collection.png') });
 await expect(editor.locator('.dirty-dot')).toHaveCount(0); expect(await fs.readFile(projectFile, 'utf8')).toBe(savedText);
 expect(errors).toEqual([]);
 await fs.writeFile(path.join(output, 'editor-report.json'), JSON.stringify({ status: 'passed', compiledBuild: true, checks: ['两份模板配置、实际原图控件', '排列和确认设置、撤销重做、显式保存重开、窄窗口', '按添加顺序显示、删除后重新加入、离页重入', '实际WAV播放、确认取消和Escape继续试听', '确认删除其他条目继续、删除当前条目停止', '末页接受后回退、未解锁收藏仍能确认移除', '预演不修改工程或玩家资料'], errors }, null, 2));
} catch (error) {
 await fs.writeFile(path.join(output, 'editor-error.txt'), String(error));
 await fs.writeFile(path.join(output, 'editor-dom.txt'), await page.locator('body').innerText().catch(() => 'unavailable'));
 await page.screenshot({ path: path.join(output, 'editor-failure.png'), timeout: 5000 }).catch(() => undefined);
 throw error;
}
finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); }
} else {
 assert.equal(JSON.parse(await fs.readFile(path.join(output, 'editor-report.json'), 'utf8')).status, 'passed');
}

const runtimeOutput = reuse ? path.join(output, 'runtime', new Date().toISOString().replaceAll(':', '-')) : output;
for (const standard of [false, true]) {
 const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
 saved.playerDefaults = { ...saved.playerDefaults, fullscreen: false, windowSize: '1280x720' };
 if (standard) {
  saved.ui.pages!.messageBox = { layout: 'native' };
  const component = saved.ui.components.find(c => c.id === 'voice_list')!;
  component.list = { columns: 2, rows: 6, favoritesOnly: true, voiceOrder: 'favorites', voiceRemoveConfirm: true, voiceRemoveMessage: prompt, navigationRect: component.list?.navigationRect };
 }
 const directory = path.join(runtimeOutput, standard ? 'standard-runtime' : 'custom-runtime'), game = path.join(directory, 'game'), sdk = path.join(root, 'resources/runtime');
 const built = await buildProject({ project: saved, projectDir: fixture, sdkRoot: sdk, outputDir: game, development: true });
 await fs.writeFile(path.join(directory, 'compile.log'), built.log + JSON.stringify(built.diagnostics)); assert.ok(built.ok);
 const accept = standard ? 'click "确认"' : 'click id "vn_component_ai_confirm_yes"';
 const cancel = standard ? 'click "取消"' : 'click id "vn_component_ai_confirm_no"';
 await fs.writeFile(path.join(game, 'game/testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase voice_behavior:
    $ persistent.vn_unlocks = ["voice_%d" % i for i in range(13)]
    $ persistent.vn_favorite_voices = ["voice_12", "voice_0"] + ["voice_%d" % i for i in range(1, 12)]
    click id "vn_component_open_voices"
    pause until screen "voice_collection"
    assert eval renpy.get_widget("voice_collection", "vn_component_voice_list_voice_12") is not None
    assert eval renpy.get_widget("voice_collection", "vn_component_voice_list_voice_11") is None
    assert eval [e[0] for e in vn_voice_collection_entries(None, True, "favorites")] == persistent.vn_favorite_voices
    click id "vn_component_voice_list_voice_12"
    pause until eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_12.wav"
    click id "vn_component_voice_list_page_1"
    assert eval renpy.get_widget("voice_collection", "vn_component_voice_list_voice_11") is not None
    click id "vn_component_voice_list_favorite_voice_11"
    pause until screen "confirm"
    assert eval len(persistent.vn_favorite_voices) == 13
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_12.wav"
    screenshot "delete-confirm.png"
    assert eval renpy.get_screen("confirm").scope["message"] == "删除 [[name] {{b} 收藏吗？"
    ${cancel}
    assert not screen "confirm"
    assert eval renpy.get_widget("voice_collection", "vn_component_voice_list_voice_11") is not None
    assert eval len(persistent.vn_favorite_voices) == 13
    click id "vn_component_voice_list_favorite_voice_11"
    ${accept}
    assert eval "voice_11" not in persistent.vn_favorite_voices
    assert eval renpy.get_widget("voice_collection", "vn_component_voice_list_voice_12") is not None
    assert eval renpy.get_widget("voice_collection", "vn_component_voice_list_page_1") is None
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_12.wav"
    $ VnFavoriteVoice("assets/voice_11.wav")()
    assert eval persistent.vn_favorite_voices[-1] == "voice_11"
    click id "vn_component_voice_list_favorite_voice_12"
    keysym "K_ESCAPE"
    assert not screen "confirm"
    assert eval "voice_12" in persistent.vn_favorite_voices
    click id "vn_component_voice_list_favorite_voice_12"
    ${accept}
    pause until eval renpy.music.get_playing(channel="vn_replayvoice") is None
    assert eval "voice_12" not in persistent.vn_favorite_voices
    assert eval renpy.music.get_playing(channel="vn_replayvoice") is None
    click id "vn_component_ai_voicecollection_buttonback"
    click id "vn_component_open_voices"
    assert eval renpy.get_widget("voice_collection", "vn_component_voice_list_voice_11") is not None
    $ persistent.vn_unlocks = []
    $ renpy.restart_interaction()
    assert eval not renpy.get_widget("voice_collection", "vn_component_voice_list_voice_0").is_sensitive()
    click id "vn_component_voice_list_favorite_voice_0"
    assert screen "confirm"
    ${accept}
    assert eval "voice_0" not in persistent.vn_favorite_voices
    screenshot "collection.png"
`);
 const run = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(directory, 'saves'), timeoutMs: 90000 });
 await fs.writeFile(path.join(directory, 'runtime.log'), run.log);
 const passed = run.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(run.log);
 const assertions = Number(run.log.match(/Assertions\s*:\s*(\d+)\s*\|\s*\d+ passed/)?.[1] ?? 0);
 await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', standard, checks: ['实际排序、分页、确认前后页码', '字面提示、取消、Escape和接受', '试听期间弹框及删除不同条目', '重新收藏追加末尾、返回保留顺序', '未解锁收藏确认删除'], assertions }, null, 2));
 if (!passed) throw Error(run.log.slice(-5000));
}
console.log(output);
if (reuse) console.log(runtimeOutput);
