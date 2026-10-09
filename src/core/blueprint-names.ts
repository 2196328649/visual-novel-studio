import { projectGraphs } from './project-resources';
import type { BlueprintGraph, Project } from './model';

/** The invocation is a human name; the serialized ID keeps existing calls bound. */
export const blueprintCallName = (graph: Pick<BlueprintGraph, 'name' | 'callName'>) => graph.callName?.trim() || graph.name;
const normalize = (name: string) => name.trim().normalize('NFKC').toLocaleLowerCase();
const referenceId = (name: string) => name.match(/【([a-z][a-z0-9_]{0,63})】\s*$/)?.[1];
export function resolveBlueprintCall(graphs: BlueprintGraph[], name: string) {
  const id = referenceId(name);
  if (id) return graphs.find(graph => graph.id === id);
  return graphs.find(graph => normalize(blueprintCallName(graph)) === normalize(name) || normalize(graph.name) === normalize(name));
}

// Engine syntax must remain unambiguous when a blueprint becomes a command.
const reserved = new Set('独立演出 播放台词演出 背景音乐 复用节点 显示角色 隐藏 隐藏角色 背景 切换背景 bgm 音乐 播放音乐 音效 播放音效 配音 停止音乐 等待 暂停 震动 镜头 效果 蓝图 通用蓝图 角色功能 角色-功能 章节演出 章节标题 章节背景 章节题图 章节音效 章节动效 入口 开始 返回 选择 选项 结局 跳转 调用 实例 节点实例 互动实例 小游戏实例 设置 条件 满足 不满足 场景基础 场景模板 场景参数 场景蓝图 界面实例 ui实例 演出实例 对白标记 节点标记 效果定义 动作 效果结束'.split(' '));
export function availableBlueprintName(project: Project, base: string): string {
  const used = new Set([...reserved, ...projectGraphs(project).flatMap(graph => [normalize(graph.name), normalize(blueprintCallName(graph))])]);
  let name = base, index = reserved.has(normalize(base)) ? 1 : 2;
  while (used.has(normalize(name))) name = `${base} ${index++}`;
  return name;
}
export function blueprintNameError(project: Project, graphId: string, name: string, callName?: string): string | undefined {
  for (const candidate of new Set([name, callName || name])) {
    if (!candidate.trim() || candidate.length > 120 || /[\r\n:：，,;；=【】@/／#]/.test(candidate)) return '名称需要 1～120 个字，不能含换行、冒号、逗号、等号或指令符号。';
    if (reserved.has(normalize(candidate))) return `“${candidate}”是基础指令，请换一个名称。`;
    if (projectGraphs(project).some(graph => graph.id !== graphId && [graph.name, blueprintCallName(graph)].some(other => normalize(other) === normalize(candidate)))) return `“${candidate}”已被其他蓝图使用。`;
  }
}

/** Rewrite command/reference fields only, never dialogue, strings or comments. */
export function renameBlueprint(project: Project, graphId: string, change: { name?: string; callName?: string }): void {
  const graph = projectGraphs(project).find(item => item.id === graphId);
  if (!graph) throw new Error('找不到这张蓝图。');
  const before = { ...graph }, name = change.name?.trim() ?? graph.name;
  const callName = change.callName === undefined ? graph.callName : change.callName.trim() || undefined;
  const error = blueprintNameError(project, graphId, name, callName);
  if (error) throw new Error(error);
  graph.name = name; graph.callName = callName;
  const call = blueprintCallName(graph), ref = `【${graph.id}】`;
  const matches = (value: string) => {
    const raw = value.trim().replace(/^(["'])(.*)\1$/, '$2');
    const id = referenceId(raw);
    return id ? id === graph.id : [before.name, blueprintCallName(before)].some(old => normalize(old) === normalize(raw));
  };
  const rewrite = (line: string): string => {
    const command = line.match(/^(\s*[@/／]\s*)([^:：]+?)(?:([:：])\s*(.*))?$/);
    if (!command) return line;
    const [, prefix, head, colon, body = ''] = command;
    if (head.trim() === '独立演出') return line;
    if (head.trim() === '动作') return `${prefix}${head}${colon ?? '：'}${rewrite(body)}`;
    if (matches(head)) return `${prefix}${call}${ref}${colon ? `${colon}${body}` : ''}`;
    if (['蓝图', '通用蓝图'].includes(head.trim())) {
      const separator = body.search(/[，,]/), target = separator < 0 ? body : body.slice(0, separator);
      if (matches(target)) return `${prefix}${call}${ref}${separator < 0 ? '' : `：${body.slice(separator + 1).trimStart()}`}`;
    }
    if (head.trim() === '场景蓝图' && matches(body)) return `${prefix}${head}${colon}${name}${ref}`;
    return line;
  };
  if (project.scriptText) project.scriptText.content = project.scriptText.content.split('\n').map(rewrite).join('\n');
  for (const effect of project.effects) effect.commands = effect.commands.map(rewrite);
  for (const owner of projectGraphs(project)) for (const node of owner.nodes) {
    if (node.type === 'sceneAction' && typeof node.properties.command === 'string') node.properties.command = node.properties.command.split('\n').map(rewrite).join('\n');
    if (['callFunction', 'callMacro'].includes(node.type) && node.properties.graphId === graph.id && [before.name, blueprintCallName(before)].includes(node.name)) node.name = name;
  }
}
