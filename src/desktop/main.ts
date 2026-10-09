import { AiConversationStore } from './ai-conversations';
import { aiConversationSchema, conversationMarkdown } from '../core/ai-conversations';
import { visibleImageBounds } from '../core/portrait';
import { app, BrowserWindow, dialog, ipcMain, protocol, nativeImage, shell, safeStorage, net, session as electronSession } from 'electron';
import { existsSync, mkdirSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assetFiles, createProject, type Project } from '../core/model';
import { projectFolderName } from '../core/project-templates';
import type { ExportTool, PreviewOptions, PreviewCommand, PreviewViewport, ProjectSession, RunResult, RuntimeEvent } from '../core/bridge';
import { atomicWrite, autosaveProject, containedPath, assetSourcePath, importAsset, loadProject as readProject, parseProject, PROJECT_FILENAME, saveProject, WriteQueue } from './project-store';
import { resolveResourcePath } from './resource-paths';
import { runRenpy, spawnRenpy } from '../runtime/service';
import { androidSigningDirectory, checkExportEnvironment, exportBuildDirectory, exportProject } from '../runtime/game-export';
import { exportDiagnostics, exportPlatformNames, exportSettings } from '../core/export-settings';
import { PreviewController } from './preview-controller';
import { readTextDocument } from './text-import';
import { exportText, type TextExportMode } from '../core/text-exchange';
import { assetResponse } from './asset-response';
import { findSpineAtlas, importSpineAsset, readSpineAtlas } from './spine-import';
import { importAssetPaths, parseAssetImportOptions } from './asset-import';
import { AssetDiscovery } from './asset-discovery';
import { AiService } from './ai-service';
import { AiAuthoringService } from './ai-authoring';
import { inspectAiAttachments, inspectMentionedAiAttachments } from './ai-attachments';
import { AiWindowController } from './ai-window';
import { UiPreviewWindowController } from './ui-preview-window';
import { ExportSetupController } from './export-setup';
import { RecentProjects } from './recent-projects';
import { autosaveAtLocation, discardProjectRecovery, loadRelocatedProject, projectFileExists, recoverProjectAtLocation } from './project-location';
import { revealExportResult } from './export-result';
import { TemplateLibrary } from './template-library';

