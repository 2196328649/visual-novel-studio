import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { Project } from '../core/model';
import type { ExportSetupProgress, ExportSetupResult } from '../core/bridge';
import { exportSettings } from '../core/export-settings';
import { checkExportEnvironment } from '../runtime/game-export';
import { atomicWrite, containedPath } from './project-store';
import tools from '../../resources/export-tools.json';
import { nativeEnvironment } from '../runtime/process-env';
import { javaProxyOptions } from './java-proxy';

export interface ToolArchive { name: string; url: string; sha256: string; bytes: number }
const exists = (file: string) => fs.stat(file).then(stat => stat.isFile(), () => false);
const digest = async (file: string) => {
  const hash = createHash('sha256');
  for await (const data of createReadStream(file)) hash.update(data);
  return hash.digest('hex');
};

/** Validate the exact target before creating, replacing or cleaning managed data. */
export async function managedPath(root: string, relative: string) {
  const base = path.resolve(root), target = containedPath(base, relative);
  if (target === base) throw new Error('不能将环境目录本身用作工具文件。');
  for (let candidate = target; candidate !== path.dirname(base); candidate = path.dirname(candidate)) {
    const info = await fs.lstat(candidate).catch(() => undefined);
    if (info?.isSymbolicLink()) throw new Error('环境目录中有符号链接，请换用普通文件夹。');
    if (candidate === base) break;
  }
  return target;
}

export async function downloadTool(archive: ToolArchive, directory: string, options: {
  signal: AbortSignal; fetch?: typeof fetch; progress?: (received: number, total: number) => void;
}): Promise<string> {
  if (!/^https:\/\//.test(archive.url) || !/^[a-f0-9]{64}$/.test(archive.sha256) || !Number.isSafeInteger(archive.bytes) || archive.bytes <= 0) throw new Error('工具下载信息无效。');
  options.signal.throwIfAborted();
  await fs.mkdir(directory, { recursive: true });
  const destination = await managedPath(directory, `${archive.sha256}.zip`);
  if (await exists(destination) && await digest(destination) === archive.sha256) {
    options.signal.throwIfAborted(); options.progress?.(archive.bytes, archive.bytes); return destination;
  }
  const partial = await managedPath(directory, `${archive.sha256}.${randomUUID()}.part`);
  try {
    const response = await (options.fetch ?? fetch)(archive.url, { signal: options.signal });
    if (!response.ok || !response.body) throw new Error(`${archive.name}下载失败（HTTP ${response.status}）。可以重试。`);
    let received = 0, lastUpdate = 0;
    const hash = createHash('sha256');
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length; hash.update(chunk);
      if (received > archive.bytes + 1024) { callback(new Error(`${archive.name}的下载大小与发行记录不符。`)); return; }
      if (Date.now() - lastUpdate > 120) { options.progress?.(received, archive.bytes); lastUpdate = Date.now(); }
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), meter, createWriteStream(partial, { flags: 'wx' }), { signal: options.signal });
    if (received !== archive.bytes || hash.digest('hex') !== archive.sha256) throw new Error(`${archive.name}的下载校验失败，请重试。`);
    await fs.copyFile(partial, destination);
    options.progress?.(received, archive.bytes);
    return destination;
  } finally { await fs.rm(await managedPath(directory, path.basename(partial)), { force: true }); }
}

export interface ExportSetupOptions {
  resources: string;
  userData: string;
  appVersion: string;
  fetch?: typeof fetch;
  resolveProxy?: (url: string) => Promise<string>;
  onProgress?: (state: ExportSetupProgress) => void;
  onRuntime?: (directory: string) => void;
}

