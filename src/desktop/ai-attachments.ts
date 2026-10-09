import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { aiAttachmentLimit, aiAttachmentPathsSchema, extractAiAttachmentPathMentions, type AiAttachment } from '../core/ai-attachments';
import { readTextDocument } from './text-import';

const documents = new Set(['.docx', '.txt', '.md']);
const plainText = new Set(['.json', '.csv', '.tsv', '.rpy', '.py', '.js', '.ts', '.tsx', '.css', '.html', '.xml', '.yaml', '.yml', '.srt', '.vtt', '.log']);

/** Resolve only paths that exist and were typed into this explicitly authorized request. */
export async function resolveMentionedAiAttachmentPaths(prompt: string) {
  const result = new Map<string, string>();
  for (const mention of extractAiAttachmentPathMentions(prompt)) {
    // Try the longest unquoted path first. A quoted missing file must never
    // silently become a shorter, unrelated directory with the same prefix.
    const options = [mention.path, ...(mention.quoted ? [] : [...mention.path.matchAll(/\s+/g)]
      .reverse().map(boundary => mention.path.slice(0, boundary.index).trimEnd()))];
    for (const option of options) {
      if (!path.isAbsolute(option)) continue;
      const absolutePath = path.resolve(option);
      try {
        const stat = await fs.stat(absolutePath);
        if (!stat.isFile() && !stat.isDirectory()) continue;
        const key = process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath;
        if (!result.has(key)) result.set(key, absolutePath);
        break;
      } catch { /* Ignore sentence fragments and paths that are not present. */ }
    }
    if (result.size > aiAttachmentLimit) throw new Error(`最多引用 ${aiAttachmentLimit} 份文件或目录，请先移除部分附件。`);
  }
  return [...result.values()];
}

const mentionRequestSchema = z.object({ prompt: z.string().max(10000), allowExternalFiles: z.boolean() }).strict();
export async function inspectMentionedAiAttachments(raw: unknown): Promise<AiAttachment[]> {
  const request = mentionRequestSchema.parse(raw);
  if (!request.allowExternalFiles) return [];
  return inspectAiAttachments(await resolveMentionedAiAttachmentPaths(request.prompt));
}

/** Staging checks metadata only. Content is read when the user sends a request. */
export async function inspectAiAttachments(raw: unknown): Promise<AiAttachment[]> {
  const paths = aiAttachmentPathsSchema.parse(raw), result: AiAttachment[] = [], seen = new Set<string>();
  for (const input of paths) {
    if (!path.isAbsolute(input) || input.includes('\0')) throw new Error('请拖入本机文件或文件夹，不能引用网页链接。');
    const absolute = path.resolve(input), key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    if (seen.has(key)) continue;
    seen.add(key);
    let stat;
    try { stat = await fs.stat(absolute); } catch { throw new Error(`无法访问附件「${path.basename(absolute)}」，请确认文件仍然存在。`); }
    if (!stat.isFile() && !stat.isDirectory()) throw new Error('只能引用普通文件或目录。');
    const kind = stat.isDirectory() ? 'directory' : documents.has(path.extname(absolute).toLowerCase()) || plainText.has(path.extname(absolute).toLowerCase()) ? 'document' : 'file';
    if (kind === 'document' && stat.size > 32 * 1024 * 1024) throw new Error(`附件「${path.basename(absolute)}」超过 32 MB，请拆分后引用。`);
    result.push({ path: absolute, name: path.basename(absolute) || absolute, kind, bytes: stat.size });
  }
  return result;
}

export async function readAiAttachments(paths: string[], check: () => void): Promise<AiAttachment[]> {
  const items = await inspectAiAttachments(paths);
  let remaining = 60000;
  const readDirectory = async (item: AiAttachment) => {
    const entries: NonNullable<AiAttachment['entries']> = [];
    let entriesTruncated = false;
    let entryChars = 0;
    const seen = new Set<string>();
    const scan = async (current: string, relative: string, depth: number): Promise<void> => {
      check();
      if (depth > 24 || entries.length >= 2048) { entriesTruncated = true; return; }
      let children: string[];
      try { children = (await fs.readdir(current)).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })); }
      catch (error) { throw new Error(`无法读取附件目录「${item.name}」：${error instanceof Error ? error.message : String(error)}`); }
      for (const child of children) {
        if (entries.length >= 2048) { entriesTruncated = true; return; }
        const absolute = path.join(current, child), childRelative = relative ? path.join(relative, child) : child;
        let stat;
        try { stat = await fs.lstat(absolute); } catch { continue; }
        if (stat.isSymbolicLink()) continue;
        const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
        if (seen.has(key)) continue;
        seen.add(key);
        if (entryChars + childRelative.length > 120000) { entriesTruncated = true; return; }
        entryChars += childRelative.length;
        if (stat.isDirectory()) {
          entries.push({ path: childRelative.replaceAll('\\', '/'), kind: 'directory' });
          await scan(absolute, childRelative, depth + 1);
        } else if (stat.isFile()) {
          entries.push({ path: childRelative.replaceAll('\\', '/'), kind: 'file', bytes: stat.size });
        }
      }
    };
    await scan(item.path, '', 0);
    item.entries = entries;
    if (entriesTruncated) item.entriesTruncated = true;
  };
  for (const item of items) {
    check();
    if (item.kind === 'directory') { await readDirectory(item); continue; }
    if (item.kind !== 'document') continue;
    let text: string;
    if (documents.has(path.extname(item.path).toLowerCase())) text = (await readTextDocument(item.path)).text;
    else {
      // Bound the read even if the file grows after its metadata was inspected.
      const file = await fs.open(item.path, 'r');
      try {
        const buffer = Buffer.alloc(32 * 1024 * 1024 + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 32 * 1024 * 1024) throw new Error(`附件「${item.name}」超过 32 MB，请拆分后引用。`);
        const bytes = buffer.subarray(0, bytesRead);
        if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes);
        else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes);
        else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('gb18030').decode(bytes); } }
        if (text.includes('\0')) throw new Error(`附件「${item.name}」不是可读取的文本。`);
      } finally { await file.close(); }
    }
    check();
    const limit = Math.min(30000, remaining);
    item.text = text.slice(0, limit); item.truncated = text.length > limit;
    remaining -= item.text.length;
  }
  return items;
}
