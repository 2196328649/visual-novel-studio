import { targets, type Diagnostic, type Project, type StoryNode } from './model';
import { storyGroupIndex, storyGroupNodeId, storySceneNodeId, type StoryGroupIndex } from './story-groups';
import { performancePlayback } from './standalone-performance';
import { uiPage } from './ui-pages';

export type StoryGraphScope = { kind: 'game' } | { kind: 'content' } | { kind: 'scene'; sceneId: string; groupId?: string } | { kind: 'page'; pageId: string; trail?: string[] };
export const storyScopeKey = (scope: StoryGraphScope) => scope.kind === 'scene' ? 'scene:' + scope.sceneId + ':' + (scope.groupId ?? '') : scope.kind === 'page' ? 'page:' + scope.pageId : scope.kind;
export const storyContentId = 'flow:story';
export interface StoryGraphPort { id: string; label: string; nodeId?: string; port?: string; readonly?: boolean }
export interface StoryContainerView {
  id: string; kind: 'content' | 'scene' | 'group' | 'input' | 'output' | 'return' | 'missing';
  name: string; detail: string; position: { x: number; y: number }; scope?: StoryGraphScope;
  groupId?: string; targetNodeId?: string; nodeIds: ReadonlySet<string>;
  inputs: StoryGraphPort[]; outputs: StoryGraphPort[]; containsEntry: boolean; issues: Diagnostic[];
}
export interface StoryGraphWire {
  id: string; source: string; target: string; sourceHandle: string; targetHandle: string;
  label: string; caption: string; readonly: boolean;
  storySource?: string; storyPort?: string; storyTarget?: string;
}

export function storyPortLabel(node: StoryNode, port: string): string {
  if (node.kind === 'choice') return node.choices.find(choice => choice.id === port)?.text || '未命名选项';
  if (node.kind === 'interaction') {
    const hotspot = node.hotspots.find(item => item.id === port); if (hotspot) return hotspot.name || '互动区域';
  }
  if (node.kind === 'call') return port === 'target' ? '调用' : '返回后继续';
  return ({ yes: '满足', no: '不满足', success: '成功', failure: '失败', cancel: '取消', timeout: '超时', target: '前往', next: '继续', returnTitle: '返回标题', returnCall: '返回调用处' } as Record<string, string>)[port] ?? port;
}

export function storyNodeReturnsTitle(node: StoryNode, project?: Project) {
  return node.kind === 'end' || node.kind === 'chapterTitle' && node.playback?.onComplete === 'title'
    || node.kind === 'passage' && node.lines.some(line => line.silent && (project ? performancePlayback(project, line) : line.playback)?.onComplete === 'title');
}

export function storyNodeLocation(project: Project, nodeId: string, index = storyGroupIndex(project)): string {
  const node = project.nodes.find(item => item.id === nodeId), scene = project.scenes.find(item => item.id === node?.sceneId);
  return [project.chapters.find(chapter => chapter.id === scene?.chapterId)?.name, scene?.name,
    ...index.ancestors(index.nodeGroup.get(nodeId)).map(group => group.name)].filter(Boolean).join(' / ');
}

export function storyNodeScope(project: Project, nodeId: string, index = storyGroupIndex(project)): StoryGraphScope | undefined {
  const node = project.nodes.find(item => item.id === nodeId);
  return node ? { kind: 'scene', sceneId: node.sceneId, groupId: index.nodeGroup.get(node.id) } : undefined;
}

export function validStoryScope(project: Project, scope: StoryGraphScope): StoryGraphScope {
  if (scope.kind === 'page') return uiPage(project, scope.pageId) ? { ...scope, trail: scope.trail?.filter((id, i, all) => id !== scope.pageId && all.indexOf(id) === i && !!uiPage(project, id)).slice(-16) } : { kind: 'game' };
  if (scope.kind !== 'scene') return scope;
  if (!project.scenes.some(scene => scene.id === scope.sceneId)) return { kind: 'content' };
  if (scope.groupId && !project.storyGroups?.some(group => group.id === scope.groupId && group.sceneId === scope.sceneId)) return { kind: 'scene', sceneId: scope.sceneId };
  return scope;
}