protocol.registerSchemesAsPrivileged([{ scheme: 'studio-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
if (!app.isPackaged && process.env.VNS_USER_DATA) app.setPath('userData', path.resolve(process.env.VNS_USER_DATA));
const explicitData = app.commandLine.getSwitchValue('user-data-dir');
if (explicitData) app.setPath('userData', path.resolve(explicitData));
else if (app.isPackaged && existsSync(path.join(path.dirname(process.execPath), 'portable.json'))) {
  const portableData = path.join(path.dirname(process.execPath), 'data');
  try {
    mkdirSync(portableData, { recursive: true });
    app.setPath('userData', portableData);
  } catch {
    dialog.showErrorBox('无法创建便携版数据目录', `请先将整个压缩包解压到可以写入的文件夹（例如桌面或 E:\\叙事工坊），再运行程序。\n\n无法写入：${portableData}`);
    app.exit(1);
  }
}
let window: BrowserWindow;
let session: ProjectSession = { project: createProject(), path: null, recovered: false };
let sdkRoot: string | null = null;
let initialSession: Promise<ProjectSession> | undefined;
let closeApproved = false;
let closeRequested = false;
let finalizingClose = false;
let exporting = false;
const writes = new WriteQueue();
const resources = app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(app.getAppPath(), 'resources');
const templates = new TemplateLibrary(path.join(app.getPath('userData'), 'templates'), path.join(resources, 'templates/aihong'));
const loadProject = async (file: string): Promise<ProjectSession> => ({ ...await readProject(file, path.join(resources, 'templates/aihong')), template: templates.identify(file) });
const testRoot = !app.isPackaged ? process.env.VNS_TEST_ROOT : undefined;
const prefsPath = () => path.join(app.getPath('userData'), 'workspace.json');
const draftPath = () => path.join(app.getPath('userData'), 'draft.vns.json');
const projectDirectory = (project: Project) => session.path && session.project.id === project.id ? path.dirname(session.path) : undefined;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const exportSetup = new ExportSetupController({
  resources, userData: app.getPath('userData'), appVersion: app.getVersion(),
  fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
  resolveProxy: url => electronSession.defaultSession.resolveProxy(url),
  onRuntime: directory => { sdkRoot = directory; },
  onProgress: state => { if (window && !window.isDestroyed()) window.webContents.send('studio:export-setup-progress', state); },
});
const exportEnvironment = async (project: Project) => ({ sdkRoot, projectDir: projectDirectory(project), spineRuntimeDir: path.join(resources, 'spine'), javaHome: await exportSetup.javaHome(), processEnv: await exportSetup.processEnvironment() });
const previewController = new PreviewController({ window: () => window, userData: app.getPath('userData'), sdk: () => sdkRoot, resources, projectDirectory, emit: event => emitEvent(event) });
const aiConversations = new AiConversationStore(path.join(app.getPath('userData'),'ai-conversations'));
const aiService = new AiService({
  chunk: (id,text)=>{for(const window of BrowserWindow.getAllWindows())if(!window.isDestroyed())window.webContents.send('studio:ai-chunk',{id,text});},
  file: path.join(app.getPath('userData'), 'ai-settings.json'), vault: safeStorage,
  // Chromium honors the desktop's system proxy; Node fetch bypasses it.
  fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
});
const aiAuthoring = new AiAuthoringService(aiService, { projectDirectory, progress: progress => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('studio:ai-progress', progress); } });
const aiWindow = new AiWindowController({ editor: () => window, desktopDir: __dirname, devUrl: !app.isPackaged ? process.env.VNS_DEV_URL : undefined, onClose: () => aiAuthoring.cancelAll() });
const uiPreviewWindow = new UiPreviewWindowController({ editor: () => window, desktopDir: __dirname, devUrl: !app.isPackaged ? process.env.VNS_DEV_URL : undefined });

const recentProjects = new RecentProjects(prefsPath());
async function remember() { if (!templates.identify(session.path)) await recentProjects.remember(session.path, session.project.name, session.project.id); }
async function locateSdk(): Promise<string | null> {
  if (app.isPackaged) {
    try { return await exportSetup.ensureRuntime(); }
    catch { return null; /* The export panel offers repair and a concrete error. */ }
  }
  const candidates = [process.env.VNS_RENPY_SDK, path.join(resources, 'runtime'), path.resolve(app.getAppPath(), '..')];
  for (const candidate of candidates) if (candidate) {
    try { await fs.access(path.join(candidate, 'lib', 'py3-windows-x86_64', 'python.exe')); await fs.access(path.join(candidate, 'renpy.py')); return candidate; } catch { /* Try the next installed runtime. */ }
  }
  return null;
}

async function chooseSave(project: Project, saveAs = false): Promise<ProjectSession | null> {
  const savingDraft = !session.path && session.project.id === project.id;
  let file = !saveAs && session.project.id === project.id ? session.path : null;
  if (file && !await projectFileExists(file)) {
    await writes.run(() => autosaveAtLocation(file, project, app.getPath('userData')));
    throw new Error('工程文件已移动或不可用，编辑内容已暂存。请点击“重新定位工程”选择新位置，再保存。');
  }
  if (!file) {
    if (testRoot) file = path.join(testRoot, project.id, PROJECT_FILENAME);
    else {
      const safeName = projectFolderName(project.name);
      const defaultDir = path.join(app.getPath('documents'), 'Visual Novel Studio', safeName);
      await fs.mkdir(defaultDir, { recursive: true });
      const choice = await dialog.showSaveDialog(window, { title: '保存作品', defaultPath: path.join(defaultDir, PROJECT_FILENAME), filters: [{ name: '叙事工坊项目', extensions: ['json'] }] });
      if (choice.canceled || !choice.filePath) return null;
      file = choice.filePath;
    }
  }
  const sourceDir = projectDirectory(project);
  session = await writes.run(() => saveProject(file!, project, sourceDir));
  session.template = templates.identify(session.path);
  await remember();
  if (savingDraft) await fs.rm(`${draftPath()}.autosave`, { force: true });
  return session;
}

async function loadInitial(): Promise<ProjectSession> {
  const requested = !app.isPackaged && process.env.VNS_PROJECT_PATH;
  if (requested) { session = await loadProject(requested); return session; }
  try {
    const recovered = await loadProject(draftPath());
    session = { ...recovered, path: null, recovered: true };
    return session;
  } catch { /* No recoverable unsaved work. */ }
  const prefs = await fs.readFile(prefsPath(), 'utf8').then(JSON.parse).catch(() => ({}));
  if (prefs.path) {
    try { if (await projectFileExists(prefs.path)) { session = await loadProject(prefs.path); return session; } } catch { /* Reopen from its new location or explicitly recover it. */ }
  }
  const example = path.join(resources, 'example');
  try {
    const working = path.join(app.getPath('userData'), 'example');
    await fs.cp(example, working, { recursive: true, force: false });
    session = await loadProject(path.join(working, PROJECT_FILENAME));
  } catch { session = { project: createProject(), path: null, recovered: false }; }
  return session;
}

function emit(message: string, kind: 'log' | 'exit' = 'log', code?: number) {
  if (window && !window.isDestroyed()) window.webContents.send('studio:runtime', { kind, message, code });
}
function emitEvent(event: RuntimeEvent) { if (window && !window.isDestroyed()) window.webContents.send('studio:runtime', event); }

function registerHandlers() {
  ipcMain.handle('studio:project-hub', async () => {
    const explicitProject = !app.isPackaged && process.env.VNS_PROJECT_PATH;
    const bypass = !app.isPackaged && process.env.VNS_SKIP_PROJECT_HUB === '1';
    if (explicitProject || bypass) await (initialSession ??= loadInitial());
    let recovery: { name: string; savedAt: number } | undefined;
    try { const raw = JSON.parse(await fs.readFile(draftPath() + '.autosave', 'utf8')); if (typeof raw.project?.name === 'string') recovery = { name: raw.project.name, savedAt: Number(raw.savedAt) || 0 }; } catch { /* No unsaved draft. */ }
    return { recent: (await recentProjects.list()).filter(item => !templates.identify(item.path)), templates: await templates.list(), recovery, defaultDirectory: path.join(app.getPath('documents'), 'Visual Novel Studio'), ...((explicitProject || bypass) ? { direct: session } : {}) };
  });
  ipcMain.handle('studio:template-create', (_event, name, source = 'blank') => writes.run(async () => {
    const next = await templates.create(name, source);
    previewController.stop(); session = next; initialSession = Promise.resolve(session); return session;
  }));
  ipcMain.handle('studio:template-edit', (_event, id) => writes.run(async () => {
    const next = await templates.open(id);
    previewController.stop(); session = next; initialSession = Promise.resolve(session); return session;
  }));
  ipcMain.handle('studio:project-hub-open', async (_event, file: unknown) => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('请选择有效的工程文件。');
    if (!await projectFileExists(file)) throw new Error('工程文件已移动或不可用，请重新定位工程；恢复内容可单独打开。');
    return writes.run(async () => { const next = await loadProject(file); previewController.stop(); session = next; initialSession = Promise.resolve(session); await remember(); return session; });
  });
  ipcMain.handle('studio:project-location', async () => {
    const file = session.path;
    return { path: file, missing: !!file && !await projectFileExists(file) };
  });
  ipcMain.handle('studio:project-recover', (_event, file: string) => writes.run(async () => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('工程路径无效。');
    const next = await recoverProjectAtLocation(file, app.getPath('userData'));
    previewController.stop(); session = next; initialSession = Promise.resolve(session); return session;
  }));
  ipcMain.handle('studio:project-relocate', async (_event, file: string, current?: unknown) => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('工程路径无效。');
    const snapshot = current ? parseProject(current).project : undefined;
    if (snapshot && (session.path !== file || session.project.id !== snapshot.id)) throw new Error('当前工程已切换，请重新定位当前工程。');
    const entry = (await recentProjects.list()).find(item => item.path.toLowerCase() === path.normalize(file).toLowerCase());
    const recovered = await recoverProjectAtLocation(file, app.getPath('userData')).catch(() => undefined);
    const expectedId = snapshot?.id ?? entry?.projectId ?? recovered?.project.id;
    const choice = await dialog.showOpenDialog(window, { title: '重新定位工程：选择移动后的 project.vns.json', properties: ['openFile'], filters: [{ name: '叙事工坊项目', extensions: ['json'] }] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    let next = await loadRelocatedProject(choice.filePaths[0], expectedId);
    if (snapshot) next = { ...next, project: snapshot, recovered: true };
    else if (recovered && JSON.stringify(recovered.project) !== JSON.stringify(next.project)) {
      const answer = await dialog.showMessageBox(window, { type: 'question', title: '选择要继续的内容', message: '旧位置的恢复内容与新位置的工程不同。', detail: '选择这次继续编辑的版本。工程文件仅在你保存时更新。', buttons: ['使用新位置的内容', '保留旧位置的恢复内容', '取消'], defaultId: 0, cancelId: 2 });
      if (answer.response === 2) return null;
      if (answer.response === 1) next = { ...next, project: recovered.project, recovered: true };
    }
    return writes.run(async () => {
      await recentProjects.remember(next.path, next.project.name, next.project.id, file);
      previewController.stop(); session = next; initialSession = Promise.resolve(session); return session;
    });
  });
  ipcMain.handle('studio:project-hub-forget', (_event, file: unknown) => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('工程路径无效。');
    return recentProjects.forget(file);
  });
  ipcMain.handle('studio:project-hub-recover', () => writes.run(async () => {
    const recovered = await loadProject(draftPath());
    session = { ...recovered, path: null, recovered: true }; initialSession = Promise.resolve(session); return session;
  }));
  ipcMain.handle('studio:project-hub-directory', async () => {
    const choice = await dialog.showOpenDialog(window, { title: '选择新工程的父文件夹', properties: ['openDirectory', 'createDirectory'] });
    return choice.canceled ? null : choice.filePaths[0] ?? null;
  });
  ipcMain.handle('studio:project-hub-create', async (_event, name: unknown, template: unknown, directory: unknown) => {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) throw new Error('请输入 1 到 200 字的作品名称。');
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('请选择绝对路径的工程位置。');
    return writes.run(async () => {
      const next = await templates.createProject(name, template as import('../core/project-templates').ProjectTemplate, directory);
      previewController.stop(); session = next; initialSession = Promise.resolve(session); await remember(); return session;
    });
  });
  ipcMain.handle('studio:ai-config', () => aiService.getConfig());
  ipcMain.handle('studio:ai-config-save', async (_event, config) => {
    const view = await aiService.saveConfig(config);
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('studio:ai-config-changed', view);
    return view;
  });
  ipcMain.handle('studio:ai-conversations', (_event, projectId)=>aiConversations.list(projectId));
  ipcMain.handle('studio:ai-conversation-read', (_event, projectId,id)=>aiConversations.read(projectId,id));
  ipcMain.handle('studio:ai-conversation-save', (_event, conversation)=>aiConversations.save(conversation));
  ipcMain.handle('studio:ai-conversation-delete', (_event, projectId,id)=>aiConversations.delete(projectId,id));
  ipcMain.handle('studio:ai-conversation-export', async (event,raw)=>{
    const conversation=aiConversationSchema.parse(raw);
    const choice=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender)??window,{title:'导出聊天记录',defaultPath:conversation.title.replace(/[<>:"/\\|?*]/g,'_')+'.md',filters:[{name:'Markdown',extensions:['md']}]});
    if(choice.canceled||!choice.filePath)return false;
    await fs.writeFile(choice.filePath,conversationMarkdown(conversation),'utf8');return true;
  });
  ipcMain.handle('studio:ai-request', async (_event, request) => {
    aiService.beginUsage(request?.id);
    try {const response=await aiAuthoring.request(request);return {...response,usage:aiService.takeUsage(request.id)};}
    catch(error){aiService.takeUsage(request.id);throw error;}
  });
  ipcMain.handle('studio:ai-attachments', (_event, paths) => inspectAiAttachments(paths));
  ipcMain.handle('studio:ai-attachments-mentioned', (_event, request) => inspectMentionedAiAttachments(request));
  ipcMain.handle('studio:ai-attachments-choose', async (event, mode) => {
    if (mode !== 'files' && mode !== 'directory') throw new Error('附件选择方式无效。');
    const parent = BrowserWindow.fromWebContents(event.sender) ?? window;
    const result = await dialog.showOpenDialog(parent, { title: mode === 'directory' ? '引用文件夹' : '添加参考文件', properties: mode === 'directory' ? ['openDirectory'] : ['openFile', 'multiSelections'] });
    return result.canceled ? [] : inspectAiAttachments(result.filePaths);
  });
  ipcMain.handle('studio:ai-test', (_event, id) => aiService.test(id));
  ipcMain.handle('studio:ai-cancel', (_event, id) => aiAuthoring.cancel(id));
  ipcMain.handle('studio:ai-models', (_event, id, config) => aiService.listModels(id, config));
  aiWindow.registerHandlers();
  uiPreviewWindow.registerHandlers();
  ipcMain.handle('studio:initial', async () => { await (initialSession ??= loadInitial()); return session; });
  ipcMain.handle('studio:new', async (_event, name: unknown, template: unknown = 'blank') => {
    previewController.stop();
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) throw new Error('请输入 1 到 200 字的作品名称。');
    const project = createProject(name.trim());
    if (template !== 'blank') {
      const available = await templates.list();
      if (!available.some(item => item.id === template && item.available)) throw new Error('所选工程模板不存在或不可用。');
      const defaultDir = path.join(app.getPath('documents'), 'Visual Novel Studio', projectFolderName(project.name));
      await fs.mkdir(defaultDir, { recursive: true });
      const choice = await dialog.showSaveDialog(window, { title: '从模板创建工程', defaultPath: path.join(defaultDir, PROJECT_FILENAME), filters: [{ name: '叙事工坊项目', extensions: ['json'] }] });
      if (choice.canceled || !choice.filePath) return null;
      return writes.run(async () => {
        session = await templates.createProjectFile(project.name, template as import('../core/project-templates').ProjectTemplate, choice.filePath!);
        await remember();
        return session;
      });
    }
    return writes.run(async () => {
      await autosaveProject(draftPath(), project);
      session = { project, path: null, recovered: false };
      await remember();
      return session;
    });
  });
  ipcMain.handle('studio:environment', () => ({ sdkPath: sdkRoot, appVersion: app.getVersion() }));
  ipcMain.handle('studio:export-check', async (_event, input: unknown) => {
    const project = parseProject(input).project;
    return checkExportEnvironment(project, await exportEnvironment(project));
  });
  ipcMain.handle('studio:export-setup', async (_event, input: unknown, options: unknown) => {
    if (exporting) return { ok: false, error: '游戏正在导出，完成后再配置环境。' };
    const project = parseProject(input).project;
    const accepted = !!options && typeof options === 'object' && 'acceptAndroidLicense' in options && options.acceptAndroidLicense === true;
    return exportSetup.run(project, projectDirectory(project), accepted);
  });
  ipcMain.handle('studio:export-setup-cancel', () => exportSetup.cancel());
  ipcMain.handle('studio:export-setup-status', () => exportSetup.snapshot());
  ipcMain.handle('studio:export-tool', async (_event, tool: ExportTool, input: unknown) => {
    const project = parseProject(input).project;
    if (tool === 'androidHelp') { await shell.openExternal('https://www.renpy.org/doc/html/android.html'); return; }
    if (tool === 'androidLicense') { await shell.openExternal('https://developer.android.com/studio/terms'); return; }
    if (tool === 'signing') {
      const projectDir = projectDirectory(project);
      if (!projectDir) throw new Error('请先保存作品，再打开工程的签名文件夹。');
      const directory = androidSigningDirectory(project, projectDir);
      await fs.mkdir(directory, { recursive: true });
      const error = await shell.openPath(directory);
      if (error) throw new Error(error);
      return;
    }
    if (tool !== 'androidSetup') throw new Error('未知的导出工具。');
    if (exportSetup.running || exporting) throw new Error('请等待当前配置或导出完成。');
    if (!sdkRoot) throw new Error('未找到 Ren’Py 运行时。');
    // The bundled runtime has no tutorial project. Give the launcher a small
    // setup project so its Android installation page is available immediately.
    const setup = path.join(app.getPath('userData'), 'android-environment', 'setup');
    const savedir = path.join(app.getPath('userData'), 'android-environment', 'launcher-settings');
    await atomicWrite(path.join(setup, 'game/setup.rpy'), 'define config.name = "Android 环境准备"\ndefine config.version = "1.0.0"\nlabel start:\n    return\n');
    const env = await exportSetup.processEnvironment();
    const selected = await runRenpy(sdkRoot, path.join(sdkRoot, 'launcher'), ['set_project', setup], { savedir, timeoutMs: 30_000, env });
    if (selected.code !== 0) throw new Error(`Android 环境工具未能启动：${selected.log}`);
    await new Promise<void>((resolve, reject) => {
      const child = spawnRenpy(sdkRoot!, path.join(sdkRoot!, 'launcher'), ['run'], { savedir, env, onData: text => emit(text) });
      child.once('spawn', resolve); child.once('error', reject);
    });
  });
  ipcMain.handle('studio:close-save', async (_event, input: { project: unknown; dirty: boolean } | null) => {
    if (!closeRequested) return;
    if (input === null) { closeRequested = false; await previewController.setDialogBlocked(false); return; }
    try {
      if (input.dirty) {
        const project = parseProject(input.project).project;
        if (session.project.id !== project.id) throw new Error('当前工程已切换，请重新关闭窗口。');
        const choice = await dialog.showMessageBox(window, { type: 'question', title: '保存工程', message: `是否保存对“${project.name}”的修改？`, detail: '自动恢复副本用于意外退出后的恢复；选择“不保存”将放弃本次未保存的修改。', buttons: ['保存', '不保存', '取消'], defaultId: 0, cancelId: 2, noLink: true });
        if (choice.response === 2) { closeRequested = false; await previewController.setDialogBlocked(false); return; }
        finalizingClose = true;
        if (choice.response === 0 && !await chooseSave(project)) { finalizingClose = false; closeRequested = false; await previewController.setDialogBlocked(false); return; }
        await writes.run(() => discardProjectRecovery(session.path, app.getPath('userData')));
      }
      finalizingClose = true;
      await writes.run(async () => undefined);
      closeApproved = true;
      window.close();
    } catch (error) {
      closeRequested = false; finalizingClose = false;
      await dialog.showMessageBox(window, { type: 'error', title: '未能完成关闭', message: errorMessage(error), detail: '窗口保持打开，修改尚未丢弃。请修正问题或手动保存工程后再退出。' });
      await previewController.setDialogBlocked(false);
    }
  });
  ipcMain.handle('studio:open', async () => {
    previewController.stop();
    const choice = await dialog.showOpenDialog(window, { title: '打开作品', filters: [{ name: '叙事工坊项目', extensions: ['json'] }], properties: ['openFile'] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    await writes.run(async () => {
      session = await loadProject(choice.filePaths[0]);
      initialSession = Promise.resolve(session);
      await remember();
    });
    return session;
  });
  ipcMain.handle('studio:save', (_event, input: unknown, saveAs: boolean) => chooseSave(parseProject(input).project, saveAs));
  ipcMain.handle('studio:autosave', async (_event, input: unknown) => {
    const project = parseProject(input).project;
    return writes.run(async () => {
      if (finalizingClose || session.project.id !== project.id) return { savedAt: 0 };
      const result = await autosaveAtLocation(session.path, project, app.getPath('userData'));
      session = { ...session, project, recovered: true };
      return result;
    });
  });
  ipcMain.handle('studio:import', async (_event, input: unknown, rawOptions: unknown) => {
    const options = parseAssetImportOptions(rawOptions);
    let project = parseProject(input).project;
    if (!projectDirectory(project)) {
      const saved = await chooseSave(project);
      if (!saved) return null;
      project = saved.project;
    }
    let sources = options.paths;
    if (!sources) {
      const choice = await dialog.showOpenDialog(window, options.mode === 'folder'
        ? { title: '导入素材文件夹（保留子文件夹）', properties: ['openDirectory', 'multiSelections'] }
        : { title: options.single ? '选择项目外素材' : '导入素材', properties: options.single ? ['openFile'] : ['openFile', 'multiSelections'], filters: [{ name: '可用素材', extensions: options.extensions ?? ['png', 'jpg', 'jpeg', 'webp', 'avif', 'ogg', 'opus', 'wav', 'mp3', 'flac', 'webm', 'mp4', 'ogv', 'ttf', 'otf', 'rpy'] }] });
      if (choice.canceled) return null;
      sources = choice.filePaths;
    }
    const result = await importAssetPaths(projectDirectory(project)!, project, sources, options, file => { const image = nativeImage.createFromPath(file), size = image.getSize(); return { ...size, visibleBounds: visibleImageBounds(image.toBitmap(), size.width, size.height) }; });
    session = { ...session, project: result.project };
    return { ...session, importReport: result.report };
  });
  const discoveries = new Map<string, AssetDiscovery>();
  ipcMain.handle('studio:discover-assets', async (_event, input: unknown) => {
    const project = parseProject(input).project, directory = projectDirectory(project);
    if (!directory || session.locationMissing) return null;
    const discoveryKey = directory + '/' + project.id;
    if (!discoveries.has(discoveryKey)) { discoveries.clear(); discoveries.set(discoveryKey, new AssetDiscovery()); }
    const discovered = await discoveries.get(discoveryKey)!.scan(directory, project, file => { const image = nativeImage.createFromPath(file), size = image.getSize(); return { ...size, visibleBounds: visibleImageBounds(image.toBitmap(), size.width, size.height) }; });
    return discovered ? { ...session, project: discovered } : null;
  });
  ipcMain.handle('studio:reveal-asset', async (_event, input: unknown, assetId: string) => {
    const project = parseProject(input).project, directory = projectDirectory(project);
    const asset = project.assets.find(item => item.id === assetId);
    if (!directory || !asset) throw new Error('请先保存作品并选择有效素材。');
    const file = assetSourcePath(directory, asset);
    await fs.access(file);
    shell.showItemInFolder(file);
  });
  ipcMain.handle('studio:resource-directory', async (_event, input: unknown) => {
    const project = parseProject(input).project, directory = projectDirectory(project);
    if (!directory) throw new Error('请先保存作品。');
    const folder = containedPath(directory, project.resourceSettings?.directory ?? 'assets');
    await fs.mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  });
  ipcMain.handle('studio:import-spine', async (_event, input: unknown) => {
    let project = parseProject(input).project;
    if (!projectDirectory(project)) {
      const saved = await chooseSave(project);
      if (!saved) return null;
      project = saved.project;
    }
    const choice = await dialog.showOpenDialog(window, { title: '导入骨骼动画：选择 Spine 4.2 JSON 数据', properties: ['openFile'], filters: [{ name: '骨骼与动画数据', extensions: ['json', 'bytes'] }] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const skeleton = choice.filePaths[0];
    let atlas = await findSpineAtlas(skeleton);
    if (!atlas) {
      const choice = await dialog.showOpenDialog(window, { title: '选择配套的图集索引', defaultPath: path.dirname(skeleton), properties: ['openFile'], filters: [{ name: 'Spine 图集索引', extensions: ['atlas', 'bytes'] }] });
      if (choice.canceled || !choice.filePaths[0]) return null;
      atlas = choice.filePaths[0];
    }
    const { atlas: parsed } = await readSpineAtlas(atlas);
    const textures: Record<string, string> = {};
    for (const page of parsed.pages) {
      const choice = await dialog.showOpenDialog(window, { title: `为图集“${page.name}”选择对应图片`, defaultPath: path.join(path.dirname(atlas), page.name), properties: ['openFile'], filters: [{ name: '图集图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
      if (choice.canceled || !choice.filePaths[0]) return null;
      textures[page.name] = choice.filePaths[0];
    }
    const asset = await importSpineAsset(projectDirectory(project)!, skeleton, atlas, textures, { mode: project.resourceSettings?.importMode, directory: project.resourceSettings?.directory });
    const duplicate = project.assets.some(item => item.id === asset.id);
    // Reimporting identical files must retain the author's name and metadata.
    session = { ...session, project: duplicate ? project : { ...project, assets: [...project.assets, asset] } };
    return { ...session, importReport: { imported: duplicate ? 0 : 1, duplicates: duplicate ? 1 : 0, skipped: 0, errors: [] } };
  });
  ipcMain.handle('studio:export-text', async (_event, input: unknown, mode: TextExportMode) => {
    if (!['commands', 'revision', 'dialogue'].includes(mode)) throw new Error('文本导出格式无效。');
    const project = parseProject(input).project, result = exportText(project, mode);
    const safeName = project.name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
    const choice = await dialog.showSaveDialog(window, { title: '导出文本', defaultPath: path.join(projectDirectory(project) ?? app.getPath('documents'), `${safeName}-${{ commands: '完整剧本', revision: '对白修订稿', dialogue: '纯台词' }[mode]}.txt`), filters: [{ name: 'UTF-8 文本', extensions: ['txt'] }] });
    if (choice.canceled || !choice.filePath) return null;
    await atomicWrite(choice.filePath, result.text);
    if (result.mapping) await atomicWrite(choice.filePath + '.vns-lines.json', JSON.stringify(result.mapping, null, 2));
    return choice.filePath;
  });
  ipcMain.handle('studio:import-text', async (_event, file?: string) => {
    if (file !== undefined) {
      if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('文本文件路径无效。');
      return readTextDocument(file);
    }
    const choice = await dialog.showOpenDialog(window, {
      title: '导入中文文本',
      properties: ['openFile'],
      filters: [{ name: '中文剧本文本', extensions: ['docx', 'txt', 'md'] }],
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    return readTextDocument(choice.filePaths[0]);
  });
  ipcMain.handle('studio:preview', (_event, input: unknown, preview: PreviewOptions = {}) => previewController.start(parseProject(input).project, preview));
  ipcMain.handle('studio:preview-control', (_event, command: PreviewCommand) => previewController.control(command));
  ipcMain.handle('studio:preview-viewport', (_event, viewport: PreviewViewport) => previewController.updateViewport(viewport));
  ipcMain.handle('studio:export', async (_event, input: unknown): Promise<RunResult | null> => {
    if (exportSetup.running) return { ok: false, diagnostics: [{ severity: 'error', message: '导出环境正在配置，请等待完成。' }], log: '' };
    if (exporting) return { ok: false, diagnostics: [{ severity: 'error', message: '已有游戏正在导出，请等待完成。' }], log: '' };
    exporting = true;
    try {
      const project = parseProject(input).project;
      if (!sdkRoot) throw new Error('未找到 Ren\'Py 运行时。');
      const invalid = exportDiagnostics(project);
      if (invalid.length) return { ok: false, diagnostics: invalid, log: '' };
      const environment = { ...await exportEnvironment(project), sdkRoot };
      const check = await checkExportEnvironment(project, environment);
      if (!check.ready) return { ok: false, diagnostics: check.diagnostics, log: check.diagnostics.map(d => d.message).join('\n') };
      let output: string;
      if (exportSettings(project).directory.trim()) {
        output = exportSettings(project).directory.trim();
        if (!path.isAbsolute(output)) throw new Error('导出文件位置必须是绝对路径，请点击「选择位置」选择文件夹。');
      }
      else if (testRoot) output = path.join(testRoot, 'exports');
      else {
        const choice = await dialog.showOpenDialog(window, { title: `选择 ${exportPlatformNames[exportSettings(project).platform]} 游戏导出目录`, properties: ['openDirectory', 'createDirectory'] });
        if (choice.canceled || !choice.filePaths[0]) return null;
        output = choice.filePaths[0];
      }
      const buildDir = exportBuildDirectory(project, app.getPath('userData'), app.getPath('temp'));
      const baseline = path.join(projectDirectory(project) ?? app.getPath('userData'), '.studio', project.id, 'release-baseline');
      const result = await exportProject({ ...environment, project, buildDir, baselineDir: baseline, outputDir: output, onData: text => emit(text) });
      return await revealExportResult(result, directory => shell.openPath(directory));
    } catch (error) { return { ok: false, diagnostics: [{ severity: 'error', message: errorMessage(error) }], log: errorMessage(error) }; }
    finally { exporting = false; }
  });
  ipcMain.handle('studio:export-directory', async (_event, current: unknown) => {
    if (testRoot) return path.join(testRoot, 'exports');
    const choice = await dialog.showOpenDialog(window, { title: '选择游戏导出位置', defaultPath: typeof current === 'string' && current ? current : undefined, properties: ['openDirectory', 'createDirectory'] });
    return choice.canceled ? null : choice.filePaths[0] ?? null;
  });
  ipcMain.handle('studio:open-export-directory', async (_event, directory: unknown) => {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || !(await fs.stat(directory)).isDirectory()) throw new Error('请选择有效的导出文件夹。');
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });
}

app.whenReady().then(async () => {
  sdkRoot = await locateSdk();
  protocol.handle('studio-asset', async request => {
    try {
      const url = new URL(request.url);
      // Only this fixed SDK resource is exposed; project paths retain their containment checks.
      if (url.hostname === 'runtime') {
        if (url.pathname !== '/default-font' || !sdkRoot) return new Response('Not found', { status: 404 });
        return await assetResponse(path.join(sdkRoot, 'sdk-fonts', 'SourceHanSansLite.ttf'), request);
      }
      if (url.hostname === 'ai') {
        const parts = url.pathname.slice(1).split('/');
        if (parts.length !== 2) return new Response('Not found', { status: 404 });
        const preview = aiAuthoring.previewAsset(parts[0], decodeURIComponent(parts[1]));
        if (!preview) return new Response('Not found', { status: 404 });
        const file = await fs.realpath(assetSourcePath(preview.directory, preview.asset));
        const base = await fs.realpath(preview.directory);
        if (!preview.asset.externalPath && !preview.asset.externalFiles && !file.toLowerCase().startsWith((base + path.sep).toLowerCase())) return new Response('Not found', { status: 404 });
        return await assetResponse(file, request);
      }
      if (url.hostname !== 'project') return new Response('Not found', { status: 404 });
      if (!session.path) return new Response('No project', { status: 404 });
      const relative = decodeURIComponent(url.pathname.slice(1));
      const asset = session.project.assets.find(item => assetFiles(item).includes(relative));
      const file = asset ? assetSourcePath(path.dirname(session.path), asset, relative) : resolveResourcePath(path.dirname(session.path), relative);
      const real = await fs.realpath(file);
      const base = await fs.realpath(path.dirname(session.path));
      if (!asset?.externalPath && !asset?.externalFiles && !real.toLowerCase().startsWith((base + path.sep).toLowerCase())) return new Response('Not found', { status: 404 });
      return await assetResponse(real, request);
    } catch { return new Response('Not found', { status: 404 }); }
  });
  registerHandlers();
  window = new BrowserWindow({ width: 1480, height: 940, minWidth: 1024, minHeight: 680, title: '叙事工坊', backgroundColor: '#181818', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.setMenuBarVisibility(false);
  window.on('resize', () => previewController.refreshViewport());
  window.on('move', () => previewController.refreshViewport());
  window.on('restore', () => previewController.refreshViewport());
  window.on('show', () => previewController.refreshViewport());
  window.on('close', event => {
    if (closeApproved) return;
    event.preventDefault();
    if (!closeRequested) {
      closeRequested = true;
      // The native playtest owns a separate surface above the editor. Hide it
      // before asking the renderer to show a save dialog, retaining its geometry.
      void previewController.setDialogBlocked(true).then(() => {
        if (!window.isDestroyed()) window.webContents.send('studio:close-request');
      });
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) { previewController.stop(false); aiAuthoring.cancelAll(); aiWindow.dispose(); uiPreviewWindow.dispose(); } });
  window.on('closed', () => { aiWindow.dispose(); uiPreviewWindow.dispose(); });
  if (process.env.VNS_DEV_URL && !app.isPackaged) await window.loadURL(process.env.VNS_DEV_URL);
  else await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  window.show();
});
app.on('before-quit', () => exportSetup.cancel());
app.on('window-all-closed', () => { previewController.stop(false); aiAuthoring.cancelAll(); exportSetup.cancel(); app.quit(); });
