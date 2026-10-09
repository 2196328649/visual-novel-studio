import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import type { Project } from '../core/model';
import type { ExportCheck, RunResult } from '../core/bridge';
import { androidConfiguration, distributionCommand, exportDiagnostics, exportPlatformNames, exportSettings } from '../core/export-settings';
import { atomicWrite } from '../desktop/project-store';
import { buildProject, preserveCompiledGame, runRenpy } from './service';
import { packageSingleExe, singleExeEntry } from './single-exe';

const execute = promisify(execFile);
const exists = (file: string) => fs.stat(file).then(stat => stat.isFile()).catch(() => false);
export const androidAbis = ['armeabi-v7a', 'arm64-v8a', 'x86_64'] as const;
/** Keep native tools below Windows' legacy path limit, including long portable locations. */
export function exportBuildDirectory(project: Project, userData: string, temporary: string): string {
  const id = randomUUID().replaceAll('-', '').slice(0, 12);
  const candidate = path.join(userData, 'builds', id);
  const relative = ['game/fonts/SourceHanSansLite.ttf', ...project.assets.map(asset => 'game/' + asset.path), `dist/12345678/${exportSettings(project).fileName}-${project.version}-win.zip`];
  return process.platform === 'win32' && relative.some(file => path.join(candidate, file).length >= 245) ? path.join(temporary, 'vns-builds', id) : candidate;
}
export function androidSigningDirectory(project: Pick<Project, 'id'>, projectDir: string): string {
  return path.join(projectDir, '.studio', project.id, 'android-signing');
}

async function javaTool(name: string, javaHome = process.env.JAVA_HOME): Promise<string> {
  const executable = name + (process.platform === 'win32' ? '.exe' : '');
  const candidate = javaHome && path.join(javaHome, 'bin', executable);
  return candidate && await exists(candidate) ? candidate : executable;
}
async function probeJdk(javaHome?: string): Promise<string | undefined> {
  try {
    const result = await execute(await javaTool('javac', javaHome), ['-version'], { windowsHide: true, timeout: 10_000 });
    const version = `${result.stdout}${result.stderr}`.trim();
    if (!/javac 21(?:\.|\s|$)/.test(version)) return;
    await execute(await javaTool('keytool', javaHome), ['-help'], { windowsHide: true, timeout: 10_000 });
    return version;
  } catch { return; }
}
export interface ExportEnvironment {
  sdkRoot: string | null; projectDir?: string; spineRuntimeDir: string;
  javaHome?: string;
  processEnv?: Record<string, string>;
  singleExeToolsDir?: string;
}

