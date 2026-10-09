import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type Project } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { compileProject } from '../src/runtime/compiler';
import { saveProject } from '../src/desktop/project-store';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts/chapter-authoring', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
const templateRoot = path.join(root, 'resources/templates/aihong');
const template = JSON.parse(await fs.readFile(path.join(templateRoot, 'project.vns.json'), 'utf8')) as Project;
const inputProject = createProject('章节演出与目录验证');
inputProject.playerDefaults = { ...inputProject.playerDefaults, masterVolume: 0 };
inputProject.ui.chapterTransition = structuredClone(template.ui.chapterTransition);
const names = ['章节进场 · 夜宴庭院', '章节题字 · 记第一回 醉梦', '花街柳巷'];
const ids = Object.values(inputProject.ui.chapterTransition ?? {}).filter(value => typeof value === 'string');
for (const asset of template.assets.filter(asset => names.includes(asset.name) || ids.includes(asset.id))) {
  const target = path.join(path.dirname(projectFile), asset.path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(templateRoot, asset.path), target);
  inputProject.assets.push(structuredClone(asset));
}
const source = `@入口：开场【opening】
# 章节：第一章
# 小章节：夜宴
# 段落：开场【opening】
@章节标题：第一章 · 酒醒城破｜据原剧情「记·第一回」「忆·第一回」节选改编｜4.2
@章节背景：章节进场 · 夜宴庭院
@章节题图：章节题字 · 记第一回 醉梦
@章节配乐：花街柳巷
旁白：这里直接接对白，不声明新段落。
@选择：要出门吗？
@选项：出门 -> 走向城门
@选项：留下 -> 留在庭院
# 段落：走向城门
@结局演出：文字=城门外的雨停了。
@返回标题界面
# 段落：留在庭院
@结局演出：文字=我们留在灯下。
@返回标题界面`;
const parsed = applyTextScript(inputProject, source);
expect(parsed.issues).toEqual([]);
parsed.project.scriptText = { format: 'vns-text-1', content: source };
await saveProject(projectFile, parsed.project);
const runtimeBefore = compileProject(parsed.project).files;
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server.listen();
const env = Object.fromEntries(Object.entries({ ...process.env, VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: path.join(output, 'profile'), VNS_DEV_URL: `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` }).filter((entry): entry is [string, string] => entry[1] !== undefined));
delete env.ELECTRON_RUN_AS_NODE;
let app: ElectronApplication | undefined, page: Page | undefined;
let phase = 'launch';
const checks: string[] = [], errors: string[] = [];
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 60_000 });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(parsed.project.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
  await openStoryMode(page, 'text');
  const input = page.getByLabel('中文文本剧本', { exact: true });
  const at = async (marker: string) => {
    await input.evaluate((element, marker) => { const input = element as HTMLTextAreaElement; const position = input.value.indexOf(marker) + marker.length; input.focus({ preventScroll: true }); input.setSelectionRange(position, position); input.dispatchEvent(new Event('select', { bubbles: true })); }, marker);
    await input.press('ArrowLeft'); await input.press('ArrowRight');
  };
  const play = page.getByRole('button', { name: '播放预览', exact: true });
  phase = 'four chapter commands';
  for (const command of ['@章节标题', '@章节背景', '@章节题图', '@章节配乐']) {
    await at(command);
    await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-key', 'opening/');
    await expect(page.locator('.chapter-preview.is-static')).toBeVisible();
    await expect(play).toBeEnabled();
  }
  await expect(page.locator('.chapter-preview .chapter-ripple-scene')).toHaveAttribute('data-ripple-ready', 'true');
  await expect(page.locator('.chapter-preview canvas[aria-label="章节背景波动"]')).toBeVisible();
  await expect(page.locator('audio[aria-label="试听音乐：花街柳巷"]')).toBeVisible();
  await page.screenshot({ path: path.join(output, 'chapter-static.png') });
  checks.push('四条章节指令都定位同一章节演出，显示实际背景和题图，并提供播放及配乐入口。');

  phase = 'chapter playback, stop and completion';
  await page.evaluate(() => {
    const scope = window as typeof window & { chapterTestAudio?: HTMLAudioElement[] };
    scope.chapterTestAudio = [];
    window.Audio = new Proxy(window.Audio, { construct(Target, args) { const audio = Reflect.construct(Target, args) as HTMLAudioElement; scope.chapterTestAudio!.push(audio); return audio; } });
  });
  await play.click();
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-phase', 'actions');
  await expect(page.locator('.chapter-preview.is-playing')).toBeVisible();
  await expect.poll(() => page!.evaluate(() => (window as typeof window & { chapterTestAudio?: HTMLAudioElement[] }).chapterTestAudio?.some(audio => !audio.paused))).toBe(true);
  await page.screenshot({ path: path.join(output, 'chapter-playing.png') });
  await page.getByRole('button', { name: '停止预览', exact: true }).click();
  await expect(page.locator('.chapter-preview.is-static')).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { chapterTestAudio?: HTMLAudioElement[] }).chapterTestAudio!.every(audio => audio.paused))).toBe(true);
  await play.click();
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-phase', 'finished', { timeout: 8000 });
  await expect(page.locator('.chapter-preview')).toHaveAttribute('data-elapsed', '4.2');
  expect(await page.evaluate(() => (window as typeof window & { chapterTestAudio?: HTMLAudioElement[] }).chapterTestAudio!.every(audio => audio.paused))).toBe(true);
  await page.getByRole('button', { name: '停止预览', exact: true }).click();
  await expect(page.locator('.chapter-preview.is-static')).toBeVisible();
  await play.click(); await at('旁白：');
  await expect(page.locator('.chapter-preview')).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { chapterTestAudio?: HTMLAudioElement[] }).chapterTestAudio!.every(audio => audio.paused))).toBe(true);
  checks.push('播放使用原蒙板渐变和真实音频资源；停止、自然完成和移到对白时均停止章节配乐。测试音量为零。');

  phase = 'implicit text and module headings';
  await page.getByRole('button', { name: '应用到项目', exact: true }).click();
  const appliedText = await input.inputValue();
  expect(appliedText).not.toMatch(/# 段落：(段落 \d|选择 \d)/);
  expect(appliedText).not.toMatch(/节点标记|对白标记|【[a-z_0-9]+】/);
  expect(appliedText.split('\n').filter(line => line.startsWith('# 段落：'))).toEqual(['# 段落：开场', '# 段落：走向城门', '# 段落：留在庭院']);
  await openStoryMode(page, 'script');
  await expect(page.locator('.passage-heading-row')).toHaveCount(3);
  await expect(page.locator('.node-summary').filter({ hasText: '要出门吗？' })).toHaveCount(1);
  await expect(page.locator('.story-directory .tree-node')).toHaveCount(3);
  await page.getByRole('button', { name: '显示未命名的对白和演出', exact: true }).click();
  await expect(page.locator('.story-directory .tree-node')).toHaveCount(5);
  await page.locator('#node-opening .node-summary').click();
  await expect(page.getByRole('button', { name: '播放预览', exact: true })).toBeEnabled();
  await page.screenshot({ path: path.join(output, 'chapter-module.png') });
  checks.push('文本只显示手写的三个段落标题；模块里的选择只显示一次，目录默认只列命名段落，可切换显示全部内容。');

  phase = 'save and reload';
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const stored = JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project;
  expect(stored.nodes).toEqual(parsed.project.nodes);
  expect(compileProject(stored).files).toEqual(runtimeBefore);
  await page.reload(); await openStoryMode(page, 'text');
  await expect(input).toHaveValue(appliedText);
  await at('@章节题图'); await expect(page.locator('.chapter-preview.is-static')).toBeVisible();
  expect(errors).toEqual([]);
  checks.push('保存重开仍可预览，节点身份、连接与生成的游戏脚本保持不变。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, packaged: false, userProjectModified: false }, null, 2));
  console.log(`PASS: ${checks.length} checks. ${output}`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2));
  console.error(error); console.log(output); process.exitCode = 1;
} finally { await app?.close(); await server.close(); }
