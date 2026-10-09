import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { projectSchema, effectiveCharacter, targets } from '../src/core/model';
import { aiStoryResources } from '../src/core/ai-story';
import { currentTextProject, dialogueRows } from '../src/core/text-exchange';
import { validateProject } from '../src/core/validate';
import { saveProject } from '../src/desktop/project-store';
import { exportProject } from '../src/runtime/game-export';
import { exportSettings } from '../src/core/export-settings';
import { launchDesktopFixture, installedExecutable } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { liveAiProvider } from './lib/live-ai-provider';

const root = path.resolve('.'), execute = promisify(execFile);
const resume = process.env.VNS_AI_FRAMEWORK_RESUME;
const output = resume ? path.resolve(resume) : path.join(root, 'artifacts/ai-framework-1.2.1', new Date().toISOString().replaceAll(':', '-'));
if (!output.toLowerCase().startsWith((path.join(root, 'artifacts/ai-framework-1.2.1') + path.sep).toLowerCase())) throw new Error('恢复测试目录必须位于本项验收产物中。');
const template = installedExecutable ? path.join(path.dirname(installedExecutable), 'resources/resources/templates/aihong') : path.join(root, 'resources/templates/aihong');
const profile = path.join(output, 'profile'), projectFile = path.join(output, 'project/project.vns.json');
const settings = process.env.VNS_LIVE_AI_SETTINGS ?? path.join(process.env.APPDATA!, 'visual-novel-studio/ai-settings.json');
await fs.mkdir(profile, { recursive: true });
const settingsBytes = await fs.readFile(settings), settingsHash = createHash('sha256').update(settingsBytes).digest('hex');
if (!resume) await fs.writeFile(path.join(profile, 'ai-settings.json'), settingsBytes);
const original = projectSchema.parse(JSON.parse(await fs.readFile(path.join(template, 'project.vns.json'), 'utf8')));
original.id = 'ai_framework_verification';
if (!resume) await saveProject(projectFile, original, template);
const server = installedExecutable || resume ? undefined : await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server?.listen();
let app: ElectronApplication | undefined, page: Page | undefined, assistant: Page | undefined, phase = 'launch';
const prior = resume ? JSON.parse(await fs.readFile(path.join(output, 'report.json'), 'utf8')) : {};
const checks: string[] = prior.checks ?? [], errors: string[] = [], progress: unknown[] = prior.progress ?? [];
const report: Record<string, unknown> = { ...prior, status: 'running', output, projectFile, checks, progress };
delete report.error; delete report.phase;
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const snapshot = async () => {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  return currentTextProject(projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))));
};
const ask = async (prompt: string) => {
  const before = await assistant!.getByLabel('AI 创作方案', { exact: true }).count();
  await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill(prompt);
  await assistant!.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => {
    const alerts = await assistant!.getByRole('alert').allTextContents();
    if (alerts.some(Boolean)) throw new Error(alerts.join('\n'));
    return assistant!.getByLabel('AI 创作方案', { exact: true }).count();
  }, { timeout: 600000, intervals: [1000, 2000, 3000] }).toBe(before + 1);
  return assistant!.getByLabel('AI 创作方案', { exact: true }).last();
};
try {
  let project = currentTextProject(projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))));
  if (!resume) {
  app = await launchDesktopFixture({ root, profile, projectFile, devUrl: server ? `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` : undefined });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(original.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1500, 980));
  const provider = await liveAiProvider();
  if (provider) await page.evaluate(update => window.studio!.saveAiConfig!(update), provider);
  const config = await page.evaluate(() => window.studio!.getAiConfig!());
  if (!config.model || !config.hasKey) throw new Error('保存的真实 AI 服务缺少模型或可解密密钥。');
  report.provider = { host: new URL(config.baseUrl).host, model: config.model, keyStorage: config.keyStorage };
  console.log(JSON.stringify({ phase: 'provider-ready', provider: report.provider }));
  const opened = app.waitForEvent('window'); await page.getByRole('button', { name: 'AI 助手', exact: true }).click(); assistant = await opened;
  assistant.on('pageerror', error => errors.push(error.message));
  assistant.on('console', message => { if (message.text().startsWith('VNS_AI_PROGRESS ')) { const value = JSON.parse(message.text().slice(16)); progress.push(value); console.log(JSON.stringify(value)); } });
  await expect(assistant.locator('.ai-assistant-window')).toBeVisible();
  await assistant.evaluate(() => window.studio!.onAiProgress!(value => console.log('VNS_AI_PROGRESS ' + JSON.stringify(value))));
  await assistant.getByLabel('AI 处理范围', { exact: true }).selectOption('all');

  phase = 'live one-prompt framework'; const started = Date.now();
  const prompt = '用现有的林翩翩和苏怜烟制作一个雨后重逢的古风短篇游戏框架：恰好两个场景、约12句对白、一个两项选择和两个不同结局，配置合适的现有背景、配乐、表情和左右关联站位，所有分支连接完整，无可靠配音就先不绑定；请从这句创意直接生成完整可玩框架，不导入文件。';
  const proposal = await ask(prompt);
  report.prompt = prompt; report.generationSeconds = Math.round((Date.now() - started) / 1000);
  await assistant.screenshot({ path: path.join(output, '01-framework-proposal.png') });
  await proposal.getByRole('button', { name: '应用创作方案', exact: true }).click();
  await expect(proposal).toContainText('已应用创作方案');
  project = await snapshot();
  assert.equal(project.scenes.length, 2);
  assert.equal(project.nodes.filter(n => n.kind === 'choice').length, 1);
  assert.equal(project.nodes.filter(n => n.kind === 'end').length, 2);
  assert.ok(dialogueRows(project).length >= 6);
  assert.deepEqual(validateProject(project).filter(d => d.severity === 'error'), []);
  assert.ok(project.nodes.every(node => targets(node).every(link => !link.target || project.nodes.some(n => n.id === link.target))));
  assert.ok(dialogueRows(project).filter(r => r.line.speakerId).every(({ line }) => line.actions.some(a => a.kind === 'show' && !!a.presetId)));
  assert.ok(project.scenes.every(s => s.entryActions?.some(a => a.kind === 'background')));
  checks.push('真实服务通过一句创意生成两场景、一个选择、两个结局；背景/配乐与表情使用现有素材，角色使用关联站位，连接和素材检查通过。');
  await assistant.getByRole('button', { name: '撤销工程修改', exact: true }).click();
  assert.deepEqual((await snapshot()).nodes, currentTextProject(original).nodes);
  await page.getByRole('button', { name: '重做', exact: true }).click(); project = await snapshot();
  checks.push('整体应用、一次撤销、重做均通过，生成方案保留原工程的界面与资源。');
  report.generated = { name: project.name, lines: dialogueRows(project).length, scenes: project.scenes.length, endings: 2 };
  await saveReport();

  phase = 'manual dialogue editing';
  await openStoryMode(page, 'text');
  const input = page.getByLabel('中文文本剧本', { exact: true }), source = await input.inputValue();
  const first = dialogueRows(project)[0].line, editedText = first.text + '（风停了。）';
  assert.ok(source.includes(first.text));
  await input.fill(source.replace(first.text, editedText));
  project = await snapshot(); assert.ok(dialogueRows(project).some(r => r.line.text === editedText));
  checks.push('生成结果可以直接在文本编辑器修改一句对白并保存，预设和分支保留。');
  await page.screenshot({ path: path.join(output, '02-manual-detail.png') });

  phase = 'live scene configuration';
  const resources = aiStoryResources(project), scene = project.scenes[0];
  const chosen = resources.backgrounds.find(a => !scene.entryActions?.some(s => s.kind === 'background' && s.assetId === a.id))!;
  const music = resources.music[0];
  const sceneProposal = await ask(`请配置现有场景「${scene.name}」的入场演出：背景明确使用「${chosen.name}」，配乐使用「${music.name}」，保留已生成的台词、分支、立绘及站位预设。`);
  await sceneProposal.getByRole('button', { name: '应用创作方案', exact: true }).click(); await expect(sceneProposal).toContainText('已应用创作方案');
  project = await snapshot();
  assert.ok(project.scenes.find(s => s.id === scene.id)?.entryActions?.some(a => a.kind === 'background' && a.assetId === chosen.id));
  assert.ok(project.scenes.find(s => s.id === scene.id)?.entryActions?.some(a => a.kind === 'music' && a.assetId === music.id));
  assert.ok(dialogueRows(project).some(r => r.line.text === editedText));
  await assistant.screenshot({ path: path.join(output, '03-scene-proposal.png') });
  checks.push('真实服务按指定资源配置已有场景入场背景和配乐，保留手动改稿和角色站位。');
  await saveReport();

  phase = 'live indexed voice matching';
  const directory = path.join(output, 'voice-fixture'); await fs.mkdir(directory);
  const selected = dialogueRows(project).filter(r => r.line.speakerId).slice(0, 2);
  const manifest: { file: string; text: string; speaker: string; lineId: string }[] = [];
  // Low-volume synthetic tones with explicit transcripts, not generated speech or recognition.
  for (const [index, { line }] of selected.entries()) {
    const samples = 16000 * 6, buffer = Buffer.alloc(44 + samples * 2);
    buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i / (13 + index)) * 200), 44 + i * 2);
    const file = `${index + 1}.wav`; await fs.writeFile(path.join(directory, file), buffer);
    manifest.push({ file, text: line.text, speaker: effectiveCharacter(project, line.speakerId!)!.name, lineId: line.id });
  }
  await fs.writeFile(path.join(directory, 'voices.json'), JSON.stringify(manifest, null, 2));
  const voiceProposal = await ask(`根据当前台词匹配「${directory}」目录中的配音，使用其中的 voices.json 索引，只给可靠匹配的台词绑定录音，保留其他演出。`);
  await voiceProposal.getByRole('button', { name: '应用创作方案', exact: true }).click(); await expect(voiceProposal).toContainText('已应用创作方案');
  project = await snapshot();
  assert.deepEqual(dialogueRows(project).filter(r => r.line.voiceId).map(r => r.line.id), selected.map(r => r.line.id));
  await assistant.screenshot({ path: path.join(output, '04-voice-proposal.png') });
  report.voiceFixture = { lines: 2, kind: 'low-volume synthetic tones with explicit text index; no speech synthesis or transcription' };
  checks.push('真实服务理解录音目录请求；两条明确文本索引正确匹配并复制文件，其余台词不猜配音。');
  assert.deepEqual(errors, []);
  assert.equal(createHash('sha256').update(await fs.readFile(settings)).digest('hex'), settingsHash);
  await app.close(); app = undefined; page = undefined; assistant = undefined;
  }

  phase = 'export generated story';
  project.exportSettings = { ...exportSettings(project), platform: 'windows', fileName: 'AI-Framework-1-2-1' };
  await saveProject(projectFile, project, path.dirname(projectFile));
  const exported = await exportProject({ project, projectDir: path.dirname(projectFile), sdkRoot: path.join(root, 'resources/runtime'), spineRuntimeDir: path.join(root, 'resources/spine'), buildDir: path.join(output, 'build'), baselineDir: path.join(output, 'baseline'), outputDir: path.join(output, 'distribution') });
  await fs.writeFile(path.join(output, 'export.log'), exported.log);
  assert.ok(exported.ok, exported.log + JSON.stringify(exported.diagnostics));
  const zip = (await fs.readdir(exported.outputPath!)).find(file => file.endsWith('.zip'))!;
  const archive = path.join(exported.outputPath!, zip), unpacked = path.join(output, 'unpacked', String(Date.now()));
  report.package = archive; report.sha256 = createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_EXPORT_ARCHIVE, $env:VNS_EXPORT_UNPACKED)'], { windowsHide: true, env: { ...process.env, VNS_EXPORT_ARCHIVE: archive, VNS_EXPORT_UNPACKED: unpacked }, timeout: 180000 });
  const folder = (await fs.readdir(unpacked, { withFileTypes: true })).find(f => f.isDirectory())!;
  const game = path.join(unpacked, folder.name), executable = path.join(game, (await fs.readdir(game)).find(f => f.endsWith('.exe'))!);
  report.executable = executable;
  const choice = project.nodes.find(n => n.kind === 'choice')!;
  assert.ok(choice.kind === 'choice');
  const voiceLine = dialogueRows(project).find(r => r.line.voiceId)!.line;
  const voicePath = project.assets.find(a => a.id === voiceLine.voiceId)!.path.replaceAll('\\', '/');
  // Added solely to the extracted acceptance copy; the ZIP contains no test scripts.
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase generated_story:
    assert screen "main_menu"
    click id "vn_component_ai_title_start"
    advance until ${JSON.stringify(voiceLine.text)}
    assert screen "say"
    assert eval vn_current_line == ${JSON.stringify(voiceLine.id)}
    pause 0.1
    assert eval renpy.music.get_playing(channel="voice") == ${JSON.stringify(voicePath)}
    screenshot "01-voiced-dialogue.png"
    advance until screen "choice"
    screenshot "02-choice.png"
    click ${JSON.stringify(choice.choices[0].text)}
    advance until eval vn_performance_active and renpy.showing("vn_visual_ending_title")
    pause 0.7
    screenshot "03-ending-a.png"
    pause until screen "main_menu"
    click id "vn_component_ai_title_start"
    advance until screen "choice"
    click ${JSON.stringify(choice.choices[1].text)}
    advance until eval vn_performance_active and renpy.showing("vn_visual_ending_title")
    pause 0.7
    screenshot "04-ending-b.png"
    pause until screen "main_menu"
    screenshot "05-title-return.png"
    $ open(config.basedir + "/framework-passed.json", "w").write('{"passed":true}')
