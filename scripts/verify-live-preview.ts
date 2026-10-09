import { openStoryMode } from './lib/story-workspace';
import { expect, type ElectronApplication } from '@playwright/test';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema } from '../src/core/model';
import type { RuntimeEvent } from '../src/core/bridge';
import { PNG } from 'pngjs';
import { installedExecutable, launchDesktopFixture } from './lib/desktop-fixture';

declare global { interface Window { __previewEvents: RuntimeEvent[]; __previewInputs: { type: string; key?: string; target?: string; at: number }[] } }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/live-preview-verification', new Date().toISOString().replaceAll(':', '-'));
const profile = path.join(output, 'profile'), projectDir = path.join(output, 'project');
const projectFile = path.join(projectDir, 'project.vns.json');
const sdk = path.join(root, 'resources/runtime');
const checks: string[] = [], errors: string[] = [];
const nativeCalls: { hwnd: string; command: string; at: number }[] = [];
let application: ElectronApplication | undefined;
const server = installedExecutable ? undefined : await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
async function native(hwnd: string, command = 'inspect', x = 0, y = 0) {
  if (command !== 'inspect') nativeCalls.push({ hwnd, command, at: Date.now() });
  return new Promise<any>((resolve, reject) => {
    const child = spawn(path.join(sdk, 'lib/py3-windows-x86_64/python.exe'), [path.join(output, 'native.py'), hwnd, command, String(x), String(y)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.once('error', reject); child.once('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
  });
}
try {
  await fs.mkdir(output, { recursive: true });
  const template = installedExecutable ? path.join(path.dirname(installedExecutable), 'resources/resources/templates/aihong') : path.join(root, 'resources/templates/aihong');
  await fs.cp(template, projectDir, { recursive: true });
  const project = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  project.id = 'project_live_preview'; project.name = '实时试玩验证';
  await fs.mkdir(path.join(projectDir, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'scripts/preview-readiness.rpy'), `init 1001 python:
    vn_test_preview_ready_line = None
    def vn_test_preview_readiness():
        global vn_test_preview_ready_line
        line = getattr(renpy.store, "vn_current_line", None)
        if line and line != vn_test_preview_ready_line and not renpy.game.interface.trans_pause and renpy.get_screen("say") is not None:
            vn_test_preview_ready_line = line
            print("VNS_TEST_DIALOGUE_READY:" + str(line), flush=True)
    config.periodic_callbacks.append(vn_test_preview_readiness)
`);
  project.assets.push({ id: 'preview_readiness_probe', kind: 'script', name: '试玩验收探针', path: 'scripts/preview-readiness.rpy' });
  await fs.writeFile(projectFile, JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(output, 'native.py'), `import ctypes, sys, json, time
from ctypes import wintypes
user = ctypes.WinDLL("user32", use_last_error=True)
user.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
user.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
hwnd = int(sys.argv[1])
user.GetParent.argtypes = [wintypes.HWND]
user.GetParent.restype = wintypes.HWND
user.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
user.GetWindow.restype = wintypes.HWND
user.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
user.GetWindowLongPtrW.restype = ctypes.c_ssize_t
user.WindowFromPoint.argtypes = [wintypes.POINT]
user.WindowFromPoint.restype = wintypes.HWND
user.GetForegroundWindow.restype = wintypes.HWND
user.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
user.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
user.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
user.mouse_event.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.c_size_t]
user.keybd_event.argtypes = [wintypes.BYTE, wintypes.BYTE, wintypes.DWORD, ctypes.c_size_t]
user.MapVirtualKeyW.argtypes = [wintypes.UINT, wintypes.UINT]
user.MapVirtualKeyW.restype = wintypes.UINT
user.IsWindowVisible.argtypes = [wintypes.HWND]
user.IsWindowEnabled.argtypes = [wintypes.HWND]
user.IsWindow.argtypes = [wintypes.HWND]
user.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user.SetForegroundWindow.argtypes = [wintypes.HWND]
user.SetActiveWindow.argtypes = [wintypes.HWND]
user.SetFocus.argtypes = [wintypes.HWND]
user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user.GetWindowThreadProcessId.restype = wintypes.DWORD
user.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
user.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
kernel = ctypes.WinDLL("kernel32")
kernel.GetCurrentThreadId.restype = wintypes.DWORD
def focus_target():
    if not user.IsWindow(hwnd) or not user.IsWindowEnabled(hwnd):
        raise RuntimeError("Requested input window is gone or disabled: " + str(hwnd))
    user.SetForegroundWindow(hwnd)
    for attempt in range(12):
        if user.GetForegroundWindow() == hwnd: return
        if attempt == 3:
            # The helper is short lived and may not own the foreground input
            # queue. Attach only while focusing our known test window.
            current = kernel.GetCurrentThreadId()
            targets = {user.GetWindowThreadProcessId(user.GetForegroundWindow(), None), user.GetWindowThreadProcessId(hwnd, None)} - {0, current}
            attached = []
            try:
                for target in targets:
                    if user.AttachThreadInput(current, target, True): attached.append(target)
                user.SetForegroundWindow(hwnd)
                user.SetActiveWindow(hwnd)
                user.SetFocus(hwnd)
            finally:
                for target in reversed(attached): user.AttachThreadInput(current, target, False)
        time.sleep(0.06)
    foreground = user.GetForegroundWindow()
    classname = ctypes.create_unicode_buffer(256)
    user.GetClassNameW(foreground, classname, 256)
    raise RuntimeError("Refusing input to another window: " + json.dumps(dict(command=sys.argv[2], requested=hwnd, foreground=foreground, foregroundClass=classname.value, exists=bool(user.IsWindow(hwnd)), enabled=bool(user.IsWindowEnabled(hwnd)), visible=bool(user.IsWindowVisible(hwnd)))))
rect, client = wintypes.RECT(), wintypes.RECT()
user.GetWindowRect(hwnd, ctypes.byref(rect))
user.GetClientRect(hwnd, ctypes.byref(client))
if sys.argv[2] == "focus":
    user.ShowWindow(hwnd, 9)
    focus_target()
if sys.argv[2] == "wake":
    # SetForegroundWindow alone does not wake a sleeping display. A modifier
    # tap in our verified window gives pixel checks an active desktop.
    focus_target()
    user.keybd_event(0x10, user.MapVirtualKeyW(0x10, 0), 0, 0)
    time.sleep(0.08)
    user.keybd_event(0x10, user.MapVirtualKeyW(0x10, 0), 2, 0)
if sys.argv[2] == "click":
    x, y = round(float(sys.argv[3]) * client.right), round(float(sys.argv[4]) * client.bottom)
    user.SetForegroundWindow(hwnd)
    point, previous = wintypes.POINT(x, y), wintypes.POINT()
    user.ClientToScreen(hwnd, ctypes.byref(point))
    if user.WindowFromPoint(point) != hwnd: raise RuntimeError("Another window covers the game click target")
    user.GetCursorPos(ctypes.byref(previous))
    user.SetCursorPos(point.x, point.y)
    time.sleep(0.12)
    user.mouse_event(0x0002, 0, 0, 0, 0)
    time.sleep(0.08)
    user.mouse_event(0x0004, 0, 0, 0, 0)
    time.sleep(0.15)
    user.SetCursorPos(previous.x, previous.y)
if sys.argv[2].startswith("key-"):
    focus_target()
    shifted = "shift" in sys.argv[2]
    key = 0x74 if "f5" in sys.argv[2] else 0x70 if "f1" in sys.argv[2] else 0x75
    if shifted: user.keybd_event(0x10, user.MapVirtualKeyW(0x10, 0), 0, 0)
    user.keybd_event(key, user.MapVirtualKeyW(key, 0), 0, 0)
    time.sleep(0.08)
    user.keybd_event(key, user.MapVirtualKeyW(key, 0), 2, 0)
    if shifted: user.keybd_event(0x10, user.MapVirtualKeyW(0x10, 0), 2, 0)
center = wintypes.POINT((rect.left + rect.right) // 2, (rect.top + rect.bottom) // 2)
print(json.dumps(dict(exists=bool(user.IsWindow(hwnd)), visible=bool(user.IsWindowVisible(hwnd)), enabled=bool(user.IsWindowEnabled(hwnd)), parent=str(user.GetParent(hwnd) or ""), owner=str(user.GetWindow(hwnd, 4) or ""), isChild=bool(user.GetWindowLongPtrW(hwnd, -16) & 0x40000000), foreground=str(user.GetForegroundWindow() or ""), atCenter=str(user.WindowFromPoint(center) or ""), bounds=[rect.left, rect.top, rect.right, rect.bottom], client=[client.right, client.bottom])))
`);
  await fs.writeFile(path.join(output, 'capture-screen.ps1'), String.raw`param([string]$Manifest)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type 'using System; using System.Runtime.InteropServices; public class StudioCaptureNative { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context); }'
[StudioCaptureNative]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
foreach ($item in (Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json)) {
  $bitmap = [System.Drawing.Bitmap]::new([int]$item.width, [int]$item.height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen([int]$item.x, [int]$item.y, 0, 0, $bitmap.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
    $bitmap.Save([string]$item.path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
`);
  await server?.listen();
  application = await launchDesktopFixture({ root, profile, projectFile, devUrl: server ? `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` : undefined });
  const page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 30000 });
  await application.evaluate(({ powerSaveBlocker }) => powerSaveBlocker.start('prevent-display-sleep'));
  const parent = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
  await native(parent, 'wake');
  await page.evaluate(() => {
    window.__previewEvents = []; window.__previewInputs = [];
    window.studio!.onRuntimeEvent(event => window.__previewEvents.push(event));
    for (const type of ['keydown', 'keyup', 'click']) window.addEventListener(type, event => {
      const key = event instanceof KeyboardEvent ? event.key : undefined;
      if (key && !/^F\d+$/.test(key)) return;
      window.__previewInputs.push({ type, key, target: (event.target as HTMLElement)?.closest('button')?.textContent ?? undefined, at: Date.now() });
    }, true);
  });
  await openStoryMode(page, 'text');
  const source = page.getByLabel('中文文本剧本'), originalText = await source.inputValue();
  const opening = project.nodes.find(node => node.kind === 'passage')!;
  if (opening.kind !== 'passage') throw new Error('No opening');
  const authoredText = originalText.replace(opening.lines[0].text, opening.lines[0].text + '【试玩草稿】');
  expect(authoredText).not.toBe(originalText);
  await source.fill(authoredText);
  await page.getByRole('button', { name: '实时试玩', exact: true }).click();
  await expect(page.getByRole('region', { name: '实时试玩工作区' })).toBeVisible();
  await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', /compiling|starting|running/);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await page.waitForTimeout(600);
  await application.evaluate(({ BrowserWindow }) => { const current = BrowserWindow.getAllWindows()[0]; current.restore(); current.focus(); });
  await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', /running|failed/, { timeout: 60000 });
  expect(await page.locator('.play-workspace').getAttribute('data-preview-state'), (await page.locator('.play-placeholder').textContent().catch(() => '')) ?? '').toBe('running');
  const readyEvent = await page.evaluate(() => window.__previewEvents.find(event => event.kind === 'preview' && event.phase === 'running')!);
  const build = path.join(profile, 'builds', project.id, 'preview', readyEvent.sessionId!);
  const ready = JSON.parse(await fs.readFile(path.join(build, 'preview-ready.json'), 'utf8'));
  expect(ready.parent).toBe(parent); expect(ready.visible).toBe(true);
  expect((await fs.stat(path.join(build, 'preview-first-frame.png'))).size).toBeGreaterThan(1000);
  const nativeWindow = await native(ready.windowId);
  await fs.writeFile(path.join(output, 'native-window.json'), JSON.stringify(nativeWindow, null, 2));
  expect(nativeWindow.visible).toBe(true); expect(nativeWindow.parent).toBe(parent);
  expect(nativeWindow.owner).toBe(parent); expect(nativeWindow.isChild).toBe(false);
  expect(ready.presentation).toBe('owned-viewport');
  const bounds = await page.getByLabel('游戏画面', { exact: true }).boundingBox(); const ratio = await page.evaluate(() => devicePixelRatio);
  expect(Math.abs(nativeWindow.client[0] - bounds!.width * ratio)).toBeLessThan(6);
  expect(Math.abs(nativeWindow.client[1] - bounds!.height * ratio)).toBeLessThan(6);
  expect(await fs.readFile(path.join(build, 'game/story.rpy'), 'utf8')).toContain('【试玩草稿】');
  checks.push(`文本按钮立即显示启动状态；真实首帧、可见原生窗口、编辑器所属关系与 DPI 尺寸均匹配。首次检测窗口时 visible=${ready.initialVisibility}。`);
  checks.push('编译启动期间最小化再恢复，试玩区域保留原尺寸并成功显示首帧。');
  await fs.copyFile(path.join(build, 'preview-first-frame.png'), path.join(output, 'game-first-frame.png'));
  await native(ready.windowId, 'focus');
  await native(ready.windowId, 'wake');
  expect((await native(ready.windowId)).atCenter).toBe(ready.windowId);
  await fs.writeFile(path.join(output, 'native-window.json'), JSON.stringify(await native(ready.windowId), null, 2));
  const captureElectron = () => application!.evaluate(async ({ desktopCapturer, BrowserWindow, screen }, gameBounds) => {
    const current = BrowserWindow.getAllWindows()[0];
    const display = screen.getDisplayMatching(current.getBounds());
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) } });
    const source = sources.find(source => source.display_id === String(display.id));
    if (!source || source.thumbnail.isEmpty()) throw new Error('Cannot capture the presented desktop frame');
    const origin = screen.dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y });
    const editor = current.getBounds(), editorOrigin = screen.dipToScreenPoint(editor);
    return {
      game: source.thumbnail.crop({ x: gameBounds[0] - origin.x, y: gameBounds[1] - origin.y, width: gameBounds[2] - gameBounds[0], height: gameBounds[3] - gameBounds[1] }).toDataURL(),
      editor: source.thumbnail.crop({ x: editorOrigin.x - origin.x, y: editorOrigin.y - origin.y, width: Math.round(editor.width * display.scaleFactor), height: Math.round(editor.height * display.scaleFactor) }).toDataURL(),
    };
  }, nativeWindow.bounds);
  let captureMethod = 'electron-desktop';
  const captureGdi = async () => {
    const currentGame = await native(ready.windowId);
    expect(currentGame.foreground, 'Capture only while the tested game owns input').toBe(ready.windowId);
    expect(currentGame.atCenter, 'Another window covers the capture region').toBe(ready.windowId);
    const editor = await native(parent);
    const regions = [{ name: 'game', bounds: currentGame.bounds }, { name: 'editor', bounds: editor.bounds }].map(({ name, bounds }) => ({ x: bounds[0], y: bounds[1], width: bounds[2] - bounds[0], height: bounds[3] - bounds[1], path: path.join(output, name + '-gdi.png') }));
    const manifest = path.join(output, 'capture-regions.json');
    await fs.writeFile(manifest, JSON.stringify(regions));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(path.join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-File', path.join(output, 'capture-screen.ps1'), '-Manifest', manifest], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let error = ''; child.stderr.on('data', chunk => error += chunk);
      child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(error)));
    });
    return { game: 'data:image/png;base64,' + (await fs.readFile(regions[0].path)).toString('base64'), editor: 'data:image/png;base64,' + (await fs.readFile(regions[1].path)).toString('base64') };
  };
  const reference = PNG.sync.read(await fs.readFile(path.join(output, 'game-first-frame.png')));
  const differenceFromGame = (pixels: PNG) => {
    let difference = 0;
    for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) {
      const expectedAt = (Math.floor((y + 0.5) / 36 * reference.height) * reference.width + Math.floor((x + 0.5) / 64 * reference.width)) * 4;
      const actualAt = (Math.floor((y + 0.5) / 36 * pixels.height) * pixels.width + Math.floor((x + 0.5) / 64 * pixels.width)) * 4;
      for (let channel = 0; channel < 3; channel++) difference += Math.abs(reference.data[expectedAt + channel] - pixels.data[actualAt + channel]);
    }
    return difference / (64 * 36 * 3);
  };
  let captured = await captureElectron();
  // Some desktop-duplication drivers return a stale surface after minimize.
  // GDI reads the same physical desktop rectangle, not the game's internal image.
  if (differenceFromGame(PNG.sync.read(Buffer.from(captured.game.split(',')[1], 'base64'))) >= 30) {
    const gdi = await captureGdi();
    if (differenceFromGame(PNG.sync.read(Buffer.from(gdi.game.split(',')[1], 'base64'))) < 30) { captureMethod = 'gdi-desktop'; captured = gdi; }
  }
  const capturePresented = () => captureMethod === 'gdi-desktop' ? captureGdi() : captureElectron();
  await expect.poll(async () => {
    captured = await capturePresented();
    const frame = Buffer.from(captured.game.split(',')[1], 'base64');
    await fs.writeFile(path.join(output, 'game-presented.png'), frame);
    await fs.writeFile(path.join(output, 'editor-with-game.png'), Buffer.from(captured.editor.split(',')[1], 'base64'));
    const pixels = PNG.sync.read(frame);
    return differenceFromGame(pixels);
  }, { timeout: 10000, intervals: [100, 250, 500, 1000], message: 'Wait for the desktop compositor to present the real game frame' }).toBeLessThan(30);
  const presentedFrame = Buffer.from(captured.game.split(',')[1], 'base64');
  const pixels = PNG.sync.read(presentedFrame);
  let brightPixels = 0;
  for (let index = 0; index < pixels.data.length; index += 4) if ((pixels.data[index] + pixels.data[index + 1] + pixels.data[index + 2]) / 3 > 48) brightPixels++;
  expect(brightPixels / (pixels.width * pixels.height), 'The actual presented title frame must be visible in the editor').toBeGreaterThan(0.25);
  const meanColorDifference = differenceFromGame(pixels);
  expect(meanColorDifference, 'Presented pixels must match the game title, not another desktop window').toBeLessThan(30);
  await fs.writeFile(path.join(output, 'game-presented.png'), presentedFrame);
  await fs.writeFile(path.join(output, 'editor-with-game.png'), Buffer.from(captured.editor.split(',')[1], 'base64'));
  await fs.writeFile(path.join(output, 'presentation.json'), JSON.stringify({ captureMethod, brightFraction: brightPixels / (pixels.width * pixels.height), meanColorDifference, owner: nativeWindow.owner, isChild: nativeWindow.isChild }, null, 2));
  checks.push('实际桌面合成画面显示完整标题，已检查编辑器中的可见像素。');

  const originalPosition = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getPosition());
  await application.evaluate(({ BrowserWindow }, position) => BrowserWindow.getAllWindows()[0].setPosition(position[0] + 40, position[1] + 20), originalPosition);
  await expect.poll(async () => Math.abs((await native(ready.windowId)).bounds[0] - nativeWindow.bounds[0] - Math.round(40 * ratio))).toBeLessThanOrEqual(2);
  await expect.poll(async () => Math.abs((await native(ready.windowId)).bounds[1] - nativeWindow.bounds[1] - Math.round(20 * ratio))).toBeLessThanOrEqual(2);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await expect.poll(async () => (await native(ready.windowId)).visible).toBe(false);
  await application.evaluate(({ BrowserWindow }, position) => { const current = BrowserWindow.getAllWindows()[0]; current.restore(); current.setPosition(position[0], position[1]); current.focus(); }, originalPosition);
  await expect.poll(async () => (await native(ready.windowId)).visible).toBe(true);
  await expect.poll(async () => Math.abs((await native(ready.windowId)).bounds[0] - nativeWindow.bounds[0])).toBeLessThanOrEqual(2);
  checks.push('试玩画面跟随编辑器移动，最小化时隐藏，恢复后回到正确区域。');

  await native(ready.windowId, 'key-f6');
  await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', 'paused');
  const controlPath = path.join(build, 'preview-control.json'), savedControl = await fs.readFile(controlPath, 'utf8');
  await fs.writeFile(controlPath, '{');
  await page.waitForTimeout(350);
  expect((await native(ready.windowId)).exists).toBe(true);
  expect(await fs.access(path.join(build, 'traceback.txt')).then(() => true, () => false)).toBe(false);
  await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', 'paused');
  await fs.writeFile(controlPath, savedControl);
  checks.push('控制快照暂不可读时保留暂停状态，恢复有效文件后可以继续，无运行时异常。');
  await native(parent, 'key-f6');
  await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', 'running');
  checks.push('标题菜单中的实体 F6 可暂停与继续。');

  const start = project.ui.components.find(component => component.id === 'ai_title_start')!;
  await native(ready.windowId, 'click', start.x + start.width / 2, start.y + start.height / 2);
  await expect.poll(() => page.evaluate(() => window.__previewEvents.some(event => event.kind === 'position' && event.nodeId === 'ai_title_one')), { timeout: 15000 }).toBe(true);
  await native(ready.windowId, 'key-f6');
  await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', 'paused');
  await expect.poll(async () => (await native(ready.windowId)).foreground).toBe(parent);
  expect(await page.evaluate(() => window.__previewEvents.filter(event => event.kind === 'position').at(-1)?.nodeId)).toBe('ai_title_one');
  await native(parent, 'key-f6');
  await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', 'running');
  checks.push('章节模态画面中实体 F6 可暂停，焦点回到编辑器后再按 F6 可继续。');
  await expect.poll(() => page.evaluate(id => window.__previewEvents.some(event => event.kind === 'position' && event.nodeId === id), opening.id), { timeout: 15000 }).toBe(true);
  // Position is emitted before the entry transition. This assertion targets the
  // actual dialogue interaction; chapter-animation shortcuts were checked above.
  await expect.poll(() => page.evaluate(id => window.__previewEvents.some(event => event.kind === 'log' && event.message === 'VNS_TEST_DIALOGUE_READY:' + id), opening.lines[0].id), { timeout: 15000 }).toBe(true);
  await native(ready.windowId, 'key-f6');
  await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', 'paused');
  expect((await native(ready.windowId)).enabled).toBe(false);
  await expect.poll(async () => (await native(ready.windowId)).foreground).toBe(parent);
  await native(parent, 'key-f6');
  await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', 'running');
  expect((await native(ready.windowId)).enabled).toBe(true);
  await page.getByRole('button', { name: '返回编辑', exact: true }).click();
  await expect(source).toBeVisible(); await expect.poll(async () => (await native(ready.windowId)).visible).toBe(false);
  expect(await source.inputValue()).toBe(authoredText);
  await page.getByRole('button', { name: '返回试玩画面', exact: true }).click();
  await expect.poll(async () => (await native(ready.windowId)).visible).toBe(true);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 740));
  await expect.poll(async () => Math.abs((await native(ready.windowId)).client[0] - (await page.getByLabel('游戏画面', { exact: true }).boundingBox())!.width * ratio)).toBeLessThan(6);
  checks.push('原生标题按钮进入剧情并回传位置；暂停/继续、返回编辑隐藏窗口、恢复画面与调整尺寸生效，文本保持不变。');
  // Returning to editing intentionally pauses the game. Reopening its viewport
  // preserves that pause; resume from the editor before sending game shortcuts.
  await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', 'paused');
  await native(parent, 'key-f6');
  await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', 'running');
  await expect.poll(async () => (await native(ready.windowId)).enabled).toBe(true);
  await native(ready.windowId, 'key-shift-f1');
  await expect.poll(async () => (await native(ready.windowId)).foreground).toBe(parent);
  await native(ready.windowId, 'key-shift-f5'); await expect(source).toBeVisible();
  await expect.poll(async () => (await native(ready.windowId)).exists).toBe(false);
  await page.getByRole('button', { name: '实时试玩', exact: true }).click();
  await page.getByRole('button', { name: '停止试玩（Shift+F5）', exact: true }).click();
  await expect(source).toBeVisible();
  await expect(page.getByRole('button', { name: '实时试玩', exact: true })).toBeEnabled({ timeout: 15000 });
  checks.push('停止关闭真实游戏；编译期间取消不会晚到弹出窗口或覆盖新状态。');
  await page.getByRole('button', { name: '作品设置', exact: true }).click();
  await page.getByRole('button', { name: '试玩设置', exact: true }).click();
  await page.getByLabel('试玩方式', { exact: true }).selectOption('window');
  await page.getByRole('button', { name: '开始试玩', exact: true }).click();
  await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', /running|failed/, { timeout: 60000 });
  expect(await page.locator('.play-workspace').getAttribute('data-preview-state')).toBe('running');
  const external = await page.evaluate(() => window.__previewEvents.filter(event => event.kind === 'preview' && event.phase === 'running').at(-1)!);
  expect((await native(external.windowId!)).visible).toBe(true); expect((await native(external.windowId!)).parent).toBe('');
  await page.getByRole('button', { name: '显示游戏窗口', exact: true }).click();
  await page.getByRole('button', { name: '停止试玩（Shift+F5）', exact: true }).click();
  await expect.poll(async () => (await native(external.windowId!)).exists).toBe(false);
  checks.push('独立窗口模式真正显示游戏，能够从编辑器定位和停止。');

  const brokenDir = path.join(output, 'broken-project');
  await fs.cp(projectDir, brokenDir, { recursive: true });
  await fs.mkdir(path.join(brokenDir, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(brokenDir, 'scripts/startup-failure.rpy'), 'init 999 python:\n    raise RuntimeError("preview-startup-error-for-test")\n');
  const broken = structuredClone(project); broken.id = 'project_preview_failure'; broken.name = '启动异常验证';
  broken.assets.push({ id: 'asset_preview_failure', kind: 'script', name: '启动错误', path: 'scripts/startup-failure.rpy' });
  const brokenFile = path.join(brokenDir, 'project.vns.json'); await fs.writeFile(brokenFile, JSON.stringify(broken, null, 2));
  await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog; }, brokenFile);
  await page.getByRole('button', { name: '打开工程', exact: true }).click();
  await expect(page.locator('.project-title strong')).toHaveText(broken.name);
  await page.getByRole('button', { name: '试玩', exact: true }).click();
  await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', 'failed', { timeout: 30000 });
  await expect(page.locator('.play-placeholder')).toContainText('preview-startup-error-for-test');
  const failureSession = await page.evaluate(() => window.__previewEvents.filter(event => event.kind === 'preview' && event.phase === 'failed').at(-1)!.sessionId);
  expect(await page.evaluate(id => window.__previewEvents.some(event => event.sessionId === id && event.kind === 'preview' && event.phase === 'running'), failureSession)).toBe(false);
  checks.push('真实启动异常明确显示原因，未报告启动成功，也未留下可见游戏窗口。');
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'events.json'), JSON.stringify(await page.evaluate(() => window.__previewEvents), null, 2));
  await fs.writeFile(path.join(output, 'inputs.json'), JSON.stringify({ nativeCalls, renderer: await page.evaluate(() => window.__previewInputs) }, null, 2));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, output, build, ready }, null, 2));
  console.log(`PASS: ${checks.length} live preview checks. Report: ${path.join(output, 'report.json')}`);
} catch (error) {
  console.error(error);
  await fs.mkdir(output, { recursive: true });
  if (application) {
    const page = await application.firstWindow();
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
    await fs.writeFile(path.join(output, 'events.json'), JSON.stringify((await page.evaluate(() => window.__previewEvents).catch(() => [])) ?? [], null, 2));
    await fs.writeFile(path.join(output, 'inputs.json'), JSON.stringify({ nativeCalls, renderer: await page.evaluate(() => window.__previewInputs).catch(() => []) }, null, 2));
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, errors, error: error instanceof Error ? error.stack : String(error) }, null, 2));
  console.log(`Report: ${path.join(output, 'report.json')}`); process.exitCode = 1;
} finally { await application?.close(); await server?.close(); }