export class ExportSetupController {
  private controller?: AbortController;
  private log = '';
  private state: ExportSetupProgress = { phase: 'idle', platform: 'windows', message: '', running: false };
  constructor(private readonly options: ExportSetupOptions) {}
  get running() { return !!this.controller; }
  snapshot() { return { ...this.state, log: this.log }; }
  cancel() { this.controller?.abort(new Error('已取消环境配置。')); }
  private update(patch: Partial<ExportSetupProgress>) {
    this.state = { ...this.state, receivedBytes: undefined, totalBytes: undefined, ...patch };
    this.options.onProgress?.(this.snapshot());
  }
  private append(text: string) {
    this.log = (this.log + text).slice(-60_000);
    this.options.onProgress?.(this.snapshot());
  }
  private get toolRoot() { return path.join(this.options.userData, 'export-tools'); }
  async javaHome() {
    const directory = path.join(this.toolRoot, `jdk21-${tools.jdk.sha256.slice(0, 10)}`);
    return await exists(path.join(directory, 'bin/javac.exe')) ? directory : undefined;
  }
  async processEnvironment(): Promise<Record<string, string>> {
    const javaHome = await this.javaHome();
    // Gradle and sdkmanager are JVM processes; Chromium's fetch proxy does not
    // carry over to them. Resolve the active system proxy on each invocation.
    const proxy = javaProxyOptions(await this.options.resolveProxy?.('https://services.gradle.org/') ?? 'DIRECT');
    return { ...(javaHome ? { JAVA_HOME: javaHome, PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ''}` } : {}), GRADLE_USER_HOME: path.join(this.toolRoot, 'gradle-cache'),
      ...(proxy.length ? { JAVA_TOOL_OPTIONS: [process.env.JAVA_TOOL_OPTIONS, ...proxy].filter(Boolean).join(' ') } : {}) };
  }
  private async command(executable: string, args: string[], signal: AbortSignal, input?: string, timeoutMs = 1_200_000): Promise<void> {
    signal.throwIfAborted();
    const env = nativeEnvironment({ ...await this.processEnvironment(), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, { cwd: this.options.userData, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let timedOut = false;
      const stop = () => {
        if (child.pid && process.platform === 'win32') {
          const kill = spawn(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          kill.on('error', () => child.kill());
        } else child.kill();
      };
      const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
      signal.addEventListener('abort', stop, { once: true });
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); };
      child.stdout.on('data', data => this.append(data.toString('utf8')));
      child.stderr.on('data', data => this.append(data.toString('utf8')));
      child.stdin.on('error', () => { /* A completed tool may close its input early. */ });
      child.stdin.end(input ?? '');
      child.on('error', error => { cleanup(); reject(error); });
      child.on('close', code => {
        cleanup();
        if (signal.aborted) reject(signal.reason);
        else if (timedOut) reject(new Error('环境配置超时，可重试继续使用已下载的工具。'));
        else if (code !== 0) reject(new Error(`环境工具未完成（退出码 ${code}）。请查看详细记录，检查网络后重试。`));
        else resolve();
      });
    });
  }
  private async archive(archive: ToolArchive, sdk: string, signal: AbortSignal, install: (staging: string) => Promise<void>) {
    const zip = await downloadTool(archive, path.join(this.toolRoot, 'downloads'), { signal, fetch: this.options.fetch, progress: (receivedBytes, totalBytes) => this.update({ receivedBytes, totalBytes }) });
    this.update({ message: `正在安装${archive.name}…` });
    const relative = `export-tools/staging/${randomUUID()}`;
    const staging = await managedPath(this.options.userData, relative);
    await fs.mkdir(staging, { recursive: true });
    try {
      await this.command(path.join(sdk, 'lib/py3-windows-x86_64/python.exe'), [path.join(this.options.resources, 'tools/unpack_verified.py'), zip, staging], signal, undefined, 180_000);
      signal.throwIfAborted(); await install(staging); signal.throwIfAborted();
    } finally { await fs.rm(await managedPath(this.options.userData, relative), { recursive: true, force: true }); }
  }
  async ensureRuntime(signal?: AbortSignal, repair = false) {
    const directory = await managedPath(this.options.userData, `runtime/renpy-${tools.runtimeVersion}-${this.options.appVersion}`);
    const source = path.join(this.options.resources, 'runtime');
    const critical = ['renpy.py', 'lib/py3-windows-x86_64/python.exe', 'sdk-fonts/SourceHanSansLite.ttf', 'launcher/game/rapt_hash.txt'];
    for (const file of critical) if (!await exists(path.join(source, file))) throw new Error('编辑器随附的运行时不完整，请重新解压完整便携包或重新安装编辑器。');
    const complete = (await Promise.all(critical.map(async file => await exists(path.join(directory, file)) && await digest(path.join(directory, file)) === await digest(path.join(source, file))))).every(Boolean);
    if (repair || !complete || !await exists(path.join(directory, '.ready'))) {
      await fs.mkdir(directory, { recursive: true });
      await fs.rm(await managedPath(this.options.userData, path.relative(this.options.userData, path.join(directory, '.ready'))), { force: true });
      await fs.cp(source, directory, { recursive: true, force: true, filter: file => {
        signal?.throwIfAborted();
        const relative = path.relative(source, file).replaceAll('\\', '/');
        return !/(?:^|\/)(?:tmp|__pycache__|cache|saves)(?:\/|$)/.test(relative) && !/(?:^|\/)(?:log|traceback|errors)\.txt$/.test(relative);
      } });
      await atomicWrite(path.join(directory, '.ready'), tools.runtimeVersion + '\n');
    }
    this.options.onRuntime?.(directory);
    return directory;
  }
  async run(project: Project, projectDir: string | undefined, acceptAndroidLicense: boolean): Promise<ExportSetupResult> {
    if (this.controller) return { ok: false, error: '已有环境配置正在进行。' };
    const controller = new AbortController(); this.controller = controller; this.log = '';
    const signal = controller.signal, platform = exportSettings(project).platform;
    this.update({ phase: 'runtime', platform, running: true, message: '正在检查并准备游戏运行时…' });
    try {
      const sdk = await this.ensureRuntime(signal, true);
      const environment = () => ({ sdkRoot: sdk, projectDir, spineRuntimeDir: path.join(this.options.resources, 'spine') });
      let check = await checkExportEnvironment(project, { ...environment(), javaHome: await this.javaHome() });
      if (platform === 'android') {
        if (check.checks.some(item => ['androidSdk', 'androidBuildTools'].includes(item.id) && item.status !== 'ready') && !acceptAndroidLicense) throw new Error('配置 Android SDK 前，请先阅读并同意 Android SDK 许可。');
        if (check.checks.some(item => item.id === 'jdk' && item.status === 'missing')) {
          this.update({ phase: 'jdk', message: '正在下载 JDK 21…' });
          await this.archive(tools.jdk, sdk, signal, async staging => {
            const directories = await fs.readdir(staging, { withFileTypes: true });
            const home = directories.find(entry => entry.isDirectory() && entry.name.startsWith('jdk-'));
            if (!home || !await exists(path.join(staging, home.name, 'bin/javac.exe'))) throw new Error('JDK 压缩包内容不完整。');
            const target = await managedPath(this.options.userData, `export-tools/jdk21-${tools.jdk.sha256.slice(0, 10)}`);
            await fs.cp(path.join(staging, home.name), target, { recursive: true, force: true });
          });
        }
        if (check.checks.some(item => item.id === 'rapt' && item.status === 'missing')) {
          const expected = (await fs.readFile(path.join(sdk, 'launcher/game/rapt_hash.txt'), 'utf8')).trim();
          if (expected !== tools.rapt.versionHash) throw new Error('Android 工具与当前运行时不匹配，请更新编辑器。');
          this.update({ phase: 'rapt', message: '正在下载 Android 打包工具…' });
          await this.archive(tools.rapt, sdk, signal, async staging => {
            if ((await fs.readFile(path.join(staging, 'rapt/hash.txt'), 'utf8')).trim() !== expected) throw new Error('Android 打包工具版本校验失败。');
            const target = await managedPath(this.options.userData, path.relative(this.options.userData, path.join(sdk, 'rapt')));
            await fs.cp(path.join(staging, 'rapt'), target, { recursive: true, force: true });
          });
        }
        check = await checkExportEnvironment(project, { ...environment(), javaHome: await this.javaHome() });
        if (check.checks.some(item => ['androidSdk', 'androidBuildTools'].includes(item.id) && item.status === 'missing')) {
          if (!acceptAndroidLicense) throw new Error('请先阅读并同意 Android SDK 许可。');
          const androidSdk = await managedPath(this.options.userData, 'export-tools/android-sdk');
          const cmdline = path.join(androidSdk, 'cmdline-tools/latest');
          this.update({ phase: 'androidSdk', message: '正在下载 Android SDK…' });
          if (!await exists(path.join(cmdline, 'lib/sdkmanager-classpath.jar'))) await this.archive(tools.android, sdk, signal, async staging => {
            if (!await exists(path.join(staging, 'cmdline-tools/lib/sdkmanager-classpath.jar'))) throw new Error('Android SDK 压缩包内容不完整。');
            const target = await managedPath(this.options.userData, path.relative(this.options.userData, cmdline));
            await fs.cp(path.join(staging, 'cmdline-tools'), target, { recursive: true, force: true });
          });
          await atomicWrite(path.join(sdk, 'rapt/sdk.txt'), androidSdk);
          this.update({ phase: 'androidSdk', message: '正在安装 Android 平台与构建工具，首次配置可能需要几分钟…' });
          const javaHome = await this.javaHome();
          const java = javaHome ? path.join(javaHome, 'bin/java.exe') : process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java.exe') : 'java.exe';
          await this.command(java, ['-Dcom.android.sdklib.toolsdir=' + cmdline, '-classpath', path.join(cmdline, 'lib/sdkmanager-classpath.jar'), 'com.android.sdklib.tool.sdkmanager.SdkManagerCli', `--sdk_root=${androidSdk}`, ...tools.android.packages], signal, 'y\n'.repeat(128));
          await atomicWrite(path.join(this.toolRoot, 'android-license-consent.json'), JSON.stringify({ url: tools.android.licenseUrl, packages: tools.android.packages, acceptedAt: new Date().toISOString() }, null, 2));
        }
      }
      signal.throwIfAborted(); this.update({ phase: 'checking', message: '正在检查配置结果…' });
      check = await checkExportEnvironment(project, { ...environment(), javaHome: await this.javaHome() });
      if (!check.ready) throw new Error(check.diagnostics.map(item => item.message).join('\n'));
      this.update({ phase: 'ready', running: false, message: '导出环境已就绪，可以选择目录并导出游戏。' });
      return { ok: true, check };
    } catch (error) {
      const cancelled = signal.aborted, message = cancelled ? '已取消配置。已校验的下载会保留，下次可以继续。' : error instanceof Error ? error.message : String(error);
      this.append(message + '\n');
      this.update({ phase: cancelled ? 'cancelled' : 'failed', running: false, message });
      return { ok: false, cancelled, error: message };
    } finally { this.controller = undefined; }
  }
}
