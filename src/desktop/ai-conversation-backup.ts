import { z } from 'zod';
import { aiConversationSchema, savedAiMessageSchema } from '../core/ai-conversations';
import { atomicWrite } from './project-store';

// Recovery must also retain the reply that exceeded the normal save limits.
// Keep the same data format and field validation without truncating its text.
export const aiConversationBackupSchema = aiConversationSchema.extend({
  messages: z.array(savedAiMessageSchema.extend({ content: z.string() })),
});

export async function writeAiConversationBackup(file: string, raw: unknown) {
  const conversation = aiConversationBackupSchema.parse(raw);
  await atomicWrite(file, JSON.stringify(conversation, null, 2));
}
