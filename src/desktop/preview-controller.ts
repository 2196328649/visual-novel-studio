import { BrowserWindow, screen } from 'electron';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Project } from '../core/model';
import type { PreviewCommand, PreviewOptions, PreviewPhase, PreviewViewport, RunResult, RuntimeEvent } from '../core/bridge';
import { buildProject, spawnRenpy } from '../runtime/service';
import { diagnosticsFromLog, runtimePosition, type SourceMap } from '../runtime/diagnostics';
import { atomicWrite } from './project-store';

interface Session {
  id: string; abort: AbortController; child?: ChildProcess; options: PreviewOptions;
  finish?: (result: RunResult) => void; buildPath: string; log: string; pending: string;
  ready: boolean; timer?: ReturnType<typeof setTimeout>; sourceMap: SourceMap;
  traceback?: boolean;
  control: { revision: number; paused: boolean; focus: number; viewport?: PreviewViewport };
  controlWrite: Promise<void>;
}
const cancelled: RunResult = { ok: false, cancelled: true, diagnostics: [], log: '' };

/** Owns a single preview, including compilation, readiness, controls and shutdown. */
export class PreviewController {
  private current?: Session;
  private stopping: Promise<void> = Promise.resolve();
  private viewport: PreviewViewport = { x: 0, y: 0, width: 0, height: 0, visible: false };
  private dialogBlocked = false;
  constructor(private readonly host: {
    window: () => BrowserWindow; userData: string; sdk: () => string | null; resources: string;
    projectDirectory: (project: Project) => string | undefined; emit: (event: RuntimeEvent) => void;
  }) {}

