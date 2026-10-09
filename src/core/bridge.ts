import type { AiConversation, AiConversationList } from './ai-conversations';
import type { BlueprintSelection, UiPageSelection, UiAnimationSelection } from './ai-selection';
import type { EditorLayoutAction } from './editor-layout';
import type { AiEditorTarget } from './ai-editor-targets';
import type { AiEditorCommand, AiEditorResult } from './ai-editor-commands';
import type { Asset, AssetCategory, Diagnostic, Project, UiComponent, VariableValue } from './model';
import type { ExportPlatform } from './export-settings';
import type { AiChange, AiConfigUpdate, AiConfigView, AiRequest, AiResponse } from './ai';
import type { ImportedText, TextExportMode } from './text-exchange';
import type { AiProgress, AiWorkflowProposal } from './ai-workflow';
import type { AiAttachment } from './ai-attachments';
import type { ProjectTemplate, ProjectTemplateInfo } from './project-templates';

export interface AiWorkspaceContext { selectedUiPage?: UiPageSelection; selectedUiAnimation?: UiAnimationSelection; selectedParameter?: {setId:string;variableId?:string}; selectedContentKeys?: string[]; selectedBlueprint?: BlueprintSelection; selectedUiComponentId?: string; project: Project; sceneId?: string; lineId?: string; canUndo: boolean; readOnlyMessage?: string }
export interface UiPreviewWindowContext { project: Project; components: UiComponent[]; pageId: string; assetUrls?: Record<string, string> }
export type AiEditorAction = { projectId: string } & ({ kind: 'apply'; changes: AiChange[] } | { kind: 'workflow'; proposal: AiWorkflowProposal } | { kind: 'undo' } | { kind:'command'; command:AiEditorCommand } | { kind:'layout'; layout:EditorLayoutAction } | { kind: 'navigate'; target: AiEditorTarget } | { kind: 'locate'; lineId: string });

export interface AssetImportOptions { mode?: 'files' | 'folder'; paths?: string[]; folderId?: string; category?: AssetCategory; extensions?: string[]; single?: boolean }
export interface AssetImportReport { imported: number; duplicates: number; skipped: number; errors: string[]; assetIds?: string[] }
export interface RecentProject { path: string; name: string; lastOpenedAt: number; available: boolean; recoveryAvailable?: boolean; projectId?: string }
export interface ProjectHubInfo { recent: RecentProject[]; templates: ProjectTemplateInfo[]; defaultDirectory: string; recovery?: { name: string; savedAt: number }; direct?: ProjectSession }

