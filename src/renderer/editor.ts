import { linePreviewSnapshot } from '../core/line-preview';
import { currentScriptText } from '../core/script-text';
import { resolveShowAction } from '../core/character-presets';
import { useCallback, useRef, useState } from "react";
import {
  connectNode,
  createProject,
  effectiveScene,
  makeId,
  targets,
  type Project,
  type StoryNode,
  type StoryLine,
  type StageAction,
} from "../core/model";
import { expandStageAction } from "../core/text-script";
import { shareProjectBranches } from "../core/project-history";
import { relocateProjectAssets, type AssetRelocation } from '../core/asset-relocation';

export type Commit = (label: string, edit: (project: Project) => void, options?: { separate?: boolean }) => void;
export type EditorView = "script" | "text" | "blueprint" | "ui" | "flowchart";
export type LibraryKind = "scenes" | "assets" | "characters" | "variables";
export const nodeNames: Record<StoryNode["kind"], string> = {
  start: "流程起点",
  passage: "剧情段落",
  choice: "玩家选择",
  condition: "条件分支",
  set: "修改状态",
  jump: "跳转",
  call: "调用段落",
  return: "返回",
  end: "返回标题界面",
  chapterTitle: "独立演出",
  interaction: "点击互动",
  minigame: "小游戏",
};
export const actionNames: Record<StageAction["kind"], string> = {
  audioClip: "音频片段",
  visual: "演出对象",
  hideVisual: "隐藏对象",
  background: "切换背景",
  show: "显示角色",
  hide: "隐藏角色",
  music: "播放音乐",
  sound: "播放音效",
  unlock: "解锁素材",
  stopMusic: "停止音乐",
  pause: "等待",
  hideInterface: "隐藏界面",
  showInterface: "显示界面",
  startDialogue: "播放台词演出",
  animate: "角色动画",
  camera: "镜头",
  shake: "震动",
  effect: "演出效果",
  blueprint: "调用蓝图或时间轴",
  chapter: "章节进入演出",
  characterFeature: "角色功能",
};

