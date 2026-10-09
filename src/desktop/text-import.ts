import { promises as fs } from 'node:fs';
import path from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { dialogueMapSchema, type ImportedText } from '../core/text-exchange';

type XmlEntry = Record<string, XmlEntry[] | string>;
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
function documentText(xml: string): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('DOCX 正文 XML 格式无效。');
  // fast-xml-parser enables numeric XML references through htmlEntities.
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: true, removeNSPrefix: true, trimValues: false, parseTagValue: false, ignoreDeclaration: true, htmlEntities: true });
  let document: XmlEntry[];
  try { document = parser.parse(xml) as XmlEntry[]; }
  catch { throw new Error('DOCX 正文 XML 格式无效或层级过深。'); }
  const root = document.find(entry => Array.isArray(entry.document))?.document;
  const body = Array.isArray(root) ? root.find(entry => Array.isArray(entry.body))?.body : undefined;
  if (!Array.isArray(body)) throw new Error('DOCX 正文 XML 缺少文档内容。');
  const text = (entries: XmlEntry[], insideText = false): string => entries.map(entry => Object.entries(entry).map(([tag, children]) => {
    if (tag === 'del' || tag === 'instrText') return '';
    if (tag === 'tab') return '\t';
    if (tag === 'br' || tag === 'cr') return '\n';
    if (tag === '#text') return insideText && typeof children === 'string' ? children : '';
    return Array.isArray(children) ? text(children, tag === 't') : '';
  }).join('')).join('');
  const paragraphs: string[] = [];
  const visit = (entries: XmlEntry[]) => {
    for (const entry of entries) for (const [tag, children] of Object.entries(entry)) {
      if (!Array.isArray(children) || tag === 'del') continue;
      if (tag === 'p') paragraphs.push(text(children));
      else visit(children);
    }
  };
  visit(body);
  return paragraphs.join('\n');
}

export function extractDocxText(bytes: Buffer): string {
  let end = bytes.length - 22;
  const firstEnd = Math.max(0, bytes.length - 65557);
  while (end >= firstEnd && (bytes.readUInt32LE(end) !== 0x06054b50 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length)) end--;
  if (end < firstEnd) throw new Error('这不是有效的 DOCX 文件。');
  const directoryStart = bytes.readUInt32LE(end + 16);
  const directoryEnd = directoryStart + bytes.readUInt32LE(end + 12);
  const count = bytes.readUInt16LE(end + 10);
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0 || bytes.readUInt16LE(end + 8) !== count || directoryEnd > end) throw new Error('DOCX 文件目录已损坏或使用了不支持的分卷格式。');
  let offset = directoryStart;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > directoryEnd || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('DOCX 文件目录已损坏。');
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const expectedCrc = bytes.readUInt32LE(offset + 16);
    const size = bytes.readUInt32LE(offset + 20);
    const expandedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > directoryEnd || bytes.readUInt16LE(offset + 34) !== 0) throw new Error('DOCX 文件目录已损坏。');
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset = nextOffset;
    if (name !== 'word/document.xml') continue;
    if (expandedSize > MAX_DOCUMENT_BYTES || local + 30 > directoryStart || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('文档内容过大或已损坏。');
    const localFlags = bytes.readUInt16LE(local + 6);
    const localNameLength = bytes.readUInt16LE(local + 26);
    const dataStart = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
    if (dataStart + size > directoryStart || (flags | localFlags) & 1) throw new Error('DOCX 正文已损坏或受到密码保护。');
    if (localFlags !== flags || bytes.readUInt16LE(local + 8) !== method || bytes.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name) throw new Error('DOCX 正文压缩记录不符，文件已损坏。');
    if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== expectedCrc || bytes.readUInt32LE(local + 18) !== size || bytes.readUInt32LE(local + 22) !== expandedSize)) throw new Error('DOCX 正文长度或校验记录不符，文件已损坏。');
    const compressed = bytes.subarray(dataStart, dataStart + size);
    if (method !== 0 && method !== 8) throw new Error('不支持此 DOCX 的压缩格式。');
    let data: Buffer;
    try { data = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: MAX_DOCUMENT_BYTES }); }
    catch { throw new Error('DOCX 正文解压失败，内容过大或已损坏。'); }
    if (data.length !== expandedSize) throw new Error('DOCX 正文长度与文件记录不符。');
    if (crc32(data) !== expectedCrc) throw new Error('DOCX 正文校验失败，文件已损坏。');
    let xml: string;
    try { xml = new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { throw new Error('DOCX 正文 XML 编码无效。'); }
    return documentText(xml);
  }
  throw new Error('DOCX 中没有可读取的正文。');
}

export async function readTextDocument(file: string): Promise<ImportedText> {
  const stat = await fs.stat(file);
  if (stat.size > 32 * 1024 * 1024) throw new Error('文本文件超过 32 MB，请拆分后导入。');
  const bytes = await fs.readFile(file);
  const extension = path.extname(file).toLowerCase();
  if (!['.docx', '.txt', '.md'].includes(extension)) throw new Error('请选择 DOCX、TXT 或 Markdown 文本。');
  let text: string;
  if (extension === '.docx') text = extractDocxText(bytes);
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes);
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes);
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { text = new TextDecoder('gb18030').decode(bytes); }
  }
  const result: ImportedText = { name: path.basename(file), text };
  try {
    const mapFile = file + '.vns-lines.json';
    const size = (await fs.stat(mapFile)).size;
    if (size > 32 * 1024 * 1024) throw new Error('对应表过大。');
    result.mapping = dialogueMapSchema.parse(JSON.parse(await fs.readFile(mapFile, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('对白对应表无法读取，请保留导出时的对应表或改用带行标识的修订稿。');
  }
  return result;
}