/** Read-only preflight: never downloads tools, compiles, creates keys or exports. */
export async function checkExportEnvironment(project: Project, options: ExportEnvironment, jdk = probeJdk): Promise<ExportCheck> {
  const settings = exportSettings(project), checks: ExportCheck['checks'] = [];
  const add = (id: string, label: string, ready: boolean, detail: string) => checks.push({ id, label, status: ready ? 'ready' : 'missing', detail });
  const sdk = options.sdkRoot;
  const runtimeReady = !!sdk && await exists(path.join(sdk, 'renpy.py')) && await exists(path.join(sdk, 'lib/py3-windows-x86_64/python.exe'));
  add('runtime', '游戏运行时', runtimeReady, runtimeReady ? `Ren’Py · ${sdk}` : '未找到 Ren’Py 运行时。');
  if (settings.platform === 'windows' && settings.windows.format === 'exe') {
    const directory = options.singleExeToolsDir ?? path.join(options.spineRuntimeDir, '../single-exe');
    const ready = await exists(path.join(directory, 'launcher.exe')) && await exists(path.join(directory, 'icon-tool.exe'));
    add('singleExe', '单 EXE 打包器', ready, ready ? '离线打包器已就绪。' : '单 EXE 打包器缺失，请修复或更新编辑器。');
  }
  if (settings.platform === 'android') {
    const rapt = sdk && path.join(sdk, 'rapt');
    const expected = sdk ? await fs.readFile(path.join(sdk, 'launcher/game/rapt_hash.txt'), 'utf8').catch(() => '') : '';
    const actual = rapt ? await fs.readFile(path.join(rapt, 'hash.txt'), 'utf8').catch(() => '') : '';
    const raptReady = !!rapt && await exists(path.join(rapt, 'buildlib/rapt/build.py')) && !!expected.trim() && actual.trim() === expected.trim();
    add('rapt', 'Android 打包工具', raptReady, raptReady ? rapt! : '点击「一键配置」安装与运行时匹配的 Android 打包工具。');
    const java = await jdk(options.javaHome);
    add('jdk', 'JDK 21', !!java, java || '点击「一键配置」安装 JDK 21，无需设置系统环境变量。');
    const customSdk = rapt ? (await fs.readFile(path.join(rapt, 'sdk.txt'), 'utf8').catch(() => '')).trim() : '';
    const androidSdk = customSdk ? path.resolve(sdk!, customSdk) : path.join(rapt ?? '', 'Sdk');
    const installSource = rapt ? await fs.readFile(path.join(rapt, 'buildlib/rapt/install_sdk.py'), 'utf8').catch(() => '') : '';
    const api = installSource.match(/platforms;android-(\d+)/)?.[1];
    const platforms = api ? [`android-${api}`] : await fs.readdir(path.join(androidSdk, 'platforms')).catch(() => [] as string[]);
    const platformReady = (await Promise.all(platforms.map(folder => exists(path.join(androidSdk, 'platforms', folder, 'android.jar'))))).some(Boolean);
    const androidReady = !!rapt && await exists(path.join(androidSdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')) && platformReady && await exists(path.join(androidSdk, 'licenses/android-sdk-license'));
    add('androidSdk', 'Android SDK', androidReady, androidReady ? androidSdk : `点击「一键配置」安装 Android SDK${api ? `（Android ${api}）` : ''}。`);
    const buildVersion = installSource.match(/build-tools;([\d.]+)/)?.[1] ?? '36.0.0';
    const buildTools = path.join(androidSdk, 'build-tools', buildVersion);
    const buildToolsReady = (await Promise.all(['aapt2', 'zipalign'].map(name => exists(path.join(buildTools, name + (process.platform === 'win32' ? '.exe' : '')))))).every(Boolean)
      && await exists(path.join(buildTools, 'lib/apksigner.jar')) && await exists(path.join(buildTools, 'lib/d8.jar'));
    add('androidBuildTools', 'Android 构建工具', buildToolsReady, buildToolsReady ? `Build Tools ${buildVersion}` : `点击「一键配置」补齐 Android Build Tools ${buildVersion}。`);
    if (project.assets.some(asset => asset.kind === 'spine')) {
      const missing = (await Promise.all(androidAbis.map(async abi => await exists(path.join(options.spineRuntimeDir, 'android', abi, 'libvns_spine.so')) ? '' : abi))).filter(Boolean);
      add('spine', 'Android 骨骼动画', !missing.length, missing.length ? `当前作品使用骨骼动画，缺少 Android 运行库：${missing.join('、')}。请安装包含这些运行库的编辑器资源。` : '已具备 ARM 32 位、ARM 64 位与 x86_64 运行库。');
    }
    const signing = options.projectDir && androidSigningDirectory(project, options.projectDir);
    const signed = !!signing && await exists(path.join(signing, 'android.keystore')) && await exists(path.join(signing, 'bundle.keystore'));
    checks.push({ id: 'signing', label: '应用签名', status: signed ? 'ready' : 'info', detail: signed ? `继续使用工程签名：${signing}` : '首次导出时创建签名并保存在工程的 .studio 文件夹；备份工程时请一并保留。' });
  }
  if (project.assets.some(asset => asset.kind === 'spine')) {
    const available = await exists(path.join(options.spineRuntimeDir, 'vns_spine.dll')) && await exists(path.join(options.spineRuntimeDir, 'vns_spine.py'));
    add('hostSpine', '本机骨骼动画', available, available ? '本机编译与试玩运行库已就绪。' : '缺少本机骨骼动画运行库，请修复编辑器资源。');
  }
  const diagnostics = checks.filter(check => check.status === 'missing').map(check => ({ severity: 'error' as const, message: check.detail }));
  return { platform: settings.platform, ready: !diagnostics.length, checks, diagnostics };
}

export type KeyGenerator = (destination: string, projectId: string) => Promise<void>;
async function generateKey(destination: string, projectId: string, javaHome?: string) {
  await execute(await javaTool('keytool', javaHome), ['-genkeypair', '-keystore', destination, '-alias', 'android', '-keyalg', 'RSA', '-keysize', '2048', '-keypass', 'android', '-storepass', 'android', '-dname', `CN=VNS-${projectId}`, '-validity', '20000', '-noprompt'], { windowsHide: true, timeout: 30_000 });
}

/** Keys outlive temporary builds, including a failed first distribution. */
export async function ensureAndroidSigning(project: Project, projectDir: string, generate: KeyGenerator = generateKey): Promise<string> {
  const directory = androidSigningDirectory(project, projectDir);
  await fs.mkdir(directory, { recursive: true });
  const names = ['android.keystore', 'bundle.keystore'];
  for (const name of names) {
    const destination = path.join(directory, name), imported = path.join(projectDir, name);
    if (!await exists(destination) && await exists(imported)) await fs.copyFile(imported, destination, fs.constants.COPYFILE_EXCL);
  }
  let available = await exists(path.join(directory, names[0])) ? names[0] : await exists(path.join(directory, names[1])) ? names[1] : undefined;
  if (!available) {
    if (await exists(path.join(directory, 'signing-manifest.json'))) throw new Error('该工程曾创建 Android 签名，但签名文件已丢失。请从备份恢复 .studio 中的签名文件后再导出。');
    const temporary = path.join(directory, `${randomUUID()}.keystore`);
    try {
      await generate(temporary, project.id);
      if (!await exists(temporary)) throw new Error('Android 签名未能创建。');
      await fs.copyFile(temporary, path.join(directory, names[0]), fs.constants.COPYFILE_EXCL);
    } finally { await fs.rm(temporary, { force: true }); }
    available = names[0];
  }
  for (const name of names) if (!await exists(path.join(directory, name))) await fs.copyFile(path.join(directory, available), path.join(directory, name), fs.constants.COPYFILE_EXCL);
  const fingerprints = Object.fromEntries(await Promise.all(names.map(async name => [name, createHash('sha256').update(await fs.readFile(path.join(directory, name))).digest('hex')])));
  await atomicWrite(path.join(directory, 'signing-manifest.json'), JSON.stringify({ projectId: project.id, fingerprints }, null, 2));
  return directory;
}

export async function prepareAndroidExport(project: Project, options: ExportEnvironment & { buildDir: string }, generate?: KeyGenerator): Promise<void> {
  if (!options.projectDir) throw new Error('请先保存作品，Android 签名需要保存在工程内。');
  const directory = await ensureAndroidSigning(project, options.projectDir, generate ?? ((destination, id) => generateKey(destination, id, options.javaHome)));
  await atomicWrite(path.join(options.buildDir, 'android.json'), JSON.stringify(androidConfiguration(project), null, 2));
  for (const name of ['android.keystore', 'bundle.keystore']) await fs.copyFile(path.join(directory, name), path.join(options.buildDir, name));
  if (project.assets.some(asset => asset.kind === 'spine')) for (const abi of androidAbis) {
    const destination = path.join(options.sdkRoot!, 'rapt/prototype/renpyandroid/src/main/jniLibs', abi, 'libvns_spine.so');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(options.spineRuntimeDir, 'android', abi, 'libvns_spine.so'), destination);
  }
}

export interface GameExportOptions extends ExportEnvironment {
  sdkRoot: string; project: Project; buildDir: string; baselineDir: string; outputDir: string; onData?: (text: string) => void;
}
export interface GameExportServices {
  check: typeof checkExportEnvironment; build: typeof buildProject; distribute: typeof runRenpy;
  prepareAndroid: typeof prepareAndroidExport; preserve: typeof preserveCompiledGame;
}
const services: GameExportServices = { check: checkExportEnvironment, build: buildProject, distribute: runRenpy, prepareAndroid: prepareAndroidExport, preserve: preserveCompiledGame };

export async function exportProject(options: GameExportOptions, dependencies: GameExportServices = services): Promise<RunResult> {
  const { project, sdkRoot, buildDir, baselineDir, outputDir } = options;
  const platform = exportSettings(project).platform;
  let log = '';
  try {
    const invalid = exportDiagnostics(project);
    if (invalid.length) return { ok: false, diagnostics: invalid, log: '' };
    const check = await dependencies.check(project, options);
    if (!check.ready) return { ok: false, diagnostics: check.diagnostics, log: check.diagnostics.map(d => d.message).join('\n') };
    await fs.mkdir(buildDir, { recursive: true });
    try { await fs.cp(baselineDir, path.join(buildDir, 'old-game'), { recursive: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    options.onData?.(`正在编译 ${exportPlatformNames[platform]} 游戏…\n`);
    const result = await dependencies.build({ project, projectDir: options.projectDir, sdkRoot, spineRuntimeDir: options.spineRuntimeDir, outputDir: buildDir, development: false });
    if (!result.ok) return result;
    log = result.log;
    if (platform === 'android') await dependencies.prepareAndroid(project, options);
    // Verify the actual output in a fresh directory. RAPT can exit successfully
    // even when copying its package to the requested destination failed.
    const staging = path.join(buildDir, 'dist', randomUUID().slice(0, 8));
    await fs.mkdir(staging, { recursive: true });
    const started = Date.now();
    options.onData?.(`正在导出 ${exportPlatformNames[platform]} 游戏…\n`);
    const distribution = await dependencies.distribute(sdkRoot, path.join(sdkRoot, 'launcher'), distributionCommand(project, buildDir, staging), { timeoutMs: platform === 'android' ? 1_200_000 : 300_000, onData: options.onData, env: options.processEnv });
    log += distribution.log;
    if (distribution.code !== 0) {
      const tracebackPath = path.join(sdkRoot, 'launcher/traceback.txt');
      const stat = await fs.stat(tracebackPath).catch(() => undefined);
      if (stat && stat.mtimeMs >= started - 1000 && stat.size < 1_000_000) {
        const traceback = await fs.readFile(tracebackPath, 'utf8');
        if (!log.includes(traceback)) log += `\n${traceback}`;
      }
      let message = `${exportPlatformNames[platform]} 游戏导出失败，请查看记录。`;
      if (process.platform === 'win32' && log.includes('FileNotFoundError')) {
        const longAsset = project.assets.map(asset => path.join(buildDir, 'game', asset.path)).find(file => file.length >= 260);
        if (longAsset && await exists(longAsset)) message = `运行时无法读取过长的临时构建路径（${longAsset.length} 字符）。请缩短应用数据目录的位置后重试：${longAsset}`;
      }
      return { ...result, ok: false, log, diagnostics: [...result.diagnostics, { severity: 'error', message }] };
    }
    const extension = platform === 'windows' ? '.zip' : `.${exportSettings(project).android.format}`;
    const packages = (await fs.readdir(staging, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(extension));
    if (!packages.length) throw new Error(`导出工具没有生成 ${extension} 文件，请查看构建记录。`);
    if (platform === 'windows' && exportSettings(project).windows.format === 'exe') {
      options.onData?.('正在生成单 EXE 游戏包…\n');
      for (const item of packages) {
        const archive = path.join(staging, item.name), name = item.name.replace(/\.zip$/i, '.exe');
        await packageSingleExe({ archive, destination: path.join(staging, name), toolsDir: options.singleExeToolsDir ?? path.join(options.spineRuntimeDir, '../single-exe'), title: project.name, entry: await singleExeEntry(sdkRoot, archive), icon: path.join(buildDir, 'icon.ico') });
        item.name = name;
      }
    }
    await fs.mkdir(outputDir, { recursive: true });
    for (const item of packages) {
      if (!(await fs.stat(path.join(staging, item.name))).size) throw new Error(`导出文件为空：${item.name}`);
      const temporary = path.join(outputDir, '.' + item.name + '.' + randomUUID() + '.partial');
      try {
        await fs.copyFile(path.join(staging, item.name), temporary, fs.constants.COPYFILE_EXCL);
        await fs.rename(temporary, path.join(outputDir, item.name));
      } finally { await fs.rm(temporary, { force: true }); }
    }
    await dependencies.preserve(buildDir, baselineDir);
    log += `\n已导出到 ${outputDir}\n${packages.map(item => item.name).join('\n')}\n`;
    return { ...result, log, outputPath: outputDir };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, diagnostics: [{ severity: 'error', message }], log: log + '\n' + message, buildPath: buildDir };
  }
}
