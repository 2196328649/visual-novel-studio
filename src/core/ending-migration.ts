import { projectGraphs, addProjectGraphs } from './project-resources';
import { makeId, type Project, type StageAction, type StoryNode } from './model';
import { createEndingPerformance, endingPerformanceId } from './builtin-performances';
import { availableBlueprintName, blueprintCallName } from './blueprint-names';

type EndingBase = Pick<StoryNode, 'id' | 'sceneId' | 'name' | 'x' | 'y' | 'textHeading'>;
type OldEnding = EndingBase & { kind: 'end'; text?: string; mode?: 'caption' | 'title'; unlockIds?: string[] };

function uniqueId(seed: string, ids: Set<string>) {
  let id = seed.slice(0, 60), suffix = 1;
  while (ids.has(id)) id = seed.slice(0, 52) + '_' + suffix++;
  ids.add(id); return id;
}

export function ensureEndingPerformance(project: Project) {
  const existing = projectGraphs(project).find(graph => graph.id === endingPerformanceId && graph.exposedInputs.some(pin => pin.id === 'caption'));
  if (existing) return existing;
  const graph = createEndingPerformance();
  if (projectGraphs(project).some(item => item.id === graph.id)) graph.id = makeId('ending');
  graph.name = graph.callName = availableBlueprintName(project, graph.name);
  addProjectGraphs(project, graph); return graph;
}

/** New stories and imported endings share the ordinary performance authoring path. */
export function endingPerformanceNodes(project: Project, base: EndingBase, caption?: string, unlockIds: string[] = [], reservedIds?: Set<string>): StoryNode[] {
  const ids = reservedIds ?? new Set(project.nodes.flatMap(node => [node.id, ...(node.kind === 'passage' ? node.lines.map(line => line.id) : [])]));
  const returnId = uniqueId(base.id + '_return_title', ids);
  const actions: StageAction[] = [...new Set(unlockIds)].map(assetId => ({ kind: 'unlock', assetId }));
  if (caption !== undefined) actions.push({ kind: 'blueprint', blueprintId: ensureEndingPerformance(project).id, inputs: { caption: caption || '全剧终' } });
  return [
    { ...base, kind: 'passage', next: returnId, lines: [{ id: uniqueId(base.id + '_performance', ids), text: '', silent: true, actions }] },
    { ...base, id: returnId, name: '返回标题界面', kind: 'end', x: base.x + 340, textHeading: false },
  ];
}

/** Read old fields before the current schema strips them; never regenerate a text draft. */
export function migrateLegacyEndings(project: Project, input: unknown): boolean {
  const source = input as { nodes?: unknown[] };
  const old = new Map<string, OldEnding>();
  for (const raw of source.nodes ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as OldEnding;
    if (node.kind !== 'end' || !['text', 'mode', 'unlockIds'].some(key => Object.hasOwn(node, key))) continue;
    if (node.text !== undefined && typeof node.text !== 'string' || node.mode !== undefined && !['title', 'caption'].includes(node.mode) || node.unlockIds !== undefined && (!Array.isArray(node.unlockIds) || node.unlockIds.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(id)))) throw new Error('旧结局数据无效，原文件已保留。');
    old.set(node.id, node);
  }
  const converted = new Map<string, Extract<StoryNode, { kind: 'passage' }>>();
  const reservedIds = new Set(project.nodes.flatMap(node => [node.id, ...(node.kind === 'passage' ? node.lines.map(line => line.id) : [])]));
  project.nodes = project.nodes.flatMap(node => {
    const previous = old.get(node.id);
    if (node.kind !== 'end' || !previous) return [node];
    if (previous.mode === 'title' && !previous.unlockIds?.length) return [node];
    const nodes = endingPerformanceNodes(project, node, previous.mode === 'title' ? undefined : previous.text ?? '全剧终', previous.unlockIds, reservedIds);
    converted.set(node.id, nodes[0] as Extract<StoryNode, { kind: 'passage' }>); return nodes;
  });
  const script = project.scriptText;
  if (!script || !/^\s*[@／/]\s*(?:结局(?:\s*[:：]|\s*$)|解锁[cC][gG]\s*[:：])/m.test(script.content)) return old.size > 0;
  const newline = script.content.includes('\r\n') ? '\r\n' : '\n';
  const output: string[] = [], used = new Set<string>();
  let anchor: string | undefined;
  let pending: { lines: string[]; unlocks: string[]; trailing: string[]; indent: string } | undefined;
  const flush = () => { if (pending) output.push(...pending.unlocks, ...pending.lines, ...pending.trailing); pending = undefined; };
  for (const line of script.content.split(/\r?\n/)) {
    const unlock = line.match(/^(\s*)[@／/]\s*解锁[cC][gG]\s*[:：]\s*(.*)$/);
    if (unlock) {
      const replacement = unlock[1] + '@解锁素材：' + unlock[2];
      if (pending) pending.unlocks.push(replacement); else output.push(replacement);
      continue;
    }
    if (pending && (!line.trim() || /^\s*\/\//.test(line))) { pending.trailing.push(line); continue; }
    flush();
    const marker = line.match(/^(?:\s*#段落|\s*[@／/]\s*节点标记)\s*[:：].*【([a-z][a-z0-9_]{0,63})】\s*$/);
    if (marker) anchor = marker[1];
    const ending = line.match(/^(\s*)[@／/]\s*结局(?:\s*[:：]\s*(.*)|\s*)$/);
    const returning = line.match(/^(\s*)[@／/]\s*返回标题(?:界面)?\s*[:：]?\s*$/);
    if (!ending && !returning) { output.push(line); continue; }
    const indent = (ending ?? returning)![1];
    if (returning) { pending = { lines: [line], unlocks: [], trailing: [], indent }; continue; }
    let caption = ending![2] ?? '';
    if (caption.startsWith('"')) { try { const parsed: unknown = JSON.parse(caption); if (typeof parsed === 'string') caption = parsed; } catch { /* Preserve an unfinished draft as literal text. */ } }
    const identity = anchor && old.has(anchor) && !used.has(anchor) ? anchor : [...old.values()].find(node => node.mode !== 'title' && !used.has(node.id) && (node.text ?? '') === caption)?.id;
    if (identity) used.add(identity);
    const node = identity ? converted.get(identity) : undefined;
    const graph = ensureEndingPerformance(project);
    pending = { indent, trailing: [], unlocks: [], lines: [
      ...(node ? [indent + '@对白标记：' + node.lines[0].id] : []),
      `${indent}@${blueprintCallName(graph)}【${graph.id}】：文字【caption】=${JSON.stringify(caption || '全剧终')}`,
      `${indent}@独立演出：${node?.name ?? '结局演出'}`,
      ...(node ? [`${indent}@节点标记：返回标题界面【${node.next}】`] : []),
      indent + '@返回标题界面',
    ] };
    anchor = undefined;
  }
  flush(); script.content = output.join(newline);
  return true;
}
