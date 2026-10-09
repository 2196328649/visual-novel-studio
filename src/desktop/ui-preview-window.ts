import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import { aiDraftProjectSchema } from '../core/ai-draft-schema';
import { uiComponentSchema } from '../core/model';
import type { UiPreviewWindowContext } from '../core/bridge';

const contextSchema = z.object({ project: aiDraftProjectSchema, components: z.array(uiComponentSchema), pageId: z.string().min(1) });

export class UiPreviewWindowController {
 private window?: BrowserWindow;
 private loading?: Promise<void>;
 private context?: UiPreviewWindowContext;
 private signature = '';
 private bounds?: Rectangle;
 constructor(private options: { editor: () => BrowserWindow; desktopDir: string; devUrl?: string }) {}
 private editor(event: IpcMainInvokeEvent) {
  if (event.sender !== this.options.editor().webContents) throw Error('请从主编辑器打开或更新预览。');
 }
 private preview(event: IpcMainInvokeEvent) {
  if (!this.window || event.sender !== this.window.webContents) throw Error('请从预览窗口读取当前界面。');
 }
 private update(raw: UiPreviewWindowContext) {
  const context = contextSchema.parse(raw), signature = JSON.stringify(context);
  if (signature === this.signature) return;
  this.context = context;
  this.signature = signature;
  if (this.window && !this.window.isDestroyed()) this.window.webContents.send('studio:ui-preview-context', this.context);
 }
 private signal(open: boolean) {
  const editor = this.options.editor();
  if (!editor.isDestroyed()) editor.webContents.send('studio:ui-preview-window-state', open);
 }
 async open(context: UiPreviewWindowContext) {
  this.update(context);
  if (this.window && !this.window.isDestroyed()) {
   await this.loading;
   if (this.window && !this.window.isDestroyed()) { if (this.window.isMinimized()) this.window.restore(); this.window.show(); this.window.focus(); }
   return;
  }
  const editor = this.options.editor().getBounds(), saved = this.bounds;
  const area = screen.getDisplayMatching(saved ?? editor).workArea;
  const width = Math.min(saved?.width ?? 1100, area.width), height = Math.min(saved?.height ?? 800, area.height);
  const preview = new BrowserWindow({ width, height, minWidth: Math.min(640, area.width), minHeight: Math.min(480, area.height),
   x: Math.max(area.x, Math.min(area.x + area.width - width, saved?.x ?? editor.x + 70)), y: Math.max(area.y, Math.min(area.y + area.height - height, saved?.y ?? editor.y + 50)),
   title: 'UI 预览', backgroundColor: '#1c2024', show: false,
   webPreferences: { preload: path.join(this.options.desktopDir, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  preview.setBounds({ x: Math.max(area.x, Math.min(area.x + area.width - width, saved?.x ?? editor.x + 70)), y: Math.max(area.y, Math.min(area.y + area.height - height, saved?.y ?? editor.y + 50)), width, height });
  this.window = preview;
  preview.setMenuBarVisibility(false);
  preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  preview.on('close', () => {
   this.bounds = preview.getNormalBounds();
   if (!preview.isMaximized() && !preview.isMinimized() && !preview.isFullScreen()) {
    const [x, y] = preview.getPosition(), [width, height] = preview.getSize();
    this.bounds = { x, y, width, height };
   }
  });
  preview.on('closed', () => { if (this.window === preview) this.window = undefined; this.signal(false); });
  this.loading = this.options.devUrl ? preview.loadURL(new URL('#ui-preview', this.options.devUrl).toString()) : preview.loadFile(path.join(this.options.desktopDir, '..', 'dist', 'index.html'), { hash: 'ui-preview' });
  try { await this.loading; if (!preview.isDestroyed()) { preview.show(); preview.focus(); this.signal(true); } }
  catch (error) { if (!preview.isDestroyed()) preview.destroy(); throw error; }
  finally { this.loading = undefined; }
 }
 close() { this.window?.close(); }
 dispose() { this.close(); this.context = undefined; this.signature = ''; }
 registerHandlers() {
  ipcMain.handle('studio:ui-preview-open', (event, context) => { this.editor(event); return this.open(context); });
  ipcMain.handle('studio:ui-preview-update', (event, context) => { this.editor(event); if (this.window && !this.window.isDestroyed()) this.update(context); });
  ipcMain.handle('studio:ui-preview-get', event => { this.preview(event); return this.context ?? null; });
  ipcMain.handle('studio:ui-preview-close', event => { if (event.sender !== this.window?.webContents) this.editor(event); this.close(); });
 }
}
