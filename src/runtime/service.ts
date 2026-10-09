import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { compileProject } from './compiler';
import { containedPath, assetSourcePath, atomicWrite } from '../desktop/project-store';
import { assetFiles, type Project } from '../core/model';
import type { PreviewOptions, RunResult } from '../core/bridge';
import { diagnosticsFromLog } from './diagnostics';
import { createPreviewRuntime } from './preview-runtime';
import { writeExportIcons } from './export-icons';
import { withPortraitMetadata } from '../desktop/image-metadata';
import { nativeEnvironment } from './process-env';
import { androidAssets } from './android-assets';
import { exportSettings } from '../core/export-settings';
import { projectForExport } from '../core/export-assets';

// Keep attribution available in exported games without depending on the editor layout.
const SAMPLE_CREDITS = `# 示例素材来源

示例工程中的背景、截图、缩略图和音乐来自用户提供的《哀鸿》素材目录：
\`E:/Project/Model/SLY/T/Assets\`。素材会复制到游戏包的 \`game/assets/\`，运行时不依赖原始绝对路径。

- 场景背景：东关街忆晴、茶舍忆昼、郊外晴
- 角色演示图：\`Resources/screenshot.png\`、\`thumbnail/琼华离去.png\`
- 音乐：\`starveling/sound/BGM/哀鸿_葬花埋香.ogg\`

素材版权和再分发范围以《哀鸿》项目授权条款为准。本文件不将其声明为公共领域或本项目原创。
示例故事、项目数据和编辑器代码由本项目生成。
`;

export interface BuildOptions { project: Project; projectDir?: string; sdkRoot: string; spineRuntimeDir?: string; outputDir: string; development?: boolean; preview?: PreviewOptions; previewHost?: boolean; signal?: AbortSignal }
export function spawnRenpy(sdkRoot: string, projectDir: string, command: string[], options: { savedir?: string; onData?: (text: string) => void; env?: Record<string, string>; signal?: AbortSignal } = {}): ChildProcess {
  const args = [path.join(sdkRoot, 'renpy.py')];
  if (options.savedir) args.push('--savedir', options.savedir);
  args.push(projectDir, ...command);
  // A game is a GUI process. STARTF_USESHOWWINDOW/SW_HIDE can suppress SDL's
  // first ShowWindow call; pythonw avoids a console without hiding the game.
  const interactive = command[0] === 'run';
  const child = spawn(path.join(sdkRoot, 'lib', 'py3-windows-x86_64', interactive ? 'pythonw.exe' : 'python.exe'), args, {
    cwd: sdkRoot, windowsHide: !interactive, env: nativeEnvironment({ PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...options.env }), stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal,
  });
  child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', options.onData ?? (() => undefined));
  child.stderr?.on('data', options.onData ?? (() => undefined));
  return child;
}

export function runRenpy(sdkRoot: string, projectDir: string, command: string[], options: { savedir?: string; timeoutMs?: number; onData?: (text: string) => void; signal?: AbortSignal; env?: Record<string, string> } = {}): Promise<{ code: number; log: string }> {
  return new Promise((resolve, reject) => {
    let log = '';
    let timedOut = false;
    const child = spawnRenpy(sdkRoot, projectDir, command, { ...options, onData(text) { log = (log + text).slice(-1_000_000); options.onData?.(text); } });
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs ?? 120_000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); resolve({ code: timedOut ? 124 : (code ?? 1), log: log + (timedOut ? '\n运行超时。' : '') }); });
  });
}

