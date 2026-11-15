import { mergeBlueprintDebugPacket, type BlueprintBreakpoint, type BlueprintDebugSnapshot } from '../core/blueprint-debug';
import { projectEditSnapshot, projectReadSnapshot } from '../core/project-mutation';
import { resolveUiPreviewAction, type UiPreviewAction, type UiPreviewActionResult } from '../core/ui-preview-actions';
import type { BlueprintUsage } from '../core/blueprint-usages';
import { blueprintResourceEditedProject } from '../core/blueprint-resource-edit';
import { graphResourceKey, projectGraphs, addProjectGraphs } from '../core/project-resources';
import { createTimelinePreset, isTimelineComponent } from '../core/timeline-component';
import { AssetImportContext, mergeImportedAssets } from './AssetImportContext';
import { findTimelinePath } from '../core/timeline-navigation';
import { currentScriptText } from '../core/script-text';
import { requestUiAnimationFocus, type UiAnimationFocus } from './ui-animation-editor-focus';
import { requestBlueprintSelection } from './blueprint-editor-selection';
import type { UiPageSelection, UiAnimationSelection, BlueprintSelection } from '../core/ai-selection';
import { isBlueprintEditorCommand, runBlueprintEditorAction } from './blueprint-editor-actions';
import { updateEditorLayout, editorLayoutEvent, editorLayoutNames } from '../core/editor-layout';
import { resolveAiEditorTarget } from '../core/ai-editor-targets';
import { blueprintContext } from '../core/blueprint-context';
import { controlAiPreview } from './ai-preview-control';
import { aiActivityFor } from './ai-activity';
import type { UiPreviewWindowControls } from './useUiPreviewWindow';
import { availableBlueprintName } from '../core/blueprint-names';
import type { AiEditorResult, AiEditorReporter } from '../core/ai-editor-commands';
import { applyUiDraft, uiDraftChanged } from '../core/ui-draft';
import { sameProjectValue } from '../core/project-history';
import { useUiDraftHistory } from './useUiDraftHistory';
import { useProjectRecovery } from './useProjectRecovery';
import { NumericEditContext } from './NumericEditContext';
import { moduleLineSelection } from './module-line-selection';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from 'react-dom';
import { version as studioVersion } from "../../package.json";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Clapperboard,
  FilePlus2,
  FileText,
  FolderOpen,
  GitBranch,
  LayoutTemplate,
  LoaderCircle,
  MessageSquare,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelBottom,
  Pause,
  Play,
  Square,
  Redo2,
  Save,
  Settings2,
  Sparkles,
  SquareTerminal,
  Undo2,
  Image as ImageIcon,
  UserRound,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  createProject,
  makeId,
  newNode,
  connectNode,
  variableValueType,
  type Diagnostic,
  type NodeKind,
  type Project,
  type VariableValue,
} from "../core/model";
import type { AiEditorAction, AiWorkspaceContext, AssetImportOptions, PreviewMode, PreviewPhase, PreviewOptions, ProjectSession, RunResult, RuntimeEvent } from "../core/bridge";
import { validateProject } from "../core/validate";
import { addNodeToStoryGroup, pruneStoryGroups } from '../core/story-groups';
import { diagnosticLocation, diagnosticSourceLine, uniqueDiagnostics } from '../core/diagnostic-location';
import { createBlueprintGraph, synchronizeBlueprintSignatures } from "../core/blueprint";
import { moveContent, type ContentItem } from '../core/content-browser';
import { applyTextScript, projectToText, type TextIssue, type TextParseResult } from "../core/text-script";
import { createTextScriptReader, type TextScriptReader } from '../core/text-script-cache';
import { refreshTextReferenceNames, textDocument } from '../core/text-document';
import { textChapters } from '../core/text-chapters';
import { addStorySection, deleteStorySection, readStoryStructure } from '../core/story-structure';
import type { ProjectTemplate, ProjectTemplateInfo } from '../core/project-templates';
import { ProjectBrowser, type ProjectBrowserSection } from './ProjectBrowser';
import { browserBridge } from "./browserBridge";
import {
  nodeNames,
  useProjectHistory,
  type Commit,
  type EditorView,
  type LibraryKind,
} from "./editor";
import { IconButton, Field, TargetSelect, ValueInput } from "./components";
import { ScriptEditor, ScriptEditorActions } from "./ScriptEditor";
import { TextEditor } from "./TextEditor";
import { TextExchange } from './TextExchange';
import type { ImportedText } from '../core/text-exchange';
import { PerformanceWorkspace } from './PerformanceWorkspace';
import { WorkspaceTabs } from './WorkspaceTabs';
import type { PerformanceTarget } from '../core/performance-workspace';
import { Blueprint } from "./Blueprint";
import type { BlueprintFocus } from "./BlueprintGraphEditor";
import { BlueprintNavigationBar } from "./BlueprintNavigationBar";
import { enterBlueprintVisit, resolveBlueprintReturn, type BlueprintReturnPoint, type BlueprintVisit, type OpenBlueprintGraph } from "./blueprint-navigation";
import { stageEditedProject, type StageCommit } from '../core/stage-edit';
import { UiEditor, type UiFocus } from "./UiEditor";
import { UiFontFaces } from './UiAppearance';
import type { UiAuthoringSession } from './ui-authoring-session';
import type { GameFlowFocus } from './GameFlowInspector';
import type { GameFlowPhase } from '../core/game-flow-schema';
import type { UiPageUsage } from '../core/game-flow';
import type { ParameterUsage } from '../core/parameter-usages';
import { Inspector, type ResourceSelection } from "./Inspector";
import { Library } from "./Library";
import { StoryDirectory } from './StoryDirectory';
import { ContentBrowser } from './ContentBrowser';
import { PlayWorkspace } from './PlayWorkspace';
import { ProjectSettings, type SettingsSection } from './ProjectSettings';
import { DiagnosticList } from './DiagnosticList';
import { AiAssistant } from './AiAssistant';
import { errorMessage } from '../core/error-message';
import { applyAiChanges, type AiChange } from '../core/ai';
import { applyAiWorkflow, type AiWorkflowProposal } from '../core/ai-workflow';
import { storyFlowContentEdit } from '../core/story-flow-authoring';
import { uiPage } from '../core/ui-pages';