export function storyScopeBreadcrumbs(project: Project, scope: StoryGraphScope, index = storyGroupIndex(project)) {
  const crumbs: { name: string; scope: StoryGraphScope }[] = [{ name: '流程图', scope: { kind: 'game' } }];
  if (scope.kind === 'game') return crumbs;
  if (scope.kind === 'page') {
    for (const [i, pageId] of [...scope.trail ?? [], scope.pageId].entries()) crumbs.push({ name: uiPage(project, pageId)?.name ?? '页面', scope: { kind: 'page', pageId, trail: scope.trail?.slice(0, i) } });
    return crumbs;
  }
  crumbs.push({ name: '游戏内容', scope: { kind: 'content' } });
  if (scope.kind === 'content') return crumbs;
  const scene = project.scenes.find(item => item.id === scope.sceneId);
  crumbs.push({ name: [project.chapters.find(chapter => chapter.id === scene?.chapterId)?.name, scene?.name].filter(Boolean).join(' / '), scope: { kind: 'scene', sceneId: scope.sceneId } });
  for (const group of index.ancestors(scope.groupId)) crumbs.push({ name: group.name, scope: { kind: 'scene', sceneId: scope.sceneId, groupId: group.id } });
  return crumbs;
}

/** A view over the real graph. Edges retain exact source/port/target IDs for edits across group boundaries. */
export function projectStoryGraph(project: Project, scope: StoryGraphScope, diagnostics: readonly Diagnostic[] = [], index: StoryGroupIndex = storyGroupIndex(project)) {
  const containers: StoryContainerView[] = [], stories: StoryNode[] = [], wires: StoryGraphWire[] = [];
  if (scope.kind === 'page') return { stories, containers, wires, owner: new Map<string, string>() };
  const nodes = new Map(project.nodes.map(node => [node.id, node]));
  const owner = new Map<string, string>(), cards = new Map<string, StoryContainerView>();
  const issues = new Map<string, Diagnostic[]>();
  for (const issue of diagnostics) if (issue.nodeId) issues.set(issue.nodeId, [...(issues.get(issue.nodeId) ?? []), issue]);
  const container = (input: Pick<StoryContainerView, 'id' | 'kind' | 'name' | 'detail' | 'position' | 'nodeIds'> & Partial<StoryContainerView>) => {
    const card: StoryContainerView = { inputs: [], outputs: [], containsEntry: input.nodeIds.has(project.entryId), issues: [...input.nodeIds].flatMap(id => issues.get(id) ?? []), ...input };
    containers.push(card); cards.set(card.id, card);
    for (const id of card.nodeIds) owner.set(id, card.id);
    return card;
  };
  if (scope.kind === 'game') {
    const card = container({ id: storyContentId, kind: 'content', name: '游戏内容',
      detail: `${project.scenes.length} 个小章节 · ${project.nodes.length} 个剧情节点`, position: { x: 700, y: 250 },
      nodeIds: new Set(nodes.keys()), scope: { kind: 'content' } });
    card.inputs.push({ id: 'in', label: '从故事入口开始', nodeId: project.entryId }, { id: 'load', label: '恢复存档位置', readonly: true });
    if (project.nodes.some(node => storyNodeReturnsTitle(node, project))) card.outputs.push({ id: 'returnTitle', label: '返回标题', readonly: true });
    return { stories, containers, wires, owner };
  }
  if (scope.kind === 'content') {
    for (const [i, scene] of project.scenes.entries()) container({
      id: storySceneNodeId(scene.id), kind: 'scene', name: scene.name,
      detail: project.chapters.find(chapter => chapter.id === scene.chapterId)?.name ?? '小章节',
      position: project.gameFlow?.positions?.[storySceneNodeId(scene.id)] ?? { x: 80 + (i % 3) * 370, y: 100 + Math.floor(i / 3) * 260 },
      nodeIds: new Set(project.nodes.filter(node => node.sceneId === scene.id).map(node => node.id)), scope: { kind: 'scene', sceneId: scene.id },
    });
  } else {
    for (const node of project.nodes) if (node.sceneId === scope.sceneId && index.nodeGroup.get(node.id) === scope.groupId) {
      stories.push(node); owner.set(node.id, node.id);
    }
    for (const group of index.children.get(scope.groupId) ?? []) if (group.sceneId === scope.sceneId) container({
      id: storyGroupNodeId(group.id), kind: 'group', name: group.name, detail: `${index.members(group.id).size} 个剧情节点 · 双击进入`,
      position: { x: group.x, y: group.y }, nodeIds: index.members(group.id), groupId: group.id,
      scope: { kind: 'scene', sceneId: scope.sceneId, groupId: group.id },
    });
  }
  const visible = [...stories.map(node => ({ x: node.x, y: node.y })), ...containers.map(card => card.position)];
  const left = visible.length ? Math.min(...visible.map(item => item.x)) : 40;
  const right = visible.length ? Math.max(...visible.map(item => item.x)) : 400;
  const top = visible.length ? Math.min(...visible.map(item => item.y)) : 100;
  let inputCount = 0, outputCount = 0;
  const reference = (nodeId: string, incoming: boolean, special?: 'title' | 'return' | 'entry'): StoryContainerView => {
    const id = `story:ref:${storyScopeKey(scope)}:${incoming ? 'in' : 'out'}:${special ?? nodeId}`;
    const old = cards.get(id); if (old) return old;
    const node = nodes.get(nodeId);
    const name = special === 'title' ? '返回标题' : special === 'return' ? '回到调用处' : special === 'entry' ? '故事入口'
      : node ? (incoming ? '来自 · ' : '前往 · ') + node.name : '目标已不存在';
    const detail = special === 'title' ? '按启动执行时机决定是否重播开场' : special === 'return' ? '目标由运行时的调用位置决定'
      : special === 'entry' ? '新游戏从这里进入' : node ? storyNodeLocation(project, nodeId, index) : nodeId;
    const card = container({ id, kind: special ? special === 'entry' ? 'input' : 'return' : !node ? 'missing' : incoming ? 'input' : 'output', name, detail,
      position: project.gameFlow?.positions?.[id] ?? { x: incoming ? left - 340 : right + 360, y: top + (incoming ? inputCount++ : outputCount++) * 155 },
      nodeIds: new Set(), targetNodeId: special ? undefined : node?.id,
      scope: special === 'title' ? { kind: 'game' } : undefined });
    if (incoming) card.outputs.push({ id: 'out', label: special === 'entry' ? '进入' : '来自外部', readonly: true });
    else card.inputs.push({ id: 'in', label: special === 'return' ? '返回' : '进入', readonly: true });
    return card;
  };
  const input = (cardId: string, target: StoryNode): string => {
    const card = cards.get(cardId); if (!card?.scope || card.kind === 'return') return 'in';
    const id = 'in:' + target.id;
    if (!card.inputs.some(port => port.id === id)) card.inputs.push({ id, label: target.name + (target.id === project.entryId ? ' · 故事入口' : ''), nodeId: target.id });
    return id;
  };
  const output = (cardId: string, node: StoryNode, port: string, readonly: boolean): string => {
    const card = cards.get(cardId); if (!card?.scope || card.kind === 'return') return cards.has(cardId) ? 'out' : port;
    const id = 'out:' + node.id + ':' + port;
    if (!card.outputs.some(item => item.id === id)) card.outputs.push({ id, label: `${node.name} · ${storyPortLabel(node, port)}`, nodeId: node.id, port, readonly });
    return id;
  };
  for (const node of project.nodes) {
    const sourceOwner = owner.get(node.id);
    const ports = storyNodeReturnsTitle(node, project) ? [{ port: 'returnTitle', target: undefined }]
      : node.kind === 'return' ? [{ port: 'returnCall', target: undefined }] : targets(node);
    for (const port of ports) {
      const special = port.port === 'returnTitle' ? 'title' : port.port === 'returnCall' ? 'return' : undefined;
      const targetNode = port.target ? nodes.get(port.target) : undefined;
      const targetOwner = targetNode ? owner.get(targetNode.id) : undefined;
      if (!sourceOwner && !targetOwner || sourceOwner && sourceOwner === targetOwner && cards.has(sourceOwner)) continue;
      if (sourceOwner && !port.target && !special) { output(sourceOwner, node, port.port, false); continue; }
      const source = sourceOwner ?? reference(node.id, true).id;
      const target = targetOwner ?? reference(port.target ?? '', false, special).id;
      const sourceHandle = sourceOwner ? output(source, node, port.port, !!special) : 'out';
      const targetHandle = targetOwner && targetNode ? input(target, targetNode) : 'in';
      const caption = storyPortLabel(node, port.port);
      wires.push({ id: node.id + ':' + port.port, source, target, sourceHandle, targetHandle,
        label: `${node.name} · ${caption} → ${special === 'title' ? '标题菜单' : special === 'return' ? '调用处（运行时决定）' : targetNode?.name ?? '目标已不存在'}`,
        caption: caption === '继续' && sourceOwner === node.id && targetOwner === targetNode?.id ? '' : caption,
        readonly: !!special, storySource: node.id, storyPort: port.port, storyTarget: port.target });
    }
  }
  const entry = nodes.get(project.entryId), entryOwner = entry && owner.get(entry.id);
  if (entry && entryOwner) {
    const source = reference(entry.id, true, 'entry');
    wires.push({ id: 'story:entry', source: source.id, sourceHandle: 'out', target: entryOwner, targetHandle: input(entryOwner, entry),
      label: '新游戏 → 故事入口 · ' + entry.name, caption: '故事入口', readonly: true, storyTarget: entry.id });
  }
  for (const card of containers) if (card.kind === 'group' || card.kind === 'scene') {
    // A choice opens an explicit target picker; never guess the first internal node.
    if ([...card.nodeIds].some(id => nodes.get(id)?.kind !== 'start')) card.inputs.push({ id: 'choose', label: '选择其他入口…' });
  }
  return { stories, containers, wires, owner };
}
