import { cloneData } from "./project-mutation";
import { projectSchema, type Project } from './model';
import { assertNoNewAiProjectErrors } from './ai-project-validation';
import { assertTimelineEditDoesNotOverlap } from './timeline-edit-validation';
import { aiLines } from './ai';
import { editableProjectFields } from './ai-project-edit';
import { aiDraftProjectSchema } from './ai-draft-schema';

export interface AiProgress { id: string; message: string; completed?: number; total?: number }
export interface AiWorkflowDetail { lineId?: string; speaker?: string; text?: string; action: string; reason?: string }
export interface AiTaskOutcome { id: string; title: string; status: 'complete' | 'unchanged' | 'incomplete'; detail: string; evidence: string[] }
export interface AiPortraitImage { assetId: string; name: string; path: string; previewUrl?: string }
export interface AiPortraitComparison { characterId: string; name: string; expressions: { id: string; name: string; before?: AiPortraitImage; after?: AiPortraitImage }[] }
export type AiProposalField = typeof editableProjectFields[number] | 'scriptText';
export interface AiWorkflowProposal {
  projectId: string;
  fingerprint: string;
  project: Project;
  sourceName?: string;
  kind?: 'agent';
  changedFields?: AiProposalField[];
  tasks?: AiTaskOutcome[];
  portraits?: AiPortraitComparison[];
  summary: { lines: number; changedLines?: number; portraitLines: number; portraitCharacters?: number; expressions: number; voices: number; importedAssets: number; batches: number; scenes?: number; choices?: number; endings?: number; changes?: number; chapters?: number };
  warnings: string[];
  details: AiWorkflowDetail[];
}
/** Count actual prose/speaker edits, independently of the inspected dialogue scope. */
export function changedDialogueCount(before: Project, after: Project) {
  const previous = new Map(aiLines(before).map(({ line }) => [line.id, [line.speakerId ?? '', line.text]]));
  let changed = 0;
  for (const { line } of aiLines(after)) {
    const old = previous.get(line.id);
    if (!old || old[0] !== (line.speakerId ?? '') || old[1] !== line.text) changed++;
    previous.delete(line.id);
  }
  return changed + previous.size;
}
const storyFields = ['name', 'chapters', 'scenes', 'nodes', 'storyGroups', 'entryId', 'characters', 'variables', 'effects', 'blueprints', 'timelinePresets', 'textPresets', 'gameFlow', 'assets', 'contentBrowser'] as const;
export function aiWorkflowFingerprint(project: Project) {
  const normalized = projectSchema.parse(project);
  return projectFingerprint(storyFields.map(key => normalized[key]));
}
/** Agent drafts may edit UI/settings too; include source and all settings in conflict detection. */
export function aiAgentFingerprint(project: Project) {
  return projectFingerprint(aiDraftProjectSchema.parse(project));
}
function projectFingerprint(value: unknown) {
  const serialized = JSON.stringify(value, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  let first = 2166136261, second = 5381;
  for (let i = 0; i < serialized.length; i++) { const char = serialized.charCodeAt(i); first = Math.imul(first ^ char, 16777619); second = Math.imul(second, 33) ^ char; }
  return `${serialized.length}:${first >>> 0}:${second >>> 0}`;
}
export function applyAiWorkflow(project: Project, proposal: AiWorkflowProposal): Project {
  const agent = proposal.kind === 'agent';
  if (project.id !== proposal.projectId || proposal.project.id !== project.id || (agent ? aiAgentFingerprint(project) : aiWorkflowFingerprint(project)) !== proposal.fingerprint) throw new Error(agent ? '生成方案期间工程或文本已修改，请根据当前工程重新生成，避免覆盖刚才的编辑。' : '生成方案期间剧情、游戏流程、角色或资源已修改，请根据当前工程重新生成。界面设置可继续独立编辑。');
  const parsed = projectSchema.parse(proposal.project), next = cloneData(project);
  const fields = agent ? proposal.changedFields ?? [] : [...storyFields, 'scriptText' as const];
  for (const field of fields) {
    if (field !== 'scriptText' && !editableProjectFields.includes(field)) throw new Error('方案包含不支持的工程字段。');
    if (parsed[field] === undefined) delete (next as Record<string, unknown>)[field];
    else Object.assign(next, { [field]: cloneData(parsed[field]) });
  }
  // A valid proposal can become invalid when only its changed fields are merged.
  // Preserve unchanged draft issues that were already accepted by this workflow.
  const merged = projectSchema.safeParse(next);
  if (!merged.success) {
    const issueKey = (issue: { code: string; path: PropertyKey[]; message: string }) => JSON.stringify([issue.code, issue.path, issue.message]);
    const previous = projectSchema.safeParse(project);
    const existing = new Map<string, number>();
    if (!previous.success) for (const issue of previous.error.issues) {
      const key = issueKey(issue); existing.set(key, (existing.get(key) ?? 0) + 1);
    }
    const added = merged.error.issues.find(issue => {
      const key = issueKey(issue), remaining = existing.get(key) ?? 0;
      if (!remaining) return true;
      existing.set(key, remaining - 1); return false;
    });
    if (added) throw new Error(`方案无法应用：${added.message}`);
  }
  assertNoNewAiProjectErrors(project, next, '方案无法应用：');
  assertTimelineEditDoesNotOverlap(project, next);
  return next;
}
