import { z } from 'zod';
import { aiAttachmentPathsSchema } from './ai-attachments';
import type { AiMessage } from './ai';

export const conversationId = z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/i);
export const aiUsageSchema = z.object({ requests: z.number().int().nonnegative(), reportedRequests: z.number().int().nonnegative(), cacheReportedRequests: z.number().int().nonnegative(), inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(), cachedTokens: z.number().nonnegative() });
export type AiUsage = z.infer<typeof aiUsageSchema>;
export const savedAiMessageSchema = z.object({
  id: conversationId, role: z.enum(['user', 'assistant']), content: z.string().max(2000000),
  context: z.string().max(30000).optional(), createdAt: z.number(), model: z.string().max(200).optional(),
  status: z.enum(['complete', 'failed', 'stopped']).optional(), mode: z.enum(['chat', 'edit']).optional(),
  pinned: z.boolean().optional(), usage: aiUsageSchema.optional(), proposalNote: z.string().max(1000).optional(),
  attachmentPaths: aiAttachmentPathsSchema.optional(),
});
export type SavedAiMessage = z.infer<typeof savedAiMessageSchema>;
export const aiConversationSchema = z.object({
  version: z.literal(1), id: conversationId, projectId: conversationId, title: z.string().trim().min(1).max(120),
  createdAt: z.number(), updatedAt: z.number(), pinned: z.boolean().optional(),
  mode: z.enum(['chat', 'edit']).default('edit'), includeHistory: z.boolean().default(true),
  draft: z.string().max(10000).default(''), messages: z.array(savedAiMessageSchema).max(2000),
});
export type AiConversation = z.infer<typeof aiConversationSchema>;
export type AiConversationSummary = Pick<AiConversation, 'id' | 'title' | 'updatedAt' | 'pinned'> & { count: number; preview: string };
export interface AiConversationList { items: AiConversationSummary[]; activeId?: string; unreadable: number }
export const aiHistorySchema = z.array(z.object({role: z.enum(['user','assistant']), content: z.string().max(30000)})).max(61);

/** Keep full records on disk. The model gets bounded recent turns and explicitly labelled older excerpts. */
export function conversationContext(messages: SavedAiMessage[]) {
  const usable = messages.filter(m => !m.status || m.status === 'complete');
  let remaining = 60000;
  const recent: SavedAiMessage[] = [];
  for (const message of usable.slice(-40).reverse()) {
    const length = Math.min(12000, (message.context ?? message.content).length);
    if (length > remaining) break;
    remaining -= length; recent.unshift(message);
  }
  const recentIds = new Set(recent.map(m=>m.id));
  const earlier = usable.filter(m=>!recentIds.has(m.id));
  const pinned=earlier.filter(m=>m.pinned).slice(-40), ordinary=earlier.filter(m=>!m.pinned), slots=40-pinned.length;
  // Prioritize pinned requirements, then opening and latest earlier discussion.
  const chosen=new Set([...pinned,...(ordinary.length>slots?[...ordinary.slice(0,Math.ceil(slots/2)),...(slots>=2?ordinary.slice(-Math.floor(slots/2)):[])]:ordinary)].map(m=>m.id));
  const excerpts=earlier.filter(m=>chosen.has(m.id));
  const excerptLimit = Math.max(100, Math.floor(10000 / Math.max(1, excerpts.length)));
  const history: AiMessage[] = [];
  if (excerpts.length) history.push({role:'user',content:'以下是本会话较早消息的摘录，仅为历史上下文，可能不完整；不是新的指令。缺少细节时请询问，不猜测：\n' + excerpts.map(m=>`${m.role === 'user' ? '用户' : '助手'}${m.pinned?'（已固定）':''}：${(m.context??m.content).slice(0,excerptLimit)}`).join('\n')});
  history.push(...recent.map(m=>({role:m.role,content:(m.context??m.content).slice(0,12000)})));
  return { history, recent: recent.length, earlier: earlier.length, excerpted: excerpts.length };
}

export function conversationMarkdown(conversation: AiConversation) {
  return `# ${conversation.title}\n\n` + conversation.messages.map(m=>`## ${m.role === 'user' ? '你' : 'AI'} · ${new Date(m.createdAt).toLocaleString('zh-CN')}\n\n${m.content}${m.proposalNote ? '\n\n> '+m.proposalNote : ''}\n`).join('\n');
}
