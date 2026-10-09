import { aiLines } from './ai';
import { editableProjectFields } from './ai-project-edit';
import { aiAgentFingerprint, changedDialogueCount, type AiPortraitComparison, type AiProposalField, type AiTaskOutcome, type AiWorkflowProposal } from './ai-workflow';
import { effectiveCharacter, type Project, type StoryLine } from './model';

export type AiCheckPath = (string | number | { id: string })[];
export interface AiEffect { path: AiCheckPath; value?: unknown; absent?: boolean }
export interface AiAgentTask { id: string; title: string; kind: 'change' | 'inspect' }
export interface AiToolEvidence {
  id: string; name: string; taskIds: string[]; ok: boolean; mutation: boolean;
  effects: AiEffect[]; complete: boolean; detail: string;
  /** Read assertions must still hold in the final draft. */
  checks?: AiEffect[];
}
export const aiProposalFields: readonly AiProposalField[] = [...editableProjectFields, 'scriptText'];
// JSON object key order is not part of a result's meaning; array order is.
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

export function aiValueAt(project: Project, segments: AiCheckPath): unknown {
  let value: any = project;
  for (const part of segments) {
    if (typeof part === 'string' && ['__proto__', 'prototype', 'constructor'].includes(part)) throw new Error('检查路径无效。');
    if (typeof part === 'object') value = Array.isArray(value) ? value.find(item => item?.id === part.id) : undefined;
    else value = value && Object.hasOwn(value, part) ? value[part] : undefined;
  }
  return value;
}
export function aiEffectHolds(project: Project, effect: AiEffect) {
  const value = aiValueAt(project, effect.path);
  return effect.absent ? value === undefined : same(value, effect.value);
}

/** ID-based paths keep evidence valid when another task changes a sibling object. */
export function aiProjectEffects(before: Project, after: Project): AiEffect[] {
  const changes: AiEffect[] = [];
  const walk = (old: any, next: any, path: AiCheckPath) => {
    if (same(old, next)) return;
    const idList = (value: any): value is { id: string }[] => Array.isArray(value) && value.every(item => item && typeof item.id === 'string') && new Set(value.map(item => item.id)).size === value.length;
    if (idList(old) && idList(next)) {
      const previous = new Map(old.map(item => [item.id, item]));
      for (const item of next) { walk(previous.get(item.id), item, [...path, { id: item.id }]); previous.delete(item.id); }
      for (const [id, item] of previous) walk(item, undefined, [...path, { id }]);
      // Pure order changes need an explicit effect even if every item is identical.
      if (old.length === next.length && old.every(item => next.some(other => other.id === item.id)) && !same(old.map(item => item.id), next.map(item => item.id))) changes.push({ path, value: structuredClone(next) });
      return;
    }
    if (old && next && typeof old === 'object' && typeof next === 'object' && !Array.isArray(old) && !Array.isArray(next)) {
      for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) walk(old[key], next[key], [...path, key]);
      return;
    }
    changes.push(next === undefined ? { path, absent: true } : { path, value: structuredClone(next) });
  };
  for (const field of aiProposalFields) if (field !== 'scriptText') walk(before[field], after[field], [field]);
  return changes;
}

type AiTaskClaim = { id: string; status: 'complete' | 'incomplete'; evidence: string[]; detail?: string };

function evidenceProblem(project: Project, task: AiAgentTask, item: AiToolEvidence): string | undefined {
  if (!item.ok || !item.complete) return item.detail || '工具未成功完成。';
  if (!item.mutation && task.kind !== 'inspect' && !item.checks?.length || item.name === 'importAssets' && task.kind !== 'inspect' && !item.checks?.length) {
    return item.name === 'importAssets' ? '仅导入素材，尚不能证明角色已绑定；请引用 bindPortraits 或通过的 checkProject。' : '此调用没有执行修改或具体结果检查；请引用实际修改或 checkProject，reviewChanges/validateProject 不能替代它们。';
  }
  const stale = [...item.effects, ...item.checks ?? []].filter(effect => !aiEffectHolds(project, effect));
  if (stale.length) return `此前结果已被后续修改覆盖，需要检查最终状态。失效路径：${stale.slice(0, 6).map(effect => JSON.stringify(effect.path)).join('、')}`;
}

/** Explain exactly which recorded calls can prove a task, without trusting model prose. */
export function aiTaskEvidenceDiagnostics(project: Project, task: AiAgentTask, evidence: AiToolEvidence[], claim?: AiTaskClaim) {
  const allCalls = evidence.filter(item => item.taskIds.includes(task.id));
  const candidates = allCalls.filter(item => !evidenceProblem(project, task, item));
  const lastFailed = [...allCalls].reverse().find(item => !item.ok || !item.complete);
  const available = candidates.filter(item => !lastFailed || evidence.indexOf(item) > evidence.indexOf(lastFailed));
  const rejected = (claim?.evidence ?? allCalls.map(item => item.id)).flatMap(id => {
    const item = evidence.find(item => item.id === id);
    const reason = !item ? '此调用编号不存在，请使用工具执行结果中的 id。'
      : !allCalls.includes(item) ? `此调用未关联任务 ${task.id}；请用该 taskIds 执行结果检查。`
      : evidenceProblem(project, task, item) ?? (lastFailed && evidence.indexOf(item) < evidence.indexOf(lastFailed) ? `之后的 ${lastFailed.id} 未通过：${lastFailed.detail}。请修正或重新检查最终结果。` : undefined);
    return reason ? [{ id, reason }] : [];
  });
  return { taskId: task.id, title: task.title, availableEvidence: available.map(item => item.id), rejected, lastFailure: lastFailed ? { id: lastFailed.id, detail: lastFailed.detail } : undefined };
}