const studio = window.studio ?? browserBridge;
let draftCache: { inputs: unknown[]; value: boolean } | undefined;
const verifiedTextProjects = new WeakSet<Project>();
function hasTextDraft(project: Project, parse: TextScriptReader = applyTextScript) {
  if (!project.scriptText) return false;
  if (verifiedTextProjects.has(project)) return false;
  const inputs = [project.scriptText, project.nodes, project.scenes, project.chapters, project.variables, project.characters, project.assets, project.effects, project.blueprints, project.timelinePresets, project.entryId, project.ui.activeInstanceId, project.ui.instances?.map(instance => instance.id + ':' + instance.name).join('|'), project.ui.flowStyles?.map(style => style.id + ':' + style.name).join('|')];
  if (draftCache && inputs.every((value, index) => value === draftCache!.inputs[index])) return draftCache.value;
  const parsed = parse(project, project.scriptText.content);
  const value = parsed.issues.some((issue) => issue.severity === "error") || projectToText(parsed.project) !== projectToText(project);
  draftCache = { inputs, value };
  return value;
}
export default function App({ initialSession }: { initialSession?: ProjectSession } = {}) {
  const [readTextScript] = useState(createTextScriptReader);
  const history = useProjectHistory();
  const { project, reset } = history;
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const projectBrowserBusy = useRef(false);
  const resumeDiscovery = useRef<(() => void) | undefined>(undefined);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [locationMissing, setLocationMissing] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ProjectSession['template']>();
  const [projectBrowser, setProjectBrowser] = useState<ProjectBrowserSection>();
  const [availableTemplates, setAvailableTemplates] = useState<ProjectTemplateInfo[]>([]);
  const [sceneId, setSceneId] = useState(project.scenes[0]?.id ?? "");
  const [nodeId, setNodeId] = useState<string | undefined>(
    project.nodes.find((n) => n.kind === "passage")?.id,
  );
  const [lineId, setLineId] = useState<string>();
  const [view, setViewState] = useState<EditorView>("script");
  const [gameFlowFocus, setGameFlowFocus] = useState<GameFlowFocus>();
  const [storyFlowFocus, setStoryFlowFocus] = useState<{ nodeId?: string; sceneId?: string; request: number }>();
  const uiHistory = useUiDraftHistory(project);
  const { draft: uiDraft, current: uiDraftRef, update: updateUiDraft } = uiHistory;
  const [contentFocus,setContentFocus]=useState<{assetId:string;request:number}>();
  const [uiAdvanced, setUiAdvanced] = useState(false);
  const uiSaving = useRef(false);
  const [uiLeave, setUiLeave] = useState<{ proceed: () => void; cancel?: () => void; onDecision?: (decision:'save'|'discard'|'cancel')=>void; stay?:boolean }>();
  const leaveUi = (action: () => void) => {
    if (!uiDraftChanged(uiDraftRef.current)) return true;
    setUiLeave({ proceed: action }); return false;
  };
  const setView = (next: EditorView) => {
    if (next !== 'ui' && !leaveUi(() => setViewState(next))) return;
    setViewState(next);
  };
  const [storyMode, setStoryMode] = useState<'script' | 'text'>('script');
  const [activeBlueprint, setActiveBlueprint] = useState<BlueprintSelection>();
  const [parameterSetFocus,setParameterSetFocus]=useState<string>();
  const [resourceFocus,setResourceFocus]=useState(0);
  const [blueprintFocus, setBlueprintFocus] = useState<BlueprintFocus>();
  const [blueprintVisits, setBlueprintVisits] = useState<BlueprintVisit[]>([]);
  useEffect(() => setBlueprintVisits([]), [project.id]);
  const [uiAnimationFocus, setUiAnimationFocus] = useState<UiAnimationFocus>();
  const [uiBlueprintFocus, setUiBlueprintFocus] = useState<BlueprintFocus>();
  const [performanceTarget, setPerformanceTarget] = useState<PerformanceTarget>();
  const [blueprintEntryRequest, setBlueprintEntryRequest] = useState(0);
  const [textExchange, setTextExchange] = useState<{ imported?: ImportedText; complete?: (result:AiEditorResult)=>void }>();
  const textSource = useMemo(() => project.scriptText?.content ?? projectToText(project), [project]);
  // Once the text editor is open, its source is the draft being edited. Avoid
  // reparsing the complete document just to decide whether to keep that view.
  const textDraft = useMemo(() => view === 'text' ? true : hasTextDraft(project, readTextScript), [view, project, readTextScript]);
  const [textFocusLine, setTextFocusLine] = useState<{ line: number; request: number }>();
  const [moduleRevealRequest, setModuleRevealRequest] = useState(0);
  const commit: Commit = useCallback((label, edit, options) => {
    let regenerated = false;
    const next = history.commit(label, (draft, before) => {
      const preserveDraft = hasTextDraft(before);
      edit(draft);
      if (draft.nodes !== before.nodes || draft.scenes !== before.scenes) pruneStoryGroups(draft);
      synchronizeBlueprintSignatures(draft, before);
      // Read the plain edited project: walking the draft is over ten times slower.
      if (draft.scriptText && !preserveDraft) { draft.scriptText = { ...draft.scriptText, content: projectToText(projectReadSnapshot(draft)) }; regenerated = true; }
    }, options);
    // Text just written from this project needs no parsing to show it matches.
    if (regenerated) verifiedTextProjects.add(next);
    return next;
  }, [history.commit]);
  const commitBlueprint: Commit = useCallback((label, edit, options) => {
    history.commitPrepared(label, before => blueprintResourceEditedProject(before, edit, readTextScript), options);
  }, [history.commitPrepared, readTextScript]);
  const [library, setLibrary] = useState<LibraryKind>("scenes");
  useEffect(()=>{if(view!=='ui'||library!=='scenes')setUiAdvanced(false);},[view, library]);
  const [resource, setResource] = useState<ResourceSelection>();
  const [uiId, setUiId] = useState<string>();
  const [activeUiPage,setActiveUiPage] = useState<UiPageSelection>();
  const [activeUiAnimation, setActiveUiAnimation] = useState<UiAnimationSelection>();
  const [uiSelectionRequest, setUiSelectionRequest] = useState(0);
  const [uiFocus, setUiFocus] = useState<UiFocus>();
  const [uiPreviewInstance, setUiPreviewInstance] = useState<string>();
  const uiPreviewControls = useRef<UiPreviewWindowControls | undefined>(undefined);
  const captureUiPreviewControls = useCallback((controls?: UiPreviewWindowControls) => { uiPreviewControls.current = controls; }, []);
  useEffect(() => {
    if (!uiFocus || view !== 'ui') return;
    const frame = requestAnimationFrame(() => {
      const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(uiFocus.field === 'action' ? '.inspector [aria-label="点击行为"]' : '.inspector [aria-label="控件显示名称"]');
      control?.focus({ preventScroll: true }); control?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [uiFocus, view]);
  const uiWorkingProject = useMemo(() => applyUiDraft(project, uiDraft), [project, uiDraft]);
  const uiProject = useMemo(() => uiPreviewInstance === undefined ? uiWorkingProject : { ...uiWorkingProject, ui: { ...uiWorkingProject.ui, activeInstanceId: uiPreviewInstance || undefined } }, [uiWorkingProject, uiPreviewInstance]);
  // Keep authoring view state when resource/module navigation unmounts UiEditor.
  const uiAuthoringSessions = useMemo(() => new Map<string, UiAuthoringSession>(), [project.id]);
  // Inspecting a diagnostic must not change the UI instance used by the game.
  const commitUi: Commit = useCallback((label, edit, options) => {
    if (uiSaving.current) return;
    if (label === '切换界面实例') setUiPreviewInstance(undefined);
    let regenerated = false;
    const next = uiHistory.commit(label, (draft, before) => {
      if (label === storyFlowContentEdit && hasTextDraft(before)) return;
      const active = draft.ui.activeInstanceId;
      if (uiPreviewInstance !== undefined && label !== '切换界面实例') draft.ui.activeInstanceId = uiPreviewInstance || undefined;
      edit(draft);
      if (uiPreviewInstance !== undefined && label !== '切换界面实例') draft.ui.activeInstanceId = draft.ui.instances?.some(instance => instance.id === active) ? active : undefined;
      const selectedName = (p: Project) => p.ui.instances?.find(instance => instance.id === p.ui.activeInstanceId)?.name;
      if (draft.scriptText && (label === storyFlowContentEdit || label === '流程图节点文字' || draft.ui.activeInstanceId !== before.ui.activeInstanceId || selectedName(draft) !== selectedName(before)) && !hasTextDraft(before)) {
        draft.scriptText = { ...draft.scriptText, content: projectToText(projectReadSnapshot(draft)) };
        regenerated = true;
      }
    }, options);
    if (regenerated) verifiedTextProjects.add(next);
  }, [uiHistory.commit, uiPreviewInstance]);
  const undo = () => {
    if (view !== 'ui') { history.undo(); return; }
    if (uiSaving.current) return;
    uiHistory.undo();
  };
  const redo = () => {
    if (view !== 'ui') { history.redo(); return; }
    if (uiSaving.current) return;
    uiHistory.redo();
  };
  const [settings, setSettings] = useState(false);
  const selectUi = useCallback((id?: string) => {
    setUiId(id);
    setUiFocus(undefined);
    setUiSelectionRequest(request => request + 1);
    setResource(undefined);
    setSettings(false);
  }, []);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('project');
  const [navigation, setNavigation] = useState<string[]>([]);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [navigationPanels, setNavigationPanels] = useState<Record<string, boolean>>({});
  const navigationWorkspace = view === 'script' || view === 'text' ? 'story' : view;
  const hasStoryDirectory = library === 'scenes' && (view === 'script' || view === 'text');
  const isStoryFlowchart = library === 'scenes' && view === 'flowchart';
  const sidebarVisible = navigationPanels[navigationWorkspace] ?? true;
  const toggleProjectNavigation = () => setNavigationPanels(previous => ({ ...previous, [navigationWorkspace]: !sidebarVisible }));
  const [activeParameter, setActiveParameter] = useState<{setId:string;variableId?:string}>();
  const [contentSelection, setContentSelection] = useState<string[]>([]);
  const [dockSelection, setDockSelection] = useState<string[]>([]);
  const [contentOpen, setContentOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const operation = useRef("");
  const [busyNotice, setBusyNotice] = useState("");
  const [status, setStatus] = useState("正在打开工程…");
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [log, setLog] = useState("");
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<Diagnostic[]>(
    [],
  );
  const [runtimePosition, setRuntimePosition] = useState<RuntimeEvent>();
  const [newDialog, setNewDialog] = useState(false);
  const [newName, setNewName] = useState("我的视觉小说");
  const [newTemplate, setNewTemplate] = useState<ProjectTemplate>('blank');
  useEffect(() => { if (!newDialog || !studio.getProjectHub) return; let active = true; void studio.getProjectHub().then(info => { if (active) setAvailableTemplates(info.templates); }).catch(error => { if (active) setStatus(`模板读取失败：${String(error)}`); }); return () => { active = false; }; }, [newDialog]);
  const [nameDialog, setNameDialog] = useState<{
    title: string;
    value: string;
    submit: (value: string) => void;
  }>();
  const [playOpen, setPlayOpen] = useState(false);
  const [playPhase, setPlayPhase] = useState<PreviewPhase>('idle');
  const [playMessage, setPlayMessage] = useState('');
  const [playProject, setPlayProject] = useState(project);
  const [playMode, setPlayMode] = useState<PreviewMode>('embedded');
  const [liveMode, setLiveMode] = useState<PreviewMode>('embedded');
  const lastPreview = useRef<PreviewOptions>({});
  const [playDebug, setPlayDebug] = useState<BlueprintDebugSnapshot>();
  const playDebugRef = useRef<BlueprintDebugSnapshot | undefined>(undefined);
  const playSessionRef = useRef<string | undefined>(undefined);
  const [firstFramePending, setFirstFramePending] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(true), [debugPoints, setDebugPoints] = useState<BlueprintBreakpoint[]>([]);
  const setDebugSettings = (enabled: boolean, points: BlueprintBreakpoint[]) => {
    setDebugEnabled(enabled); setDebugPoints(points);
    lastPreview.current = { ...lastPreview.current, blueprintDebug: enabled, blueprintBreakpoints: points };
    try { localStorage.setItem('vns:preview-settings:' + project.id, JSON.stringify(lastPreview.current)); } catch { /* Optional local settings, never project data. */ }
  };
  const playActive = ['compiling', 'starting', 'running', 'paused'].includes(playPhase);
  const [testEntry, setTestEntry] = useState<string>();
  const [testVariables, setTestVariables] = useState<
    Record<string, VariableValue>
  >({});
  const [ready, setReady] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const aiParsed = useMemo(() => aiOpen ? readTextScript(project, textSource) : undefined, [aiOpen, project, textSource, readTextScript]);
  const hasAppInspector = view !== 'ui' && library !== 'assets' && library !== 'variables' && library !== 'characters' && !hasStoryDirectory && view !== 'blueprint' && !isStoryFlowchart;
  const showInspector = hasAppInspector && inspectorVisible;
  const closingSnapshot = useRef({ project, dirty: history.dirty });
  closingSnapshot.current = { project: uiWorkingProject, dirty: history.dirty || uiDraftChanged(uiDraft) };
  const readClosingSnapshot = useRef(() => closingSnapshot.current);
  readClosingSnapshot.current = () => ({ project: applyUiDraft(history.getProject(), uiDraftRef.current), dirty: history.dirty || uiDraftChanged(uiDraftRef.current) });
  const closeReady = useRef(ready); closeReady.current = ready;
  const recovery = useProjectRecovery({ project, workingProject: uiWorkingProject, projectDirty: history.dirty,
    uiDirty: uiDraftChanged(uiDraft), ready, busy: !!busy || closing, saving: uiSaving, bridge: studio, status: setStatus });
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [diagnosticProject, setDiagnosticProject] = useState(project);
  useEffect(() => { const timer = setTimeout(() => setDiagnosticProject(uiWorkingProject), 150); return () => clearTimeout(timer); }, [uiWorkingProject]);
  const diagnostics = useMemo(() => {
    const parsed = hasTextDraft(diagnosticProject, readTextScript) ? readTextScript(diagnosticProject, diagnosticProject.scriptText!.content) : undefined;
    return uniqueDiagnostics([...(parsed?.issues ?? []), ...validateProject(parsed?.project ?? diagnosticProject)]);
  }, [diagnosticProject, readTextScript]);
  const allDiagnostics = uniqueDiagnostics([...diagnostics, ...runtimeDiagnostics]);
  const errorCount = allDiagnostics.filter(
    (d) => d.severity === "error",
  ).length;

  const notify = useCallback((message: string) => {
    setStatus(message);
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus("就绪"), 6000);
  }, []);
  useEffect(() => studio.onCloseRequested?.(() => readClosingSnapshot.current(), async () => {
    if (operation.current || uiSaving.current || projectBrowserBusy.current || !closeReady.current) {
      const message = `正在${operation.current || (uiSaving.current ? '保存界面' : projectBrowserBusy.current ? '处理项目' : '打开工程')}，请等待完成后再关闭。`;
      setBusyNotice(message); notify(message);
      return false;
    }
    // Native close does not reliably blur the active field. Commit its normal
    // blur edit and render the updated project/draft before reading the snapshot.
    flushSync(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    closingRef.current = true;
    clearTimeout(statusTimer.current);
    flushSync(() => { setClosing(true); setStatus('正在保存并关闭窗口…'); });
    // The settings dialog can own an in-flight request or an atomic config save
    // even while the separate assistant is closed.
    await aiActivityFor(studio).stopAll();
    return true;
  }, error => {
    const prepared = closingRef.current;
    closingRef.current = false; setClosing(false);
    const discovered = resumeDiscovery.current; resumeDiscovery.current = undefined; discovered?.();
    if (error) notify(`未能关闭：${error}`);
    else if (prepared) notify('关闭已取消，修改保留。');
  }), []);
  useEffect(() => {
    // Portals and global shortcuts sit outside app-shell; freeze them in the
    // same synchronous close phase as the main controls.
    const block = (event: Event) => {
      if (!closingRef.current) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    const events = ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'keydown', 'keyup', 'beforeinput', 'input', 'change', 'paste', 'cut', 'drop', 'dragstart', 'dragover', 'contextmenu', 'submit', 'wheel', 'touchstart', 'touchmove', 'touchend'];
    for (const name of events) window.addEventListener(name, block, { capture: true, passive: false });
    return () => { for (const name of events) window.removeEventListener(name, block, true); };
  }, []);
  const adopt = useCallback(
    (session: ProjectSession) => {
      updateUiDraft(undefined); setUiLeave(undefined); setBlueprintVisits([]);
      setUiPreviewInstance(undefined); setUiId(undefined); setUiFocus(undefined); setUiAdvanced(false);
      setActiveUiPage(undefined); setActiveUiAnimation(undefined); setActiveBlueprint(undefined);
      setUiBlueprintFocus(undefined); setUiAnimationFocus(undefined); setBlueprintFocus(undefined); setPerformanceTarget(undefined);
      setGameFlowFocus(undefined); setStoryFlowFocus(undefined); setParameterSetFocus(undefined); setActiveParameter(undefined);
      setContentSelection([]); setDockSelection([]);
      reset(session.project, session.path !== null && (!session.recovered || session.recoveredProjectDirty === false));
      if (session.recovered) recovery.recovered(session.project);
      if (session.uiDraft) updateUiDraft({ base: session.project, value: session.uiDraft });
      setProjectPath(session.path);
      setLocationMissing(!!session.locationMissing);
      setEditingTemplate(session.template);
      const recoveredDraft = hasTextDraft(session.project);
      let preferredMode: 'script' | 'text' = 'script';
      try { if (localStorage.getItem(`vns:story-mode:${session.project.id}`) === 'text') preferredMode = 'text'; } catch { /* Optional local view preference. */ }
      if (session.uiDraft) setViewState('ui');
      else setViewState(recoveredDraft || preferredMode === 'text' ? 'text' : 'script');
      let preferredChapter: string | undefined;
      try {
        const choice = JSON.parse(localStorage.getItem(`vns:text-chapter:${session.project.id}`) ?? 'null');
        preferredChapter = textChapters(session.project.scriptText?.content ?? projectToText(session.project), session.project.chapters).find(chapter => chapter.key === choice?.key)?.chapterId;
      } catch { /* Start with the first chapter when no usable preference exists. */ }
      const preferredScenes = new Set(session.project.scenes.filter(scene => scene.chapterId === preferredChapter).map(scene => scene.id));
      const first = session.project.nodes.find(node => node.kind === 'passage' && preferredScenes.has(node.sceneId)) ??
        session.project.nodes.find((n) => n.kind === "passage") ??
        session.project.nodes[0];
      setSceneId(first?.sceneId ?? session.project.scenes[0]?.id ?? "");
      setNodeId(first?.id);
      setLineId(first?.kind === "passage" ? first.lines[0]?.id : undefined);
      setTextFocusLine(undefined);
      setResource(undefined);
      setNavigation([]);setContentFocus(undefined);
      setSettings(false);
      let previewSettings: PreviewOptions = {};
      try { previewSettings = JSON.parse(localStorage.getItem(`vns:preview-settings:${session.project.id}`) ?? '{}') ?? {}; } catch { /* Optional local playtest settings. */ }
      setPlayMode(previewSettings.mode === 'window' ? 'window' : 'embedded');
      lastPreview.current = previewSettings;
      setDebugEnabled(previewSettings.blueprintDebug !== false);
      setDebugPoints(Array.isArray(previewSettings.blueprintBreakpoints) ? previewSettings.blueprintBreakpoints.filter(point => point && typeof point.graphId === 'string' && typeof point.nodeId === 'string').slice(0, 512) : []);
      setPlayDebug(undefined); playDebugRef.current = undefined; playSessionRef.current = undefined; setFirstFramePending(false);
      setTestEntry(session.project.nodes.some(node => node.id === previewSettings.entryId) ? previewSettings.entryId : undefined);
      setTestVariables(Object.fromEntries(session.project.variables.flatMap(variable => {
        const value = previewSettings.variables?.[variable.id];
        return typeof value === variableValueType(variable) ? [[variable.id, value as VariableValue]] : [];
      })));
      setLibrary("scenes");
      setRuntimeDiagnostics([]);
      setRuntimePosition(undefined);
      setPlayOpen(false); setPlayPhase('idle');
      setLog("");
      notify(session.recovered ? "已恢复上次未保存的内容" : "工程已打开");
    },
    [reset, notify],
  );
  useEffect(() => {
    let active = true;
    (initialSession ? Promise.resolve(initialSession) : studio.getInitial())
      .then((session) => {
        if (active) {
          adopt(session);
          setReady(true);
        }
      })
      .catch((error) => {
        notify(`打开失败：${String(error)}`);
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [adopt, notify, initialSession]);
  useEffect(
    () =>
      studio.onRuntimeEvent((event) => {
        if (event.kind === 'preview' && event.phase === 'compiling') { playSessionRef.current = event.sessionId; playDebugRef.current = undefined; setPlayDebug(undefined); setFirstFramePending(true); }
        if (event.sessionId && playSessionRef.current && event.sessionId !== playSessionRef.current) return;
        if (event.kind === 'blueprintDebug') {
          if (event.blueprintDebug) { const snapshot = mergeBlueprintDebugPacket(playDebugRef.current, event.blueprintDebug); playDebugRef.current = snapshot; setPlayDebug(snapshot); }
          return;
        }
        if (event.kind === 'preview') {
          if (event.firstFramePending !== undefined) setFirstFramePending(event.firstFramePending);
          if (event.phase) setPlayPhase(event.phase);
          if (event.phase === 'idle') setPlayOpen(false);
          setPlayMessage(event.message);
          if (event.phase === 'running' || event.phase === 'paused' || event.phase === 'idle') notify(event.message);
          return;
        }
        if (event.kind === "position") { setRuntimePosition(event); return; }
        if (event.kind === "diagnostics") {
          setRuntimeDiagnostics(previous => uniqueDiagnostics([...previous, ...(event.diagnostics ?? [])]));
          setProblemsOpen(true);
        }
        if (event.message.trim()) setLog((previous) => `${previous}\n${event.message}`.trim());
        if (event.kind === "exit")
          notify(
            event.code ? `试玩已结束，退出代码 ${event.code}` : "试玩已结束",
          );
      }),
    [notify],
  );
  useEffect(() => {
    if (!ready || !studio.checkProjectLocation) return;
    let active = true;
    const check = () => void studio.checkProjectLocation!().then(result => {
      if (active && result.path === projectPath) setLocationMissing(result.missing);
    }).catch(() => { /* A temporary filesystem error must not reset editor state. */ });
    check();
    const timer = setInterval(check, 5000);
    window.addEventListener('focus', check);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check); };
  }, [ready, projectPath]);
  useEffect(() => {
    if (!ready || !projectPath || !studio.discoverAssets) return;
    let active = true, scanning = false;
    const scan = async () => {
      if (scanning || closingRef.current) return; scanning = true;
      const snapshot = closingSnapshot.current.project;
      try {
        const result = await studio.discoverAssets!(snapshot);
        const accept = () => {
          if (active && result && closingSnapshot.current.project.id === snapshot.id) {
            const added = result.project.assets.filter(asset => !closingSnapshot.current.project.assets.some(existing => existing.id === asset.id));
            if (added.length) { commit('发现目录中的素材', draft => mergeImportedAssets(draft, result.project), { separate: true }); notify(`已发现 ${added.length} 项新素材`); }
          }
        };
        // The scanner remembers discovered files. Keep a late result so a
        // cancelled close can apply it instead of losing it until restart.
        if (closingRef.current) resumeDiscovery.current = accept;
        else accept();
      } catch { /* A missing drive or an in-progress file copy is retried on the next scan. */ }
      finally { scanning = false; }
    };
    void scan();
    const timer = setInterval(() => void scan(), 5000);
    window.addEventListener('focus', scan);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', scan); };
  }, [ready, projectPath, commit, notify]);
  const previousSelectionProject = useRef(project);
  useEffect(() => {
    const previous = previousSelectionProject.current;
    previousSelectionProject.current = project;
    if (view === 'text') return;
    const selectedSceneId = project.scenes.some((scene) => scene.id === sceneId) ? sceneId : project.scenes[0]?.id ?? '';
    if (selectedSceneId !== sceneId) setSceneId(selectedSceneId);
    if (!project.nodes.some((n) => n.id === nodeId)) {
      const node = project.nodes.find((n) => n.sceneId === selectedSceneId);
      setNodeId(node?.id);
      setLineId(undefined);
      return;
    }
    const selectedLineId = moduleLineSelection(project, nodeId, lineId, previous);
    if (selectedLineId !== lineId) setLineId(selectedLineId);
  }, [project, sceneId, nodeId, lineId, view]);
  useEffect(() => {
    if (library === 'scenes' && (view === 'script' || view === 'text')) {
      setStoryMode(view);
      if (ready) try { localStorage.setItem(`vns:story-mode:${project.id}`, view); } catch { /* Optional view preference. */ }
    }
  }, [view, library, ready, project.id]);
  useEffect(() => {
    // Unapplied source protects story editing, not independent resources. A
    // module may temporarily invalidate a text call while its interface is fixed.
    if (textDraft && library === "scenes" && (view === "script" || view === "flowchart")) setView("text");
  }, [textDraft, library, view]);

  const beginOperation = (label: string, report?: AiEditorReporter) => {
    if (closingRef.current) {
      const message = '主编辑器正在关闭，请等待关闭完成或取消后再试。';
      report?.({ status: 'failed', message });
      return false;
    }
    if (operation.current) {
      const message = `正在${operation.current}，请等待完成后再试。`;
      setBusyNotice(message);
      report?.({status:'failed',message});
      return false;
    }
    // React state updates are deferred; the ref also blocks a second operation
    // started by another event before the next render.
    operation.current = label;
    setBusyNotice(""); setBusy(label);
    return true;
  };
  const endOperation = () => { operation.current = ""; setBusyNotice(""); setBusy(""); };
  const run = async (label: string, task: () => Promise<void>, report?: AiEditorReporter) => {
    if (!beginOperation(label, report)) return;
    try {
      await task();
    } catch (error) {
      const message = errorMessage(error);
      setLog(message);
      setProblemsOpen(true);
      notify(`${label}失败：${message}`);
      report?.({status:'failed',message:message.slice(0,6000)});
    } finally {
      endOperation();
    }
  };
  const acceptUiSave = (label: string, base: Project, snapshot: Project, session: ProjectSession) => {
    if (history.getProject().id !== snapshot.id) return;
    history.checkpoint();
    // Apply the saved UI changes to today's project, not the old whole-project
    // snapshot: asset discovery/imports can finish while the save is pending.
    const current = history.commitPrepared(label, before => applyUiDraft(before, { base, value: snapshot }));
    history.checkpoint();
    // Only the snapshot actually written to disk is saved. Concurrent changes
    // remain dirty, even though this UI draft has now been accepted.
    const saved = history.acceptAssetRelocations(sameProjectValue(current, snapshot) ? current : snapshot, session.assetRelocations);
    history.markSaved(saved);
    setProjectPath(session.path); setEditingTemplate(session.template); updateUiDraft(undefined);
    return saved;
  };
  const saveUi = async (saveAs = false, report?: AiEditorReporter): Promise<boolean> => {
    if (!beginOperation('保存界面', report)) return false;
    uiSaving.current = true;
    try {
      const base = history.getProject(), snapshot = applyUiDraft(base, uiDraftRef.current);
      const session = await studio.save(snapshot, saveAs || !projectPath);
      if (!session) { report?.({status:'cancelled',message:'已取消保存界面。'}); return false; }
      if (!acceptUiSave('保存界面', base, snapshot, session)) return false;
      notify('界面已保存'); report?.({status:'completed',message:'界面已保存。'}); return true;
    } catch (error) { report?.({status:'failed',message:String(error).slice(0,6000)}); notify('界面保存失败：' + (error instanceof Error ? error.message : String(error))); return false; }
    finally { uiSaving.current = false; endOperation(); }
  };
  const save = (saveAs = false, report?: AiEditorReporter) => {
    // Commit blur-based fields before taking the snapshot, including Ctrl+S.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return uiDraftChanged(uiDraftRef.current) ? saveUi(saveAs, report) : run("保存工程", async () => {
      history.checkpoint();
      const snapshot = history.getProject();
      const session = await studio.save(snapshot, saveAs || !projectPath);
      if (session) {
        setProjectPath(session.path);
        setEditingTemplate(session.template);
        history.markSaved(history.acceptAssetRelocations(snapshot, session.assetRelocations));
        const resources = session.resourceReport;
        notify(resources ? `工程已保存；已同步 ${resources.moved} 项素材目录${resources.skipped.length ? `，${resources.skipped.length} 项文件缺失，保留原路径` : ''}${resources.retained.length ? `，${resources.retained.length} 个旧文件暂未移除` : ''}` : "工程已保存");
        report?.({status:'completed',message:'工程已保存。'});
      } else report?.({status:'cancelled',message:'已取消保存工程。'});
    }, report);
  };
  const openProjectBrowser = (section: ProjectBrowserSection) => void run('保存并打开项目窗口', async () => {
    const changedUi = uiDraftChanged(uiDraftRef.current);
    if (history.dirty || changedUi) {
      uiSaving.current = true;
      try {
        const base = history.getProject(), snapshot = applyUiDraft(base, uiDraftRef.current);
        const saved = await studio.save(snapshot, !projectPath);
        if (!saved || !acceptUiSave('保存界面', base, snapshot, saved)) return;
      } finally { uiSaving.current = false; }
    }
    setPlayOpen(false);
    await studio.setPreviewViewport?.({ x: 0, y: 0, width: 0, height: 0, visible: false });
    await studio.controlPreview?.('stop');
    setPlayPhase('idle');
    setProjectBrowser(section);
  });
  const relocateCurrent = () => void run('重新定位工程', async () => {
    if (!projectPath || !studio.relocateProject) return;
    const snapshot = applyUiDraft(project, uiDraftRef.current);
    const next = await studio.relocateProject(projectPath, project);
    if (!next) return;
    setProjectPath(next.path); setLocationMissing(false); setEditingTemplate(next.template);
    if (history.dirty || uiDraftChanged(uiDraftRef.current)) await studio.autosave(project, { projectDirty: history.dirty, uiDraft: uiDraftChanged(uiDraftRef.current) ? snapshot : undefined });
    notify('已连接到新位置，当前编辑内容已保留');
  });
  const open = () => { if (!leaveUi(() => { void open(); })) return; return run("打开工程", async () => {
      if (
        history.dirty &&
        !confirm("当前工程有未保存的修改，继续打开其他工程？")
      )
        return;
      const session = await studio.open();
      if (session) adopt(session);
    }); };
  const importAssets = (spine = false, keepWorkspace = false, options?: AssetImportOptions, reportResult?: AiEditorReporter) =>
    run("导入素材", async () => {
      if (spine && !studio.importSpine) throw new Error('请使用 Windows 桌面版导入骨骼动画素材。');
      const session = await (spine ? studio.importSpine!(project) : studio.importAssets(project, options));
      if (session) {
        let importedId: string | undefined;
        commit("导入素材", (p) => {
          const existing = new Set(p.assets.map(asset => asset.id));
          const added = session.project.assets.filter(asset => !existing.has(asset.id));
          p.assets.push(...added);
          importedId = added.at(-1)?.id;
          if (session.project.contentBrowser) {
            const state = p.contentBrowser ??= { folders: [], assignments: {}, favorites: [] };
            const folders = new Set(state.folders.map(folder => folder.id));
            state.folders.push(...session.project.contentBrowser.folders.filter(folder => !folders.has(folder.id)));
            for (const asset of session.project.assets) if (!existing.has(asset.id)) {
              const key = `asset:${asset.id}`, folder = session.project.contentBrowser.assignments[key];
              if (folder) state.assignments[key] = folder;
            }
          }
        });
        setProjectPath(session.path);
        if (importedId && keepWorkspace && library === 'assets') setContentFocus({ assetId: importedId, request: Date.now() });
        if (!keepWorkspace) { setLibrary("assets"); setView('script'); }
        const last = session.project.assets.at(-1);
        if (last && !keepWorkspace) setResource({ kind: "asset", id: last.id });
        const report = session.importReport;
        if (report?.errors.length) { setLog(report.errors.join('\n')); setProblemsOpen(true); }
        notify(report ? `已导入 ${report.imported} 项${report.duplicates ? `，跳过 ${report.duplicates} 项重复素材` : ''}${report.skipped ? `，忽略 ${report.skipped} 个非素材文件` : ''}${report.errors.length ? `，${report.errors.length} 项失败，见运行结果` : ''}` : '素材已导入');
        reportResult?.({status:report?.errors.length?'failed':'completed',message:report?`已导入 ${report.imported} 项，跳过 ${report.duplicates} 项重复素材，忽略 ${report.skipped} 个非素材文件；${report.errors.length} 项失败。${report.errors.join('；')}`.slice(0,6000):'素材已导入。'});
      } else reportResult?.({status:'cancelled',message:'已取消导入素材。'});
    }, reportResult);
  const importPickerAsset = async (options: AssetImportOptions) => {
    if (!beginOperation('导入项目外素材')) throw new Error(`正在${operation.current}，请等待完成后再导入。`);
    try {
      const snapshot = closingSnapshot.current.project;
      const result = await studio.importAssets(snapshot, options);
      if (!result || closingSnapshot.current.project.id !== snapshot.id) return;
      if (result.importReport?.errors.length) throw new Error(result.importReport.errors.join('；'));
      commit('导入项目外素材', draft => mergeImportedAssets(draft, result.project), { separate: true });
      setProjectPath(result.path);
      const id = result.importReport?.assetIds?.[0] ?? result.project.assets.find(asset => !snapshot.assets.some(existing => existing.id === asset.id))?.id;
      return result.project.assets.find(asset => asset.id === id);
    } finally { endOperation(); }
  };
  const updateTextSource = (source: string, command = false) => {
    setRuntimeDiagnostics(previous => previous.length ? [] : previous);
    if (command) history.checkpoint();
    history.commitText(command ? '插入文本指令' : "文本剧本", source);
    if (command) history.checkpoint();
  };
  const commitStage: StageCommit = (label, edit) => {
    let result: ReturnType<StageCommit>;
    history.checkpoint();
    try {
      let changed: ReturnType<typeof stageEditedProject>;
      const next = history.commitPrepared(label, before => {
        changed = stageEditedProject(before, edit, readTextScript);
        return changed?.project;
      }, { separate: true });
      if (changed) {
        readTextScript.remember(next, changed.source, { ...changed.parsed, project: next });
        verifiedTextProjects.add(next);
        result = { source: changed.source, sourceMap: changed.sourceMap };
      }
    } catch (error) { notify(error instanceof Error ? error.message : '舞台修改未应用'); }
    history.checkpoint();
    return result;
  };
  const importText = (file?: File, report?: AiEditorReporter) =>
    run("导入文本", async () => {
      const imported = file && !studio.pathForFile ? { name: file.name, text: await file.text() } : await studio.importText(file ? studio.pathForFile?.(file) : undefined);
      if (!imported) {report?.({status:'cancelled',message:'已取消选择文本文件。'});return;}
      if(report)report(await new Promise<AiEditorResult>(resolve=>setTextExchange({imported,complete:resolve})));
      else setTextExchange({ imported });
    },report);
  const exportAiText = (mode: 'commands'|'dialogue'|'revision', report:AiEditorReporter) =>
    run('导出文本', async()=>{
      if(!studio.exportText)throw new Error('当前环境不支持文本文件导出。');
      const snapshot=applyUiDraft(project,uiDraftRef.current);
      const destination=await studio.exportText(snapshot,mode);
      if(!destination){report({status:'cancelled',message:'已取消导出文本。'});return;}
      const message='文本已导出：'+destination+(mode==='commands'?'':'；已同时保存对白对应表。');
      notify(message);report({status:'completed',message});
    },report);
  const applyParsedText = (result: TextParseResult, source: string): boolean => {
      if (result.issues.some((issue) => issue.severity === "error")) {
        reportTextErrors(result.issues);
        return false;
      }
      history.commit("应用文本剧本", (draft) => {
        // Keep project identity, assets, UI and layout; text owns the story graph.
        draft.name = result.project.name;
        draft.chapters = result.project.chapters;
        draft.scenes = result.project.scenes;
        draft.nodes = result.project.nodes;
        draft.entryId = result.project.entryId;
        draft.characters = result.project.characters;
        draft.variables = result.project.variables;
        draft.effects = result.project.effects;
        // Text directives can select a reusable UI instance. Keep the authored
        // component library while applying that explicit selection.
        draft.ui.activeInstanceId = result.project.ui.activeInstanceId;
        draft.ui.instances = result.project.ui.instances;
        draft.scriptText = currentScriptText(refreshTextReferenceNames(result.project, source), result.project.scriptText?.sourceName ?? draft.scriptText?.sourceName);
      });
      setRuntimeDiagnostics(result.issues);
      setProblemsOpen(result.issues.length > 0);
      const first = result.project.nodes.find(node => node.id === nodeId) ?? result.project.nodes.find((node) => node.kind === "passage") ?? result.project.nodes[0];
      if (first) {
        setSceneId(first.sceneId);
        setNodeId(first.id);
        setLineId(first.kind === "passage" ? first.lines.find(line => line.id === lineId)?.id ?? first.lines[0]?.id : undefined);
      }
      notify(result.issues.length ? `文本已应用，有 ${result.issues.length} 条提示` : "文本已应用到项目");
      return true;
  };
  const applyText = (_result: TextParseResult, source: string) =>
    run("应用文本", async () => {
      // The preview parse may intentionally lag behind the input while the
      // author is typing. Always validate and apply the latest source here.
      applyParsedText(applyTextScript(project, source, project.scriptText?.sourceName), source);
    });
  const synchronizeText = () => !textDraft || applyParsedText(applyTextScript(project, textSource, project.scriptText?.sourceName), textSource);
  const changeView = (next: EditorView) => {
    if (playOpen) backFromPreview();
    if (next === view && library === 'scenes' && next !== 'blueprint') return true;
    if (!leaveUi(() => changeView(next))) return false;
    if ((next === "script" || next === "flowchart") && !synchronizeText()) return false;
    if (next === 'blueprint') {
      setBlueprintFocus(undefined);
      setBlueprintEntryRequest(previous => previous + 1);
      const previous = projectGraphs(project).find(graph => graph.id === performanceTarget?.graphId);
      setPerformanceTarget(previous && !isTimelineComponent(previous) ? { ...performanceTarget!, editorMode: 'graph' } : undefined);
    }
    if (next === 'text' && view !== 'text') {
      const parsed = applyTextScript(project, textSource);
      const location = parsed.sourceMap.find(item => !item.reference && item.nodeId === nodeId && item.lineId === lineId && item.actionCount === undefined) ?? parsed.sourceMap.find(item => !item.reference && item.nodeId === nodeId);
      const line = location?.sourceLine ?? parsed.nodeLocations.find(item => item.nodeId === nodeId)?.sourceLine;
      if (line) setTextFocusLine(previous => ({ line, request: (previous?.request ?? 0) + 1 }));
    }
    setView(next);
    setLibrary("scenes");
    setResource(undefined);
    setSettings(false);
    return true;
  };
  const handleResult = (result: RunResult, success: string) => {
    setRuntimeDiagnostics(result.diagnostics);
    setLog(result.log);
    setProblemsOpen(!result.ok);
    notify(
      result.ok
        ? result.outputPath
          ? `${success}：${result.outputPath}`
          : success
        : "存在问题，请查看下方结果",
    );
  };
  const reportTextErrors = (issues: TextIssue[]) => {
    setRuntimeDiagnostics(issues);
    setProblemsOpen(true);
    setView("text");
    setLibrary("scenes");
    setResource(undefined);
    const first = issues.find((issue) => issue.severity === "error");
    if (first) setTextFocusLine((previous) => ({ line: first.sourceLine, request: (previous?.request ?? 0) + 1 }));
    notify("文本存在错误，请修正后再继续");
  };
  const playableProject = (snapshot = applyUiDraft(project, uiDraftRef.current)): Project | undefined => {
    if (!snapshot.scriptText) return snapshot;
    const parsed = applyTextScript(snapshot, snapshot.scriptText.content, snapshot.scriptText.sourceName);
    if (parsed.issues.some((issue) => issue.severity === "error")) {
      reportTextErrors(parsed.issues);
      return;
    }
    return parsed.project;
  };
  const preview = (options?: PreviewOptions, report?: AiEditorReporter) =>
    run("启动试玩", async () => {
      uiSaving.current = true;
      let savedProject: Project;
      try {
        const base = history.getProject(), snapshot = applyUiDraft(base, uiDraftRef.current);
        const session = await studio.save(snapshot, !projectPath);
        if (!session) { notify('已取消保存，未启动试玩'); report?.({status:'cancelled',message:'已取消保存，未启动试玩。'}); return; }
        const saved = acceptUiSave('试玩前保存界面', base, snapshot, session);
        if (!saved) return;
        savedProject = saved;
      } finally { uiSaving.current = false; }
      const selected = { entryId: testEntry, variables: testVariables, blueprintDebug: debugEnabled, blueprintBreakpoints: debugPoints, ...options, mode: options?.mode ?? playMode };
      try { localStorage.setItem(`vns:preview-settings:${savedProject.id}`, JSON.stringify(selected)); } catch { /* Project data is already saved; local view settings are optional. */ }
      const current = playableProject(savedProject);
      if (!current) { report?.({status:'failed',message:'工程已保存；文本存在错误，无法继续试玩。'}); return; }
      setLiveMode(selected.mode);
      lastPreview.current = selected;
      setPlayProject(current); setPlayOpen(true); setPlayPhase('compiling'); setPlayMessage('工程已保存，正在编译最新内容并准备素材…');
      setRuntimePosition(undefined); setRuntimeDiagnostics([]); setLog(''); setProblemsOpen(false);
      try {
        const result = await studio.preview(current, selected);
        if (result.cancelled) { report?.({status:'cancelled',message:'试玩启动已取消。'}); return; }
        if (result.ok) { setPlayPhase(previous => previous === 'paused' ? previous : 'running'); notify(playDebugRef.current?.phase === 'paused' ? '蓝图已暂停，可单步或继续。' : '试玩已启动'); }
        else { setPlayPhase('failed'); setPlayMessage(result.diagnostics.find(d => d.severity === 'error')?.message ?? result.log ?? '试玩未能启动'); handleResult(result, '试玩已启动'); }
        report?.({status:result.ok?'completed':'failed',message:result.ok?'试玩已启动。':(result.diagnostics.filter(d=>d.severity==='error').map(d=>d.message).join('；')||result.log||'试玩启动失败。').slice(0,6000)});
      } catch (error) { setPlayPhase('failed'); setPlayMessage(error instanceof Error ? error.message : String(error)); throw error; }
    }, report);
  const stopPreview = async () => { setPlayOpen(false); await studio.controlPreview?.('stop'); setPlayPhase('idle'); notify('试玩已停止，已返回编辑'); };
  const resumePreview = async () => {
    setPlayOpen(true);
    try {
      const debug = playDebugRef.current;
      if (debug?.phase === 'paused') await studio.controlBlueprintDebug?.({ sessionId: debug.sessionId, action: 'continue' });
      await studio.controlPreview?.('resume'); await studio.controlPreview?.('focus');
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  };
  const pausePreview = () => playPhase === 'paused' ? resumePreview() : studio.controlPreview?.('pause');
  const backFromPreview = () => {
    setPlayOpen(false);
    void studio.setPreviewViewport?.({ x: 0, y: 0, width: 0, height: 0, visible: false });
    if (playPhase === 'running') void studio.controlPreview?.('pause');
    else if (playPhase === 'starting' || playPhase === 'compiling') void studio.controlPreview?.('stop');
  };
  const exportGame = (report?: AiEditorReporter) =>
    run("导出游戏", async () => {
      const current = playableProject();
      if (!current) { report?.({status:'failed',message:'文本存在错误，无法导出。'}); return; }
      if (!projectPath) {
        const saved = await studio.save(current);
        if (!saved) { report?.({status:'cancelled',message:'已取消保存，未导出游戏。'}); return; }
        setProjectPath(saved.path); history.markSaved(history.acceptAssetRelocations(current, saved.assetRelocations));
      }
      const result = await studio.exportGame(current);
      if (result) { handleResult(result, "游戏已导出"); report?.({status:result.ok?'completed':'failed',message:(result.ok?'游戏已导出：'+(result.outputPath??''):result.diagnostics.filter(d=>d.severity==='error').map(d=>d.message).join('；')||result.log||'导出失败。').slice(0,6000)}); } else report?.({status:'cancelled',message:'已取消导出游戏。'});
    }, report);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (closingRef.current || projectBrowser || event.defaultPrevented || event.isComposing) return;
      if (event.key === 'F5') { event.preventDefault(); if (event.shiftKey) void stopPreview(); else void preview(); return; }
      if (event.key === 'F6' && playActive) { event.preventDefault(); void pausePreview(); return; }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.code === 'Space') { event.preventDefault(); setContentOpen(previous => !previous); return; }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save(event.shiftKey);
      } else if (["z", "y"].includes(event.key.toLowerCase())) {
        const target = event.target;
        // UI property values use the same history as canvas transforms. Text
        // fields and editor-only controls keep their native typing history.
        const uiValue = view === 'ui' && target instanceof HTMLInputElement
          && !!target.closest('.ui-inspector, .blueprint-properties, .ui-toolbar-popover')
          && ['number', 'range', 'checkbox', 'radio', 'color'].includes(target.type)
          && (target.type !== 'number' || target.value.trim() !== '' && Number.isFinite(target.valueAsNumber));
        if (target instanceof HTMLInputElement && !uiValue || target instanceof HTMLTextAreaElement
          || target instanceof HTMLElement && target.isContentEditable) return;
        event.preventDefault();
        event.key.toLowerCase() === 'y' || event.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });

  const selectNode = (id: string, selectedLine?: string) => {
    const node = history.getProject().nodes.find((n) => n.id === id);
    if (!node) return;
    setGameFlowFocus(undefined);
    setSceneId(node.sceneId);
    setNodeId(id);
    setLineId(
      selectedLine ?? (node.kind === "passage" ? node.lines[0]?.id : undefined),
    );
    setResource(undefined);
    setSettings(false);
  };
  const selectTextLocation = useCallback((selection: { sceneId: string; nodeId: string; lineId?: string }) => {
    setGameFlowFocus(undefined);
    setSceneId(selection.sceneId); setNodeId(selection.nodeId); setLineId(selection.lineId);
  }, []);
  const selectScene = (id: string) => {
    setGameFlowFocus(undefined);
    setNavigation([]);
    setSceneId(id);
    if (view === 'script') setModuleRevealRequest(request => request + 1);
    const first =
      project.nodes.find((n) => n.sceneId === id && n.kind === "passage") ??
      project.nodes.find((n) => n.sceneId === id);
    if (first) selectNode(first.id);
    else {
      setNodeId(undefined);
      setLineId(undefined);
    }
    setLibrary("scenes");
    setResource(undefined);
    setSettings(false);
  };
  const selectResource = (next?: ResourceSelection) => {
    if (!leaveUi(() => selectResource(next))) return;
    setResource(next);
    setSettings(false);
  };
  const locateUiParameter = (id: string) => {
    const effective = applyUiDraft(history.getProject(), uiDraftRef.current);
    if (!effective.variables.some(variable => variable.id === id)) return;
    const projectId = effective.id;
    const navigate = () => {
      // Saving may accept a newly authored parameter; discarding may remove it.
      // Resolve the target after that decision, never through the old closure.
      const current = history.getProject();
      if (current.id !== projectId || !current.variables.some(variable => variable.id === id)) {
        notify('来源参数已不在当前工程中，未跳转。'); return;
      }
      setParameterSetFocus(undefined);
      setResourceFocus(value => value + 1);
      setLibrary('variables');
      setViewState('script');
      setResource({ kind: 'variable', id });
      setSettings(false);
    };
    if (leaveUi(navigate)) navigate();
  };
  const changeLibrary = (next: LibraryKind) => {
    if (playOpen) backFromPreview();
    if (!leaveUi(() => changeLibrary(next))) return false;
    setLibrary(next);
    setView('script');
    setSettings(false);
    setResource(undefined);
    return true;
  };
  const addNode = (kind: NodeKind) => {
    setGameFlowFocus(undefined);
    const node = kind === 'chapterTitle' ? { ...newNode('passage', sceneId), kind: 'passage' as const, name: '独立演出', lines: [{ id: makeId('line'), text: '', silent: true, actions: [] }] } : newNode(kind, sceneId, project.variables[0]?.id);
    node.x =
      80 +
      (project.nodes.filter((n) => n.sceneId === sceneId).length % 3) * 290;
    node.y =
      80 +
      Math.floor(
        project.nodes.filter((n) => n.sceneId === sceneId).length / 3,
      ) *
        190;
    commit("添加节点", (p) => p.nodes.push(node));
    setNodeId(node.id);
    setLineId(node.kind === "passage" ? node.lines[0]?.id : undefined);
    setResource(undefined);
    setSettings(false);
  };
  const openLinkedNode = (target: string, sourceId = nodeId) => {
    if (sourceId) setNavigation(previous => [...previous, sourceId]);
    selectNode(target);
    setStoryFlowFocus(previous => ({ nodeId: target, request: (previous?.request ?? 0) + 1 }));
    setLibrary("scenes");
    setView("flowchart");
  };
  const createSubgraph = (groupId?: string, targetSceneId = sceneId, sourceId?: string) => setNameDialog({
    title: "新建可复用段落", value: "共同剧情",
    submit: name => {
      const chapterId = project.scenes.find(scene => scene.id === targetSceneId)?.chapterId;
      if (!chapterId) return;
      const graphScene = makeId("scene");
      const passage = newNode("passage", graphScene);
      const back = newNode("return", graphScene);
      const call = newNode("call", targetSceneId);
      if (passage.kind !== "passage" || call.kind !== "call") return;
      passage.name = name;
      passage.x = 40; passage.y = 100; passage.next = back.id;
      back.x = 350; back.y = 100;
      const source = project.nodes.find(node => node.id === sourceId && node.sceneId === targetSceneId && (groupId ? project.storyGroups?.find(group => group.id === groupId)?.nodeIds.includes(node.id) : !project.storyGroups?.some(group => group.nodeIds.includes(node.id))));
      call.name = `调用 · ${name}`;
      call.target = passage.id;
      call.next = source && "next" in source ? source.next : project.nodes.find(node => node.sceneId === targetSceneId && node.kind === "end")?.id;
      call.x = (source?.x ?? 0) + 310; call.y = source?.y ?? 100;
      commit("创建可复用段落", draft => {
        draft.scenes.push({ id: graphScene, chapterId, name });
        if (source && ["start", "passage", "set", "call"].includes(source.kind)) draft.nodes = draft.nodes.map(node => node.id === source.id ? connectNode(node, "next", call.id) : node);
        draft.nodes.push(call, passage, back);
        addNodeToStoryGroup(draft, call.id, groupId);
      });
      setSceneId(targetSceneId); setNodeId(call.id); setLineId(undefined); setResource(undefined); setSettings(false);
    },
  });
  const addScene = () => {
    const current = readStoryStructure(project).project;
    const chapterId = current.scenes.find(scene => scene.id === sceneId)?.chapterId ?? current.chapters[0]?.id;
    editDirectory('添加小章节', before => addStorySection(before, 'scene', `小章节 ${current.scenes.length + 1}`, chapterId));
  };
  const editDirectory = (label: string, edit: (before: Project) => TextParseResult & { sceneId?: string; nodeId?: string; lineId?: string }) => {
    try {
      let result: ReturnType<typeof edit> | undefined;
      history.commit(label, draft => { result = edit(draft); Object.assign(draft, result.project); }, { separate: true });
      if (!result) return;
      const current = result.project;
      const selected = current.nodes.find(node => node.id === (result!.nodeId ?? nodeId)) ?? current.nodes.find(node => node.sceneId === sceneId) ?? current.nodes[0];
      setSceneId(result.sceneId ?? selected?.sceneId ?? current.scenes[0]?.id ?? '');
      setNodeId(selected?.id); setLineId(result.lineId); setResource(undefined);
      setLibrary('scenes');
      const at = result.nodeLocations.find(location => location.nodeId === selected?.id);
      if (view === 'text' && at) setTextFocusLine({ line: at.sourceLine, request: Date.now() });
    } catch (error) { notify(error instanceof Error ? error.message : '目录修改未应用'); }
  };
  const addChapter = () =>
    setNameDialog({
      title: "新建章节",
      value: `第 ${readStoryStructure(project).project.chapters.length + 1} 章`,
      submit: (name) => {
        editDirectory('添加章节', before => addStorySection(before, 'chapter', name));
      },
    });
  const renameScene = (id: string) => {
    const scene = project.scenes.find((s) => s.id === id);
    if (scene)
      setNameDialog({
        title: "重命名小章节",
        value: scene.name,
        submit: (name) =>
          commit("小章节名称", (p) => {
            p.scenes.find((s) => s.id === id)!.name = name;
          }),
      });
  };
  const removeScene = (id: string) => {
    const scene = readStoryStructure(project).project.scenes.find((s) => s.id === id);
    if (scene && confirm(`删除小章节“${scene.name}”及其中所有剧情？`))
      editDirectory('删除小章节', before => deleteStorySection(before, 'scene', id));
  };
  const removeChapter = (id: string) => {
    const chapter = readStoryStructure(project).project.chapters.find(item => item.id === id);
    if (chapter && confirm(`删除章节“${chapter.name}”及其中所有小章节和剧情？可使用撤销恢复。`))
      editDirectory('删除章节', before => deleteStorySection(before, 'chapter', id));
  };
  const addResource = (kind: "character" | "variable", folderId?: string) => {
    const id = makeId(kind);
    commit(kind === "character" ? "添加角色" : "添加状态", (p) => {
      if (kind === "character")
        p.characters.push({
          id,
          name: `角色 ${p.characters.length + 1}`,
          color: ["#287b6d", "#ad5979", "#547cb5"][p.characters.length % 3],
          expressions: [],
        });
      else
        p.variables.push({
          id,
          name: `状态 ${p.variables.length + 1}`,
          type: "number",
          initial: 0,
          persistent: false,
          resetWithSettings: false,
        });
      if (folderId) moveContent(p, [kind + ':' + id], folderId);
    });
    setResource({ kind, id });
    setSettings(false);
  };
  const assetUrl = (id?: string) => {
    const asset = project.assets.find((a) => a.id === id);
    if (!asset) return undefined;
    const url = studio.assetUrl(asset.path);
    return url.startsWith('studio-asset:') ? `${url}?project=${encodeURIComponent(projectPath ?? project.id)}` : url;
  };
  const locate = (diagnostic: Diagnostic) => {
    const parsed = applyTextScript(applyUiDraft(project, uiDraftRef.current), textSource);
    const { destination, label } = diagnosticLocation(parsed.project, diagnostic, parsed);
    if (!destination && diagnostic.ui) { notify(label); return; }
    const staysInUi = destination?.kind === 'ui' || destination?.kind === 'blueprint' && !!blueprintContext(parsed.project, destination.graphId, destination.nodeId).ui;
    if (!staysInUi && !leaveUi(() => locate(diagnostic))) return;
    const sourceLine = diagnosticSourceLine(diagnostic, parsed);
    if (destination && playOpen) backFromPreview();
    if (destination?.kind === 'settings') {
      setSettingsSection('project'); setSettings(true);
    } else if (destination?.kind === 'gameFlow') {
      openGameFlow(destination.target.phase, destination.target.stepId);
    } else if (destination?.kind === 'ui') {
      setLibrary('scenes'); setView('ui'); setResource(undefined); setSettings(false); setInspectorVisible(true);
      setUiPreviewInstance(destination.target.instanceId ?? ''); setUiId(destination.target.componentId);
      setUiFocus(previous => ({ target: destination.target, request: (previous?.request ?? 0) + 1, field: diagnostic.code === 'ui.button.unbound' ? 'action' : undefined }));
      notify('已定位：' + diagnosticLocation(parsed.project, diagnostic, parsed).label + ' · 在右侧属性中调整');
    } else if (destination?.kind === 'blueprint') {
      openBlueprint(destination.graphId, destination.nodeId);
    } else if (sourceLine && (view === 'text' || !!diagnostic.sourceLine || destination?.kind === 'text')) {
      setView("text");
      setLibrary("scenes");
      setResource(undefined);
      setSettings(false);
      if (!studio.openAiWindow) setAiOpen(false);
      setTextFocusLine((previous) => ({ line: sourceLine, request: (previous?.request ?? 0) + 1 }));
    } else if (destination?.kind === 'asset') {
      setLibrary("assets");
      selectResource({ kind: "asset", id: destination.assetId });
    } else if (destination?.kind === 'story') {
      setGameFlowFocus(undefined);
      if (!synchronizeText()) return;
      const node = parsed.project.nodes.find(node => node.id === destination.nodeId);
      if (!node) return;
      setLibrary("scenes"); setResource(undefined); setSettings(false);
      setView(view === 'flowchart' ? 'flowchart' : 'script');
      if (view === 'flowchart') setStoryFlowFocus(previous => ({ nodeId: node.id, request: (previous?.request ?? 0) + 1 }));
      setSceneId(node.sceneId); setNodeId(node.id);
      setLineId(destination.lineId ?? (node.kind === 'passage' ? node.lines[0]?.id : undefined));
      setTimeout(
        () =>
          document
            .getElementById(
              diagnostic.lineId
                ? `line-${diagnostic.lineId}`
                : `node-${diagnostic.nodeId}`,
            )
            ?.scrollIntoView({ block: "center", behavior: "smooth" }),
        80,
      );
    }
  };
  const openGameFlow = (phase: GameFlowPhase = 'beforeTitle', stepId?: string) => {
    const open = () => {
      if (!synchronizeText()) return;
      const entry = project.nodes.find(node => node.id === project.entryId);
      if (entry) setSceneId(entry.sceneId);
      setLibrary('scenes'); setResource(undefined); setSettings(false); setViewState('flowchart');
      setGameFlowFocus(previous => ({ phase, stepId, request: (previous?.request ?? 0) + 1 }));
    };
    if (leaveUi(open)) open();
  };
  const locatePageUsage = (usage: UiPageUsage) => {
    if (usage.setting === 'menuShortcut') { setSettingsSection('interface'); setSettings(true); }
    else if (usage.phase) openGameFlow(usage.phase, usage.stepId);
    else if (usage.componentId && usage.pageId) locate({ severity: 'warning', message: '', ui: { page: usage.pageId.startsWith('ui:') ? usage.pageId.slice(3) as NonNullable<Diagnostic['ui']>['page'] : 'custom', customPageId: usage.pageId.startsWith('ui:') ? undefined : usage.pageId, componentId: usage.componentId, instanceId: usage.instanceId === 'base' ? undefined : usage.instanceId } });
    else if (usage.storyNodeId) locate({ severity: 'warning', message: '', nodeId: usage.storyNodeId, lineId: usage.lineId });
    else if (usage.graphId) openBlueprint(usage.graphId, usage.nodeId);
    else if (usage.pageId) locate({ severity: 'warning', message: '', ui: { page: usage.pageId.startsWith('ui:') ? usage.pageId.slice(3) as NonNullable<Diagnostic['ui']>['page'] : 'custom', customPageId: usage.pageId.startsWith('ui:') ? undefined : usage.pageId } });
  };
  const locateBlueprintUsage = (usage: BlueprintUsage) => {
    const target = usage.location;
    if (target.kind === 'blueprint') { openBlueprint(target.graphId, target.nodeId); return; }
    if (target.kind === 'story') { locate({ severity: 'warning', message: '', nodeId: target.nodeId, lineId: target.lineId }); return; }
    if (target.kind === 'ui') { locate({ severity: 'warning', message: '', ui: target.target }); return; }
    if (target.kind === 'gameFlow') { openGameFlow(target.phase, target.stepId); return; }
    if (target.kind === 'character') {
      if (!leaveUi(() => locateBlueprintUsage(usage))) return;
      if (!history.getProject().characters.some(character => character.id === target.characterId)) { notify('调用位置已不存在。'); return; }
      setBlueprintVisits([]); setView('script'); setLibrary('characters'); setResource({ kind: 'character', id: target.characterId }); setSettings(false); setInspectorVisible(true);
    }
  };
  const locateParameterUsage = (usage: ParameterUsage) => {
    const target = usage.location;
    if (target.kind === 'blueprint') { openBlueprint(target.graphId, target.nodeId); return; }
    if (target.kind === 'ui') { locate({ severity: 'warning', message: '', ui: target.target }); return; }
    if (!leaveUi(() => locateParameterUsage(usage))) return;
    if (playOpen) backFromPreview();
    setLibrary('scenes'); setResource(undefined); setSettings(false);
    if (target.kind === 'text') {
      setView('text'); setTextFocusLine(previous => ({ line: target.sourceLine, request: (previous?.request ?? 0) + 1 }));
    } else {
      // Browsing a reference must not apply or replace a pending text draft.
      const current = history.getProject();
      const node = current.nodes.find(node => node.id === target.nodeId);
      if (!node) { notify('引用位置已不存在。'); return; }
      if (hasTextDraft(current)) {
        const parsed = readTextScript(current, current.scriptText!.content);
        const line = parsed.nodeLocations.find(location => location.nodeId === node.id)?.sourceLine;
        setView('text');
        if (line) setTextFocusLine(previous => ({ line, request: (previous?.request ?? 0) + 1 }));
        else notify('这处结构化引用在未应用的文本中已改变，请先处理文本草稿。');
        return;
      }
      setGameFlowFocus(undefined); setSceneId(node.sceneId); setNodeId(node.id); setLineId(undefined);
      setStoryFlowFocus(previous => ({ nodeId: node.id, request: (previous?.request ?? 0) + 1 }));
      setView('flowchart'); setInspectorVisible(true);
    }
  };
  const tabs = [
    { id: "script" as const, label: "剧本", Icon: MessageSquare },
    { id: "flowchart" as const, label: "流程图", Icon: GitBranch },
    { id: "blueprint" as const, label: "蓝图", Icon: Clapperboard },
    { id: "ui" as const, label: "界面", Icon: LayoutTemplate },
  ];
  const resourceTabs = [
    { id: 'assets' as const, label: '资源', Icon: FolderOpen },
    { id: 'characters' as const, label: '角色', Icon: UserRound },
    { id: 'variables' as const, label: '参数集', Icon: SlidersHorizontal },
  ];
  // The text editor's hidden IDs and performances must use a source map for the
  // exact text being edited. Share one parse with the text-mode directory.
  // A projection and its source map must describe the same revision, including
  // the render immediately after deleting a chapter. The shared reader reuses
  // parses already performed while preparing the edit.
  const directoryParse = useMemo(() => hasStoryDirectory && view === 'text' ? readTextScript(project, textSource) : undefined, [hasStoryDirectory, view, project, textSource, readTextScript]);
  // Module rows and their directory already have structured data. Source maps
  // are only needed by the text surface or an opened diagnostic panel.
  const diagnosticParse = useMemo(() => directoryParse ?? (problemsOpen && view === 'script' ? readTextScript(diagnosticProject, diagnosticProject.scriptText?.content ?? projectToText(diagnosticProject)) : undefined), [directoryParse, problemsOpen, view, diagnosticProject, readTextScript]);
  const diagnosticDocument = useMemo(() => problemsOpen && diagnosticParse ? textDocument(diagnosticParse.project.scriptText?.content ?? textSource, diagnosticParse.sourceMap) : undefined, [problemsOpen, diagnosticParse, textSource]);
  const selectDirectoryNode = (id: string, selectedLine?: string) => {
    setGameFlowFocus(undefined);
    if (view !== 'text') {
      if (view === 'script') setModuleRevealRequest(request => request + 1);
      selectNode(id, selectedLine); return;
    }
    const node = directoryParse?.project.nodes.find(node => node.id === id);
    if (node) { setSceneId(node.sceneId); setNodeId(node.id); setLineId(selectedLine); }
    const location = directoryParse?.sourceMap.find(item => !item.reference && item.nodeId === id && (!selectedLine || item.lineId === selectedLine && item.actionCount === undefined));
    const sourceLine = location?.sourceLine ?? directoryParse?.nodeLocations.find(item => item.nodeId === id)?.sourceLine;
    if (sourceLine) setTextFocusLine(previous => ({ line: sourceLine, request: (previous?.request ?? 0) + 1 }));
  };
  const openBlueprint = (graphId: string, selectedNodeId?: string, objectInstanceId?: string, navigation?: { from?: BlueprintReturnPoint; back?: BlueprintVisit[]; ui?: NonNullable<Diagnostic['ui']> }) => {
    // Save-and-continue callbacks may run before React renders the accepted UI draft.
    // Read the history's synchronous snapshot, not the render that opened the prompt.
    const snapshot = applyUiDraft(history.getProject(), uiDraftRef.current);
    const back = navigation?.back && resolveBlueprintReturn(snapshot, navigation.back);
    if (back && !back.point) { setBlueprintVisits(back.remaining); notify('原调用位置已删除或改变，没有跳转到其他蓝图。'); return; }
    if (navigation?.from && navigation.from.projectId !== snapshot.id) { notify('工程已切换，本次模块跳转已取消。'); return; }
    const origin = back?.point?.origin;
    const id = origin?.graphId ?? graphId, selected = origin?.primaryNodeId ?? selectedNodeId;
    const temporary = origin?.performance?.temporary;
    const contextProject = temporary?.workspace.project ?? snapshot;
    const matches = projectGraphs(contextProject).filter(graph => graph.id === id);
    if (matches.length !== 1) { notify(matches.length ? '目标蓝图标识不唯一，请先修复冲突；本次没有跳转。' : '目标蓝图已不存在或已随未保存草稿放弃，本次没有跳转。'); return; }
    const context = blueprintContext(contextProject, id, selected), ui = back?.point?.ui ?? navigation?.ui ?? context.ui;
    if (!ui && !leaveUi(() => openBlueprint(graphId, selectedNodeId, objectInstanceId, navigation))) return;
    // Resource navigation is read-only and must also work while text calls need repair.
    if (back) setBlueprintVisits(back.remaining);
    else if (navigation?.from) setBlueprintVisits(visits => enterBlueprintVisit(visits, navigation.from!, id));
    else setBlueprintVisits([]);
    if (ui) {
      setLibrary('scenes'); setResource(undefined); setSettings(false); setView('ui'); setUiAdvanced(true);
      setUiPreviewInstance(ui.instanceId ?? ''); setUiId(ui.componentId);
      setUiFocus(previous => ({ target: ui, request: (previous?.request ?? 0) + 1 }));
      setUiBlueprintFocus(previous => ({ graphId: id, nodeId: selected, restore: origin, request: (previous?.request ?? 0) + 1 }));
    } else {
      setLibrary('scenes'); setResource(undefined); setSettings(false); setView('blueprint');
      setPerformanceTarget(origin?.performance?.target ?? { nodeId: '', graphId: id, editorMode: isTimelineComponent(matches[0]) && !selected ? 'timeline' : 'graph' });
      setBlueprintFocus(previous => ({ graphId: id, nodeId: selected, objectInstanceId, restore: origin, request: (previous?.request ?? 0) + 1 }));
    }
    if (back?.changed) notify('已返回仍存在的调用位置；失效的旧节点或连线不再选中。');
    else if (back) notify('已返回调用位置，编辑内容保留。');
    else if (context.problem) notify(context.problem);
  };
  const openCanvasBlueprint: OpenBlueprintGraph = (id, selectedNodeId, origin) => {
    let ui: NonNullable<Diagnostic['ui']> | undefined;
    if (origin && view === 'ui') {
      const pageId = activeUiPage?.pageId;
      ui = pageId ? { page: pageId.startsWith('ui:') ? pageId.slice(3) as NonNullable<Diagnostic['ui']>['page'] : 'custom', customPageId: pageId.startsWith('ui:') ? undefined : pageId,
        instanceId: pageId.startsWith('ui:') ? uiProject.ui.activeInstanceId : undefined, componentId: uiId } : blueprintContext(uiProject, origin.graphId, origin.primaryNodeId).ui;
    }
    openBlueprint(id, selectedNodeId, undefined, origin ? { from: { projectId: project.id, origin, ui } } : undefined);
  };
  const backBlueprint = () => openBlueprint('', undefined, undefined, { back: blueprintVisits });
  const uiPreviewEpoch = useRef(0);
  const uiPreviewAction = useRef<(action: UiPreviewAction, epoch?: number, nativeSession?: string) => Promise<UiPreviewActionResult>>(async () => ({ status: 'cancelled', message: '编辑器尚未准备就绪。' }));
  uiPreviewAction.current = async (raw, requestedEpoch = uiPreviewEpoch.current, nativeSession) => {
    if (closingRef.current) return { status: 'cancelled', message: '主编辑器正在关闭，请等待关闭完成或取消后再试。' };
    if (nativeSession && nativeSession !== playSessionRef.current) return { status: 'cancelled', message: '试玩会话已改变，旧记录定位请求已取消。' };
    if (requestedEpoch !== uiPreviewEpoch.current) return { status: 'cancelled', message: '预览已关闭，本次定位或试玩请求已取消。' };
    if (!ready) throw new Error('编辑器尚未准备就绪，请稍后重试。');
    if (busy || uiSaving.current) throw new Error('主编辑器正在处理操作，请稍后重试。');
    if (uiLeave) throw new Error('请先处理主编辑器中已经打开的保存提示。');
    const snapshot = applyUiDraft(history.getProject(), uiDraftRef.current);
    const { action, ui } = resolveUiPreviewAction(snapshot, raw);
    if ((action.kind === 'play' || !ui) && uiDraftChanged(uiDraftRef.current)) {
      return await new Promise<UiPreviewActionResult>((resolve, reject) => setUiLeave({
        cancel: () => resolve({ status: 'cancelled', message: '已取消，界面草稿与当前定位保留。' }),
        proceed: () => setTimeout(() => { void uiPreviewAction.current(action, requestedEpoch, nativeSession).then(resolve, reject); }, 0),
      }));
    }
    if (action.kind === 'play') {
      let result: UiPreviewActionResult = { status: 'failed', message: '试玩没有启动，请检查主编辑器中的提示。' };
      await preview({ flowStart: 'launch', entryId: snapshot.entryId, variables: {} }, value => {
        result = { status: value.status === 'completed' ? 'completed' : value.status === 'cancelled' ? 'cancelled' : 'failed', message: value.message };
      });
      return result;
    }
    if (playOpen) backFromPreview();
    setSettings(false); setInspectorVisible(true);
    if (action.graphId) openBlueprint(action.graphId, action.nodeId, undefined, ui ? { ui } : undefined);
    else if (ui) {
      setLibrary('scenes'); setResource(undefined); setView('ui'); setUiAdvanced(false);
      setUiPreviewInstance(ui.instanceId ?? ''); setUiId(ui.componentId);
      setUiFocus(previous => ({ target: ui, request: (previous?.request ?? 0) + 1 }));
    }
    const message = action.graphId ? '已定位轨迹中的蓝图' + (action.nodeId ? '节点。' : '。') : action.componentId ? '已定位原页面／方案中的触发控件。' : '已定位轨迹来源页面。';
    notify(message);
    return { status: 'completed', message };
  };
  useEffect(() => studio.onUiPreviewAction?.(action => uiPreviewAction.current(action)), []);
  useEffect(() => studio.onUiPreviewWindowState?.(open => { if (!open) uiPreviewEpoch.current++; }), []);
  const selectPerformance = (target: PerformanceTarget) => {
    setPerformanceTarget(target);
    if (target.nodeId) { setNodeId(target.nodeId); setLineId(target.lineId); const node = project.nodes.find(node => node.id === target.nodeId); if (node) setSceneId(node.sceneId); }
  };
  const openPerformance = (target: PerformanceTarget) => {
    if (!leaveUi(() => openPerformance(target))) return;
    const namedResource = target.graphId && projectGraphs(history.getProject()).some(graph => graph.id === target.graphId);
    if (target.nodeId && !namedResource && !synchronizeText()) return;
    setBlueprintVisits([]); setBlueprintFocus(undefined); selectPerformance(target); setLibrary('scenes'); setResource(undefined); setSettings(false); setView('blueprint');
  };
  const openContent = (item: ContentItem) => {
    if (item.kind === 'timeline') { openPerformance({ nodeId: '', graphId: item.id, editorMode: 'timeline' }); return; }
    if (item.kind === 'blueprint') { const graph = projectGraphs(project).find(graph => graph.id === item.id); if (graph?.kind === 'effect') openPerformance({ nodeId: '', graphId: item.id }); else openBlueprint(item.id); return; }
    if (!leaveUi(() => openContent(item))) return;
    if (item.kind === 'scene') { if (!synchronizeText()) return; selectScene(item.id); setStoryFlowFocus(previous => ({ sceneId: item.id, request: (previous?.request ?? 0) + 1 })); setView('flowchart'); return; }
    setInspectorVisible(true); setSettings(false);
    if (item.kind === 'character' || item.kind === 'variable') { setLibrary(item.kind === 'character' ? 'characters' : 'variables'); setView('script'); setResource({ kind: item.kind, id: item.id }); }
    else { setLibrary('assets'); setView('script'); setResource({ kind: 'asset', id: item.id }); }
  };
  const createResourceBlueprint = (kind: Project['blueprints'][number]['kind'] | 'timeline', folderId?: string) => {
    if (projectGraphs(project).length >= 256) { notify('蓝图数量已达到上限'); return; }
    const graph = kind === 'timeline' ? createTimelinePreset(project) : createBlueprintGraph(kind, availableBlueprintName(project, kind === 'effect' ? '新的演出' : kind === 'macro' ? '新的用户节点' : '新的蓝图'));
    commitBlueprint(kind === 'timeline' ? '新建时间轴预设' : '新建资源蓝图', draft => { addProjectGraphs(draft, graph); if (folderId) moveContent(draft, [graphResourceKey(graph)], folderId); });
    if (kind === 'effect' || kind === 'timeline') openPerformance({ nodeId: '', graphId: graph.id, editorMode: kind === 'timeline' ? 'timeline' : 'graph' }); else openBlueprint(graph.id);
  };
  const dropResourceFiles = (transfer: DataTransfer, options: AssetImportOptions) => {
    const files = [...transfer.files];
    const paths = studio.pathForFile ? files.map(file => studio.pathForFile!(file)).filter(Boolean) : [];
    if (paths.length) void importAssets(false, true, { ...options, paths });
    else notify('请从系统文件管理器拖入本机文件或文件夹；也可以使用导入按钮。');
  };
  useEffect(()=>{
    if(uiAnimationFocus?.active()&&(view!=='ui'||!uiAdvanced||library!=='scenes'||settings||playOpen))uiAnimationFocus.finish({status:'cancelled',message:'已切换工作区，动画定位已取消。'});
  },[uiAnimationFocus, view, uiAdvanced, library, settings, playOpen]);
  const aiContext = useMemo<AiWorkspaceContext>(() => ({
    selectedParameter: library === 'variables' ? activeParameter : undefined,
    selectedContentKeys: library === 'assets' ? contentSelection : contentOpen && !playOpen ? dockSelection : library === 'characters' && resource?.kind === 'character' && project.characters.some(c=>c.id===resource.id) ? ['character:'+resource.id] : undefined,
    selectedBlueprint: view === 'blueprint' || view === 'ui' && uiAdvanced ? activeBlueprint : undefined,
    selectedUiComponentId: view === 'ui' ? uiId : undefined,
    selectedUiPage: view==='ui'&&library==='scenes'&&!settings&&!playOpen?activeUiPage:undefined,
    selectedUiAnimation: view === 'ui' && uiAdvanced ? activeUiAnimation : undefined,
    project: view === 'ui' ? uiProject : aiParsed?.project ?? project, sceneId, lineId, canUndo: view === 'ui' ? uiHistory.canUndo : history.canUndo,
    readOnlyMessage: aiParsed?.issues.some(issue => issue.severity === 'error') ? '请先修正文本文法错误，再生成或应用修改建议。仍可询问用法。' : undefined,
  }), [aiParsed, project, uiProject, activeParameter, resource, library, contentSelection, contentOpen, playOpen, dockSelection, activeBlueprint, activeUiPage, activeUiAnimation, settings, uiAdvanced, view, uiDraft, uiId, sceneId, lineId, history.canUndo, uiHistory.canUndo]);
  useEffect(() => studio.onAiWindowState?.(setAiOpen), []);
  useEffect(() => {
    if (aiOpen) void studio.updateAiContext?.(aiContext).catch(error => notify(`同步 AI 上下文失败：${String(error)}`));
  }, [aiOpen, aiContext, notify]);
  const openAiAssistant = async () => {
    setAiOpen(true);
    if (!studio.openAiWindow) return;
    const parsed = aiParsed ?? applyTextScript(project, textSource);
    try {
      await studio.openAiWindow({ ...aiContext, project: view === 'ui' ? uiProject : parsed.project, readOnlyMessage: parsed.issues.some(issue => issue.severity === 'error') ? '请先修正文本文法错误，再生成或应用修改建议。仍可询问用法。' : undefined });
    } catch (error) { setAiOpen(false); notify(`打开 AI 助手失败：${String(error)}`); }
  };
  const applyAiProposal = (changes: AiChange[]) => {
    // Parse inside the history commit so the fingerprint check sees the latest
    // draft, including edits that arrived before React finished rendering.
    const applyCommit = view === 'ui' ? commitUi : history.commit;
    applyCommit(`应用 AI 建议 ${makeId('ai_edit')}`, draft => {
      const parsed = applyTextScript(draft, draft.scriptText?.content ?? projectToText(draft));
      if (parsed.issues.some(issue => issue.severity === 'error')) throw new Error('请先修正文本文法错误。');
      Object.assign(draft, applyAiChanges(parsed.project, changes));
      synchronizeBlueprintSignatures(draft);
      draft.scriptText = currentScriptText(projectToText(draft), draft.scriptText?.sourceName);
    });
    notify(`已应用 ${changes.length} 项 AI 建议，可撤销`);
  };
  const locateAiLine = (id: string) => {
    const parsed = applyTextScript(project, textSource);
    const node = parsed.project.nodes.find(node => node.kind === 'passage' && node.lines.some(line => line.id === id));
    if (!node) throw new Error('这句台词已不存在，请根据当前内容重新提问。');
    locate({ severity: 'warning', message: 'AI 建议对应的台词', nodeId: node.id, lineId: id });
  };
  const applyAiWorkflowProposal = (proposal: AiWorkflowProposal) => {
    if (view !== 'ui') history.checkpoint();
    const applyCommit = view === 'ui' ? commitUi : history.commit;
    applyCommit(`应用 AI 创作方案 ${makeId('ai_edit')}`, draft => {
      const parsed = applyTextScript(draft, draft.scriptText?.content ?? projectToText(draft));
      if (parsed.issues.some(issue => issue.severity === 'error')) throw new Error('请先修正当前文本中的指令问题。');
      Object.assign(draft, applyAiWorkflow(parsed.project, proposal));
      synchronizeBlueprintSignatures(draft);
    });
    if (view !== 'ui') history.checkpoint();
    const first = proposal.project.nodes.find(node => node.kind === 'passage');
    if (first) { setSceneId(first.sceneId); setNodeId(first.id); setLineId(first.kind === 'passage' ? first.lines[0]?.id : undefined); }
    notify('已应用 AI 创作方案，可整批撤销');
  };
  const aiEditorAction = useRef<(action: AiEditorAction) => void | Promise<void | AiEditorResult>>(() => {});
  aiEditorAction.current = async action => {
    if (closingRef.current) throw new Error('主编辑器正在关闭，请等待关闭完成或取消后再试。');
    if (!ready || action.projectId !== project.id) throw new Error('工程已切换，请根据当前工程重新操作。');
    if (busy && !(action.kind === 'command' && action.command === 'stopPreview')) throw new Error('主编辑器正在处理操作，请稍后重试。');
    if (action.kind === 'apply') applyAiProposal(action.changes);
    else if (action.kind === 'workflow') applyAiWorkflowProposal(action.proposal);
    else if (action.kind === 'undo') undo();
    else if(action.kind==='layout'){
      const key=updateEditorLayout(localStorage,action.layout);window.dispatchEvent(new CustomEvent(editorLayoutEvent,{detail:key}));
      return {status:'completed',message:editorLayoutNames[action.layout.workspace]+'布局已更新；未打开的工作区将在下次打开时使用。'};
    }
    else if (action.kind === 'navigate') {
      const destination=resolveAiEditorTarget(applyUiDraft(project,uiDraftRef.current),action.target);
      const keepUiSelection=(destination.kind==='blueprintSelection'||destination.kind==='blueprint')&&(!!destination.ui||view==='ui'&&uiAdvanced&&!!findTimelinePath(applyUiDraft(project,uiDraftRef.current),activeBlueprint?.graphId,destination.graphId));
      if(destination.kind!=='ui'&&destination.kind!=='uiAnimation'&&!keepUiSelection&&uiDraftChanged(uiDraftRef.current)){
        if(uiLeave)throw new Error('请先处理主编辑器中已打开的保存提示。');
        return await new Promise<AiEditorResult>((resolve,reject)=>setUiLeave({cancel:()=>resolve({status:'cancelled',message:'已取消定位，界面草稿保留。'}),proceed:()=>setTimeout(()=>{Promise.resolve(aiEditorAction.current(action)).then(result=>resolve(result??{status:'pending',message:'尚未收到定位结果。'}),reject);},0)}));
      }
      if(playOpen)backFromPreview();
      setSettings(false);setInspectorVisible(true);
      if(destination.kind==='uiAnimation'){
        return requestUiAnimationFocus(destination,focus=>{
          uiAnimationFocus?.finish({status:'cancelled',message:'已切换到另一个动画定位请求。'});
          setLibrary('scenes');setResource(undefined);setView('ui');setUiAdvanced(true);
          setUiId(destination.ui.componentId);setUiPreviewInstance(destination.ui.instanceId??'');
          setUiFocus(previous=>({target:destination.ui,request:(previous?.request??0)+1}));
          setUiAnimationFocus(focus);
        });
      }else if(destination.kind==='blueprintSelection'){
        return requestBlueprintSelection(destination,selection=>{
          setLibrary('scenes');setResource(undefined);
          if(keepUiSelection){
            setView('ui');setUiAdvanced(true);
            if(destination.ui&&!(view==='ui'&&uiAdvanced&&activeBlueprint?.graphId===destination.graphId)){
              setUiId(destination.ui.componentId);setUiPreviewInstance(destination.ui.instanceId??'');
              setUiFocus(previous=>({target:destination.ui!,request:(previous?.request??0)+1}));
            }
            setUiBlueprintFocus(previous=>({graphId:destination.graphId,selection,request:(previous?.request??0)+1}));
          }else{
            setView('blueprint');setPerformanceTarget({nodeId:'',graphId:destination.graphId});
            setBlueprintFocus(previous=>({graphId:destination.graphId,selection,request:(previous?.request??0)+1}));
          }
        });
      }else if(destination.kind==='blueprint'){
        openBlueprint(destination.graphId,destination.nodeId,destination.objectInstanceId);
      }else if(destination.kind==='ui'){
        setLibrary('scenes');setResource(undefined);setView('ui');setUiAdvanced(destination.advanced);setUiId(destination.target.componentId);setUiPreviewInstance(destination.target.instanceId??'');
        setUiFocus(previous=>({target:destination.target,request:(previous?.request??0)+1}));
      }else if(destination.kind==='asset'){
        setLibrary('assets');setView('script');setResource(undefined);setContentFocus(previous=>({assetId:destination.id,request:(previous?.request??0)+1}));
      }else if(destination.kind==='parameterSet'){
        setResourceFocus(value=>value+1);setParameterSetFocus(destination.id);setLibrary('variables');setView('script');setResource(undefined);
      }else{
        setParameterSetFocus(undefined);setResourceFocus(value=>value+1);setLibrary(destination.kind==='parameter'?'variables':'characters');setView('script');setResource({kind:destination.kind==='parameter'?'variable':'character',id:destination.id});
      }
      return {status:'completed',message:'已定位：'+destination.label};
    }
    else if (action.kind === 'command') {
      if(isBlueprintEditorCommand(action.command)){
        if(settings||playOpen||library!=='scenes'||!(view==='blueprint'||view==='ui'&&uiAdvanced)||!activeBlueprint)throw new Error('请先打开要操作的节点蓝图。');
        if(uiSaving.current||busy)throw new Error('编辑器正在处理其他操作，请稍后重试。');
        return runBlueprintEditorAction(project.id,activeBlueprint.graphId,action.command);
      }
      if (uiDraftChanged(uiDraftRef.current) && ['preview','exportGame','importAssets','importAssetFolder','importSpine','importText'].includes(action.command)) throw new Error('界面有未保存的修改，请先保存或放弃界面草稿，再执行此操作。');
      let result:AiEditorResult={status:'pending',message:'已请求切换页面；如有未保存修改或文本错误，请在主编辑器中处理。'};
      const report:AiEditorReporter=value=>{result={...value,message:value.message.slice(0,6000)};};
      switch(action.command) {
        case 'undo': case 'redo': {
          if (uiSaving.current) throw new Error('界面正在保存，请稍后重试。');
          const available = view === 'ui' ? (action.command === 'undo' ? uiHistory.canUndo : uiHistory.canRedo) : action.command === 'undo' ? history.canUndo : history.canRedo;
          if (!available) { report({status:'cancelled',message:action.command === 'undo' ? '没有可撤销的修改。' : '没有可重做的修改。'}); break; }
          if (action.command === 'undo') undo(); else redo();
          report({status:'completed',message:(view === 'ui' ? '界面草稿' : '工程') + (action.command === 'undo' ? '已撤销上次修改。' : '已重做上次修改。')}); break;
        }
        case 'validate': {
          const current = applyUiDraft(project, uiDraftRef.current);
          const parsed = applyTextScript(current, current.scriptText?.content ?? projectToText(current));
          const checked = uniqueDiagnostics([...parsed.issues, ...validateProject(parsed.project)]);
          setDiagnosticProject(current); setProblemsOpen(true);
          report({status:'completed',message:`检查完成：${checked.filter(d=>d.severity==='error').length} 个错误，${checked.filter(d=>d.severity==='warning').length} 个警告。`+checked.slice(0,12).map(d=>d.message).join('；')}); break;
        }
        case 'preview': await preview(undefined,report); break;
        case 'pausePreview': case 'resumePreview': report(await controlAiPreview(studio, playPhase, action.command === 'pausePreview' ? 'pause' : 'resume')); break;
        case 'stopPreview': await stopPreview(); report({status:'completed',message:'试玩已停止。'}); break;
        case 'openUiPreview': case 'closeUiPreview': {
          if (view !== 'ui' || library !== 'scenes' || settings || playOpen || !uiPreviewControls.current) {
            report({status:'cancelled',message:action.command === 'openUiPreview' ? '请先打开要预览的界面页面，可使用打开界面编辑或打开高级界面编辑。' : 'UI 预览窗口尚未打开。'}); break;
          }
          if (uiLeave) throw new Error('请先处理主编辑器中已打开的保存提示。');
          report(await uiPreviewControls.current[action.command === 'openUiPreview' ? 'show' : 'close']()); break;
        }
        case 'save': await save(false,report); break;
        case 'discardUiDraft': {
          if (!uiDraftChanged(uiDraftRef.current)) { report({status:'cancelled',message:'没有未保存的界面修改。'}); break; }
          if (uiLeave) throw new Error('请先处理主编辑器中已打开的保存提示。');
          report(await new Promise<AiEditorResult>(resolve => setUiLeave({proceed:()=>{},stay:true,onDecision:decision=>resolve(decision==='cancel'?{status:'cancelled',message:'已取消，界面草稿保留。'}:decision==='save'?{status:'completed',message:'已按选择保存界面，没有放弃修改。'}:{status:'completed',message:'未保存的界面修改已放弃，恢复至工程中的版本。'})})));
          break;
        }
        case 'importAssets': await importAssets(false,true,undefined,report); break;
        case 'importAssetFolder': await importAssets(false,true,{mode:'folder'},report); break;
        case 'importSpine': await importAssets(true,true,undefined,report); break;
        case 'importText': if(textExchange)throw new Error('请先处理已打开的文本导入或导出窗口。');await importText(undefined,report); break;
        case 'exportScript': case 'exportDialogue': case 'exportRevision': await exportAiText(action.command==='exportScript'?'commands':action.command==='exportDialogue'?'dialogue':'revision',report);break;
        case 'exportGame': await exportGame(report); break;
        case 'openScript': if (changeView('text')) report({status:'completed',message:'编辑页面已打开。'}); break;
        case 'openBlueprint': if (changeView('blueprint')) report({status:'completed',message:'编辑页面已打开。'}); break;
        case 'openUi': case 'openAdvancedUi': if (changeView('ui')) {setSettings(false);if(playOpen)backFromPreview();setUiAdvanced(action.command==='openAdvancedUi');report({status:'completed',message:action.command==='openAdvancedUi'?'高级界面编辑已打开。':'界面设计已打开。'});} break;
        case 'openAssets': if (changeLibrary('assets')) report({status:'completed',message:'素材页面已打开。'}); break;
        case 'openCharacters': if (changeLibrary('characters')) report({status:'completed',message:'角色页面已打开。'}); break;
        case 'openSettings': setSettingsSection('project');setSettings(true);report({status:'completed',message:'作品设置已打开。'});break;
        case 'openParameters': if (changeLibrary('variables')) report({status:'completed',message:'编辑页面已打开。'}); break;
      }
      return result;
    } else locateAiLine(action.lineId);
  };
  useEffect(() => studio.onAiEditorAction?.(action => aiEditorAction.current(action)), []);
  const storyModeControls = <div className="story-edit-modes" role="group" aria-label="剧本编辑模式">
    <button type="button" aria-pressed={view === 'script'} onClick={() => changeView('script')} title="按段落和对白块编辑"><Layers size={14} />模块编辑</button>
    <button type="button" aria-pressed={view === 'text'} onClick={() => changeView('text')} title="编辑剧情脚本和演出指令"><FileText size={14} />文本编辑</button>
  </div>;
  const blueprintNavigation = library === 'scenes' && !settings && !playOpen && blueprintVisits.length > 0 && activeBlueprint?.graphId === blueprintVisits.at(-1)?.targetId ? <BlueprintNavigationBar compact project={uiWorkingProject} visits={blueprintVisits} onBack={backBlueprint} /> : undefined;
  return (
    <AssetImportContext.Provider value={importPickerAsset}><div className={`app-shell ${problemsOpen ? "has-problems" : ""}`} inert={!!projectBrowser || closing} aria-busy={closing}>
      {ready && <UiFontFaces project={uiWorkingProject} assetUrl={assetUrl} warmDialogue />}
      <header className="app-header">
        <nav className="view-tabs" aria-label="工作区">
            {navigation.length > 0 && <IconButton title="返回调用处" onClick={() => { const previous = navigation.at(-1); if (previous && synchronizeText()) { selectNode(previous); setNavigation(stack => stack.slice(0, -1)); setView("flowchart"); } }}><ArrowLeft size={16} /></IconButton>}
            <WorkspaceTabs items={[
              ...tabs.map(tab => ({ ...tab, active: library === 'scenes' && (view === tab.id || tab.id === 'script' && view === 'text'), select: () => changeView(tab.id === 'script' ? storyMode : tab.id) })),
              ...resourceTabs.map(tab => ({ ...tab, active: library === tab.id, select: () => changeLibrary(tab.id) })),
            ]} />
            <div className="spacer" />
            {hasAppInspector && <IconButton
              title={inspectorVisible ? "收起属性" : "展开属性"}
              onClick={() => setInspectorVisible(!inspectorVisible)}
            >
              {inspectorVisible ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
            </IconButton>}
          </nav>
        <div className="project-title" title={projectPath ?? project.name}>
          <strong>{project.name}</strong>
          {(history.dirty || uiDraftChanged(uiDraft)) && <span className="dirty-dot" title="未保存" />}
          <span className={editingTemplate ? 'template-editing-badge' : undefined}>{editingTemplate ? '模板编辑' : projectPath ? "本地作品" : "新作品"}</span>
        </div>
        <div className="header-actions">
          {studio.getProjectHub && <button type="button" className="small-button" title={editingTemplate ? '保存修改并返回模板库' : '保存当前修改并打开项目窗口'} disabled={!ready || !!busy} onClick={() => openProjectBrowser(editingTemplate ? 'templates' : 'recent')}>{editingTemplate ? '保存并返回模板库' : '项目窗口'}</button>}
          <IconButton
            title="新建工程"
            disabled={!!busy}
            onClick={() => { if (leaveUi(() => setNewDialog(true))) setNewDialog(true); }}
          >
            <FilePlus2 size={18} />
          </IconButton>
          <IconButton title="打开工程" disabled={!!busy} onClick={open}>
            <FolderOpen size={18} />
          </IconButton>
          <IconButton title={editingTemplate ? "保存模板" : "保存工程"} disabled={!!busy} onClick={() => save()}>
            <Save size={18} />
          </IconButton>
          <span className="toolbar-divider" />
          <IconButton
            title="撤销"
            disabled={(view === 'ui' ? !uiHistory.canUndo : !history.canUndo) || !!busy}
            onClick={undo}
          >
            <Undo2 size={18} />
          </IconButton>
          <IconButton
            title="重做"
            disabled={(view === 'ui' ? !uiHistory.canRedo : !history.canRedo) || !!busy}
            onClick={redo}
          >
            <Redo2 size={18} />
          </IconButton>
          <span className="toolbar-divider" />
          <IconButton title="AI 助手" disabled={!ready || !!busy} onClick={() => void openAiAssistant()}><Sparkles size={18} /></IconButton>
          <button
            className="primary preview-button"
            title="运行最新内容（F5）"
            disabled={!!busy}
            onClick={() => preview()}
          >
            {busy === "启动试玩" ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Play size={16} />
            )}
            试玩
          </button>
          {playActive && <>
            {!playOpen && <IconButton title="返回试玩画面" onClick={() => void resumePreview()}><Play size={15} /></IconButton>}
            <IconButton title={playPhase === 'paused' ? '继续试玩（F6）' : '暂停试玩（F6）'} disabled={playPhase !== 'running' && playPhase !== 'paused'} onClick={() => void pausePreview()}>{playPhase === 'paused' ? <Play size={15} /> : <Pause size={15} />}</IconButton>
            <IconButton title="停止试玩（Shift+F5）" onClick={() => void stopPreview()}><Square size={14} /></IconButton>
          </>}

          <button
            className="small-button export-button"
            disabled={!!busy}
            title="打开游戏导出设置"
            onClick={() => { setSettingsSection('export'); setSettings(true); }}
          >
            {busy === "导出游戏" ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <ArrowDownToLine size={16} />
            )}
            导出
          </button>
          <IconButton
            title="作品设置"
            onClick={() => { setSettingsSection('project'); setSettings(true); }}
          >
            <Settings2 size={18} />
          </IconButton>
        </div>
      </header>
      {playOpen && <PlayWorkspace project={playProject} bridge={studio} phase={playPhase} message={playMessage} mode={playActive ? liveMode : playMode} setMode={setPlayMode} options={lastPreview.current} position={runtimePosition} blocked={!!projectBrowser || newDialog || !!nameDialog || settings || helpOpen || !!uiLeave || !!textExchange || aiOpen && !studio.openAiWindow} onBack={backFromPreview} debug={playDebug} firstFramePending={firstFramePending} debugEnabled={debugEnabled} onDebugEnabled={value => setDebugSettings(value, debugPoints)} debugPoints={debugPoints} onDebugPoints={value => setDebugSettings(debugEnabled, value)} onDebugAction={action => uiPreviewAction.current(action, undefined, playDebug?.sessionId)} onRestart={() => void preview({ ...lastPreview.current, blueprintDebug: debugEnabled, blueprintBreakpoints: debugPoints, mode: playMode })} onPause={() => void pausePreview()} onStop={() => void stopPreview()} onFocus={() => void (playPhase === 'paused' && playDebug?.phase !== 'paused' ? resumePreview() : studio.controlPreview?.('focus'))} onLocate={() => { backFromPreview(); if (runtimePosition?.nodeId) locate({ severity: 'warning', message: '', nodeId: runtimePosition.nodeId, lineId: runtimePosition.lineId }); }} />}
      <div
        inert={!!uiLeave || !!projectBrowser || uiSaving.current || busy === '启动试玩'}
        className={`editor-layout sidebar-hidden ${showInspector ? "" : "inspector-hidden"} ${playOpen ? 'play-covered' : ''}`}
      >
        <main className="main-workspace">
          {locationMissing && <div className="project-location-notice" role="alert"><div><strong>工程已移动或原位置不可用</strong><span title={projectPath ?? ''}>{projectPath}</span><small>请选择移动后的工程文件，继续使用当前编辑内容和素材。</small></div><button className="small-button" disabled={!!busy} onClick={relocateCurrent}><FolderOpen size={16} />重新定位工程</button></div>}
          <div className={`workspace-body ${hasStoryDirectory ? 'story-workspace' : ''}`}>
            {hasStoryDirectory && <StoryDirectory project={directoryParse?.project ?? project} open={sidebarVisible} toggle={toggleProjectNavigation} sceneId={sceneId} nodeId={nodeId} selectNode={selectDirectoryNode} selectScene={id => {
              if (view === 'text') { const first = directoryParse?.project.nodes.find(node => node.sceneId === id); if (first) selectDirectoryNode(first.id); else setSceneId(id); }
              else selectScene(id);
            }} addScene={addScene} addChapter={addChapter} renameScene={renameScene} removeScene={removeScene} removeChapter={removeChapter} />}
            <div className="workspace-editor">
            {library === 'assets' ? <ContentBrowser onRevealAsset={studio.revealAsset ? id => studio.revealAsset!(project, id) : undefined} focus={contentFocus} onActiveSelection={setContentSelection} variant="workspace" project={project} commit={commit} open onClose={() => changeView('script')} assetUrl={assetUrl} onOpen={openContent} onImport={(options, spine) => importAssets(spine, true, options)} onDropFiles={dropResourceFiles} onCreateBlueprint={createResourceBlueprint} busy={!!busy} /> : library !== "scenes" ? (
              <Library key={resourceFocus} initialSetId={parameterSetFocus}
                onParameterSelection={setActiveParameter}
                locateParameterUsage={locateParameterUsage}
                kind={library}
                project={project}
                resource={resource}
                select={selectResource}
                commit={commit}
                assetUrl={assetUrl}
                addResource={addResource}
                onOpenBlueprint={openBlueprint}
                openUi={(id, pageId = 'ui:preferences') => {
                  const page = uiPage(project, pageId);
                  if (!page) return;
                  setUiPreviewInstance(undefined);
                  setLibrary('scenes'); setResource(undefined); setView('ui'); setUiId(id);
                  setUiFocus({ target: { page: page.kind, componentId: id, ...(page.template ? { instanceId: project.ui.activeInstanceId } : { customPageId: page.id }) }, request: Date.now() });
                }}
              />
            ) : view === "text" || view === "script" ? (
              <TextEditor
                key={project.id}
                project={project}
                source={textSource}
                parsedResult={directoryParse}
                readTextScript={readTextScript}
                defaultChapterId={project.scenes.find(scene => scene.id === sceneId)?.chapterId}
                onChange={updateTextSource}
                onStageCommit={commitStage}
                onImport={importText}
                onExport={() => setTextExchange({})}
                onApply={applyText}
                onAuthoringEdit={(label, next, source) => { history.commit(label, draft => { Object.assign(draft, next); synchronizeBlueprintSignatures(draft); draft.scriptText = currentScriptText(source, draft.scriptText?.sourceName); }); notify(label + '完成，可撤销'); }}
                onOpenBlueprint={openBlueprint}
                onOpenPerformance={openPerformance}
                onNotice={notify}
                preview={() => preview()}
                previewBusy={busy === '启动试玩'}
                errors={runtimeDiagnostics}
                onLocateDiagnostic={locate}
                onOpenEntrySettings={() => locate({ severity: 'warning', message: '', setting: 'entry' })}
                assetUrl={assetUrl}
                focusSourceLine={textFocusLine}
                onUndo={undo}
                onRedo={redo}
                canUndo={history.canUndo}
                canRedo={history.canRedo}
                modeControls={storyModeControls}
                onSelectionChange={selectTextLocation}
                previewSuspended={playOpen || settings}
                moduleEditor={view === 'script' ? <ScriptEditor project={project} sceneId={sceneId} selectedNodeId={nodeId} selectedLineId={lineId} revealRequest={moduleRevealRequest} commit={commit} playbackCommit={commitStage} select={selectNode} addNode={addNode} assetUrl={assetUrl} openBlueprint={openBlueprint} openPerformance={openPerformance} embedded /> : undefined}
                moduleToolbar={view === 'script' ? <ScriptEditorActions project={project} sceneId={sceneId} addNode={addNode} /> : undefined}
                moduleSelection={view === 'script' ? { nodeId: nodeId ?? '', lineId: lineId ?? '' } : undefined}
              />
            ) : view === 'blueprint' ? (
              <PerformanceWorkspace entryRequest={blueprintEntryRequest} navigation={blueprintNavigation} onLocateUsage={locateBlueprintUsage} onOpenGraph={openCanvasBlueprint} onActiveSelection={setActiveBlueprint} project={project} target={performanceTarget} onTarget={openPerformance} commit={commitBlueprint} commitMaterialized={(label, edit) => {
                if (!commitStage(label, draft => { const before = projectEditSnapshot(draft); edit(draft); synchronizeBlueprintSignatures(draft, before); })) throw new Error('演出修改未应用，请先修复文本剧本中的错误。');
              }} assetUrl={assetUrl} focus={blueprintFocus} onNotice={notify} suspended={playOpen || settings} />
            ) : view === "flowchart" ? (
              <Blueprint
                key={project.id}
                project={project}
                sceneId={sceneId}
                selectedNodeId={nodeId}
                diagnostics={diagnostics}
                commit={commit}
                select={selectNode}
                createSubgraph={createSubgraph}
                focus={gameFlowFocus}
                storyFocus={storyFlowFocus}
                openBlueprint={openBlueprint}
                openPage={(id, saveMode, componentId) => { setUiAdvanced(false); locate({ severity: 'warning', message: '', ui: { page: id.startsWith('ui:') ? id.slice(3) as NonNullable<Diagnostic['ui']>['page'] : 'custom', customPageId: id.startsWith('ui:') ? undefined : id, componentId } }); if (saveMode) setUiFocus(previous => previous && ({ ...previous, saveMode })); }}
                preview={start => void preview({ flowStart: start, entryId: undefined, variables: {} })}
                busy={!!busy}
                storyInspector={id => <Inspector project={project} nodeId={id} view="flowchart" projectSettings={false} commit={commit} assetUrl={assetUrl} selectNode={selectNode} selectResource={selectResource} hideDialogue />}
                openPassage={(id) => {
                  selectNode(id);
                  setView("script");
                }}
              />
            ) : (
              <UiEditor key={project.id} authoringSessions={uiAuthoringSessions} navigation={blueprintNavigation} textPending={hasTextDraft(uiProject, readTextScript)}
                      onPreviewAction={action => uiPreviewAction.current(action)}
                      onPreviewClosed={() => { uiPreviewEpoch.current++; }}
                onLocateUsage={locateBlueprintUsage}
                storyPosition={{ nodeId, lineId }}
                onOpenGameFlow={openGameFlow}
                onLocatePageUsage={locatePageUsage}
                onLocateStory={id => locate({ severity: 'warning', message: '', nodeId: id })}
                onOpenGlobalSettings={() => { setSettingsSection('interface'); setSettings(true); }}
                onOpenPerformance={openPerformance}
                inspector={pageContext => <NumericEditContext.Provider value={uiHistory.numericEdit}><Inspector
            uiPageContext={pageContext}
            onParameter={locateUiParameter}
            project={uiProject}
            nodeId={nodeId}
            lineId={lineId}
            resource={resource}
            view="ui"
            uiId={uiId} selectUi={selectUi}
            uiSelectionRequest={`${uiSelectionRequest}:${uiFocus?.request ?? ''}`}
            projectSettings={false}
            commit={commitUi}
            assetUrl={assetUrl}
            selectNode={selectNode}
            selectResource={selectResource}
          /></NumericEditContext.Provider>}
                blueprintFocus={uiBlueprintFocus}
                animationFocus={uiAnimationFocus}
                advanced={uiAdvanced}
                onAdvancedChange={setUiAdvanced}
                onActivePage={setActiveUiPage}
                onPreviewControls={captureUiPreviewControls}
                onActiveAnimation={setActiveUiAnimation}
                onActiveBlueprint={setActiveBlueprint}
                project={uiProject}
                dirty={uiDraftChanged(uiDraft)}
                saving={!!busy}
                onSave={() => { void saveUi(); }}
                commit={commitUi}
                focus={uiFocus}
                selectedId={uiId}
                select={selectUi}
                assetUrl={assetUrl}
                openBlueprint={openCanvasBlueprint}
              />
            )}
            </div>
          </div>
        </main>
        {showInspector && (
          <Inspector
            project={project}
            nodeId={nodeId}
            lineId={lineId}
            resource={resource}
            view={view}
            uiId={uiId} selectUi={selectUi}
            uiSelectionRequest={`${uiSelectionRequest}:${uiFocus?.request ?? ''}`}
            projectSettings={false}
            commit={commit}
            assetUrl={assetUrl}
            selectNode={selectNode}
            selectResource={selectResource}
          />
        )}
      </div>
      <ContentBrowser onRevealAsset={studio.revealAsset ? id => studio.revealAsset!(project, id) : undefined} onActiveSelection={setDockSelection} project={project} commit={commit} open={contentOpen && !playOpen && library !== 'assets'} onClose={() => setContentOpen(false)} assetUrl={assetUrl} onOpen={openContent} onImport={(options, spine) => importAssets(spine, true, options)} onDropFiles={dropResourceFiles} onCreateBlueprint={createResourceBlueprint} busy={!!busy} />
      {problemsOpen && (
        <section className="problems-panel">
          <div className="problems-header">
            <strong>问题与运行结果</strong>
            <span>{allDiagnostics.length} 项</span>
            <div className="spacer" />
            <IconButton
              title="关闭问题面板"
              onClick={() => setProblemsOpen(false)}
            >
              <X size={15} />
            </IconButton>
          </div>
          <div className="problems-content">
            {runtimePosition && <div className="runtime-position"><button className="runtime-location" onClick={() => { if (runtimePosition.nodeId) locate({ severity: "warning", message: "", nodeId: runtimePosition.nodeId, lineId: runtimePosition.lineId }); }}><Play size={13} /><strong>{project.nodes.find(node => node.id === runtimePosition.nodeId)?.name ?? "运行位置"}</strong>{runtimePosition.lineId && <span>第 {(() => { const node = project.nodes.find(node => node.id === runtimePosition.nodeId); return node?.kind === "passage" ? node.lines.findIndex(line => line.id === runtimePosition.lineId) + 1 : ""; })()} 行</span>}</button><div className="runtime-state">{Object.entries(runtimePosition.variables ?? {}).map(([id, value]) => <span key={id}><b>{project.variables.find(variable => variable.id === id)?.name ?? id}</b><output>{typeof value === "boolean" ? value ? "是" : "否" : String(value)}</output></span>)}</div></div>}
            <DiagnosticList issues={allDiagnostics} project={diagnosticParse?.project ?? project} parsed={diagnosticParse} document={diagnosticDocument} mode={view === 'text' ? 'text' : view === 'script' ? 'script' : 'other'} onLocate={locate} />
            {!allDiagnostics.length && (
              <div className="no-problems">
                <Check size={14} />
                未发现结构问题
              </div>
            )}
            {log && <pre className="runtime-log">{log}</pre>}
          </div>
        </section>
      )}
      <footer className="status-bar">
        <button
          className={
            errorCount
              ? "error-status"
              : allDiagnostics.length
                ? "warning-status"
                : ""
          }
          onClick={() => setProblemsOpen(!problemsOpen)}
        >
          {errorCount || allDiagnostics.length ? (
            <AlertCircle size={13} />
          ) : (
            <Check size={13} />
          )}
          <span>
            {errorCount
              ? `${errorCount} 个错误`
              : allDiagnostics.length
                ? `${allDiagnostics.length} 个提示`
                : "检查通过"}
          </span>
          {problemsOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
        <button className={`content-toggle ${contentOpen ? 'active' : ''}`} aria-expanded={contentOpen} title="资源管理器（Ctrl+空格）" onClick={() => setContentOpen(!contentOpen)}><PanelBottom size={14} /><span>资源管理器</span><kbd>Ctrl+空格</kbd></button>
        <span className="status-message">
          {busy ? (
            <>
              <LoaderCircle size={13} className="spin" />
              {busyNotice || `${busy}…`}
            </>
          ) : (
            status
          )}
        </span>
        {runtimePosition && <button className="runtime-status" onClick={() => setProblemsOpen(true)}><Play size={11} /><span>{project.nodes.find(node => node.id === runtimePosition.nodeId)?.name ?? "试玩位置"}</span></button>}
        <div className="spacer" />
        <span>
          {project.scenes.length} 小章节 · {project.nodes.length} 节点
        </span>
        <IconButton title="关于叙事工坊" onClick={() => setHelpOpen(true)}>
          <CircleHelp size={14} />
        </IconButton>
      </footer>
      {uiLeave && <div className="modal-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-label="保存界面修改">
        <h2>保存界面修改？</h2><p>{uiLeave.stay ? '界面有未保存的修改。选择保存、放弃修改，或取消并保留草稿。' : '界面有未保存的修改。保存后离开，或放弃这些修改。'}</p>
        <div className="dialog-actions"><button disabled={!!busy} onClick={() => { uiLeave.cancel?.(); uiLeave.onDecision?.('cancel'); setUiLeave(undefined); }}>取消</button>
        <button disabled={!!busy} onClick={() => { const decision = uiLeave; let discarded = false; void run('放弃界面修改', async () => {
          // Flush the decision before a callback can open another project or
          // window. A debounce alone can be cancelled by that navigation.
          const base = history.getProject();
          await studio.autosave(base, { projectDirty: history.dirty, clear: !history.dirty });
          updateUiDraft(undefined); setUiLeave(undefined); discarded = true;
        }).then(() => { if (discarded) { decision.proceed(); decision.onDecision?.('discard'); } }); }}>不保存</button>
        <button className="primary" disabled={!!busy} onClick={() => { const next = uiLeave.proceed; void saveUi().then(saved => { if (saved) { setUiLeave(undefined); next(); uiLeave.onDecision?.('save'); } }); }}>保存并继续</button></div>
      </section></div>}
      {projectBrowser && <ProjectBrowser bridge={studio} initialSection={projectBrowser} closing={closing} onBusyChange={value => { projectBrowserBusy.current = value; }} onReturn={() => setProjectBrowser(undefined)} onOpen={session => { adopt(session); setProjectBrowser(undefined); }} />}
      {newDialog && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              if (
                history.dirty &&
                !confirm("当前工程有未保存的修改，继续新建？")
              )
                return;
              void run("新建工程", async () => {
                const session = await studio.create(newName.trim(), newTemplate);
                if (session) { adopt(session); setNewDialog(false); }
              });
            }}
          >
            <div className="dialog-header">
              <h2>新建作品</h2>
              <IconButton title="关闭" onClick={() => setNewDialog(false)}>
                <X size={18} />
              </IconButton>
            </div>
            <Field label="作品名称">
              <input
                autoFocus
                value={newName}
                maxLength={200}
                onChange={(e) => setNewName(e.target.value)}
              />
            </Field>
            <Field label="工程模板"><select value={newTemplate} onChange={event => setNewTemplate(event.target.value as ProjectTemplate)}><option value="blank">空白视觉小说</option>{availableTemplates.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.name}</option>)}</select></Field>
            <div className="project-preset">
              <Clapperboard size={20} />
              <div>
                <strong>{availableTemplates.find(item => item.id === newTemplate)?.name ?? '标准视觉小说'}</strong>
                <span>{availableTemplates.find(item => item.id === newTemplate)?.description ?? '1280 × 720 · 横屏'}</span>
              </div>
            </div>
            <p className="new-project-hint">{newTemplate !== 'blank' ? '使用已保存的模板创建独立项目。内容与素材会复制到作品目录。' : '创建后在第一段写下对白，按 F5 试玩；也可切换到文本模式导入文稿。'}</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="small-button"
                onClick={() => setNewDialog(false)}
              >
                取消
              </button>
              <button
                className="primary"
                type="submit"
                disabled={!newName.trim() || !!busy}
              >
                创建作品
              </button>
            </div>
          </form>
        </div>
      )}
      {nameDialog && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            onSubmit={(e) => {
              e.preventDefault();
              if (nameDialog.value.trim()) {
                nameDialog.submit(nameDialog.value.trim());
                setNameDialog(undefined);
              }
            }}
          >
            <div className="dialog-header">
              <h2>{nameDialog.title}</h2>
              <IconButton title="关闭" onClick={() => setNameDialog(undefined)}>
                <X size={18} />
              </IconButton>
            </div>
            <Field label="名称">
              <input
                autoFocus
                value={nameDialog.value}
                onChange={(e) =>
                  setNameDialog({ ...nameDialog, value: e.target.value })
                }
              />
            </Field>
            <div className="dialog-actions">
              <button
                type="button"
                className="small-button"
                onClick={() => setNameDialog(undefined)}
              >
                取消
              </button>
              <button
                type="submit"
                className="primary"
                disabled={!nameDialog.value.trim()}
              >
                确定
              </button>
            </div>
          </form>
        </div>
      )}
      {aiOpen && !studio.openAiWindow && <AiAssistant {...aiContext} bridge={studio} assetUrl={assetUrl} onApply={applyAiProposal} onApplyWorkflow={applyAiWorkflowProposal} onLayout={layout=>aiEditorAction.current({projectId:project.id,kind:'layout',layout})} onNavigate={target=>aiEditorAction.current({projectId:project.id,kind:'navigate',target})} onCommand={command=>aiEditorAction.current({projectId:project.id,kind:'command',command})} onUndo={undo} onClose={() => setAiOpen(false)} onLocate={locateAiLine} />}
      {textExchange && <TextExchange project={project} imported={textExchange.imported} bridge={studio} onClose={() => {textExchange.complete?.({status:'cancelled',message:'已取消导入，工程没有修改。'});setTextExchange(undefined);}} onNotice={notify} onApply={(next, label) => { history.checkpoint(); history.commit(label, draft => Object.assign(draft, next)); history.checkpoint(); setSceneId(next.scenes[0]?.id ?? ''); setNodeId(next.nodes.find(node => node.kind === 'passage')?.id); setLineId(undefined); setView('text'); setLibrary('scenes'); setResource(undefined); notify(`${label}，可撤销`);textExchange.complete?.({status:'completed',message:`${label}已应用，可撤销；工程尚未保存。`}); }} />}
      {settings && <ProjectSettings themeProject={uiProject} commitTheme={view === 'ui' ? commitUi : commit} project={project} commit={commit} playMode={playMode} setPlayMode={setPlayMode} testEntry={testEntry} setTestEntry={setTestEntry} testVariables={testVariables} setTestVariables={setTestVariables} selectedNodeId={nodeId} busy={!!busy} initialSection={settingsSection} bridge={studio} assetUrl={assetUrl} onExport={() => { setSettings(false); void exportGame(); }} onClose={() => setSettings(false)} onPreview={() => { setSettings(false); void preview(); }} />}
      {helpOpen && (
        <div className="modal-backdrop">
          <div className="dialog">
            <div className="dialog-header">
              <h2>叙事工坊</h2>
              <IconButton title="关闭" onClick={() => setHelpOpen(false)}>
                <X size={18} />
              </IconButton>
            </div>
            <p>Visual Novel Studio</p>
            <p className="muted">
              版本 {studioVersion} · {window.studio ? import.meta.env.DEV ? "Windows 桌面开发版" : "Windows 桌面版" : "浏览器编辑模式"}
            </p>
            <p className="muted">Ren'Py 游戏运行时</p>
          </div>
        </div>
      )}
    </div></AssetImportContext.Provider>
  );
}