export async function buildProject(options: BuildOptions): Promise<RunResult> {
  const { projectDir, sdkRoot, outputDir } = options;
  const selectedProject = options.development === false ? projectForExport(options.project) : options.project;
  const sourceProject = projectDir ? await withPortraitMetadata(selectedProject, projectDir) : selectedProject;
  const android = options.development === false && exportSettings(sourceProject).platform === 'android' ? androidAssets(sourceProject) : undefined;
  const project = android?.project ?? sourceProject;
  options.signal?.throwIfAborted();
  const compiled = compileProject(project, { development: options.development, preview: options.preview });
  const diagnostics = [...compiled.diagnostics];
  if (diagnostics.some(d => d.severity === 'error')) return { ok: false, diagnostics, log: '' };
  for (const asset of sourceProject.assets) {
    if (!projectDir) { diagnostics.push({ severity: 'error', message: `请先保存项目并导入素材：${asset.name}`, assetId: asset.id }); continue; }
    try {
      const realRoot = (await fs.realpath(projectDir)) + path.sep;
      for (const relative of assetFiles(asset)) {
        const source = assetSourcePath(projectDir, asset, relative);
        const realSource = await fs.realpath(source);
        const external = asset.externalFiles?.[relative] ?? (relative === asset.path ? asset.externalPath : undefined);
        if (!external && !realSource.toLowerCase().startsWith(realRoot.toLowerCase())) throw new Error('资源链接离开项目目录。');
        await fs.access(source);
      }
    } catch { diagnostics.push({ severity: 'error', message: `找不到素材：${asset.name}`, assetId: asset.id }); }
  }
  if (diagnostics.some(d => d.severity === 'error')) return { ok: false, diagnostics, log: '' };
  await fs.mkdir(outputDir, { recursive: true });
  // A reused build directory must not retain assets removed from the project.
  const gameRoot = containedPath(outputDir, 'game');
  for (const folder of ['assets', 'scripts']) await fs.rm(containedPath(gameRoot, folder), { recursive: true, force: true });
  for (const [relative, content] of Object.entries(compiled.files)) await atomicWrite(containedPath(outputDir, relative), content);
  for (const file of ['00-vn-android-assets.rpy', '00-vn-android-assets.rpyc']) await fs.rm(containedPath(gameRoot, file), { force: true });
  if (android?.runtime) await atomicWrite(path.join(gameRoot, '00-vn-android-assets.rpy'), android.runtime);
  if (options.previewHost) await atomicWrite(path.join(gameRoot, '99-studio-preview.rpy'), createPreviewRuntime());
  else for (const file of ['99-studio-preview.rpy', '99-studio-preview.rpyc']) await fs.rm(containedPath(gameRoot, file), { force: true });
  const sourceAssets = new Map(sourceProject.assets.flatMap(asset => assetFiles(asset).map(file => [file, asset] as const)));
  for (const { source, destination: relative } of android?.files ?? sourceProject.assets.flatMap(assetFiles).map(relative => ({ source: relative, destination: relative }))) {
    options.signal?.throwIfAborted();
    const destination = containedPath(path.join(outputDir, 'game'), relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(assetSourcePath(projectDir!, sourceAssets.get(source)!, source), destination);
  }
  if (project.assets.some(asset => asset.kind === 'spine')) {
    const spineRuntime = options.spineRuntimeDir ?? path.join(path.dirname(sdkRoot), 'spine');
    const python = path.join(outputDir, 'game/python-packages');
    await fs.mkdir(python, { recursive: true });
    for (const name of ['vns_spine.py', 'vns_spine.dll']) await fs.copyFile(path.join(spineRuntime, name), path.join(python, name));
    await fs.copyFile(path.join(spineRuntime, 'LICENSE-Spine.txt'), path.join(outputDir, 'LICENSE-Spine.txt'));
  }
  try { await writeExportIcons(project, outputDir); }
  catch (error) { return { ok: false, diagnostics: [...diagnostics, { severity: 'error', message: `游戏图标生成失败：${error instanceof Error ? error.message : String(error)}` }], log: '' }; }
  await fs.mkdir(path.join(outputDir, 'game', 'fonts'), { recursive: true });
  await fs.copyFile(path.join(sdkRoot, 'sdk-fonts', 'SourceHanSansLite.ttf'), path.join(outputDir, 'game', 'fonts', 'SourceHanSansLite.ttf'));
  await fs.copyFile(path.join(sdkRoot, 'LICENSE.txt'), path.join(outputDir, 'LICENSE-RenPy.txt'));
  await atomicWrite(path.join(outputDir, 'SAMPLE-CREDITS.md'), SAMPLE_CREDITS);
  await atomicWrite(path.join(outputDir, 'source-map.json'), JSON.stringify(compiled.sourceMap, null, 2));
  await atomicWrite(path.join(outputDir, 'build-manifest.json'), JSON.stringify({ projectId: project.id, projectVersion: project.version, schemaVersion: project.schemaVersion, compilerVersion: '1.0.0', runtimeVersion: '8.5.3', assets: project.assets.map(a => ({ id: a.id, path: a.path, files: assetFiles(a) })) }, null, 2));
  const result = await runRenpy(sdkRoot, outputDir, ['compile'], { signal: options.signal });
  let log = result.log;
  if (sourceProject.assets.length < options.project.assets.length) log += `\n导出已省略 ${options.project.assets.length - sourceProject.assets.length} 个未引用素材，保留 ${sourceProject.assets.length} 个素材。\n`;
  if (result.code !== 0) {
    log += await fs.readFile(path.join(outputDir, 'errors.txt'), 'utf8').catch(() => '');
    const mapped = diagnosticsFromLog(log, compiled.sourceMap);
    diagnostics.push(...(mapped.length ? mapped : [{ severity: 'error' as const, message: '游戏编译失败，请查看运行记录。' }]));
  }
  return { ok: result.code === 0, diagnostics, log, buildPath: outputDir };
}

export async function preserveCompiledGame(buildDir: string, baselineDir: string): Promise<void> {
  const sourceRoot = path.join(buildDir, 'game');
  async function visit(dir: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const source = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(source);
      else if (entry.name.endsWith('.rpyc')) {
        const destination = path.join(baselineDir, path.relative(sourceRoot, source));
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(source, destination);
      }
    }
  }
  await visit(sourceRoot);
}
