import { projectGraphs, withProjectGraphs } from '../core/project-resources';
import { useStorySplit } from './StorySplit';
import { textareaOffsetPoint } from './text-wrap-layout';
import { ToolbarMenu } from './components';
import { TextColorSettings } from './TextColorSettings';
import { currentScriptText } from '../core/script-text';
import { CharacterPresetSelect } from './CharacterPresets';
import { NumberInput } from './NumberInput';
import {
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  ChevronRight,
  FileText,
  EyeOff,
  Clapperboard,
  Image,
  ListChecks,
  Music2,
  LoaderCircle,
  Play,
  RefreshCw,
  Settings2,
  Sparkles,
  Square,
  Timer,
  Upload,
  Download,
  UserRound,
  Volume2,
  Undo2,
  Redo2,
  Search,
  Replace,
  Workflow,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  applyTextScript,
  textReference,
  type TextIssue,
  type TextParseResult,
} from "../core/text-script";
import { effectiveCharacter, type Diagnostic, type Project, type StageAction } from "../core/model";
import { validateProject } from "../core/validate";
import { diagnosticSourceLine, uniqueDiagnostics } from '../core/diagnostic-location';
import { nodeNames } from "./editor";
import { TextPreview, type TextPreviewSelection } from "./StoryPreview";
import { categoryAssets } from '../core/asset-library';
import { UiAssetSelect } from './AssetPicker';
import { applyTextDocumentEdit, editTextDocument, patchTextDocument, sourceTextOffset, textDocument, textDocumentContainsLine, textEdit, visibleTextLine, visibleTextOffset, type TextDocument, type TextEdit } from '../core/text-document';
import { textChapters, textChapterAtLine, selectedTextChapter } from '../core/text-chapters';
import { performanceTextDocument, performanceTextFolds } from '../core/text-performance';
import { createTextScriptReader, type TextScriptReader } from '../core/text-script-cache';
import { performanceTargetAt, type PerformanceTarget } from '../core/performance-workspace';
import { TextCodeSurface } from './TextCodeSurface';
import { foldTextDocument, visibleTextSections } from '../core/text-folding';
import { commandGroup, storyTargetItems, textAssistance, type TextCompletion } from '../core/text-completion';
import { TextAssistance } from './TextAssistance';
import type { StageCommit } from '../core/stage-edit';
import type { Commit } from './editor';
import { PassagePerformances } from './PassagePerformances';
import { createPortal } from 'react-dom';
import { actionText, projectToText, textCommandAction } from '../core/text-script';
import { addPerformanceToLines, assignBlueprintGroup, availablePerformanceBlueprints, blueprintGroup, installPerformanceBlueprint, performanceFromText } from '../core/blueprint-authoring';
import { BatchPerformance, EncapsulatePerformance } from './PerformanceTools';
import { BlueprintCallFields } from './BlueprintCallFields';
import { blueprintCallName } from '../core/blueprint-names';
import { BlueprintRenameDialog } from './BlueprintNaming';
import { NodePicker } from './NodePicker';
import { MediaCommandPicker } from './MediaCommandPicker';
import { commandPerformanceBlueprints } from '../core/builtin-performances';
import { moveMenuIndex } from './menu-navigation';

/**
 * The text editor deliberately keeps the source string controlled by App.
 * Parsing happens here for a fast preview, while App decides how an applied
 * parse result is committed to the shared project history.
 */
export interface TextEditorProps {
  project: Project;
  source: string;
  parsedResult?: TextParseResult;
  readTextScript?: TextScriptReader;
  defaultChapterId?: string;
  onChange: (source: string, command?: boolean) => void;
  onStageCommit?: StageCommit;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onImport?: (file?: File) => void | Promise<void>;
  onExport?: () => void;
  onApply: (result: TextParseResult, source: string) => void | Promise<void>;
  preview?: (result: TextParseResult, source: string) => void | Promise<void>;
  previewBusy?: boolean;
  errors?: Array<Diagnostic | TextIssue>;
  onLocateDiagnostic?: (issue: Diagnostic) => void;
  onOpenEntrySettings?: () => void;
  onAuthoringEdit?: (label: string, next: Project, source: string) => void;
  onOpenBlueprint?: (id: string) => void;
  onOpenPerformance?: (target: PerformanceTarget) => void;
  onNotice?: (message: string) => void;
  assetUrl?: (id?: string) => string | undefined;
  focusSourceLine?: { line: number; request: number };
  modeControls?: ReactNode;
  onSelectionChange?: (selection: { sceneId: string; nodeId: string; lineId?: string }) => void;
  moduleEditor?: ReactNode;
  moduleToolbar?: ReactNode;
  moduleSelection?: TextPreviewSelection;
  previewSuspended?: boolean;
}

type CommandKey =
  | "displayImage" | "displayVideo" | "displayText" | "hideVisual"
  | "jump"
  | "call"
  | "return"
  | "start"
  | "chapterTitle"
  | "background"
  | "bgm"
  | "sound"
  | "voice"
  | "stopMusic"
  | "show"
  | "hide"
  | "hideInterface"
  | "showInterface"
  | "startDialogue"
  | "characterFeature"
  | "effect"
  | "blueprint"
  | "wait"
  | "shake"
  | "camera"
  | "set"
  | "choice"
  | "option"
  | "end"
  | "nodeInstance"
  | "interactionInstance"
  | "minigameInstance";

interface CommandDefinition {
  key: CommandKey;
  label: string;
  description: string;
  icon: typeof Image;
  needsPicker?: boolean;
  argumentless?: boolean;
}

const COMMANDS: CommandDefinition[] = [
  { key: 'displayImage', label: '显示图片', description: '叠加图片，调整位置、大小和显示时长', icon: Image, needsPicker: true },
  { key: 'displayVideo', label: '显示视频', description: '播放视频，调整大小、循环和音量', icon: Play, needsPicker: true },
  { key: 'displayText', label: '显示文字', description: '在舞台上显示独立文字', icon: FileText, needsPicker: true },
  { key: 'hideVisual', label: '隐藏对象', description: '按 ID 隐藏图片、视频或文字', icon: Square, needsPicker: true },
  { key: "jump", label: "跳转", description: "跳到章节、小章节或段落，可设置过渡效果", icon: ArrowRight, needsPicker: true },
  { key: "background", label: "背景", description: "切换图片背景并设置淡入", icon: Image, needsPicker: true },
  { key: "bgm", label: "背景音乐", description: "播放或循环一段背景音乐", icon: Music2, needsPicker: true },
  { key: "sound", label: "音效", description: "播放一次声音素材", icon: Volume2, needsPicker: true },
  { key: "voice", label: "配音", description: "为下一句对白设置配音，按角色文件夹选择", icon: Volume2, needsPicker: true },
  { key: "stopMusic", label: "停止音乐", description: "让背景音乐淡出停止", icon: Square, needsPicker: true },
  { key: "show", label: "显示角色", description: "角色留空跟随当前台词，也可指定角色与表情", icon: UserRound, needsPicker: true },
  { key: "hide", label: "隐藏角色", description: "让角色离开舞台", icon: UserRound, needsPicker: true },
  { key: "hideInterface", label: "隐藏界面", description: "手动隐藏对话框及快捷按钮", icon: Square, argumentless: true },
  { key: "showInterface", label: "显示界面", description: "恢复对话框及快捷按钮", icon: Play, argumentless: true },
  { key: "startDialogue", label: "播放台词演出", description: "从此处播放本句文字和配音，后续演出继续", icon: Play, argumentless: true },
  { key: "characterFeature", label: "角色功能", description: "调用角色的可复用功能", icon: UserRound, needsPicker: true },
  { key: "effect", label: "效果", description: "调用可复用演出效果实例", icon: Sparkles, needsPicker: true },
  { key: "blueprint", label: "蓝图", description: "选择并调用工程里的自定义演出", icon: Workflow, needsPicker: true },
  { key: "wait", label: "等待", description: "暂停若干秒再继续", icon: Timer, needsPicker: true },
  { key: "shake", label: "震动", description: "让画面横向或纵向震动", icon: RefreshCw, needsPicker: true },
  { key: "camera", label: "镜头", description: "移动镜头、缩放与旋转", icon: Camera, needsPicker: true },
  { key: "set", label: "设置", description: "修改好感度等状态变量", icon: Settings2, needsPicker: true },
  { key: "choice", label: "选择", description: "显示问题，再用选项填写回答和去向", icon: ListChecks },
  { key: "option", label: "选项", description: "添加一个选项并连接目标段落", icon: ListChecks, needsPicker: true },
  { key: "call", label: "调用", description: "进入可复用剧情，返回后继续调用处的下一步", icon: Workflow, needsPicker: true },
  { key: "return", label: "返回", description: "从被调用的剧情返回", icon: Undo2, argumentless: true },
  { key: "end", label: "返回标题界面", description: "结束剧情并返回标题界面", icon: Check, argumentless: true },
  { key: "start", label: "开始", description: "创建连接下一段的流程起点；新游戏从哪里开始在「故事入口」设置，普通顺序剧情可省略此指令", icon: Play, argumentless: true },
  { key: "nodeInstance", label: "复用节点", description: "复制已有剧情、互动或小游戏及其设置", icon: Sparkles, needsPicker: true },
];

interface PaletteRange {
  start: number;
  end: number;
}

interface PickerState {
  command: CommandKey;
  range: PaletteRange;
  blueprintId?: string;
}

function displayAsset(project: Project, id?: string) {
  return project.assets.find((asset) => asset.id === id)?.name ?? id ?? "";
}

function displayNode(project: Project, id?: string) {
  return project.nodes.find((node) => node.id === id)?.name ?? id ?? "未连接";
}

function displayAction(action: StageAction, project: Project) {
  switch (action.kind) {
    case "background":
      return `背景：${displayAsset(project, (action as { assetId: string }).assetId)}`;
    case "music":
      return `背景音乐：${displayAsset(project, (action as { assetId: string }).assetId)}`;
    case "sound":
      return `音效：${displayAsset(project, (action as { assetId: string }).assetId)}`;
    case "show": {
      const show = action as { characterId: string; expressionId: string };
      const character = effectiveCharacter(project, show.characterId);
      return `显示：${character?.name ?? (show.characterId || "当前台词角色")} · ${character?.expressions.find((item) => item.id === show.expressionId)?.name ?? "默认表情"}`;
    }
    case "hide":
      return `隐藏：${project.characters.find((item) => item.id === (action as { characterId: string }).characterId)?.name ?? "角色"}`;
    case "pause":
      return `等待：${(action as { seconds: number }).seconds} 秒`;
    case "shake":
      return `震动：${(action as { direction: string }).direction === "horizontal" ? "横向" : "纵向"}`;
    case "camera": {
      const camera = action as { zoom: number; duration: number };
      return `镜头：缩放 ${camera.zoom}，${camera.duration} 秒`;
    }
    case "effect":
      return `效果：${project.effects.find((item) => item.id === (action as { effectId: string }).effectId)?.name ?? "效果实例"}`;
    case "characterFeature": {
      const character = effectiveCharacter(project, action.characterId);
      return `角色功能：${character?.name ?? action.characterId} · ${character?.features?.find(feature => feature.id === action.featureId)?.name ?? action.featureId}`;
    }
    case "stopMusic":
      return "停止音乐";
    case 'hideInterface': return '隐藏界面';
    case 'showInterface': return '显示界面';
    case 'startDialogue': return '播放台词演出';
    case "animate":
      return "动画关键帧";
  }
}

