import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AiEditorAction, AiWorkspaceContext, StudioBridge, RuntimeEvent } from '../core/bridge';
import type { AiProgress } from '../core/ai-workflow';

const bridge: StudioBridge = {
  openUiPreviewWindow: context => ipcRenderer.invoke('studio:ui-preview-open', context),
  closeUiPreviewWindow: () => ipcRenderer.invoke('studio:ui-preview-close'),
  updateUiPreviewContext: context => ipcRenderer.invoke('studio:ui-preview-update', context),
  getUiPreviewContext: () => ipcRenderer.invoke('studio:ui-preview-get'),
  onUiPreviewContext(callback) {
    const listener = (_event: Electron.IpcRendererEvent, context: import('../core/bridge').UiPreviewWindowContext) => callback(context);
    ipcRenderer.on('studio:ui-preview-context', listener);
    return () => ipcRenderer.removeListener('studio:ui-preview-context', listener);
  },
  onUiPreviewWindowState(callback) {
    const listener = (_event: Electron.IpcRendererEvent, open: boolean) => callback(open);
    ipcRenderer.on('studio:ui-preview-window-state', listener);
    return () => ipcRenderer.removeListener('studio:ui-preview-window-state', listener);
  },
  listAiConversations: projectId=>ipcRenderer.invoke('studio:ai-conversations',projectId),
  readAiConversation: (projectId,id)=>ipcRenderer.invoke('studio:ai-conversation-read',projectId,id),
  saveAiConversation: conversation=>ipcRenderer.invoke('studio:ai-conversation-save',conversation),
  deleteAiConversation: (projectId,id)=>ipcRenderer.invoke('studio:ai-conversation-delete',projectId,id),
  exportAiConversation: conversation=>ipcRenderer.invoke('studio:ai-conversation-export',conversation),
  onAiBeforeClose(callback) {const listener=()=>callback();ipcRenderer.on('studio:ai-before-close',listener);return()=>ipcRenderer.removeListener('studio:ai-before-close',listener);},
  onAiChunk(callback) {const listener=(_event:Electron.IpcRendererEvent,chunk:{id:string;text:string})=>callback(chunk);ipcRenderer.on('studio:ai-chunk',listener);return()=>ipcRenderer.removeListener('studio:ai-chunk',listener);},
  getAiConfig: () => ipcRenderer.invoke('studio:ai-config'),
  saveAiConfig: config => ipcRenderer.invoke('studio:ai-config-save', config),
  onAiConfig(callback) {
    const listener = (_event: Electron.IpcRendererEvent, config: import('../core/ai').AiConfigView) => callback(config);
    ipcRenderer.on('studio:ai-config-changed', listener);
    return () => ipcRenderer.removeListener('studio:ai-config-changed', listener);
  },
  requestAi: request => ipcRenderer.invoke('studio:ai-request', request),
  inspectAiAttachments: paths => ipcRenderer.invoke('studio:ai-attachments', paths),
  inspectMentionedAiAttachments: request => ipcRenderer.invoke('studio:ai-attachments-mentioned', request),
  chooseAiAttachments: mode => ipcRenderer.invoke('studio:ai-attachments-choose', mode),
  onAiProgress(callback) {
    const listener = (_event: Electron.IpcRendererEvent, progress: AiProgress) => callback(progress);
    ipcRenderer.on('studio:ai-progress', listener);
    return () => ipcRenderer.removeListener('studio:ai-progress', listener);
  },
  testAi: id => ipcRenderer.invoke('studio:ai-test', id),
  cancelAi: id => ipcRenderer.invoke('studio:ai-cancel', id),
  listAiModels: (id, config) => ipcRenderer.invoke('studio:ai-models', id, config),
  openAiWindow: context => ipcRenderer.invoke('studio:ai-window-open', context),
  closeAiWindow: () => ipcRenderer.invoke('studio:ai-window-close'),
  updateAiContext: context => ipcRenderer.invoke('studio:ai-context-update', context),
  getAiContext: () => ipcRenderer.invoke('studio:ai-context-get'),
  onAiContext(callback) {
    const listener = (_event: Electron.IpcRendererEvent, context: AiWorkspaceContext) => callback(context);
    ipcRenderer.on('studio:ai-context', listener);
    return () => ipcRenderer.removeListener('studio:ai-context', listener);
  },
  onAiWindowState(callback) {
    const listener = (_event: Electron.IpcRendererEvent, open: boolean) => callback(open);
    ipcRenderer.on('studio:ai-window-state', listener);
    return () => ipcRenderer.removeListener('studio:ai-window-state', listener);
  },
  runAiEditorAction: action => ipcRenderer.invoke('studio:ai-editor-action', action),
  onAiEditorAction(callback) {
    const listener = async (_event: Electron.IpcRendererEvent, { id, action }: { id: string; action: AiEditorAction }) => {
      let error: string | undefined;
      let result;
      try { result = await callback(action); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
      await ipcRenderer.invoke('studio:ai-editor-result', { id, error, result });
    };
    ipcRenderer.on('studio:ai-editor-action', listener);
    return () => ipcRenderer.removeListener('studio:ai-editor-action', listener);
  },
  getInitial: () => ipcRenderer.invoke('studio:initial'),
  getProjectHub: () => ipcRenderer.invoke('studio:project-hub'),
  createTemplate: (name, source) => ipcRenderer.invoke('studio:template-create', name, source),
  editTemplate: id => ipcRenderer.invoke('studio:template-edit', id),
  openRecentProject: file => ipcRenderer.invoke('studio:project-hub-open', file),
  relocateProject: (file, current) => ipcRenderer.invoke('studio:project-relocate', file, current),
  recoverRecentProject: file => ipcRenderer.invoke('studio:project-recover', file),
  checkProjectLocation: () => ipcRenderer.invoke('studio:project-location'),
  forgetRecentProject: file => ipcRenderer.invoke('studio:project-hub-forget', file),
  recoverDraftProject: () => ipcRenderer.invoke('studio:project-hub-recover'),
  chooseProjectDirectory: () => ipcRenderer.invoke('studio:project-hub-directory'),
  createProjectFromHub: (name, template, directory) => ipcRenderer.invoke('studio:project-hub-create', name, template, directory),
  create: (name, template) => ipcRenderer.invoke('studio:new', name, template),
  open: () => ipcRenderer.invoke('studio:open'),
  save: (project, saveAs) => ipcRenderer.invoke('studio:save', project, saveAs),
  autosave: project => ipcRenderer.invoke('studio:autosave', project),
  importAssets: (project, options) => ipcRenderer.invoke('studio:import', project, options),
  discoverAssets: project => ipcRenderer.invoke('studio:discover-assets', project),
  revealAsset: (project, assetId) => ipcRenderer.invoke('studio:reveal-asset', project, assetId),
  openResourceDirectory: project => ipcRenderer.invoke('studio:resource-directory', project),
  pathForFile: file => webUtils.getPathForFile(file),
  importSpine: project => ipcRenderer.invoke('studio:import-spine', project),
  importText: path => ipcRenderer.invoke('studio:import-text', path),
  exportText: (project, mode) => ipcRenderer.invoke('studio:export-text', project, mode),
  preview: (project, options) => ipcRenderer.invoke('studio:preview', project, options),
  controlPreview: command => ipcRenderer.invoke('studio:preview-control', command),
  setPreviewViewport: viewport => ipcRenderer.invoke('studio:preview-viewport', viewport),
  exportGame: project => ipcRenderer.invoke('studio:export', project),
  chooseExportDirectory: current => ipcRenderer.invoke('studio:export-directory', current),
  openExportDirectory: directory => ipcRenderer.invoke('studio:open-export-directory', directory),
  checkExport: project => ipcRenderer.invoke('studio:export-check', project),
  setupExport: (project, options) => ipcRenderer.invoke('studio:export-setup', project, options),
  cancelExportSetup: () => ipcRenderer.invoke('studio:export-setup-cancel'),
  exportSetupStatus: () => ipcRenderer.invoke('studio:export-setup-status'),
  onExportSetupProgress(callback) {
    const listener = (_event: Electron.IpcRendererEvent, progress: import('../core/bridge').ExportSetupProgress) => callback(progress);
    ipcRenderer.on('studio:export-setup-progress', listener);
    return () => ipcRenderer.removeListener('studio:export-setup-progress', listener);
  },
  openExportTool: (tool, project) => ipcRenderer.invoke('studio:export-tool', tool, project),
  assetUrl: relative => `studio-asset://project/${encodeURIComponent(relative)}`,
  defaultFontUrl: () => 'studio-asset://runtime/default-font',
  environment: () => ipcRenderer.invoke('studio:environment'),
  onRuntimeEvent(callback) {
    const listener = (_event: Electron.IpcRendererEvent, event: RuntimeEvent) => callback(event);
    ipcRenderer.on('studio:runtime', listener);
    return () => ipcRenderer.removeListener('studio:runtime', listener);
  },
  onCloseRequested(snapshot, beforeClose) {
    const listener = () => { void Promise.resolve(beforeClose?.() ?? true).then(allow => ipcRenderer.invoke('studio:close-save', allow ? snapshot() : null)); };
    ipcRenderer.on('studio:close-request', listener);
    return () => ipcRenderer.removeListener('studio:close-request', listener);
  },
};
contextBridge.exposeInMainWorld('studio', bridge);