export function aiTaskOutcomes(project: Project, tasks: AiAgentTask[], evidence: AiToolEvidence[], requested?: AiTaskClaim[], original?: Project): AiTaskOutcome[] {
  return tasks.map(task => {
    const claim = requested?.find(item => item.id === task.id);
    const allCalls = evidence.filter(item => item.taskIds.includes(task.id));
    const calls = allCalls.filter(item => !claim || claim.evidence.includes(item.id));
    // Importing files is preparation. A change task needs a binding/edit or an
    // explicit assertion of the requested final state, including import-only tasks.
    const usable = calls.filter(item => !evidenceProblem(project, task, item));
    const lastFailed = [...allCalls].reverse().find(item => !item.ok || !item.complete);
    const lastSuccess = usable.at(-1);
    const failedAfterSuccess = lastFailed && (!lastSuccess || evidence.indexOf(lastFailed) > evidence.indexOf(lastSuccess));
    if (claim?.status === 'incomplete' || !lastSuccess || failedAfterSuccess) return {
      id: task.id, title: task.title, status: 'incomplete', evidence: calls.map(item => item.id),
      detail: claim?.detail || lastFailed?.detail || '没有找到能证明此项已完成的工具结果，请继续处理或明确说明缺少的信息。',
    };
    const changed = allCalls.some(item => item.ok && item.mutation && item.effects.some(effect => aiEffectHolds(project, effect) && (!original || !aiEffectHolds(original, effect))))
      || !!original && usable.some(item => item.checks?.some(effect => !aiEffectHolds(original, effect)));
    return { id: task.id, title: task.title, status: task.kind === 'change' && !changed ? 'unchanged' : 'complete', evidence: usable.map(item => item.id), detail: claim?.detail || (changed ? '已核对草稿中的实际修改，等待应用。' : task.kind === 'change' ? '目标内容已经符合要求，无需修改。' : '已读取并检查所需内容。') };
  });
}

function portraitComparisons(before: Project, after: Project): AiPortraitComparison[] {
  const image = (project: Project, assetId?: string) => {
    const asset = project.assets.find(item => item.id === assetId && item.kind === 'image');
    return asset ? { assetId: asset.id, name: asset.name, path: asset.path } : undefined;
  };
  const result: AiPortraitComparison[] = [];
  for (const id of new Set([...before.characters, ...after.characters].map(character => character.id))) {
    const old = effectiveCharacter(before, id), next = effectiveCharacter(after, id);
    const expressions: AiPortraitComparison['expressions'] = [];
    for (const expressionId of new Set([...(old?.expressions ?? []), ...(next?.expressions ?? [])].map(expression => expression.id))) {
      const previous = old?.expressions.find(expression => expression.id === expressionId), current = next?.expressions.find(expression => expression.id === expressionId);
      const left = image(before, previous?.assetId), right = image(after, current?.assetId);
      if (same(left, right)) continue;
      expressions.push({ id: expressionId, name: current?.name ?? previous?.name ?? expressionId, before: left, after: right });
    }
    if (expressions.length) {
      const defaultId = next?.defaultExpressionId ?? old?.defaultExpressionId;
      expressions.sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId));
      result.push({ characterId: id, name: next?.name ?? old?.name ?? id, expressions });
    }
  }
  return result;
}
const actorActions = (line?: StoryLine) => (line?.actions ?? []).filter(action => action.kind === 'show' || action.kind === 'hide');
const expressionChoices = (line?: StoryLine) => actorActions(line).map(action => action.kind === 'show' ? [action.characterId, action.expressionId] : undefined);

/** Counts and thumbnails come from the actual draft, never from the model's prose. */
export function createAiAgentProposal(before: Project, after: Project, inspectedLineIds: Iterable<string>, batches: number): AiWorkflowProposal {
  const effects = aiProjectEffects(before, after);
  const portraits = portraitComparisons(before, after);
  const oldLines = new Map(aiLines(before).map(({ line }) => [line.id, line]));
  const nextLines = new Map(aiLines(after).map(({ line }) => [line.id, line]));
  const linePairs = [...new Set([...oldLines.keys(), ...nextLines.keys()])].map(id => [oldLines.get(id), nextLines.get(id)] as const);
  const changedItems = (field: 'chapters' | 'scenes' | 'nodes', filter: (item: any) => boolean = () => true) => {
    const old = new Map(before[field].filter(filter).map(item => [item.id, item]));
    let count = 0;
    for (const item of after[field].filter(filter)) { if (!same(old.get(item.id), item)) count++; old.delete(item.id); }
    return count + old.size;
  };
  const changedFields = aiProposalFields.filter(field => !same(before[field], after[field]));
  return {
    kind: 'agent', projectId: before.id, fingerprint: aiAgentFingerprint(before), project: after, changedFields,
    portraits, warnings: [], details: [],
    summary: {
      lines: new Set(inspectedLineIds).size, changedLines: changedDialogueCount(before, after),
      changes: effects.length + (effects.length === 0 && changedFields.includes('scriptText') ? 1 : 0),
      portraitCharacters: portraits.length,
      portraitLines: linePairs.filter(([old, next]) => !same(actorActions(old), actorActions(next))).length,
      expressions: linePairs.filter(([old, next]) => !same(expressionChoices(old), expressionChoices(next))).length,
      voices: linePairs.filter(([old, next]) => old?.voiceId !== next?.voiceId).length,
      importedAssets: after.assets.filter(asset => !before.assets.some(old => old.id === asset.id)).length,
      chapters: changedItems('chapters'), scenes: changedItems('scenes'),
      choices: changedItems('nodes', node => node.kind === 'choice'), endings: changedItems('nodes', node => node.kind === 'end'), batches,
    },
  };
}