interface PreviewRow {
  id: string;
  kind: "scene" | "passage" | "dialogue" | "choice" | "condition" | "set" | "jump" | "end" | "other";
  title: string;
  detail?: string;
  nodeId?: string;
  lineId?: string;
  sceneId?: string;
}

function previewRows(project: Project, visibleNodes?: Set<string>): PreviewRow[] {
  const rows: PreviewRow[] = [];
  for (const scene of project.scenes) {
    const nodes = project.nodes.filter(item => item.sceneId === scene.id && (!visibleNodes || visibleNodes.has(item.id)));
    if (visibleNodes && !nodes.length) continue;
    rows.push({ id: `scene-${scene.id}`, kind: "scene", title: scene.name, sceneId: scene.id });
    for (const node of nodes) {
      if (node.kind === "passage") {
        rows.push({ id: node.id, kind: "passage", title: node.name, nodeId: node.id, sceneId: scene.id, detail: `${node.lines.length} 行对白` });
        node.lines.forEach((line, index) => {
          const speaker = project.characters.find((item) => item.id === line.speakerId)?.name ?? "旁白";
          const text = line.text.trim() || "（空白对白）";
          const action = line.actions[0] ? ` · ${displayAction(line.actions[0], project)}` : "";
          rows.push({ id: `${node.id}-${line.id}`, kind: "dialogue", title: `${speaker}：${text}`, detail: `第 ${index + 1} 行${action}`, nodeId: node.id, lineId: line.id, sceneId: scene.id });
        });
      } else if (node.kind === "choice") {
        rows.push({ id: node.id, kind: "choice", title: node.name, detail: `${node.prompt || "玩家选择"} · ${node.choices.length} 个选项`, nodeId: node.id, sceneId: scene.id });
      } else if (node.kind === "condition") {
        rows.push({ id: node.id, kind: "condition", title: node.name, detail: `满足 → ${displayNode(project, node.yes)}；否则 → ${displayNode(project, node.no)}`, nodeId: node.id, sceneId: scene.id });
      } else if (node.kind === "set") {
        const variable = project.variables.find((item) => item.id === node.variableId);
        rows.push({ id: node.id, kind: "set", title: node.name, detail: `${variable?.name ?? "状态"} ${node.operation === "add" ? "增加" : "设为"} ${String(node.value)}`, nodeId: node.id, sceneId: scene.id });
      } else if (node.kind === "jump" || node.kind === "call") {
        rows.push({ id: node.id, kind: "jump", title: node.name, detail: `前往：${displayNode(project, node.target)}`, nodeId: node.id, sceneId: scene.id });
      } else if (node.kind === "end") {
        rows.push({ id: node.id, kind: "end", title: node.name, detail: "返回标题界面", nodeId: node.id, sceneId: scene.id });
      } else if (node.kind !== "start") {
        rows.push({ id: node.id, kind: "other", title: node.name, detail: nodeNames[node.kind], nodeId: node.id, sceneId: scene.id });
      }
    }
  }
  return rows;
}

function commandGlyph(kind: PreviewRow["kind"]) {
  if (kind === "scene") return <Image size={14} />;
  if (kind === "dialogue" || kind === "passage") return <FileText size={14} />;
  if (kind === "choice" || kind === "condition") return <ListChecks size={14} />;
  if (kind === "set") return <Settings2 size={14} />;
  if (kind === "end") return <Check size={14} />;
  return <ChevronRight size={14} />;
}

function TextStructure({ rows, onSelect }: { rows: PreviewRow[]; onSelect: (row: PreviewRow) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 720 });
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(previous => ({ ...previous, height: element.clientHeight })));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const height = 66, start = Math.max(0, Math.min(rows.length - 1, Math.floor(viewport.top / height) - 5));
  const end = Math.min(rows.length, start + Math.ceil(viewport.height / height) + 12);
  return <div ref={container} className="text-preview-scroll text-structure-virtual" tabIndex={0} aria-label="当前章节结构" onScroll={event => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
    {rows.length ? <div style={{ height: rows.length * height, position: 'relative' }}>
      {rows.slice(start, end).map((row, index) => <div key={row.id} title={row.title} className={`text-preview-row ${row.kind} ${row.lineId ? 'selectable' : ''}`} style={{ position: 'absolute', top: (start + index) * height, height, left: 0, right: 0 }} role={row.lineId ? 'button' : undefined} tabIndex={row.lineId ? 0 : undefined} onClick={() => onSelect(row)} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && row.lineId) { event.preventDefault(); onSelect(row); } }}><span className="text-preview-icon">{commandGlyph(row.kind)}</span><div><strong>{row.title}</strong>{row.detail && <small>{row.detail}</small>}</div></div>)}
    </div> : <div className="text-command-empty">本章尚无剧情内容</div>}
  </div>;
}

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="text-command-field">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function NumberField({ label, value, onChange, min, max, step = 0.1 }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <label className="text-command-field text-command-number">
      <span>{label}</span>
      <NumberInput aria-label={label} type="number" value={value} step={step} onChange={event => onChange(event.target.valueAsNumber)} />
    </label>
  );
}