`);
  phase = 'play exported EXE';
  let log = '';
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, [game, 'test', '--report-detailed', '--savedir', path.join(output, 'saves')], { cwd: game, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('导出游戏试玩超时。')); }, 240000);
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', data => { log += String(data); });
    child.on('error', error => { clearTimeout(timer); reject(error); }); child.on('close', code => { clearTimeout(timer); resolve(code ?? 1); });
  });
  await fs.writeFile(path.join(output, 'standalone.log'), log); assert.equal(code, 0, log.slice(-6000));
  assert.equal(JSON.parse(await fs.readFile(path.join(game, 'framework-passed.json'), 'utf8')).passed, true);
  checks.push('正式 Windows ZIP 导出后，直接运行解压 EXE；对白配音通道、选项、两个分支黑屏结局及自动返回标题全部通过。');
  report.screenshots = (await fs.readdir(path.join(game, 'tests/screenshots'))).map(f => path.join(game, 'tests/screenshots', f));
  report.status = 'passed'; await saveReport(); console.log(JSON.stringify({ status: 'passed', output, package: archive }));
} catch (error) {
  await (assistant ?? page)?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  Object.assign(report, { status: 'failed', phase, error: String(error), errors }); await saveReport(); console.error(phase, error); process.exitCode = 1;
} finally {
  await app?.close().catch(() => undefined); await server?.close();
  await fs.rm(path.join(profile, 'ai-settings.json'), { force: true });
}
