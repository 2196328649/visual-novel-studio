import { blueprintSelectionSchema, uiPageSelectionSchema, uiAnimationSelectionSchema } from '../core/ai-selection';
import { editorLayoutSchema } from '../core/editor-layout';
import { aiEditorTargetSchema } from '../core/ai-editor-targets';
import { aiDraftProjectSchema } from '../core/ai-draft-schema';
import { aiEditorCommandSchema, aiEditorResultSchema, type AiEditorResult } from '../core/ai-editor-commands';
import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { projectSchema } from '../core/model';
import type { AiEditorAction, AiWorkspaceContext } from '../core/bridge';

const contextSchema = z.object({ project: aiDraftProjectSchema, selectedParameter: z.object({setId:z.string().min(1).max(200),variableId:z.string().min(1).max(200).optional()}).strict().optional(), selectedContentKeys: z.array(z.string().min(1).max(220)).max(20000).optional(), selectedBlueprint: blueprintSelectionSchema.optional(), selectedUiPage: uiPageSelectionSchema.optional(), selectedUiAnimation: uiAnimationSelectionSchema.optional(), selectedUiComponentId: z.string().min(1).max(200).optional(), sceneId: z.string().optional(), lineId: z.string().optional(), canUndo: z.boolean(), readOnlyMessage: z.string().optional() });

/** A separate renderer owns the conversation; only the editor owns project edits. */
export class AiWindowController {
  private window?: BrowserWindow;
  private allowClose = false;
  private loading?: Promise<void>;
  private context?: AiWorkspaceContext;
  private pending = new Map<string, { resolve: (result?: AiEditorResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private options: { editor: () => BrowserWindow; desktopDir: string; devUrl?: string; onClose: () => void }) {}

  private requireEditor(event: IpcMainInvokeEvent) {
    if (event.sender !== this.options.editor().webContents) throw new Error('此操作需要从主编辑器发起。');
  }
  private requireAssistant(event: IpcMainInvokeEvent) {
    if (!this.window || event.sender !== this.window.webContents) throw new Error('此操作需要从 AI 助手窗口发起。');
  }
  private update(raw: AiWorkspaceContext) {
    this.context = contextSchema.parse(raw);
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('studio:ai-context', this.context);
  }
  private signal(open: boolean) {
    const editor = this.options.editor();
    if (!editor.isDestroyed()) editor.webContents.send('studio:ai-window-state', open);
  }
  private rejectPending() {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('AI 助手或主编辑器已关闭。')); }
    this.pending.clear();
  }
  async open(context: AiWorkspaceContext) {
    this.update(context);
    if (this.window && !this.window.isDestroyed()) {
      await this.loading;
      if (this.window && !this.window.isDestroyed()) { if (this.window.isMinimized()) this.window.restore(); this.window.show(); this.window.focus(); }
      return;
    }
    const editorBounds = this.options.editor().getBounds(), area = screen.getDisplayMatching(editorBounds).workArea;
    const width = Math.min(940, area.width), height = Math.min(850, area.height);
    const assistant = new BrowserWindow({ width, height, minWidth: 420, minHeight: 480, x: Math.max(area.x, Math.min(area.x + area.width - width, editorBounds.x + editorBounds.width - 60)), y: Math.max(area.y, Math.min(area.y + area.height - height, editorBounds.y)), title: 'AI 助手 · 叙事工坊', show: false, backgroundColor: '#222930', webPreferences: { preload: path.join(this.options.desktopDir, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    this.window = assistant; this.allowClose=false;
    assistant.on('close', event=>{if(!this.allowClose&&!this.loading&&!assistant.webContents.isCrashed()){event.preventDefault();assistant.webContents.send('studio:ai-before-close');}});
    assistant.setMenuBarVisibility(false);
    assistant.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    assistant.on('closed', () => { if (this.window === assistant) this.window = undefined; this.rejectPending(); this.options.onClose(); this.signal(false); });
    this.loading = this.options.devUrl ? assistant.loadURL(new URL('#ai-assistant', this.options.devUrl).toString()) : assistant.loadFile(path.join(this.options.desktopDir, '..', 'dist', 'index.html'), { hash: 'ai-assistant' });
    try { await this.loading; if (!assistant.isDestroyed()) { assistant.show(); assistant.focus(); this.signal(true); } }
    catch (error) { if (!assistant.isDestroyed()) assistant.destroy(); throw error; }
    finally { this.loading = undefined; }
  }
  close() { this.allowClose=true; this.window?.close(); }
  dispose() { this.close(); this.rejectPending(); this.context = undefined; }

  registerHandlers() {
    ipcMain.handle('studio:ai-window-open', (event, context) => { this.requireEditor(event); return this.open(context); });
    ipcMain.handle('studio:ai-window-close', event => { this.requireAssistant(event); this.close(); });
    ipcMain.handle('studio:ai-context-update', (event, context) => { this.requireEditor(event); this.update(context); });
    ipcMain.handle('studio:ai-context-get', event => { this.requireAssistant(event); return this.context ?? null; });
    ipcMain.handle('studio:ai-editor-action', (event, action: AiEditorAction) => {
      this.requireAssistant(event);
      if (!action || action.projectId !== this.context?.project.id || !['apply', 'workflow', 'undo', 'locate', 'navigate', 'layout', 'command'].includes(action.kind)) throw new Error('工程已切换，请根据当前工程重新操作。');
      if (action.kind === 'apply' && (!Array.isArray(action.changes) || !action.changes.length || action.changes.length > 100000)) throw new Error('建议修改的数量无效。');
      if (action.kind === 'workflow' && (!action.proposal || action.proposal.projectId !== action.projectId)) throw new Error('创作方案不属于当前工程。');
      if (action.kind === 'locate' && typeof action.lineId !== 'string') throw new Error('台词位置无效。');
      if (action.kind === 'command') aiEditorCommandSchema.parse(action.command);
      if (action.kind === 'navigate') aiEditorTargetSchema.parse(action.target);
      if (action.kind === 'layout') editorLayoutSchema.parse(action.layout);
      const editor = this.options.editor();
      if (editor.isDestroyed()) throw new Error('主编辑器已关闭。');
      if (action.kind === 'command' || action.kind === 'navigate') { editor.show(); editor.focus(); }
      return new Promise<void | AiEditorResult>((resolve, reject) => {
        const id = randomUUID(), timer = setTimeout(() => { this.pending.delete(id); reject(new Error('暂未收到操作结果；操作可能仍在进行，请查看主编辑器，勿重复执行。')); }, action.kind === 'command' || action.kind === 'navigate' ? 900000 : 30000);
        this.pending.set(id, { resolve, reject, timer });
        editor.webContents.send('studio:ai-editor-action', { id, action });
      });
    });
    ipcMain.handle('studio:ai-editor-result', (event, result: { id: string; error?: string; result?: unknown }) => {
      this.requireEditor(event);
      const pending = this.pending.get(result?.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(result.id);
      if (result.error) pending.reject(new Error(result.error)); else if (result.result === undefined) pending.resolve(); else { const parsed=aiEditorResultSchema.safeParse(result.result); if(parsed.success)pending.resolve(parsed.data);else pending.reject(new Error('主编辑器返回了无效的操作结果。')); }
    });
  }
}
