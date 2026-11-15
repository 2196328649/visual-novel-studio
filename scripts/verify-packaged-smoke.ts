import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { projectSchema, type Project } from '../src/core/model';
import type { RuntimeEvent } from '../src/core/bridge';
import { installedExecutable, launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

// Only the coordinator's freshly extracted release is accepted. This script
// never builds, installs, reads an existing user profile or contacts an AI API.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = path.join(root, 'artifacts/github-release-0.8.1-2026-11-15');
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const requested = process.env.VNS_RELEASE_VERIFY_ROOT;
const suppliedExe = process.env.VNS_INSTALLED_EXE;
assert.equal(path.resolve(process.cwd()).toLowerCase(), root.toLowerCase(), 'Run from the editor workspace.');
assert.ok(requested && path.isAbsolute(requested), 'VNS_RELEASE_VERIFY_ROOT must be an absolute fresh run path.');
assert.ok(suppliedExe && path.isAbsolute(suppliedExe) && installedExecutable, 'VNS_INSTALLED_EXE must be an absolute extracted executable.');
const output = path.resolve(requested), executable = path.resolve(suppliedExe);
assert.ok(inside(releaseRoot, output) && inside(releaseRoot, executable), 'Both run and executable must belong to this release round.');
assert.equal(path.basename(executable), 'Visual Novel Studio.exe');
assert.ok(process.argv.slice(2).every(arg => arg === '--portable'), 'Only --portable is supported.');
const portable = process.argv.includes('--portable');
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
assert.equal(version, '0.8.1');
const canonicalRelease = await fs.realpath(releaseRoot), canonicalExe = await fs.realpath(executable);
assert.ok(inside(canonicalRelease, canonicalExe), 'Executable link escapes this release round.');
const parent = await fs.realpath(path.dirname(output));
assert.ok(parent.toLowerCase() === canonicalRelease.toLowerCase() || inside(canonicalRelease, parent), 'Run parent escapes this release round.');
assert.ok(!inside(path.dirname(executable), output), 'Keep screenshots and projects outside the extracted application.');
await fs.mkdir(output); // Exclusive: never reuse an old acceptance directory.
const evidence = path.join(output, 'evidence'), projects = path.join(output, 'projects');
const profile = portable ? path.join(path.dirname(executable), 'data') : path.join(output, 'profile');
const documents = path.join(profile, 'documents');
const marker = '【发布验收_' + randomUUID().slice(0, 8) + '】';
const name = (portable ? '便携包' : '安装包') + '发布验收_' + randomUUID().slice(0, 8);
const checks: string[] = [], errors: string[] = [], events: RuntimeEvent[] = [], blockedRequests: string[] = [];
const processes: { pid?: number; exited: boolean; code?: number | null }[] = [];
const report: Record<string, unknown> = {
  status: 'running', version, portable, output, executable, profile, marker, checks, errors, blockedRequests, processes,
  externalApiCalled: false, cleanupTargets: portable ? [projects] : [projects, profile],
  limits: ['Only this release round’s extracted binary, synthetic project and fresh profile are used.',
    'Installer payload is executed without running NSIS installation actions.',
    'Native first frame and editor controls are covered; full story routes and Android exports are not repeated.'],
};
let application: ElectronApplication | undefined, page: Page | undefined, phase = 'package identity';
let ownedChild: ChildProcess | undefined, closing: Promise<void> | undefined;
let projectFile: string | undefined, saved: Project | undefined, projectHash: string | undefined;
const observed = new WeakSet<Page>();
const digest = async (file: string) => {
  const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex');
};
const persist = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ ...report, phase }, null, 2));
const allowedUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ['file:', 'studio-asset:', 'data:', 'blob:', 'about:', 'devtools:', 'chrome-devtools:'].includes(url.protocol)
      || ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
};
const observe = (window: Page) => {
  if (observed.has(window)) return;
  observed.add(window); window.on('pageerror', error => errors.push(error.message));
  window.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
};
async function launch() {
  const previousSaves = process.env.RENPY_PATH_TO_SAVES;
  process.env.RENPY_PATH_TO_SAVES = path.join(profile, 'renpy-saves');
  try {
    if (portable) {
      const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
      for (const key of Object.keys(env)) if (/^electron_run_as_node$/i.test(key) || /^VNS_(USER_DATA|PROJECT_PATH|TEST_ROOT|SKIP_PROJECT_HUB|DEV_URL|RENPY_SDK|TEST_DISCARD_ON_CLOSE)$/i.test(key)) delete env[key];
      application = await electron.launch({ executablePath: executable, args: [], cwd: path.dirname(executable), env, timeout: 120_000 });
    } else application = await launchDesktopFixture({ root, profile, projectHub: true, timeout: 120_000 });
  } finally {
    if (previousSaves === undefined) delete process.env.RENPY_PATH_TO_SAVES; else process.env.RENPY_PATH_TO_SAVES = previousSaves;
  }
  // Cache the owned process before Playwright disposes its implementation map.
  // application.process() after context.close() can no longer resolve _object.
  ownedChild = application.process();
  const processRecord = { pid: ownedChild.pid, exited: false } as typeof processes[number];
  processes.push(processRecord);
  ownedChild.once('exit', code => { processRecord.exited = true; processRecord.code = code; });
  application.on('window', observe); for (const window of application.windows()) observe(window);
  // tsx keepNames may serialize nested function bindings with __name. Install
  // the identity helper using a raw string, before any transferred function.
  await application.evaluate('globalThis.__name = value => value');
  await application.context().addInitScript('globalThis.__name = value => value');
  // Also cover Electron net.fetch; browser routing alone cannot intercept it.
  await application.evaluate(({ app, session }, input) => {
    app.setPath('documents', input.documents);
    const local = (value: string) => {
      try { const url = new URL(value); return ['file:', 'studio-asset:', 'data:', 'blob:', 'about:', 'devtools:', 'chrome-devtools:'].includes(url.protocol)
        || ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); } catch { return false; }
    };
    (globalThis as any).__releaseBlockedRequests = [];
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const cancel = !local(details.url); if (cancel) (globalThis as any).__releaseBlockedRequests.push(details.url); callback({ cancel });
    });
  }, { documents });
  await fs.mkdir(documents, { recursive: true });
  await application.context().route('**/*', route => {
    if (allowedUrl(route.request().url())) return route.continue();
    blockedRequests.push(route.request().url()); return route.abort('blockedbyclient');
  });
  const actual = await application.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, profile: app.getPath('userData') }));
  assert.equal(actual.packaged, true); assert.equal(actual.version, version);
  assert.equal(path.resolve(actual.profile).toLowerCase(), profile.toLowerCase());
  assert.ok(inside(canonicalRelease, await fs.realpath(profile)), 'Resolved profile escapes this release round.');
  report.actual = actual;
  page = await application.firstWindow({ timeout: 120_000 }); observe(page);
  await page.evaluate('globalThis.__name = value => value');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await expect(page.locator('.project-browser')).toBeVisible({ timeout: 120_000 });
}
async function close() {
  if (closing) return closing;
  if (!application) return;
  const current = application, child = ownedChild, context = current.context();
  // Detach once, so a failed close cannot re-enter a disposed app in finally.
  application = undefined; page = undefined; ownedChild = undefined;
  closing = (async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    blockedRequests.push(...await current.evaluate(() => (globalThis as any).__releaseBlockedRequests ?? []).catch(() => []));
    await current.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window && !window.isDestroyed()) await window.webContents.executeJavaScript('window.studio?.controlPreview?.("stop")');
    }).catch(error => { errors.push('preview shutdown: ' + String(error)); });
    await current.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => undefined);
    // The fixture replaces app.close(). Close our cached context directly,
    // retaining the original context method’s binding and bypassing overrides.
    try { await context.close(); }
    catch (error) { if (child.exitCode === null && child.signalCode === null) { child.kill(); errors.push('context shutdown: ' + String(error)); } }
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.removeListener('exit', exited); reject(new Error('Owned Electron did not exit within 30 seconds.')); }, 30_000);
      const exited = () => { clearTimeout(timer); resolve(); }; child.once('exit', exited);
      if (child.exitCode !== null || child.signalCode !== null) { child.removeListener('exit', exited); exited(); }
    });
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'Owned Electron must finish before restart or cleanup.');
  })();
  try { await closing; } finally { closing = undefined; }
}
async function qaImage(source: string, destination: string) {
  const image = await application!.evaluate(({ nativeImage }, source) => {
    const original = nativeImage.createFromPath(source), size = original.getSize();
    if (original.isEmpty()) throw new Error('Empty QA image: ' + source);
    const ratio = Math.min(1, 1280 / Math.max(size.width, size.height));
    const reduced = original.resize({ width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)), quality: 'good' });
    return { dimensions: reduced.getSize(), png: reduced.toPNG().toString('base64') };
  }, source);
  assert.ok(Math.max(image.dimensions.width, image.dimensions.height) <= 1280);
  await fs.writeFile(destination, Buffer.from(image.png, 'base64'));
}
async function capture(label: string) {
  const full = path.join(evidence, label + '.png'), qa = path.join(evidence, label + '-qa.png');
  await page!.screenshot({ path: full }); await qaImage(full, qa);
}
const readSaved = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile!, 'utf8')));
try {
  await fs.mkdir(evidence); await fs.mkdir(projects);
  report.binaries = { executableSha256: await digest(executable), asarSha256: await digest(path.join(path.dirname(executable), 'resources/app.asar')) };
  const portableMarker = path.join(path.dirname(executable), 'portable.json');
  if (portable) {
    const metadata = JSON.parse(await fs.readFile(portableMarker, 'utf8'));
    assert.equal(metadata.version, version); assert.equal(metadata.dataDirectory, 'data');
    await assert.rejects(fs.lstat(profile), (error: NodeJS.ErrnoException) => error.code === 'ENOENT', 'Portable data must be fresh.');
    report.cleanupTargets = [projects, profile];
  } else await assert.rejects(fs.lstat(portableMarker), (error: NodeJS.ErrnoException) => error.code === 'ENOENT', 'Installer payload must not have a portable marker.');
  phase = 'first launch'; await launch(); checks.push(portable ? '便携包无启动参数，实际数据目录为程序旁新建 data。' : '安装包实际二进制使用显式隔离 profile，版本为 0.8.1。');
  phase = 'create bundled template';
  await page!.locator('.project-template-grid button').filter({ hasText: '哀鸿模板' }).click();
  await page!.getByLabel('新项目名称', { exact: true }).fill(name);
  await page!.getByLabel('新项目保存位置', { exact: true }).fill(projects);
  await page!.getByRole('button', { name: '创建并打开项目', exact: true }).click();
  await expect(page!.locator('.project-title strong')).toHaveText(name, { timeout: 120_000 });
  const location = await page!.evaluate(() => window.studio!.checkProjectLocation!());
  assert.ok(location.path && inside(projects, location.path)); projectFile = location.path; report.projectFile = projectFile;
  assert.ok(inside(await fs.realpath(projects), await fs.realpath(projectFile)), 'Created project link escapes this run.');
  saved = await readSaved(); assert.equal(saved.name, name); assert.ok(saved.assets.length > 0);
  assert.ok(saved.assets.every(asset => !asset.externalPath && !Object.keys(asset.externalFiles ?? {}).length));
  const dialogue = saved.scenes.flatMap(scene => saved!.nodes.flatMap(node => node.kind === 'passage' && node.sceneId === scene.id ? node.lines : [])).find(line => line.text.trim());
  assert.ok(dialogue, 'Bundled template must have a real dialogue.');
  report.dialogue = { lineId: dialogue.id, original: dialogue.text }; checks.push('通过项目窗口创建内置哀鸿模板；素材复制为本轮独立工程，没有外部文件依赖。');
  phase = 'edit and save'; await openStoryMode(page!, 'text');
  const source = page!.getByRole('textbox', { name: '中文文本剧本', exact: true }), originalText = await source.inputValue();
  assert.ok(originalText.includes(dialogue.text), 'First authored dialogue must be visible in the text editor.');
  const changedText = originalText.replace(dialogue.text, dialogue.text + marker);
  await source.fill(changedText); await expect(source).toHaveValue(changedText);
  await expect(page!.locator('.dirty-dot')).toHaveCount(1, { timeout: 60_000 });
  await page!.getByRole('button', { name: '应用到项目', exact: true }).click();
  await expect(page!.locator('.status-message')).toContainText(/文本已应用/, { timeout: 60_000 });
  await expect(page!.locator('.dirty-dot')).toHaveCount(1);
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 60_000 });
  saved = await readSaved(); assert.ok(saved.nodes.some(node => node.kind === 'passage' && node.lines.some(line => line.text === dialogue.text + marker)));
  assert.ok(saved.scriptText?.content.includes(marker)); report.projectId = saved.id; projectHash = await digest(projectFile!);
  await capture('saved-project'); checks.push('编辑第一条真实对白，应用到项目后保存；唯一标记写入剧情与文本，界面无未保存状态。');
  phase = 'full restart'; const savedId = saved.id; await close(); await launch();
  await page!.locator('.recent-project-open').filter({ hasText: projectFile }).click({ timeout: 60_000 });
  await expect(page!.locator('.project-title strong')).toHaveText(name, { timeout: 60_000 });
  await openStoryMode(page!, 'text'); await expect(page!.getByRole('textbox', { name: '中文文本剧本', exact: true })).toHaveValue(changedText);
  await expect(page!.locator('.dirty-dot')).toHaveCount(0); saved = await readSaved(); assert.equal(saved.id, savedId); assert.equal(await digest(projectFile!), projectHash);
  await capture('reopened-project'); checks.push('完整退出并重启同一发布二进制，从最近项目打开；身份、完整改稿和干净保存状态保持。');
  phase = 'native runtime preview';
  await page!.evaluate(() => { (window as any).__releaseEvents = []; window.studio!.onRuntimeEvent(event => (window as any).__releaseEvents.push(event)); });
  await page!.getByRole('button', { name: '试玩', exact: true }).click();
  await expect(page!.locator('.play-workspace')).toHaveAttribute('data-preview-state', 'running', { timeout: 120_000 });
  await expect.poll(() => page!.evaluate(() => (window as any).__releaseEvents.some((event: RuntimeEvent) => event.kind === 'preview' && event.phase === 'running' && event.visible === true)), { timeout: 60_000 }).toBe(true);
  events.push(...await page!.evaluate(() => (window as any).__releaseEvents as RuntimeEvent[]));
  const running = events.find(event => event.kind === 'preview' && event.phase === 'running' && event.visible === true)!;
  assert.ok(running.sessionId && /^[0-9a-f-]{36}$/i.test(running.sessionId));
  const build = path.join(profile, 'builds', saved.id, 'preview', running.sessionId);
  const readyFile = path.join(build, 'preview-ready.json');
  await expect.poll(() => fs.readFile(readyFile, 'utf8').then(() => true, () => false), { timeout: 60_000 }).toBe(true);
  const ready = JSON.parse(await fs.readFile(readyFile, 'utf8')); assert.equal(ready.visible, true); assert.equal(ready.sessionId, running.sessionId);
  assert.ok(await fs.readFile(path.join(build, 'game/story.rpy'), 'utf8').then(text => text.includes(marker)));
  const frame = path.join(build, 'preview-first-frame.png'); assert.ok((await fs.stat(frame)).size > 1000);
  const preservedFrame = path.join(evidence, 'runtime-first-frame.png'); await fs.copyFile(frame, preservedFrame);
  await qaImage(preservedFrame, path.join(evidence, 'runtime-first-frame-qa.png'));
  report.runtime = { build, ready, firstFrame: preservedFrame }; checks.push('发布包编译器编译最新改稿，随附 Ren’Py 返回可见原生窗口和真实首帧；已保存压缩 QA 图。');
  phase = 'stop preview'; await page!.getByRole('button', { name: '停止试玩（Shift+F5）', exact: true }).click();
  await expect(page!.getByRole('button', { name: '试玩', exact: true })).toBeEnabled({ timeout: 60_000 });
  await page!.evaluate(() => window.studio!.controlPreview!('stop')); // Await the owned native child’s completed shutdown.
  events.splice(0, events.length, ...await page!.evaluate(() => (window as any).__releaseEvents as RuntimeEvent[]));
  assert.ok(!events.some(event => event.phase === 'failed' || event.diagnostics?.some(item => item.severity === 'error')));
  await expect(page!.locator('.dirty-dot')).toHaveCount(0); checks.push('停止试玩并等待本轮原生进程结束；编辑按钮恢复可用，没有失败状态或错误诊断。');
  await close(); assert.equal(await digest(projectFile!), projectHash); report.savedProjectSha256 = projectHash;
  assert.deepEqual(errors, []); assert.deepEqual(blockedRequests, []); assert.ok(processes.every(item => item.exited));
  report.status = 'passed'; phase = 'complete';
} catch (error) {
  report.status = 'failed'; report.failure = String(error); process.exitCode = 1;
  if (page) {
    await capture('failure').catch(captureError => { report.captureFailure = String(captureError); });
    events.splice(0, events.length, ...await page.evaluate(() => (window as any).__releaseEvents ?? []).catch(() => []));
  }
} finally {
  await close().catch(error => { report.status = 'failed'; report.closeFailure = String(error); process.exitCode = 1; });
  await fs.writeFile(path.join(output, 'events.json'), JSON.stringify(events, null, 2));
  report.eventsFile = path.join(output, 'events.json'); await persist();
  console.log(JSON.stringify({ status: report.status, portable, output, checks: checks.length, report: path.join(output, 'report.json') }, null, 2));
}