export interface ProjectSession {
  locationMissing?: boolean;
  template?: { id: ProjectTemplateInfo['id'] };
  project: Project;
  path: string | null;
  recovered: boolean;
  importReport?: AssetImportReport;
  assetRelocations?: import('./asset-relocation').AssetRelocation[];
  resourceReport?: { moved: number; skipped: string[]; retained: string[] };
}
export interface RunResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  log: string;
  buildPath?: string;
  outputPath?: string;
  cancelled?: boolean;
}
export interface ExportCheck {
  platform: ExportPlatform;
  ready: boolean;
  checks: { id: string; label: string; status: 'ready' | 'missing' | 'info'; detail: string }[];
  diagnostics: Diagnostic[];
}
export interface ExportSetupProgress {
  phase: 'idle' | 'runtime' | 'jdk' | 'rapt' | 'androidSdk' | 'checking' | 'ready' | 'cancelled' | 'failed';
  platform: ExportPlatform;
  message: string;
  running: boolean;
  receivedBytes?: number;
  totalBytes?: number;
  log?: string;
}
export interface ExportSetupResult { ok: boolean; cancelled?: boolean; check?: ExportCheck; error?: string }
export type ExportTool = 'androidSetup' | 'androidHelp' | 'androidLicense' | 'signing';
export type PreviewMode = 'embedded' | 'window';
export type PreviewPhase = 'idle' | 'compiling' | 'starting' | 'running' | 'paused' | 'failed';
export interface PreviewOptions { entryId?: string; variables?: Record<string, VariableValue>; mode?: PreviewMode }
export interface PreviewViewport { x: number; y: number; width: number; height: number; visible: boolean }
export type PreviewCommand = 'pause' | 'resume' | 'stop' | 'focus';
export interface RuntimeEvent {
  kind: 'log' | 'exit' | 'position' | 'diagnostics' | 'preview'; message: string; code?: number;
  nodeId?: string; lineId?: string; variables?: Record<string, VariableValue>; diagnostics?: Diagnostic[];
  phase?: PreviewPhase; mode?: PreviewMode; sessionId?: string; windowId?: string; visible?: boolean;
}
export interface StudioBridge {
  listAiConversations?(projectId: string): Promise<AiConversationList>;
  readAiConversation?(projectId: string, id: string): Promise<AiConversation>;
  saveAiConversation?(conversation: AiConversation): Promise<void>;
  deleteAiConversation?(projectId: string, id: string): Promise<void>;
  exportAiConversation?(conversation: AiConversation): Promise<boolean>;
  onAiBeforeClose?(callback: () => void): () => void;
  onAiChunk?(callback: (chunk: {id: string; text: string}) => void): () => void;
  openUiPreviewWindow?(context: UiPreviewWindowContext): Promise<void>;
  closeUiPreviewWindow?(): Promise<void>;
  updateUiPreviewContext?(context: UiPreviewWindowContext): Promise<void>;
  getUiPreviewContext?(): Promise<UiPreviewWindowContext | null>;
  onUiPreviewContext?(callback: (context: UiPreviewWindowContext) => void): () => void;
  onUiPreviewWindowState?(callback: (open: boolean) => void): () => void;
  getAiConfig?(): Promise<AiConfigView>;
  saveAiConfig?(config: AiConfigUpdate): Promise<AiConfigView>;
  onAiConfig?(callback: (config: AiConfigView) => void): () => void;
  onAiProgress?(callback: (progress: AiProgress) => void): () => void;
  requestAi?(request: AiRequest): Promise<AiResponse>;
  inspectAiAttachments?(paths: string[]): Promise<AiAttachment[]>;
  inspectMentionedAiAttachments?(request: { prompt: string; allowExternalFiles: boolean }): Promise<AiAttachment[]>;
  chooseAiAttachments?(mode: 'files' | 'directory'): Promise<AiAttachment[]>;
  testAi?(id: string): Promise<string>;
  cancelAi?(id: string): Promise<void>;
  listAiModels?(id: string, config: AiConfigUpdate): Promise<string[]>;
  openAiWindow?(context: AiWorkspaceContext): Promise<void>;
  closeAiWindow?(): Promise<void>;
  updateAiContext?(context: AiWorkspaceContext): Promise<void>;
  getAiContext?(): Promise<AiWorkspaceContext | null>;
  onAiContext?(callback: (context: AiWorkspaceContext) => void): () => void;
  onAiWindowState?(callback: (open: boolean) => void): () => void;
  runAiEditorAction?(action: AiEditorAction): Promise<void | AiEditorResult>;
  onAiEditorAction?(callback: (action: AiEditorAction) => void | AiEditorResult | Promise<void | AiEditorResult>): () => void;
  getInitial(): Promise<ProjectSession>;
  getProjectHub?(): Promise<ProjectHubInfo>;
  createTemplate?(name: string, source?: ProjectTemplate): Promise<ProjectSession>;
  editTemplate?(id: ProjectTemplateInfo['id']): Promise<ProjectSession>;
  openRecentProject?(path: string): Promise<ProjectSession>;
  relocateProject?(path: string, current?: Project): Promise<ProjectSession | null>;
  recoverRecentProject?(path: string): Promise<ProjectSession>;
  checkProjectLocation?(): Promise<{ path: string | null; missing: boolean }>;
  forgetRecentProject?(path: string): Promise<void>;
  recoverDraftProject?(): Promise<ProjectSession>;
  chooseProjectDirectory?(): Promise<string | null>;
  createProjectFromHub?(name: string, template: ProjectTemplate, directory: string): Promise<ProjectSession>;
  create(name: string, template?: ProjectTemplate): Promise<ProjectSession | null>;
  open(): Promise<ProjectSession | null>;
  save(project: Project, saveAs?: boolean): Promise<ProjectSession | null>;
  autosave(project: Project): Promise<{ savedAt: number; locationMissing?: boolean }>;
  importAssets(project: Project, options?: AssetImportOptions): Promise<ProjectSession | null>;
  discoverAssets?(project: Project): Promise<ProjectSession | null>;
  revealAsset?(project: Project, assetId: string): Promise<void>;
  openResourceDirectory?(project: Project): Promise<void>;
  pathForFile?(file: File): string;
  importSpine?(project: Project): Promise<ProjectSession | null>;
  importText(path?: string): Promise<ImportedText | null>;
  exportText?(project: Project, mode: TextExportMode): Promise<string | null>;
  preview(project: Project, options?: PreviewOptions): Promise<RunResult>;
  controlPreview?(command: PreviewCommand): Promise<void>;
  setPreviewViewport?(viewport: PreviewViewport): Promise<void>;
  exportGame(project: Project): Promise<RunResult | null>;
  chooseExportDirectory?(current?: string): Promise<string | null>;
  openExportDirectory?(directory: string): Promise<void>;
  checkExport(project: Project): Promise<ExportCheck>;
  setupExport?(project: Project, options: { acceptAndroidLicense: boolean }): Promise<ExportSetupResult>;
  cancelExportSetup?(): Promise<void>;
  exportSetupStatus?(): Promise<ExportSetupProgress>;
  onExportSetupProgress?(callback: (progress: ExportSetupProgress) => void): () => void;
  openExportTool?(tool: ExportTool, project: Project): Promise<void>;
  assetUrl(path: string): string;
  defaultFontUrl?(): string;
  environment(): Promise<{ sdkPath: string | null; appVersion: string }>;
  onRuntimeEvent(callback: (event: RuntimeEvent) => void): () => void;
  onCloseRequested?(snapshot: () => { project: Project; dirty: boolean }, beforeClose?: () => Promise<boolean>): () => void;
}
declare global { interface Window { studio?: StudioBridge } }
export function projectAssetUrl(asset: Asset): string { return window.studio?.assetUrl(asset.path) ?? asset.path; }