export function useProjectHistory(initial?: Project) {
  const [project, setProject] = useState<Project>(
    () => initial ?? createProject(),
  );
  const [revision, setRevision] = useState(0);
  const [savedProject, setSavedProject] = useState<Project | null>(project);
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const current = useRef(project);
  const lastEdit = useRef({ label: "", time: 0 });
  const accept = useCallback((label: string, prepared: Project, options?: { separate?: boolean }) => {
    const next = shareProjectBranches(current.current, prepared);
    if (next === current.current) return current.current;
    const now = Date.now();
    if (options?.separate || lastEdit.current.label !== label || now - lastEdit.current.time > 700) {
      past.current.push(current.current);
      if (past.current.length > 100) past.current.shift();
    }
    lastEdit.current = { label: options?.separate ? '' : label, time: now };
    future.current = [];
    current.current = next;
    setProject(next);
    setRevision((r) => r + 1);
    return next;
  }, []);
  const commit = useCallback((label: string, edit: (draft: Project, before: Project) => void, options?: { separate?: boolean }) => {
    const draft = structuredClone(current.current);
    edit(draft, current.current);
    return accept(label, draft, options);
  }, [accept]);
  const commitPrepared = useCallback((label: string, prepare: (before: Project) => Project | undefined, options?: { separate?: boolean }) => {
    const prepared = prepare(current.current);
    return prepared ? accept(label, prepared, options) : current.current;
  }, [accept]);
  // Text editing only changes scriptText. Avoid cloning and recursively
  // comparing the complete project for every keystroke in a long script.
  const commitText = useCallback((label: string, content: string) => {
    const before = current.current;
    if (before.scriptText?.content === content) return before;
    const next: Project = {
      ...before,
      scriptText: currentScriptText(content, before.scriptText?.sourceName),
    };
    const now = Date.now();
    if (lastEdit.current.label !== label || now - lastEdit.current.time > 700) {
      past.current.push(before);
      if (past.current.length > 100) past.current.shift();
    }
    lastEdit.current = { label, time: now };
    future.current = [];
    current.current = next;
    setProject(next);
    setRevision((revision) => revision + 1);
    return next;
  }, []);
  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(current.current);
    current.current = previous;
    lastEdit.current = { label: "", time: 0 };
    setProject(previous);
    setRevision((r) => r + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(current.current);
    current.current = next;
    lastEdit.current = { label: "", time: 0 };
    setProject(next);
    setRevision((r) => r + 1);
  }, []);
  const reset = useCallback((next: Project, saved = true) => {
    current.current = next;
    past.current = [];
    future.current = [];
    lastEdit.current = { label: "", time: 0 };
    setProject(next);
    setRevision(0);
    setSavedProject(saved ? next : null);
  }, []);
  return {
    project,
    commit,
    commitPrepared,
    commitText,
    undo,
    redo,
    reset,
    revision,
    dirty: project !== savedProject,
    checkpoint: () => { lastEdit.current = { label: "", time: 0 }; },
    markSaved: (snapshot: Project) => setSavedProject(snapshot),
    acceptAssetRelocations: (snapshot: Project, relocations: AssetRelocation[] = []) => {
      const cache = new Map<Project, Project>();
      const remap = (value: Project) => { let next = cache.get(value); if (!next) { next = relocateProjectAssets(value, relocations); cache.set(value, next); } return next; };
      past.current = past.current.map(remap); future.current = future.current.map(remap);
      current.current = remap(current.current); setProject(current.current);
      return remap(snapshot);
    },
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

export function removeNodes(project: Project, ids: string[]) {
  const removed = new Set(ids);
  project.nodes = project.nodes
    .filter((n) => !removed.has(n.id))
    .map((node) => {
      let next = node;
      for (const edge of targets(node)) {
        if (edge.target && removed.has(edge.target)) next = connectNode(next, edge.port);
      }
      return next;
    });
}

export function findLine(
  project: Project,
  nodeId?: string,
  lineId?: string,
): StoryLine | undefined {
  const node = project.nodes.find((n) => n.id === nodeId);
  return node?.kind === "passage"
    ? (node.lines.find((l) => l.id === lineId) ?? node.lines[0])
    : undefined;
}

export function addLine(
  project: Project,
  nodeId: string,
  afterId?: string,
): string | undefined {
  const node = project.nodes.find((n) => n.id === nodeId);
  if (node?.kind !== "passage") return;
  const line: StoryLine = { id: makeId("line"), text: "", actions: [] };
  const index = afterId
    ? node.lines.findIndex((l) => l.id === afterId) + 1
    : node.lines.length;
  node.lines.splice(index, 0, line);
  return line.id;
}

export function stageAt(project: Project, nodeId?: string, lineId?: string) {
  const stage = linePreviewSnapshot(project, nodeId && lineId ? { nodeId, lineId } : undefined).after;
  return { backgroundId: stage.backgroundId, characters: stage.actors,
    characterAppearance: new Map([...stage.actors].map(([id, actor]) => [id, { rotation: actor.rotation, opacity: actor.opacity }])), camera: stage.camera };
}

export function formatCondition(
  project: Project,
  condition: import("../core/model").Condition,
): string {
  if (condition.kind === "compare") {
    const operators = {
      eq: "=",
      ne: "≠",
      gt: ">",
      gte: "≥",
      lt: "<",
      lte: "≤",
    };
    const value =
      typeof condition.value === "boolean"
        ? condition.value
          ? "是"
          : "否"
        : String(condition.value);
    return `${project.variables.find((v) => v.id === condition.variableId)?.name ?? "未选择状态"} ${operators[condition.operator]} ${value}`;
  }
  if (condition.kind === "not")
    return `不满足 (${formatCondition(project, condition.condition)})`;
  return condition.conditions.length
    ? condition.conditions
        .map((c) => formatCondition(project, c))
        .join(condition.kind === "all" ? " 且 " : " 或 ")
    : "未设置条件";
}