function CommandPicker({ project, state, onInsert, onCancel, assetUrl }: { project: Project; state: PickerState; onInsert: (text: string) => void; onCancel: () => void; assetUrl: (id?: string) => string | undefined }) {
  const [assetId, setAssetId] = useState(categoryAssets(project, 'image', 'scene')[0]?.id ?? "");
  const audioCategory = state.command === 'voice' ? 'voice' : state.command === 'bgm' ? 'bgm' : 'sound';
  const [audioId, setAudioId] = useState(categoryAssets(project, 'audio', audioCategory)[0]?.id ?? "");
  const [characterId, setCharacterId] = useState(state.command === "show" ? "" : project.characters[0]?.id ?? "");
  const [expressionId, setExpressionId] = useState("");
  const [featureId, setFeatureId] = useState(effectiveCharacter(project, project.characters[0]?.id ?? "")?.features?.[0]?.id ?? "");
  const [effectId, setEffectId] = useState(project.effects[0]?.id ?? "builtin_vertical_shake");
  const [blueprintId, setBlueprintId] = useState(state.blueprintId ?? projectGraphs(project)?.[0]?.id ?? "");
  const [blueprintInputs, setBlueprintInputs] = useState<Record<string, string | number | boolean>>();
  const [variableId, setVariableId] = useState(project.variables[0]?.id ?? "");
  const [targetId, setTargetId] = useState(project.nodes.find((node) => node.kind === "passage")?.id ?? "");
  const [text, setText] = useState("");
  const [operation, setOperation] = useState<"set" | "add">(project.variables[0]?.type === "number" ? "add" : "set");
  const [value, setValue] = useState(project.variables[0]?.type === "boolean" ? "是" : project.variables[0]?.type === "number" ? "1" : "");
  const [seconds, setSeconds] = useState(1);
  const [direction, setDirection] = useState<"horizontal" | "vertical">("horizontal");
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [zoom, setZoom] = useState(1.1);
  const [duration, setDuration] = useState(0.8);
  const [waitMotion, setWaitMotion] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [amplitude, setAmplitude] = useState(20);
  const [motionEasing, setMotionEasing] = useState<'linear' | 'ease' | 'easein' | 'easeout'>('ease');
  const [scale, setScale] = useState(1);
  const [presetId, setPresetId] = useState('default');
  const [position, setPosition] = useState(0.5);
  const [verticalPosition, setVerticalPosition] = useState(1);
  const [transitionMode, setTransitionMode] = useState<'none' | 'dissolve' | 'fade'>('none');
  const [transitionSeconds, setTransitionSeconds] = useState(0.5);
  const [transitionColor, setTransitionColor] = useState('#000000');
  const character = useMemo(() => effectiveCharacter(project, characterId), [project, characterId]);
  const expressions = character?.expressions ?? [];
  const features = character?.features ?? [];
  const images = project.assets.filter((asset) => asset.kind === "image");
  const audio = project.assets.filter((asset) => asset.kind === "audio");
  const targets = storyTargetItems(project);
  const variables = project.variables;
  const effects = [
    { id: "builtin_vertical_shake", name: "震动" },
    { id: "builtin_horizontal_shake", name: "横向震动" },
    { id: "builtin_camera_push", name: "镜头推进" },
    { id: "builtin_camera_reset", name: "镜头复位" },
    ...project.effects,
  ];
  const instanceKinds = state.command === "interactionInstance" ? ["interaction"] : state.command === "minigameInstance" ? ["minigame"] : ["passage", "condition", "choice", "interaction", "minigame", "set", "call", "jump"];
  const instances = project.nodes.filter((node) => instanceKinds.includes(node.kind));
  const instance = instances.find((node) => node.id === targetId) ?? instances[0];
  const selectedVariable = variables.find((item) => item.id === variableId);
  const canInsert = state.command === "background" ? !!images.find((item) => item.id === assetId)
      : state.command === "bgm" || state.command === "sound" || state.command === 'voice' ? !!audio.find((item) => item.id === audioId)
        : state.command === "show" ? !characterId || !!character && (!expressionId || !!expressions.find((item) => item.id === expressionId))
          : state.command === "hide" ? !!character
            : state.command === "characterFeature" ? !!character && features.some(feature => feature.id === featureId)
              : state.command === "effect" ? !!effects.find((item) => item.id === effectId)
              : state.command === "blueprint" ? !!projectGraphs(project)?.find((item) => item.id === blueprintId)
              : state.command === "set" ? !!selectedVariable && value.trim().length > 0
                : state.command === "option" || state.command === "jump" || state.command === "call" ? !!targets.find((item) => item.id === targetId)
                  : state.command === "nodeInstance" || state.command === "interactionInstance" || state.command === "minigameInstance" ? !!instance
                  : true;

  useEffect(() => {
    setExpressionId(current => character?.expressions.some(expression => expression.id === current) ? current : "");
    setFeatureId(current => character?.features?.some(feature => feature.id === current) ? current : character?.features?.[0]?.id ?? "");
  }, [character]);

  const submit = () => {
    const ref = (item: { id: string; name: string } | undefined) => item ? textReference(item.name, item.id) : "";
    switch (state.command) {
      case "background": onInsert(`@背景：${ref(images.find((item) => item.id === assetId))}\n`); break;
      case "bgm": onInsert(`@背景音乐：${ref(audio.find((item) => item.id === audioId))} 循环\n`); break;
      case "sound": onInsert(`@音效：${ref(audio.find((item) => item.id === audioId))}\n`); break;
      case "voice": onInsert(`@配音：${ref(audio.find((item) => item.id === audioId))}\n`); break;
      case "stopMusic": onInsert(`@停止音乐：${seconds}\n`); break;
      case "show": {
        const name = ref(character);
        const expression = ref(expressions.find((item) => item.id === expressionId));
        onInsert(actionText(project, { kind: 'show', characterId, expressionId, x: position, y: verticalPosition, scale, presetId: presetId || undefined, layer: 10, transition: 'dissolve' }) + '\n');
        break;
      }
      case "hide": onInsert(`@隐藏角色：${ref(character)}\n`); break;
      case "characterFeature": onInsert(`@角色功能：${ref(character)}，${ref(features.find(feature => feature.id === featureId))}\n`); break;
      case "effect": {
        const selected = effects.find((item) => item.id === effectId);
        onInsert(`@效果：${project.effects.some((item) => item.id === effectId) ? ref(selected) : selected?.name ?? ""}\n`);
        break;
      }
      case "blueprint": onInsert(actionText(project, { kind: 'blueprint', blueprintId, inputs: blueprintInputs }) + '\n'); break;
      case "wait": onInsert(`@等待：${seconds}\n`); break;
      case "shake": onInsert(actionText(project, { kind: "shake", direction, duration, amplitude, wait: waitMotion }) + "\n"); break;
      case "camera": onInsert(actionText(project, { kind: "camera", x, y, zoom, duration, rotation, easing: motionEasing, wait: waitMotion }) + "\n"); break;
      case "set": onInsert(`@设置：${ref(selectedVariable)} ${operation === "add" ? "+=" : "="} ${value}\n`); break;
      case "option": onInsert(`@选项：${text || "新选项"} -> ${targets.find(item => item.id === targetId)?.insertText ?? ''}\n`); break;
      case "jump": {
        const transition = transitionMode === 'none' ? '' : `，切换方式=${transitionMode === 'fade' ? '淡入淡出' : '溶解'}，时长=${transitionSeconds}，颜色=${transitionColor}`;
        onInsert(`@跳转：${targets.find(item => item.id === targetId)?.insertText ?? ''}${transition}\n`);
        break;
      }
      case "call": onInsert(`@调用：${targets.find(item => item.id === targetId)?.insertText ?? ''}\n`); break;
      case "nodeInstance": case "interactionInstance": case "minigameInstance":
        onInsert(`@${COMMANDS.find((item) => item.key === state.command)!.label}：${ref(instance)}\n`);
        break;
    }
  };

  const resourceMessage = (message: string) => <p className="text-command-empty">{message}</p>;
  return (
    <div className="text-command-picker" role="dialog" aria-label="命令参数">
      <div className="text-command-picker-header">
        <strong>设置“{COMMANDS.find((item) => item.key === state.command)?.label}”</strong>
        <button type="button" className="icon-button" aria-label="关闭参数面板" title="关闭参数面板" onClick={onCancel}><X size={15} /></button>
      </div>
      <div className="text-command-fields">
        {state.command === "background" && (images.length ? <div className="text-command-field"><span>背景图片</span><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" category="scene" label="背景图片" value={assetId} empty="选择场景图片" onChange={id => setAssetId(id ?? '')} /></div> : resourceMessage("素材库中没有图片"))}
        {(['bgm', 'sound', 'voice'] as string[]).includes(state.command) && (audio.length ? <div className="text-command-field"><span>{state.command === 'voice' ? '配音素材' : state.command === 'bgm' ? '音乐素材' : '音效素材'}</span><UiAssetSelect project={project} assetUrl={assetUrl} kind="audio" category={audioCategory} label={state.command === 'voice' ? '配音素材' : state.command === 'bgm' ? '音乐素材' : '音效素材'} value={audioId} empty="选择音频" onChange={id => setAudioId(id ?? '')} /></div> : resourceMessage("素材库中没有音频"))}
        {state.command === "stopMusic" && <NumberField label="淡出秒数" value={seconds} min={0} max={30} step={0.1} onChange={setSeconds} />}
        {(state.command === "show" || state.command === "hide" || state.command === "characterFeature") && (project.characters.length || state.command === "show" ? <>
          <SelectField label="角色" value={characterId} onChange={setCharacterId}>{state.command === "show" && <option value="">当前台词角色（自动）</option>}{project.characters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField>
          {state.command === "show" && (!characterId ? <><p className="text-command-hint">角色留空跟随当前台词。旁白及没有立绘的角色跳过。</p><label className="text-command-field"><span>表情</span><input aria-label="表情" value={expressionId} placeholder="留空使用角色默认表情" onChange={event => setExpressionId(event.target.value)} /></label></> : expressions.length ? <SelectField label="表情" value={expressionId} onChange={setExpressionId}><option value="">角色默认表情</option>{expressions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField> : resourceMessage("该角色没有表情素材"))}
          {state.command === "show" && <><div className="text-command-field"><span>站位预设</span><CharacterPresetSelect project={project} characterId={characterId} value={presetId} onChange={setPresetId} /></div>{!presetId && <><div className="text-command-inline"><NumberField label="横向位置" value={position} step={0.05} onChange={setPosition} /><NumberField label="缩放" value={scale} min={0.05} max={4} step={0.05} onChange={setScale} /><NumberField label="纵向位置" value={verticalPosition} step={0.05} onChange={setVerticalPosition} /></div><p className="text-command-hint">纵向位置以立绘底部为锚点，1 为画面底部；大于 1 可把下半身移出画面，位置也可为负数。</p></>}{presetId && <p className="text-command-hint">关联角色站位；在角色页调整预设后，所有引用同步更新。</p>}</>}
          {state.command === "characterFeature" && (features.length ? <SelectField label="角色功能" value={featureId} onChange={setFeatureId}>{features.map(feature => <option key={feature.id} value={feature.id}>{feature.name}</option>)}</SelectField> : resourceMessage("该角色尚未定义功能"))}
        </> : resourceMessage("尚未创建角色"))}
        {state.command === "effect" && (effects.length ? <SelectField label="效果实例" value={effectId} onChange={setEffectId}>{effects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField> : resourceMessage("尚未创建效果实例"))}
        {state.command === "blueprint" && <><SelectField label="通用蓝图" value={blueprintId} onChange={id => { setBlueprintId(id); setBlueprintInputs(undefined); }}>{projectGraphs(project).map(item => <option key={item.id} value={item.id}>{blueprintGroup(project, item.id) ? blueprintGroup(project, item.id) + ' / ' : ''}{item.name}</option>)}</SelectField><BlueprintCallFields project={project} graph={projectGraphs(project).find(graph => graph.id === blueprintId)} inputs={blueprintInputs} onChange={setBlueprintInputs} assetUrl={assetUrl} /></>}
        {state.command === "wait" && <NumberField label="秒数" value={seconds} min={0} max={120} step={0.1} onChange={setSeconds} />}
        {state.command === "shake" && <SelectField label="方向" value={direction} onChange={(next) => setDirection(next as typeof direction)}><option value="horizontal">横向</option><option value="vertical">纵向</option></SelectField>}
        {state.command === "camera" && <div className="text-command-grid"><NumberField label="横移" value={x} step={0.05} onChange={setX} /><NumberField label="纵移" value={y} step={0.05} onChange={setY} /><NumberField label="缩放" value={zoom} min={0.25} max={4} step={0.05} onChange={setZoom} /><NumberField label="时长" value={duration} min={0} max={60} step={0.1} onChange={setDuration} /></div>}
        {(state.command === 'camera' || state.command === 'shake') && <><label className="check-field"><input type="checkbox" checked={waitMotion} onChange={event => setWaitMotion(event.target.checked)} />等待完成</label><p className="text-command-hint">关闭等待后，后面的演出会同时开始。镜头移动与震动可以直接相接。</p></>}
        {state.command === 'camera' && <><NumberField label="旋转" value={rotation} onChange={setRotation} /><SelectField label="缓动" value={motionEasing} onChange={value => setMotionEasing(value as typeof motionEasing)}><option value="ease">缓入缓出</option><option value="linear">匀速</option><option value="easein">缓入</option><option value="easeout">缓出</option></SelectField></>}
        {state.command === 'shake' && <><NumberField label="时长" value={duration} step={0.1} onChange={setDuration} /><NumberField label="幅度（像素）" value={amplitude} onChange={setAmplitude} /></>}
        {state.command === "set" && (variables.length ? <div className="text-command-grid"><SelectField label="状态变量" value={variableId} onChange={(next) => { setVariableId(next); const variable = variables.find((item) => item.id === next); setValue(variable?.type === "boolean" ? "是" : variable?.type === "number" ? "1" : ""); if (variable?.type !== "number") setOperation("set"); }}>{variables.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField><SelectField label="操作" value={operation} onChange={(next) => setOperation(next as typeof operation)}>{selectedVariable?.type === "number" && <option value="add">增加</option>}<option value="set">设为</option></SelectField><label className="text-command-field"><span>值</span>{selectedVariable?.type === "boolean" ? <select aria-label="状态值" value={value} onChange={(event) => setValue(event.target.value)}><option value="是">是</option><option value="否">否</option></select> : <NumberInput aria-label="状态值" type={selectedVariable?.type === "number" ? "number" : "text"} value={value} onChange={(event) => setValue(event.target.value)} />}</label></div> : resourceMessage("尚未创建状态变量"))}
        {(state.command === "option" || state.command === "jump" || state.command === "call") && (targets.length ? <>
          <SelectField label="目标目录项" value={targetId} onChange={setTargetId}>{['章节', '小章节', '段落'].map(kind => <optgroup key={kind} label={kind}>{targets.filter(item => item.kind === kind).map(item => <option key={item.id} value={item.id}>{kind === '章节' ? item.label : item.detail}</option>)}</optgroup>)}</SelectField>
          {state.command === "option" && <label className="text-command-field"><span>选项文字</span><input aria-label="选项文字" value={text} placeholder="例如：一起去图书馆" onChange={(event) => setText(event.target.value)} /></label>}
          {state.command === "jump" && <>
            <SelectField label="跳转过渡" value={transitionMode} onChange={next => setTransitionMode(next as typeof transitionMode)}><option value="none">无</option><option value="dissolve">溶解</option><option value="fade">淡入淡出</option></SelectField>
            {transitionMode !== 'none' && <div className="text-command-inline"><NumberField label="过渡秒数" value={transitionSeconds} min={0} max={60} step={0.1} onChange={setTransitionSeconds} />{transitionMode === 'fade' && <label className="text-command-field"><span>过渡颜色</span><input aria-label="过渡颜色" type="color" value={transitionColor} onChange={event => setTransitionColor(event.target.value)} /></label>}</div>}
          </>}
          {state.command === "call" && <p className="text-command-hint">目标剧情用 @返回 结束；调用后可用 @跳转 指定返回后继续的位置。</p>}
        </> : resourceMessage("尚未创建可连接的目录项"))}
        {(state.command === "nodeInstance" || state.command === "interactionInstance" || state.command === "minigameInstance") && (instances.length ? <SelectField label="已有实例" value={instance?.id ?? ""} onChange={setTargetId}>{instances.map((item) => <option key={item.id} value={item.id}>{item.name} · {project.scenes.find((scene) => scene.id === item.sceneId)?.name ?? "场景"}</option>)}</SelectField> : resourceMessage("尚无可复用的实例"))}
      </div>
      <div className="text-command-picker-actions"><button type="button" className="small-button" onClick={onCancel}>取消</button><button type="button" className="primary" disabled={!canInsert} onClick={submit}><Check size={14} />插入指令</button></div>
    </div>
  );
}

interface TextViewport { start: number; end: number; top: number; left: number }
function readViewport(input: HTMLTextAreaElement): TextViewport {
  return { start: input.selectionStart, end: input.selectionEnd, top: input.scrollTop, left: input.scrollLeft };
}
function restoreViewport(input: HTMLTextAreaElement, position: TextViewport, focus = false) {
  if (focus) input.focus({ preventScroll: true });
  input.setSelectionRange(position.start, position.end);
  input.scrollTop = position.top; input.scrollLeft = position.left;
}

export function TextEditor({ project, source: storedSource, parsedResult, readTextScript: sharedReader, defaultChapterId, onChange, onStageCommit, onUndo, onRedo, canUndo, canRedo, onImport, onExport, onApply, preview, previewBusy, errors = [], onLocateDiagnostic, onOpenEntrySettings, onAuthoringEdit, onOpenBlueprint, onOpenPerformance, onNotice, assetUrl, focusSourceLine, modeControls, onSelectionChange, moduleEditor, moduleToolbar, moduleSelection, previewSuspended }: TextEditorProps) {
  const split=useStorySplit();
  const [softWrap,setSoftWrap]=useState(()=>{try{return localStorage.getItem('vns:text-soft-wrap')==='true';}catch{return false;}});
  const [localReader] = useState(createTextScriptReader);
  const readTextScript = sharedReader ?? localReader;
  const isModule = moduleEditor !== undefined;
  const [hidePerformance, setHidePerformance] = useState(() => { try { return localStorage.getItem('vns:text-hide-performance') === 'true'; } catch { return false; } });
  const [revealedSourceLine, setRevealedSourceLine] = useState<number>();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  useEffect(() => setCollapsedSections(new Set()), [project.id]);
  const parsed = useMemo(() => parsedResult ?? readTextScript(project, storedSource), [project, storedSource, parsedResult, readTextScript]);
  const chapters = useMemo(() => textChapters(storedSource, parsed.project.chapters), [storedSource, parsed.project.chapters]);
  const [chapterChoice, setChapterChoice] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(`vns:text-chapter:${project.id}`) ?? 'null'); if (typeof saved?.key === 'string' && Number.isInteger(saved.index) && saved.index >= 0) return saved as { key: string; index: number }; } catch { /* Start at the current story chapter. */ }
    const index = Math.max(0, chapters.findIndex(chapter => chapter.chapterId === (defaultChapterId ?? parsed.project.chapters[0]?.id)));
    return { key: chapters[index].key, index };
  });
  const activeChapter = selectedTextChapter(chapters, chapterChoice);
  const chapterIndex = chapters.indexOf(activeChapter);
  const range = isModule || chapterChoice.key === 'all' ? undefined : activeChapter;
  const viewRange = (source: string, candidate: Project = project) => {
    if (isModule || chapterChoice.key === 'all') return undefined;
    const sections = textChapters(source, candidate.chapters);
    return selectedTextChapter(sections, chapterChoice);
  };
  const projectedDocument = (candidate: Project, source: string, hide: boolean, revealLine?: number) => foldTextDocument(performanceTextDocument(candidate, source, hide, revealLine, viewRange(source, candidate), readTextScript), isModule ? new Set() : collapsedSections);
  const documentCache = useRef<{ source: string; document: TextDocument; sourceMap: TextParseResult['sourceMap']; hide: boolean; module: boolean; rangeStart?: number } | undefined>(undefined);
  const document = useMemo(() => {
    const cached = documentCache.current;
    // Typing ordinary prose changes one raw line but does not change its
    // references or hidden markers. Shift the existing projection instead of
    // tokenizing every line in a long chapter on every keystroke. A structural
    // edit, a new parse result, or folded/performance content falls back to the
    // complete builder below.
    if (cached && !collapsedSections.size && cached.hide === hidePerformance && cached.module === isModule && cached.sourceMap === parsed.sourceMap && cached.rangeStart === range?.start && cached.source !== storedSource) {
      const change = textEdit(cached.source, storedSource);
      const start = visibleTextOffset(cached.document, change.start), end = visibleTextOffset(cached.document, change.end);
      const patched = patchTextDocument(cached.document, storedSource, { start, end, text: change.text });
      if (patched) { documentCache.current = { source: storedSource, document: patched, hide: hidePerformance, module: isModule, sourceMap: parsed.sourceMap, rangeStart: range?.start }; return patched; }
    }
    const next = foldTextDocument(textDocument(storedSource, parsed.sourceMap, { range, performances: !isModule && hidePerformance ? performanceTextFolds(storedSource, parsed, revealedSourceLine) : [] }), isModule ? new Set() : collapsedSections);
    documentCache.current = { source: storedSource, document: next, hide: hidePerformance, module: isModule, sourceMap: parsed.sourceMap, rangeStart: range?.start };
    return next;
  }, [storedSource, parsed, hidePerformance, revealedSourceLine, isModule, range, collapsedSections]);
  const sectionFolds = useMemo(() => new Map(visibleTextSections(document, collapsedSections).map(section => [section.line, section])), [document, collapsedSections]);
  const source = document.text;
  useEffect(() => { try { localStorage.setItem(`vns:text-chapter:${project.id}`, JSON.stringify(chapterChoice)); } catch { /* Optional view preference. */ } }, [project.id, chapterChoice]);
  const chapterCounts = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const location of parsed.sourceMap) if (!location.reference && location.actionCount === undefined) {
      const section = textChapterAtLine(chapters, location.sourceLine);
      if (section) { const ids = counts.get(section.key) ?? new Set<string>(); ids.add(location.lineId); counts.set(section.key, ids); }
    }
    return counts;
  }, [chapters, parsed.sourceMap]);
  const performanceGraphs = useMemo(() => availablePerformanceBlueprints(parsed.project), [parsed.project]);
  const pickerProject = useMemo(() => (withProjectGraphs({ ...parsed.project }, performanceGraphs.filter(graph => graph.kind !== 'ui'))), [parsed.project, performanceGraphs]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; start: number; end: number }>();
  const [encapsulation, setEncapsulation] = useState<{ start: number; end: number; actions: StageAction[]; standalone: boolean }>();
  const [batch, setBatch] = useState<{ ids?: Set<string> }>();
  const [authoringMessage, setAuthoringMessage] = useState('');
  useEffect(() => { if (authoringMessage) { onNotice?.(authoringMessage); setAuthoringMessage(''); } }, [authoringMessage, onNotice]);
  const [renaming, setRenaming] = useState<{ graphId: string; mode: 'name' | 'callName' }>();
  const [collapsedCommandGroups, setCollapsedCommandGroups] = useState<Set<string>>(new Set());
  const previewSourceMap = useMemo(() => parsed.sourceMap.filter(location => textDocumentContainsLine(document, location.sourceLine)).map(location => ({ ...location, sourceLine: visibleTextLine(document, location.sourceLine) })), [parsed.sourceMap, document]);
  const previewNodeLocations = useMemo(() => parsed.nodeLocations.filter(location => textDocumentContainsLine(document, location.sourceLine)).map(location => ({ ...location, sourceLine: visibleTextLine(document, location.sourceLine) })), [parsed.nodeLocations, document]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [colorSettings, setColorSettings] = useState(false);
  const [colorfulText, setColorfulText] = useState(() => { try { return localStorage.getItem('vns:text-colorful') === 'true'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('vns:text-colorful', String(colorfulText)); } catch { /* Optional local preference. */ } }, [colorfulText]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const focusedRequest = useRef<number | undefined>(undefined);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteRange, setPaletteRange] = useState<PaletteRange>();
  const [query, setQuery] = useState("");
  const [picker, setPicker] = useState<PickerState>();
  const [cursorOffset, setCursorOffset] = useState<number>();
  const [resourceBrowsing, setResourceBrowsing] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [selectionCollapsed, setSelectionCollapsed] = useState(true);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [assistanceEnabled, setAssistanceEnabled] = useState(false);
  const clickedCommandLine = useRef<string | undefined>(undefined);
  const [explicitAssistance, setExplicitAssistance] = useState(false);
  const [dismissedAssistance, setDismissedAssistance] = useState('');
  const [completionIndex, setCompletionIndex] = useState(0);
  const assistanceKey = `${cursorOffset}:${source}`;
  const assistance = useMemo(() => !isModule && (inputFocused || resourceBrowsing) && selectionCollapsed && !composing && assistanceEnabled && !paletteOpen && dismissedAssistance !== assistanceKey ? textAssistance(parsed.project, source, cursorOffset ?? 0, explicitAssistance) : undefined, [isModule, inputFocused, resourceBrowsing, selectionCollapsed, composing, assistanceEnabled, paletteOpen, dismissedAssistance, assistanceKey, parsed.project, source, cursorOffset, explicitAssistance]);
  const completionGroups = [...new Set(assistance?.items.map(item => item.group ?? '建议') ?? [])];
  const completionItems = completionGroups.flatMap(group => !assistance?.query && collapsedCommandGroups.has(group) ? [] : assistance?.items.filter(item => (item.group ?? '建议') === group) ?? []);
  const selectedCompletion = Math.min(completionIndex, Math.max(0, completionItems.length - 1));
  const toggleCompletionGroup = (group: string) => { setCollapsedCommandGroups(previous => { const next = new Set(previous); next.has(group) ? next.delete(group) : next.add(group); return next; }); setCompletionIndex(0); };
  const [previewMode, setPreviewMode] = useState<"stage" | "structure">("stage");
  const [previewSelection, setPreviewSelection] = useState<TextPreviewSelection>();
  const positions = useRef(new Map<string, TextViewport>());
  const chapterPositions = useRef(new Map<string, TextViewport>());
  const lastPosition = useRef<TextViewport>({ start: 0, end: 0, top: 0, left: 0 });
  const palettePosition = useRef<TextViewport | undefined>(undefined);
  const focusAfterChange = useRef(false);
  const paletteSearch = useRef<HTMLInputElement>(null);
  const inputSelection = useRef<{ source: string; start: number; end: number } | undefined>(undefined);
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const findInput = useRef<HTMLInputElement>(null);
  const cursorLine = source.slice(0, cursorOffset ?? 0).split('\n').length;
  const cursorColumn = (cursorOffset ?? 0) === 0 ? 1 : (cursorOffset ?? 0) - source.lastIndexOf('\n', (cursorOffset ?? 0) - 1);
  const rememberPosition = () => {
    const input = textareaRef.current;
    if (!input) return;
    const measured = readViewport(input);
    const previous = positions.current.get(input.value) ?? lastPosition.current;
    // Updating an unfocused textarea can reset its native selection before
    // Chromium finishes updating scroll/selection events. Keep the authored
    // caret while the user is working in stage fields or the undo toolbar.
    const position = input.ownerDocument.activeElement === input ? measured : { ...measured, start: previous.start, end: previous.end };
    positions.current.set(input.value, position); lastPosition.current = position;
    chapterPositions.current.set(range?.key ?? 'all', position);
    if (positions.current.size > 64) positions.current.delete(positions.current.keys().next().value!);
  };
  const selectChapter = (key: string) => {
    rememberPosition();
    const next = chapters.find(chapter => chapter.key === key);
    const position = chapterPositions.current.get(key) ?? { start: 0, end: 0, top: 0, left: 0 };
    const nextDocument = performanceTextDocument(project, storedSource, hidePerformance, undefined, key === 'all' ? undefined : next, readTextScript);
    lastPosition.current = position; positions.current.set(nextDocument.text, position);
    setChapterChoice({ key, index: next ? chapters.indexOf(next) : chapterIndex });
    setCursorOffset(position.start); setSelectionEnd(position.end); setPreviewSelection(undefined);
    setRevealedSourceLine(undefined); setPaletteOpen(false); setPicker(undefined); setContextMenu(undefined);
  };
  const changeProjection = (hide: boolean, revealLine?: number) => {
    rememberPosition();
    const position = lastPosition.current;
    const next = projectedDocument(project, storedSource, hide, revealLine);
    const start = visibleTextOffset(next, sourceTextOffset(document, position.start));
    const end = visibleTextOffset(next, sourceTextOffset(document, position.end));
    const lineDelta = next.text.slice(0, start).split('\n').length - source.slice(0, position.start).split('\n').length;
    const lineHeight = textareaRef.current ? parseFloat(getComputedStyle(textareaRef.current).lineHeight) || 22 : 22;
    const viewport = { ...position, start, end, top: Math.max(0, position.top + lineDelta * lineHeight) };
    positions.current.set(next.text, viewport); lastPosition.current = viewport;
    setHidePerformance(hide); setRevealedSourceLine(revealLine); setCursorOffset(start);
    setPaletteOpen(false); setPicker(undefined);
    try { localStorage.setItem('vns:text-hide-performance', String(hide)); } catch { /* Optional view preference. */ }
  };
  const prepareEditedDocument = (clean: TextDocument, rawStart: number, rawEnd: number, before: TextViewport, reveal: number | undefined, focus = false) => {
    const position = { ...before, start: visibleTextOffset(clean, rawStart), end: visibleTextOffset(clean, rawEnd) };
    positions.current.set(clean.text, position); lastPosition.current = position;
    setRevealedSourceLine(reveal); setCursorOffset(position.start);
    focusAfterChange.current = focus;
    return { clean, position };
  };
  const prepareEditedSource = (nextSource: string, rawStart: number, rawEnd: number, before: TextViewport, focus = false) => {
    const line = nextSource.slice(0, rawStart).split('\n').length;
    const reveal = /^\s*[@／/]/.test(nextSource.split('\n')[line - 1] ?? '') ? line : undefined;
    return prepareEditedDocument(projectedDocument(project, nextSource, hidePerformance, reveal), rawStart, rawEnd, before, reveal, focus);
  };
  const commitStage: Commit = (label, edit) => {
    rememberPosition();
    const position = lastPosition.current;
    const result = onStageCommit?.(label, edit);
    if (!result || isModule) return;
    const next = foldTextDocument(textDocument(result.source, result.sourceMap, { range: viewRange(result.source), performances: hidePerformance ? performanceTextFolds(result.source, { ...parsed, sourceMap: result.sourceMap, issues: [] }) : [] }), collapsedSections).text;
    setRevealedSourceLine(undefined);
    const change = textEdit(source, next);
    const offset = (at: number) => at < change.start ? at : at >= change.end ? at + change.text.length - (change.end - change.start) : change.start + Math.min(at - change.start, change.text.length);
    positions.current.set(next, { ...position, start: offset(position.start), end: offset(position.end) });
  };
  useEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    const beforeInput = (event: InputEvent) => {
      rememberPosition();
      if ((event.inputType === 'historyUndo' || event.inputType === 'historyRedo') && onUndo && onRedo) {
        event.preventDefault(); focusAfterChange.current = true;
        event.inputType === 'historyUndo' ? onUndo() : onRedo();
      } else inputSelection.current = { source: input.value, start: input.selectionStart, end: input.selectionEnd };
    };
    // Use the native event so deletions, paste and IME composition all capture
    // their actual selection, including edits between identical dialogue lines.
    input.addEventListener('beforeinput', beforeInput);
    return () => input.removeEventListener('beforeinput', beforeInput);
  }, [onUndo, onRedo, isModule]);
  useLayoutEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    const position = positions.current.get(source) ?? lastPosition.current;
    restoreViewport(input, position, focusAfterChange.current);
    focusAfterChange.current = false;
    lastPosition.current = position;
    setCursorOffset(Math.min(position.start, source.length)); setSelectionEnd(Math.min(position.end, source.length));
    // Chromium can reveal the old caret after a controlled value update. Restore
    // the viewport again after that selection notification, without moving focus.
    const frame = requestAnimationFrame(() => { if (input.value === source) { input.scrollTop = position.top; input.scrollLeft = position.left; } });
    return () => cancelAnimationFrame(frame);
  }, [source, storedSource, isModule]);
  useLayoutEffect(() => { if (paletteOpen && !picker) paletteSearch.current?.focus({ preventScroll: true }); }, [paletteOpen, picker]);
  const closePalette = () => {
    setPaletteOpen(false); setPicker(undefined); setPaletteRange(undefined);
    const position = palettePosition.current;
    if (position && textareaRef.current) restoreViewport(textareaRef.current, position, true);
  };

  const focusLine = useCallback((lineNumber: number, visible = false) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const lines = source.split("\n");
    const index = Math.max(0, Math.min(lines.length - 1, (visible ? lineNumber : visibleTextLine(document, lineNumber)) - 1));
    const start = lines.slice(0, index).reduce((offset, line) => offset + line.length + 1, 0);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(start, start + lines[index].length);
    setSelectionCollapsed(!lines[index].length);
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 22;
    textarea.scrollTop = Math.max(0, textareaOffsetPoint(textarea, start).y - textarea.clientHeight / 2);
    positions.current.set(source, readViewport(textarea)); lastPosition.current = readViewport(textarea);
    setCursorOffset(start);
  }, [source, document]);
  useEffect(() => {
    if (focusSourceLine && focusedRequest.current !== focusSourceLine.request) {
      if (document.folding && document.projection[focusSourceLine.line - 1]?.hidden) { setCollapsedSections(new Set()); return; }
      const target = textChapterAtLine(chapters, focusSourceLine.line);
      if (!isModule && chapterChoice.key !== 'all' && target && target.key !== activeChapter.key) { selectChapter(target.key); return; }
      if (document.projection[focusSourceLine.line - 1]?.performance) { changeProjection(hidePerformance, focusSourceLine.line); return; }
      focusedRequest.current = focusSourceLine.request;
      focusLine(focusSourceLine.line);
    }
  }, [focusLine, focusSourceLine, document, chapters, activeChapter.key, chapterChoice.key, isModule]);

  const rows = useMemo(() => previewMode === 'structure' ? previewRows(parsed.project, range ? new Set([...previewNodeLocations, ...previewSourceMap.filter(location => !location.reference)].map(location => location.nodeId)) : undefined) : [], [previewMode, parsed.project, range, previewNodeLocations, previewSourceMap]);
  const allIssues = useMemo(() => uniqueDiagnostics([...parsed.issues, ...validateProject(parsed.project), ...errors]), [errors, parsed]);
  const issueLines = useMemo(() => {
    const lines = new Map<number, string>();
    for (const issue of allIssues) {
      const sourceLine = diagnosticSourceLine(issue, parsed);
      if (!sourceLine || !textDocumentContainsLine(document, sourceLine)) continue;
      const line = visibleTextLine(document, sourceLine);
      lines.set(line, [lines.get(line), issue.message].filter(Boolean).join('\n'));
    }
    return lines;
  }, [allIssues, document, parsed]);
  const cursorSelection = useMemo(() => {
    if (cursorOffset === undefined) return;
    let location: (typeof previewSourceMap)[number] | undefined;
    for (const candidate of previewSourceMap) { if (candidate.sourceLine > cursorLine) break; location = candidate; }
    const start = cursorOffset === 0 ? 0 : source.lastIndexOf('\n', cursorOffset - 1) + 1;
    const end = source.indexOf('\n', start);
    const reference = document.references.find(ref => ref.keepNameEdits && ref.at >= start && ref.at <= (end < 0 ? source.length : end));
    const id = reference?.text.match(/^【([^】]+)】$/)?.[1];
    let declared: (typeof previewNodeLocations)[number] | undefined;
    for (const candidate of previewNodeLocations) { if (candidate.sourceLine > cursorLine) break; declared = candidate; }
    const declaredId = declared && (!location || declared.sourceLine > location.sourceLine) ? declared.nodeId : undefined;
    const definition = parsed.project.nodes.find(node => node.id === (id || declaredId));
    const node = definition || parsed.project.nodes.find(node => node.id === location?.nodeId);
    return node ? { sceneId: node.sceneId, nodeId: node.id, lineId: definition ? undefined : location?.lineId } : undefined;
  }, [cursorOffset, cursorLine, previewSourceMap, previewNodeLocations, document, parsed.project, source]);
  const selectedDialogueIds = useMemo(() => {
    if (isModule || selectionCollapsed || selectionEnd <= (cursorOffset ?? 0)) return undefined;
    const endLine = source.slice(0, selectionEnd - 1).split('\n').length;
    return [...new Set(previewSourceMap.filter(location => !location.reference && location.sourceLine >= cursorLine && location.sourceLine <= endLine).map(location => location.lineId))];
  }, [isModule, selectionCollapsed, selectionEnd, cursorOffset, cursorLine, source, previewSourceMap]);
  useEffect(() => { if (!isModule && cursorSelection) onSelectionChange?.(cursorSelection); }, [cursorSelection, onSelectionChange, isModule]);
  useEffect(() => { setPreviewSelection(undefined); }, [cursorOffset]);

  const matches = useMemo(() => {
    const found: number[] = [];
    if (!findText) return found;
    const text = source.toLocaleLowerCase(), query = findText.toLocaleLowerCase();
    for (let at = text.indexOf(query); at >= 0; at = text.indexOf(query, at + query.length)) found.push(at);
    return found;
  }, [source, findText]);
  const focusRange = (start: number, end: number) => {
    const input = textareaRef.current;
    if (!input) return;
    input.focus({ preventScroll: true }); input.setSelectionRange(start, end);
    setSelectionCollapsed(start === end);
    const line = source.slice(0, start).split('\n').length - 1;
    const y=textareaOffsetPoint(input, start).y; if (y < input.scrollTop || y > input.scrollTop + input.clientHeight - 44) input.scrollTop = Math.max(0, y - input.clientHeight / 2);
    rememberPosition(); setCursorOffset(start);
  };
  const openFind = (replace = false) => {
    rememberPosition(); setFindOpen(true); setReplaceOpen(replace);
    const input = textareaRef.current;
    const selected = input ? source.slice(input.selectionStart, input.selectionEnd) : '';
    if (selected && !selected.includes('\n')) setFindText(selected);
    requestAnimationFrame(() => { findInput.current?.focus({ preventScroll: true }); findInput.current?.select(); });
  };
  const findNext = (backward = false) => {
    if (!matches.length) return;
    const input = textareaRef.current;
    const at = backward ? [...matches].reverse().find(at => at < (input?.selectionStart ?? 0)) ?? matches.at(-1)! : matches.find(at => at >= (input?.selectionEnd ?? 0)) ?? matches[0];
    focusRange(at, at + findText.length);
  };
  const commitEdits = (edits: TextEdit[], caret: number) => {
    if (!edits.length) return;
    const before = textareaRef.current ? readViewport(textareaRef.current) : lastPosition.current;
    positions.current.set(source, before);
    let edited = document;
    let rawCaret = 0;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
      const result = applyTextDocumentEdit(edited, edit);
      rawCaret = result.sourceOffset(caret);
      edited = projectedDocument(project, result.source, hidePerformance, result.source.slice(0, rawCaret).split('\n').length);
    }
    prepareEditedSource(edited.source, rawCaret, rawCaret, before, true);
    onChange(edited.source, true);
  };
  const commitAuthoring = (label: string, next: Project, nextSource: string, caret = lastPosition.current.start) => {
    const result = applyTextScript(next, nextSource);
    const error = result.issues.find(issue => issue.severity === 'error');
    if (error) throw new Error(`第 ${error.sourceLine} 行：${error.message}`);
    const clean = projectedDocument(next, nextSource, hidePerformance);
    setRevealedSourceLine(undefined);
    const position = { ...lastPosition.current, start: Math.min(caret, clean.text.length), end: Math.min(caret, clean.text.length) };
    positions.current.set(clean.text, position); lastPosition.current = position; focusAfterChange.current = true;
    onAuthoringEdit?.(label, result.project, nextSource);
  };
  const selectedLines = () => {
    const range = contextMenu ?? lastPosition.current;
    const first = source.slice(0, range.start).split('\n').length;
    const last = source.slice(0, Math.max(range.start, range.end - 1)).split('\n').length;
    return { range, first, last };
  };
  const encapsulate = () => {
    const { first, last } = selectedLines();
    const visibleLines = source.split('\n');
    const start = visibleLines.slice(0, first - 1).reduce((sum, line) => sum + line.length + 1, 0);
    const end = visibleLines.slice(0, last).reduce((sum, line) => sum + line.length + 1, 0) - 1;
    const rawLines = storedSource.split('\n');
    const selected = document.projection.flatMap((line, index) => !line.hidden && visibleTextLine(document, index + 1) >= first && visibleTextLine(document, index + 1) <= last ? [rawLines[index]] : []).join('\n');
    setContextMenu(undefined);
    try { setEncapsulation({ start, end, actions: performanceFromText(parsed.project, selected), standalone: /^\s*[@／/]\s*(独立演出)(?:[:：]|\s*$)/m.test(selected) }); setAuthoringMessage(''); }
    catch (error) { setAuthoringMessage(error instanceof Error ? error.message : String(error)); }
  };
  const batchSelection = () => {
    const { first, last } = selectedLines();
    const ids = new Set(previewSourceMap.filter(location => !location.reference && location.sourceLine >= first && location.sourceLine <= last).map(location => location.lineId));
    setBatch({ ids }); setContextMenu(undefined);
  };
  const blueprintAt = (at: number) => {
    const start = at ? source.lastIndexOf('\n', at - 1) + 1 : 0;
    const index = document.projection.findIndex(line => !line.hidden && line.start === start);
    if (index < 0) return;
    try { const action = textCommandAction(parsed.project, storedSource.split('\n')[index]); if (action?.kind === 'blueprint') return performanceGraphs.find(graph => graph.id === action.blueprintId); }
    catch { /* Incomplete input stays editable. */ }
  };
  const performanceAt = (at: number) => performanceTargetAt(parsed, storedSource.slice(0, sourceTextOffset(document, at)).split('\n').length);
  const openBlueprintAt = (at: number) => {
    const graph = blueprintAt(at);
    const target = performanceAt(at);
    if (target && onOpenPerformance) onOpenPerformance({ ...target, graphId: graph?.id ?? target.graphId });
    else if (graph) onOpenBlueprint?.(graph.id);
  };
  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: PointerEvent) => { if (!(event.target as Element).closest('.performance-context-menu')) setContextMenu(undefined); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setContextMenu(undefined); textareaRef.current?.focus({ preventScroll: true }); } };
    globalThis.document.addEventListener('pointerdown', close);
    globalThis.document.addEventListener('keydown', escape);
    return () => { globalThis.document.removeEventListener('pointerdown', close); globalThis.document.removeEventListener('keydown', escape); };
  }, [contextMenu]);
  const replaceMatch = (all: boolean) => {
    const input = textareaRef.current;
    const at = matches.includes(input?.selectionStart ?? -1) ? input!.selectionStart : matches.find(at => at >= (input?.selectionStart ?? 0)) ?? matches[0];
    if (at === undefined) return;
    commitEdits((all ? matches : [at]).map(start => ({ start, end: start + findText.length, text: replaceText })), (all ? matches[0] : at) + replaceText.length);
  };
  const complete = (item: TextCompletion) => {
    if (!assistance) return;
    const start = item.replaceStart ?? assistance.start, end = item.replaceEnd ?? assistance.end;
    commitEdits([{ start, end, text: item.insertText }], start + (item.caretOffset ?? item.insertText.length));
    setCompletionIndex(0); setExplicitAssistance(!!item.openParameters); setSelectionCollapsed(true); setInputFocused(true);
  };

  const insertText = useCallback((text: string) => {
    const textarea = textareaRef.current;
    let start = textarea?.selectionStart ?? source.length;
    let end = textarea?.selectionEnd ?? start;
    if (paletteRange) {
      start = paletteRange.start;
      end = paletteRange.end;
    }
    const prefix = source.slice(0, start);
    const suffix = source.slice(end);
    const inlinePrefix = prefix.slice(prefix.lastIndexOf("\n") + 1).trim().length > 0;
    let insertion = `${inlinePrefix ? "\n" : ""}${text}`;
    if (!insertion.endsWith("\n") && suffix && !suffix.startsWith("\n")) insertion += "\n";
    if (insertion.endsWith("\n") && suffix.startsWith("\n")) insertion = insertion.slice(0, -1);
    const before = palettePosition.current ?? (textarea ? readViewport(textarea) : lastPosition.current);
    positions.current.set(source, before);
    const result = applyTextDocumentEdit(document, { start, end, text: insertion });
    const nextSource = result.source;
    const rawCaret = result.sourceOffset(start + insertion.length);
    const { position: { start: caret } } = prepareEditedSource(nextSource, rawCaret, rawCaret, before, true);
    if (onAuthoringEdit) {
      const action = textCommandAction(pickerProject, text.trim());
      const graph = action?.kind === 'blueprint' ? performanceGraphs.find(graph => graph.id === action.blueprintId) : undefined;
      if (graph && !projectGraphs(project).some(item => item.id === graph.id)) {
        const next = structuredClone(parsed.project); installPerformanceBlueprint(next, graph); assignBlueprintGroup(next, graph.id, '演出 / 角色');
        commitAuthoring('插入内置演出蓝图', next, nextSource, caret);
      } else onChange(nextSource, true);
    } else onChange(nextSource, true);
    setPaletteOpen(false);
    setPicker(undefined);
    setPaletteRange(undefined);
    setCursorOffset(caret);
  }, [onChange, paletteRange, source, document, onAuthoringEdit, pickerProject, performanceGraphs, project, parsed, hidePerformance]);

  const onTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setAssistanceEnabled(true); setExplicitAssistance(false); setDismissedAssistance(''); setCompletionIndex(0);
    const entered = event.target.value;
    const selection = inputSelection.current?.source === source ? inputSelection.current : undefined;
    inputSelection.current = undefined;
    const change = textEdit(source, entered, selection);
    const result = applyTextDocumentEdit(document, change);
    const rawStart = result.sourceOffset(event.target.selectionStart), rawEnd = result.sourceOffset(event.target.selectionEnd);
    const line = result.source.slice(0, rawStart).split('\n').length;
    const reveal = /^\s*[@／/]/.test(result.source.split('\n')[line - 1] ?? '') ? line : undefined;
    // A normal character edit keeps the same visible line and hidden anchors.
    // Patch that projection in place so typing near the end of a large script
    // does not parse every preceding dialogue on every keystroke. Structural
    // edits and command/reference changes return undefined and use the full
    // projection builder below.
    const patched = patchTextDocument(document, result.source, change);
    const { clean, position } = patched
      ? prepareEditedDocument(patched, rawStart, rawEnd, readViewport(event.target), reveal)
      : prepareEditedSource(result.source, rawStart, rawEnd, readViewport(event.target));
    const next = clean.text;
    onChange(result.source);
    const caret = position.start;
    setCursorOffset(caret);
    const lineStart = next.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
    const slash = Math.max(next.lastIndexOf("/", Math.max(0, caret - 1)), next.lastIndexOf("／", Math.max(0, caret - 1)));
    if (slash >= lineStart && !next.slice(slash, caret).includes("\n")) {
      palettePosition.current = readViewport(event.target);
      setPaletteRange({ start: slash, end: caret });
      setPaletteOpen(true);
      setPicker(undefined);
      setQuery(next.slice(slash + 1, caret));
    } else if (paletteOpen) {
      setPaletteOpen(false);
      setPicker(undefined);
    }
  };

  const onTextKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || composing) return;
    if ((event.ctrlKey || event.metaKey) && event.code === 'Space') { event.preventDefault(); event.stopPropagation(); setAssistanceEnabled(true); setExplicitAssistance(true); setDismissedAssistance(''); setCompletionIndex(0); return; }
    if (completionItems.length && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setCompletionIndex(moveMenuIndex(selectedCompletion, event.key === 'ArrowDown' ? 1 : -1, completionItems.length)); return; }
      if ((event.key === 'Enter' || event.key === 'Tab' || event.code === 'Space') && !event.shiftKey) { event.preventDefault(); complete(completionItems[selectedCompletion]); return; }
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && ['f', 'h'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation(); openFind(event.key.toLowerCase() === 'h'); return;
    }
    if (event.key === 'F3') { event.preventDefault(); findNext(event.shiftKey); return; }
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const input = event.currentTarget, start = input.selectionStart, end = input.selectionEnd;
      if (start === end && !event.shiftKey) commitEdits([{ start, end, text: '  ' }], start + 2);
      else {
        const first = start === 0 ? 0 : source.lastIndexOf('\n', start - 1) + 1;
        const edits: TextEdit[] = [];
        for (let at = first; at <= end; ) {
          const remove = event.shiftKey ? (source.slice(at).match(/^(?: {1,2}|\t)/)?.[0].length ?? 0) : 0;
          if (!event.shiftKey || remove) edits.push({ start: at, end: at + remove, text: event.shiftKey ? '' : '  ' });
          const next = source.indexOf('\n', at); if (next < 0 || next + 1 >= end) break; at = next + 1;
        }
        const firstEdit = edits.find(edit => edit.start === first);
        commitEdits(edits, Math.max(first, start + (event.shiftKey ? -(firstEdit ? firstEdit.end - firstEdit.start : 0) : 2)));
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.nativeEvent.isComposing && ['z', 'y'].includes(event.key.toLowerCase()) && onUndo && onRedo) {
      event.preventDefault(); event.stopPropagation(); rememberPosition(); focusAfterChange.current = true;
      setAssistanceEnabled(false);
      setPaletteOpen(false); setPicker(undefined);
      if (event.key.toLowerCase() === 'y' || event.shiftKey) onRedo(); else onUndo();
      return;
    }
    if (event.key === "Escape") {
      setDismissedAssistance(assistanceKey); setExplicitAssistance(false);
      setPaletteOpen(false);
      setPicker(undefined);
    }
  };

  const triggerImport = () => {
    if (onImport) {
      void onImport();
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleLocalFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (onImport) {
      await onImport(file);
      return;
    }
    onChange(await file.text());
  };

  return (
    <div className="text-editor-view" data-chapter-key={range?.key ?? 'all'}>
      <div className="text-editor-toolbar">
        {modeControls ?? <div className="text-editor-heading"><FileText size={17} /><h2>文本编辑</h2></div>}
        {isModule ? moduleToolbar : <div className="spacer" />}
        <button type="button" className="icon-button" title="撤销文本修改（Ctrl+Z）" aria-label="撤销文本修改" disabled={!canUndo} onClick={onUndo}><Undo2 size={15} /></button>
        <button type="button" className="icon-button" title="重做文本修改（Ctrl+Y / Ctrl+Shift+Z）" aria-label="重做文本修改" disabled={!canRedo} onClick={onRedo}><Redo2 size={15} /></button>
        {onAuthoringEdit && <button className="small-button" onClick={() => { rememberPosition(); setBatch({ ids: range ? chapterCounts.get(range.key) ?? new Set() : undefined }); }}><Sparkles size={14} />批量演出</button>}
        <ToolbarMenu label="文本文件">
          <button type="button" className="small-button" onClick={triggerImport}><Upload size={14} />导入文本</button>
          {onExport && <button type="button" className="small-button" onClick={onExport}><Download size={14} />导出文本</button>}
        </ToolbarMenu>
        {!isModule && <>
        <input ref={fileInputRef} className="visually-hidden" type="file" accept=".docx,.txt,.md,.vns,text/plain" onChange={handleLocalFile} />
        </>}
        {!isModule && <button type="button" className="primary" onClick={() => void onApply(parsed, storedSource)}><Check size={14} />应用到项目</button>}
      </div>
      <div className="text-editor-layout" ref={split.root} style={split.style}>
        <section className="text-source-panel">
          <div className="text-panel-heading"><strong>{isModule ? '对白与演出' : '剧情脚本'}</strong>{!isModule && <button type="button" className="small-button" aria-pressed={softWrap} title="只改变显示换行，不修改剧本内容" onClick={()=>{setSoftWrap(value=>{const next=!value;try{localStorage.setItem('vns:text-soft-wrap',String(next));}catch{}return next;});if(textareaRef.current)textareaRef.current.scrollLeft=0;}}>自动换行</button>}{!isModule && <button type="button" className={`small-button hide-performance-toggle ${hidePerformance ? 'active' : ''}`} aria-pressed={hidePerformance} title="在正文中隐藏演出指令，在预览下方编辑所选段落的演出" onClick={() => changeProjection(!hidePerformance)}><EyeOff size={14} />隐藏演出</button>}<button type="button" className="small-button" aria-pressed={colorfulText} title="为章节标题、演出指令和不同发言人的台词着色" onClick={() => setColorfulText(value => !value)}>彩色标注</button><button type="button" className="icon-button" aria-label="文本配色设置" title="文本配色设置" onClick={() => setColorSettings(true)}><Settings2 size={15} /></button>{colorSettings && <TextColorSettings source={source} onClose={() => setColorSettings(false)} />}<span>{isModule ? '点击演出模块编辑参数' : source.split('\n').length + ' 行'}</span><div className="spacer" />{onOpenEntrySettings && <button type="button" className="story-entry-link" title="新游戏从故事入口开始。点击可更换入口，并查看它与 @开始 的区别。" onClick={onOpenEntrySettings}><Play size={12} /><span>故事入口：{parsed.project.nodes.find(node => node.id === parsed.project.entryId)?.name ?? '未设置'}</span></button>}{!isModule && <><button type="button" className="icon-button" aria-label="查找文本" title="查找（Ctrl+F）" onClick={() => openFind()}><Search size={14} /></button><button type="button" className="icon-button" aria-label="替换文本" title="替换（Ctrl+H）" onClick={() => openFind(true)}><Replace size={14} /></button></>}</div>
          {isModule ? <>{moduleEditor}</> : <>
          {findOpen && <div className="text-find-panel" role="search" aria-label="查找和替换" onKeyDown={event => { if (event.key === 'Escape') { setFindOpen(false); textareaRef.current?.focus({ preventScroll: true }); } }}>
            <div className="text-find-row"><input ref={findInput} aria-label="查找内容" value={findText} placeholder="查找…" onChange={event => setFindText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); findNext(event.shiftKey); } }} /><small>{matches.length} 处</small><button type="button" className="icon-button" aria-label="上一个匹配" disabled={!matches.length} onClick={() => findNext(true)}><ArrowUp size={14} /></button><button type="button" className="icon-button" aria-label="下一个匹配" disabled={!matches.length} onClick={() => findNext()}><ArrowDown size={14} /></button><button type="button" className="icon-button" aria-label="关闭查找" onClick={() => setFindOpen(false)}><X size={14} /></button></div>
            {replaceOpen && <div className="text-find-row"><input aria-label="替换为" value={replaceText} placeholder="替换为…" onChange={event => setReplaceText(event.target.value)} /><button type="button" className="small-button" disabled={!matches.length} onClick={() => replaceMatch(false)}>替换</button><button type="button" className="small-button" disabled={!matches.length} onClick={() => replaceMatch(true)}>全部替换</button></div>}
          </div>}
          <div className="text-editor-input-wrap">
            <TextCodeSurface softWrap={softWrap} colorful={colorfulText} source={source} inputRef={textareaRef} cursorLine={cursorLine} issues={issueLines} onLine={line => focusLine(line, true)} folds={sectionFolds} onFold={key => {
              rememberPosition();
              const next = new Set(collapsedSections); if (next.has(key)) next.delete(key); else next.add(key);
              const base = document.folding?.document ?? document;
              const projected = foldTextDocument(base, next);
              const previous = lastPosition.current;
              const mapCaret = (offset: number) => {
                const raw = sourceTextOffset(document, offset), baseOffset = visibleTextOffset(base, raw);
                const hidden = projected.folding?.ranges.find(range => baseOffset >= range.start && baseOffset < range.end);
                return hidden ? Math.max(0, visibleTextOffset(projected, sourceTextOffset(base, hidden.start)) - 1) : visibleTextOffset(projected, raw);
              };
              const start = mapCaret(previous.start), end = mapCaret(previous.end);
              const position = { ...previous, start, end };
              positions.current.set(projected.text, position); lastPosition.current = position;
              setCursorOffset(start); setSelectionEnd(end); setCollapsedSections(next);
            }}>
              <textarea ref={textareaRef} className="text-source-input" value={source} wrap={softWrap ? "soft" : "off"} onContextMenu={event => { event.preventDefault(); rememberPosition(); setPaletteOpen(false); setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 250), y: Math.min(event.clientY, window.innerHeight - 360), start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }); }} onPointerDown={() => { setAssistanceEnabled(false); setExplicitAssistance(false); }} onClick={event => {
                const input = event.currentTarget;
                if (event.ctrlKey || event.metaKey) { openBlueprintAt(input.selectionStart); return; }
                const line = input.value.slice(0, input.selectionStart).split('\n').length;
                const key = range?.key + ':' + line + ':' + input.value.split('\n')[line - 1];
                const repeated = clickedCommandLine.current === key && input.selectionStart === input.selectionEnd;
                clickedCommandLine.current = key;
                setAssistanceEnabled(repeated); setDismissedAssistance('');
              }} onChange={onTextChange} onKeyDown={onTextKeyDown} onScroll={rememberPosition} onFocus={() => setInputFocused(true)} onBlur={() => { rememberPosition(); setInputFocused(false); clickedCommandLine.current = undefined; }} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => { setComposing(false); setAssistanceEnabled(true); }} onSelect={(event) => { if (event.currentTarget.ownerDocument.activeElement !== event.currentTarget) return; setCursorOffset(event.currentTarget.selectionStart); setSelectionEnd(event.currentTarget.selectionEnd); setSelectionCollapsed(event.currentTarget.selectionStart === event.currentTarget.selectionEnd); setPreviewSelection(undefined); rememberPosition(); }} spellCheck={false} aria-label="中文文本剧本" aria-autocomplete="list" aria-controls={assistance?.items.length ? 'text-completion-list' : undefined} aria-activedescendant={assistance?.items.length ? `text-completion-${selectedCompletion}` : undefined} placeholder={'# 章节：第一章\n# 小章节：开场\n# 段落：相遇\n\n@背景：校园.png\n旁白：故事从这里开始。\n'} />
            </TextCodeSurface>
            {paletteOpen && !picker && <NodePicker x={0} y={0} embedded closeOnChoose={false} initialQuery={query} title="插入指令" onClose={closePalette} items={[
              ...COMMANDS.filter(item => item.key !== "characterFeature" || project.characters.some(c => effectiveCharacter(project, c.id)?.features?.length)).map(item => ({ id: item.key, name: item.label, hint: item.description, category: commandGroup(item.label), choose: () => item.needsPicker ? setPicker({ command: item.key, range: paletteRange ?? { start: source.length, end: source.length } }) : insertText(`@${item.label}${item.argumentless ? '' : '：'}\n`) })),
              ...commandPerformanceBlueprints(parsed.project).map(graph => ({ id: graph.id, name: blueprintCallName(graph), hint: `${graph.exposedInputs.length} 个输入`, category: blueprintGroup(project, graph.id) || (projectGraphs(project).some(item => item.id === graph.id) ? '未分组蓝图' : '内置演出'), choose: () => graph.exposedInputs.length ? setPicker({ command: 'blueprint', blueprintId: graph.id, range: paletteRange ?? { start: source.length, end: source.length } }) : insertText(actionText(pickerProject, { kind: 'blueprint', blueprintId: graph.id }) + '\n') })),
            ].sort((a, b) => Number(b.category === '基础') - Number(a.category === '基础'))} />}
            {paletteOpen && picker && (['displayImage', 'displayVideo', 'displayText', 'hideVisual'].includes(picker.command) ? <MediaCommandPicker key={picker.command} project={pickerProject} content={picker.command === 'displayImage' ? 'image' : picker.command === 'displayVideo' ? 'video' : picker.command === 'displayText' ? 'text' : 'hide'} assetUrl={assetUrl ?? (id => project.assets.find(asset => asset.id === id)?.path)} onInsert={insertText} onCancel={closePalette} /> : <CommandPicker key={`${picker.command}/${picker.blueprintId ?? ''}`} project={pickerProject} state={picker} assetUrl={assetUrl ?? (id => project.assets.find(asset => asset.id === id)?.path)} onInsert={insertText} onCancel={closePalette} />)}
            {assistance && (assistance.signature || assistance.items.length > 0) && <TextAssistance onBrowseChange={setResourceBrowsing} project={parsed.project} assistance={assistance} input={textareaRef} selected={selectedCompletion} onSelect={complete} visibleItems={completionItems} collapsed={collapsedCommandGroups} onToggleGroup={toggleCompletionGroup} onMove={direction => setCompletionIndex(moveMenuIndex(selectedCompletion, direction, completionItems.length))} assetUrl={assetUrl ?? (id => project.assets.find(asset => asset.id === id)?.path)} />}
          </div>
          <div className="text-source-help"><span>行 {cursorLine}，列 {cursorColumn} · Ctrl+F 查找 · Ctrl+Z 撤销 · Ctrl+滚轮 缩放</span><span>Ctrl+点击 查看蓝图 · / 插入</span></div>
          </>}
        </section>
        {split.divider}
        <section className="text-preview-panel">
          <TextPreview allowSuspend={!isModule} onNotice={onNotice} performanceContent={onStageCommit ? (active, select, following, liveProject, liveCommit) => parsed.issues.some(issue => issue.severity === 'error') ? <section className="passage-performances"><h3>演出设置</h3><p role="status" className="muted">文本中有未完成或无效的指令。修正后即可编辑当前台词的演出设置。</p></section> : <PassagePerformances selectedLineIds={following && active.nodeId === cursorSelection?.nodeId ? selectedDialogueIds : undefined} key={active.nodeId} project={liveProject} nodeId={active.nodeId} lineId={active.lineId} commit={liveCommit ?? commitStage} assetUrl={assetUrl ?? (id => project.assets.find(asset => asset.id === id)?.path)} select={select} openBlueprint={onOpenBlueprint} openPerformance={onOpenPerformance} /> : undefined} commit={onStageCommit ? commitStage : undefined} editDisabled={parsed.issues.some(issue => issue.severity === 'error') ? '文本中有未完成或无效的指令，修正后可编辑舞台。' : undefined} nodeSelection={isModule ? moduleSelection?.nodeId : cursorSelection?.nodeId} suspended={previewSuspended} project={isModule ? project : parsed.project} source={source} sourceMap={previewSourceMap} cursorOffset={isModule ? undefined : cursorOffset} selection={moduleSelection ?? previewSelection} assetUrl={assetUrl ?? ((id) => project.assets.find((asset) => asset.id === id)?.path)} headerActions={<div className="segmented text-preview-modes"><button type="button" className={previewMode === 'stage' ? 'active' : ''} onClick={() => setPreviewMode('stage')}>画面</button><button type="button" className={previewMode === 'structure' ? 'active' : ''} onClick={() => setPreviewMode('structure')}>结构</button></div>} alternateContent={previewMode === 'structure' ? <div className="text-preview-scroll">
            <TextStructure key={range?.key ?? 'all'} rows={rows} onSelect={row => { if (row.nodeId && row.lineId) { setPreviewSelection({ nodeId: row.nodeId, lineId: row.lineId }); setPreviewMode('stage'); } }} />
          </div> : undefined} />
        </section>
      </div>
      {contextMenu && createPortal(<div className="performance-context-menu" role="menu" aria-label="文本编辑菜单" style={{ left: Math.max(8, contextMenu.x), top: Math.max(8, contextMenu.y) }} onKeyDown={event => { if (event.key === 'Escape') setContextMenu(undefined); }}>
        <button role="menuitem" disabled={!canUndo} onClick={() => { setContextMenu(undefined); onUndo?.(); }}>撤销</button><button role="menuitem" disabled={!canRedo} onClick={() => { setContextMenu(undefined); onRedo?.(); }}>重做</button>
        <button role="menuitem" disabled={contextMenu.start === contextMenu.end} onClick={() => { void navigator.clipboard.writeText(source.slice(contextMenu.start, contextMenu.end)).catch(() => setAuthoringMessage('复制失败，请用 Ctrl+C 复制选中的内容。')); setContextMenu(undefined); }}>复制</button>
        <button role="menuitem" disabled={contextMenu.start === contextMenu.end} onClick={() => { const range = contextMenu; void navigator.clipboard.writeText(source.slice(range.start, range.end)).then(() => commitEdits([{ start: range.start, end: range.end, text: '' }], range.start)).catch(() => setAuthoringMessage('剪切失败，原文已保留。请用 Ctrl+X 重试。')); setContextMenu(undefined); }}>剪切</button>
        <button role="menuitem" onClick={() => { const range = contextMenu; setContextMenu(undefined); void navigator.clipboard.readText().then(text => commitEdits([{ start: range.start, end: range.end, text }], range.start + textDocument(text).text.length)).catch(() => setAuthoringMessage('请用 Ctrl+V 粘贴剪贴板内容。')); }}>粘贴</button><hr />
        {(['name', 'callName'] as const).map(mode => <button role="menuitem" key={mode} disabled={!onAuthoringEdit || !blueprintAt(contextMenu.start)} onClick={() => { const graph = blueprintAt(contextMenu.start); if (graph) setRenaming({ graphId: graph.id, mode }); setContextMenu(undefined); }}>{mode === 'name' ? '修改蓝图名称…' : '修改调用名称…'}</button>)}<hr />
        <button role="menuitem" disabled={!onAuthoringEdit || contextMenu.start === contextMenu.end} onClick={encapsulate}>封装选中演出为蓝图…</button>
        <button role="menuitem" disabled={!onOpenPerformance || !performanceAt(contextMenu.start)} onClick={() => { openBlueprintAt(contextMenu.start); setContextMenu(undefined); }}><Clapperboard size={14} />在蓝图中编辑演出…</button>
        <button role="menuitem" disabled={!onAuthoringEdit} onClick={batchSelection}>为选中台词添加演出…</button>
        <button role="menuitem" disabled={!onAuthoringEdit} onClick={() => { setContextMenu(undefined); setBatch({ ids: range ? chapterCounts.get(range.key) ?? new Set() : undefined }); }}>{range ? '为本章台词添加演出…' : '为全部台词添加演出…'}</button>
      </div>, globalThis.document.body)}
      {renaming && performanceGraphs.find(graph => graph.id === renaming.graphId) && <BlueprintRenameDialog project={{ ...parsed.project, scriptText: currentScriptText(storedSource, project.scriptText?.sourceName) }} graph={performanceGraphs.find(graph => graph.id === renaming.graphId)!} mode={renaming.mode} onClose={() => setRenaming(undefined)} onApply={next => {
        const nextSource = next.scriptText!.content, clean = projectedDocument(next, nextSource, hidePerformance);
        positions.current.set(clean.text, { ...lastPosition.current, start: Math.min(lastPosition.current.start, clean.text.length), end: Math.min(lastPosition.current.end, clean.text.length) }); focusAfterChange.current = true;
        onAuthoringEdit?.(renaming.mode === 'name' ? '修改蓝图名称' : '修改调用名称', next, nextSource); setAuthoringMessage('名称及已有调用已同步更新，可一次撤销。');
      }} />}
      {encapsulation && <EncapsulatePerformance project={parsed.project} actions={encapsulation.actions} assetUrl={assetUrl ?? (id => project.assets.find(asset => asset.id === id)?.path)} onClose={() => setEncapsulation(undefined)} onCreate={(graph, group) => {
        graph.performanceKind = encapsulation.standalone ? 'standalone' : 'dialogue';
        const next = structuredClone(parsed.project); installPerformanceBlueprint(next, graph); assignBlueprintGroup(next, graph.id, group);
        const moduleName = source.slice(encapsulation.start, encapsulation.end).match(/@独立演出\s*[:：]\s*([^\n]+)/)?.[1] ?? graph.name;
        const replacement = actionText(next, { kind: 'blueprint', blueprintId: graph.id }) + (encapsulation.standalone ? `\n@独立演出：${moduleName}` : '');
        const nextSource = editTextDocument(document, { start: encapsulation.start, end: encapsulation.end, text: replacement });
        commitAuthoring('封装演出为蓝图', next, nextSource, encapsulation.start + textDocument(replacement).text.length);
        setEncapsulation(undefined); setAuthoringMessage(`已封装“${graph.name}”，可通过 / 调用，Ctrl+点击蓝图指令进入编辑。`);
      }} />}
      {batch && <BatchPerformance project={isModule ? project : parsed.project} selectedIds={batch.ids} assetUrl={assetUrl ?? (id => project.assets.find(asset => asset.id === id)?.path)} onClose={() => setBatch(undefined)} onApply={(action, narration, graph) => {
        try {
          const next = structuredClone(isModule ? project : parsed.project); if (graph) { installPerformanceBlueprint(next, graph); if (!projectGraphs(project).some(item => item.id === graph.id)) assignBlueprintGroup(next, graph.id, '演出 / 角色'); }
          const count = addPerformanceToLines(next, action, batch.ids, narration);
          commitAuthoring('批量添加台词演出', next, projectToText(next)); setBatch(undefined); setAuthoringMessage(`已为 ${count} 句台词添加演出，可一次撤销。`);
        } catch (error) { setAuthoringMessage(error instanceof Error ? error.message : String(error)); }
      }} />}
    </div>
  );
}

export default TextEditor;
