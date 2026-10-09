import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AiAttachment } from '../core/ai-attachments';
import { inspectAiAttachments } from './ai-attachments';
import { readTextDocument } from './text-import';

const key = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const within = (root: string, file: string) => key(root) === key(file) || key(file).startsWith(key(root) + path.sep);

/** A supplied directory authorizes its real descendants, never a symlink escape. */
export async function resolveAiSource(source: string, attachments: AiAttachment[], check: () => void) {
  check();
  if (source.includes('\0')) throw new Error('附件路径无效。');
  let absolute: string;
  if (path.isAbsolute(source)) absolute = path.resolve(source);
  else {
    const named = attachments.filter(item => item.name === source);
    if (named.length !== 1) throw new Error('请使用本次附件的完整路径，或唯一的附件名称。');
    absolute = named[0].path;
  }
  const attached = attachments.filter(item => key(item.path) === key(absolute) || item.kind === 'directory' && within(item.path, absolute))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!attached) throw new Error('只能读取本次明确引用的附件及其目录中的文件，不能使用未提供的路径。');
  const root = path.resolve(attached.path);
  const relative = path.relative(root, absolute);
  let part = root;
  for (const segment of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) part = path.join(part, segment);
    const stat = await fs.lstat(part);
    if (stat.isSymbolicLink()) throw new Error('附件中的链接不能用于读取或导入，请直接引用目标文件。');
  }
  const realRoot = await fs.realpath(root), real = await fs.realpath(absolute);
  check();
  if (!within(realRoot, real)) throw new Error('附件路径不能离开所引用的目录。');
  const [metadata] = await inspectAiAttachments([absolute]);
  check();
  return metadata;
}

export async function aiAttachmentText(file: AiAttachment, check: () => void) {
  if (file.kind !== 'document') throw new Error('此附件不是可读取的文本文件。图片和音频只能读取文件信息，不能据此声称看过或听过内容。');
  if (/\.(txt|md|docx)$/i.test(file.path)) { const result = await readTextDocument(file.path); check(); return result; }
  const handle = await fs.open(file.path, 'r');
  try {
    const buffer = Buffer.alloc(32 * 1024 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    check();
    if (bytesRead > 32 * 1024 * 1024) throw new Error('文本附件超过 32 MB，请拆分后读取。');
    const bytes = buffer.subarray(0, bytesRead);
    let text: string;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes);
    else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('gb18030').decode(bytes); } }
    if (text.includes('\0')) throw new Error('附件不是可读取的文本。');
    return { name: file.name, text };
  } finally { await handle.close(); }
}

export async function readAiAttachmentPage(file: AiAttachment, offset: number, limit: number, query: string | undefined, check: () => void) {
  if (file.kind === 'document') {
    const { text } = await aiAttachmentText(file, check);
    const end = Math.min(text.length, offset + 30000);
    return { path: file.path, name: file.name, kind: file.kind, text: text.slice(offset, end), total: text.length, offset, nextOffset: end < text.length ? end : undefined, offsetUnit: 'UTF-16' };
  }
  if (file.kind !== 'directory') return { ...file, contentRead: false, note: '仅文件信息；未读取图片内容或音频。' };
  const children = (await fs.readdir(file.path, { withFileTypes: true })).filter(item => !item.isSymbolicLink() && (!query || item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  const entries = children.slice(offset, offset + limit).map(item => ({ path: path.join(file.path, item.name), name: item.name, kind: item.isDirectory() ? 'directory' : 'file' }));
  check();
  return { path: file.path, name: file.name, kind: 'directory', entries, total: children.length, offset, nextOffset: offset + entries.length < children.length ? offset + entries.length : undefined };
}
