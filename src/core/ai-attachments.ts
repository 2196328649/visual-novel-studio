import { z } from 'zod';

export const aiAttachmentLimit = 10;
export const aiAttachmentPathsSchema = z.array(z.string().min(1).max(4096)).max(aiAttachmentLimit);
export const aiAttachmentEntrySchema = z.object({
  path: z.string().min(1).max(4096),
  kind: z.enum(['file', 'directory']),
  bytes: z.number().nonnegative().optional(),
}).strict();
export const aiAttachmentSchema = z.object({
  path: z.string().min(1).max(4096), name: z.string().min(1).max(1024),
  kind: z.enum(['document', 'directory', 'file']), bytes: z.number().nonnegative(),
  text: z.string().max(30000).optional(), truncated: z.boolean().optional(),
  entries: z.array(aiAttachmentEntrySchema).max(2048).optional(), entriesTruncated: z.boolean().optional(),
}).strict();
export const aiAttachmentsSchema = z.array(aiAttachmentSchema).max(aiAttachmentLimit)
  .refine(items => items.reduce((sum, item) => sum + (item.text?.length ?? 0), 0) <= 60000, '附件参考正文合计超过 60000 字符。');
export type AiAttachment = z.infer<typeof aiAttachmentSchema>;

export function aiAttachmentDescription(item: AiAttachment) {
  return item.kind === 'directory' ? '文件夹' : item.kind === 'document' ? '文本文件' : '文件';
}

/** Keep quoted paths intact; unquoted mentions may still end with prose. */
export function extractAiAttachmentPathMentions(prompt: string) {
  const mentions: { path: string; quoted: boolean; index: number }[] = [];
  const absolute = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
  let text = prompt.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`“”‘’]+/gi, value => ' '.repeat(value.length));
  const quotes: Record<string, string> = { '"': '"', "'": "'", '`': '`', '“': '”', '‘': '’' };
  for (const match of text.matchAll(/["'`“‘]/g)) {
    const start = match.index + 1, end = text.indexOf(quotes[match[0]], start);
    if (end < 0 || !absolute.test(text.slice(start))) continue;
    const value = text.slice(start, end);
    if (/[\0\r\n]/.test(value)) continue;
    mentions.push({ path: value, quoted: true, index: match.index });
    text = text.slice(0, match.index) + ' '.repeat(end - match.index + 1) + text.slice(end + 1);
  }
  const starts = [...text.matchAll(/[A-Za-z]:[\\/]|\\\\|(?<![^\s(（\[【:：])\/(?!\/)/g)];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index;
    const value = text.slice(start, starts[i + 1]?.index)
      .split(/[<>|\0\r\n"'`“”‘’，。；、！？：,;!?]/, 1)[0]
      .trim().replace(/[\s.）)\]}]+$/u, '');
    if (value.length >= 3) mentions.push({ path: value, quoted: false, index: start });
  }
  return mentions.sort((a, b) => a.index - b.index);
}