  private state(session: Session, phase: PreviewPhase, message: string, extra: Partial<RuntimeEvent> = {}) {
    if (session !== this.current) return;
    this.host.emit({ kind: 'preview', phase, message, mode: session.options.mode, sessionId: session.id, ...extra });
  }
  private send(command: Record<string, unknown>) {
    const session = this.current;
    if (!session) return;
    if (command.command === 'pause') session.control.paused = true;
    if (command.command === 'resume') session.control.paused = false;
    if (command.command === 'focus') session.control.focus++;
    if (command.command === 'viewport') session.control.viewport = command.viewport as PreviewViewport;
    session.control.revision++;
    const contents = JSON.stringify(session.control);
    session.controlWrite = session.controlWrite.then(async () => {
      if (session === this.current) await atomicWrite(path.join(session.buildPath, 'preview-control.json'), contents);
    }).catch(error => this.fail(session, `试玩控制失败：${error.message}`));
  }
  private physicalViewport(): PreviewViewport {
    const window = this.host.window();
    const scale = screen.getDisplayMatching(window.getBounds()).scaleFactor * window.webContents.getZoomFactor();
    const [width, height] = window.getContentSize();
    const viewport = { ...this.viewport,
      width: Math.max(0, Math.min(this.viewport.width, width - this.viewport.x)),
      height: Math.max(0, Math.min(this.viewport.height, height - this.viewport.y)),
      visible: this.viewport.visible && !this.dialogBlocked && !window.isMinimized(),
    };
    return { ...viewport, ...Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(viewport[key as 'x'] * scale)])) };
  }
  updateViewport(viewport: PreviewViewport) {
    if (!viewport || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(viewport[key as 'x']))) return;
    // Keep the renderer's geometry. Windows may report a zero client area while
    // minimized; clipping the saved geometry would keep it at zero after restore.
    this.viewport = { x: Math.max(0, viewport.x), y: Math.max(0, viewport.y), width: Math.max(0, viewport.width), height: Math.max(0, viewport.height), visible: viewport.visible === true };
    this.refreshViewport();
  }
  refreshViewport() { this.send({ command: 'viewport', viewport: this.physicalViewport() }); }
  async setDialogBlocked(blocked: boolean) {
    this.dialogBlocked = blocked;
    this.refreshViewport();
    await this.current?.controlWrite;
  }
  control(command: PreviewCommand) {
    if (command === 'stop') return this.stop();
    if (!['pause', 'resume', 'focus'].includes(command)) return;
    if (command === 'focus') { this.host.window().show(); this.host.window().focus(); }
    this.send({ command });
    return this.current?.controlWrite;
  }
  stop(notify = true) {
    const session = this.current;
    if (!session) return this.stopping;
    if (notify) this.state(session, 'idle', '试玩已停止');
    this.current = undefined;
    const child = session.child;
    this.stopping = child && child.exitCode === null && child.signalCode === null
      ? new Promise<void>(resolve => child.once('close', () => resolve()))
      : Promise.resolve();
    session.abort.abort();
    clearTimeout(session.timer);
    session.finish?.(cancelled);
    // These are only the compiler/game processes owned by this preview session.
    child?.kill();
    return this.stopping;
  }
  private fail(session: Session, message: string, result?: RunResult) {
    if (session !== this.current) return;
    const failure = result ?? { ok: false, diagnostics: [{ severity: 'error' as const, message }], log: session.log, buildPath: session.buildPath };
    this.state(session, 'failed', message);
    this.host.emit({ kind: 'diagnostics', message: '', diagnostics: failure.diagnostics });
    session.finish?.(failure);
    void this.stop(false);
  }

  async start(project: Project, input: PreviewOptions = {}): Promise<RunResult> {
    await this.stop(false);
    const session: Session = { id: randomUUID(), abort: new AbortController(), options: { ...input, mode: input.mode === 'embedded' ? 'embedded' : 'window' }, buildPath: '', log: '', pending: '', ready: false, sourceMap: {}, control: { revision: 0, paused: false, focus: 0 }, controlWrite: Promise.resolve() };
    session.buildPath = path.join(this.host.userData, 'builds', project.id, 'preview', session.id);
    this.current = session;
    this.state(session, 'compiling', '正在编译最新内容并准备素材…');
    try {
      const sdk = this.host.sdk();
      if (!sdk) throw new Error('未找到 Ren\'Py 运行时，请检查编辑器运行环境。');
      const result = await buildProject({ project, projectDir: this.host.projectDirectory(project), sdkRoot: sdk, spineRuntimeDir: path.join(this.host.resources, 'spine'), outputDir: session.buildPath, development: true, preview: input, previewHost: true, signal: session.abort.signal });
      if (session !== this.current) return cancelled;
      if (!result.ok) { this.fail(session, result.diagnostics.find(d => d.severity === 'error')?.message ?? '试玩编译失败', result); return result; }
      session.sourceMap = JSON.parse(await fs.readFile(path.join(session.buildPath, 'source-map.json'), 'utf8'));
      if (session !== this.current) return cancelled;
      this.state(session, 'starting', '正在启动游戏，等待首帧画面…');
      const handle = this.host.window().getNativeWindowHandle();
      const parent = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
      return await new Promise<RunResult>(resolve => {
        session.finish = resolve;
        const child = session.child = spawnRenpy(sdk, session.buildPath, ['run'], {
          savedir: path.join(this.host.userData, 'preview-saves', project.id, session.id),
          env: { VNS_PREVIEW_BOOT: JSON.stringify({ id: session.id, mode: session.options.mode, parent, viewport: this.physicalViewport() }) },
          onData: text => {
            if (session !== this.current) return;
            session.pending += text;
            const lines = session.pending.split(/\r?\n/); session.pending = lines.pop() ?? '';
            for (const line of lines) {
              if (line.startsWith('VNS_PREVIEW:')) {
                try {
                  const state = JSON.parse(line.slice('VNS_PREVIEW:'.length));
                  if (state.sessionId !== session.id) continue;
                  if (state.phase === 'focus-editor') { this.host.window().focus(); this.host.window().webContents.focus(); continue; }
                  if (state.phase === 'failed') { this.fail(session, state.message || '游戏窗口启动失败'); continue; }
                  if (!['running', 'paused'].includes(state.phase)) continue;
                  // Native shortcuts must also update the state carried by
                  // later viewport writes, otherwise resizing clears a pause.
                  session.control.paused = state.phase === 'paused';
                  if (!session.ready && state.visible !== true) continue;
                  if (!session.ready) {
                    session.ready = true; clearTimeout(session.timer);
                    resolve(result);
                    void fs.writeFile(path.join(session.buildPath, 'preview-ready.json'), JSON.stringify(state, null, 2)).catch(() => undefined);
                  }
                  this.state(session, state.phase, state.phase === 'paused' ? '试玩已暂停' : '试玩已启动', { windowId: state.windowId, visible: state.visible });
                } catch { /* Invalid output is never treated as readiness. */ }
              } else {
                const position = runtimePosition(line);
                if (position) this.host.emit({ ...position, sessionId: session.id });
                else {
                  session.log = (session.log + line + '\n').slice(-1_000_000);
                  this.host.emit({ kind: 'log', message: line, sessionId: session.id });
                  if (line.includes('Traceback (most recent call last):') || line.includes('Full traceback:')) session.traceback = true;
                  if (!session.ready && session.traceback && /^\w*(?:Error|Exception):\s/.test(line.trim())) this.fail(session, line.trim());
                }
              }
            }
          },
        });
        child.stdin?.on('error', () => { /* A closing game may close stdin before exit. */ });
        child.once('error', error => this.fail(session, `无法启动游戏：${error.message}`));
        child.once('close', async code => {
          if (session !== this.current) return;
          const traceback = await fs.readFile(path.join(session.buildPath, 'traceback.txt'), 'utf8').catch(() => '');
          if (session !== this.current) return;
          session.log += session.pending + traceback;
          const diagnostics = diagnosticsFromLog(session.log, session.sourceMap);
          if (!session.ready || code || diagnostics.length) {
            const detail = session.log.match(/^.*(?:Error|Exception): .+$/gm)?.at(-1)?.trim();
            const message = diagnostics[0]?.message ?? detail ?? `游戏${session.ready ? '异常退出' : '在画面就绪前退出'}（代码 ${code ?? 1}），请查看运行记录。`;
            this.fail(session, message, { ok: false, diagnostics: diagnostics.length ? diagnostics : [{ severity: 'error', message }], log: session.log, buildPath: session.buildPath });
          } else { this.state(session, 'idle', '试玩已结束'); this.current = undefined; }
        });
        session.timer = setTimeout(() => this.fail(session, '等待游戏画面超过 30 秒。可查看运行记录，或改用独立窗口重试。'), 30_000);
      });
    } catch (error) {
      if (session !== this.current || session.abort.signal.aborted) return cancelled;
      const message = error instanceof Error ? error.message : String(error);
      const result: RunResult = { ok: false, diagnostics: [{ severity: 'error', message }], log: message, buildPath: session.buildPath };
      this.fail(session, message, result);
      return result;
    }
  }
}
