import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { extractDocxText, readTextDocument } from '../src/desktop/text-import';

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function docx(xml: string, method: 0 | 8 = 8, comment = '', dataDescriptor = false) {
  const name = Buffer.from('word/document.xml');
  const raw = Buffer.from(xml);
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const local = Buffer.alloc(30 + name.length + data.length);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc32(raw), 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  data.copy(local, 30 + name.length);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  local.copy(central, 16, 14, 26);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  const descriptor = dataDescriptor ? Buffer.alloc(16) : Buffer.alloc(0);
  if (dataDescriptor) {
    descriptor.writeUInt32LE(0x08074b50);
    local.copy(descriptor, 4, 14, 26);
    local.writeUInt16LE(8, 6);
    central.writeUInt16LE(8, 8);
    local.fill(0, 14, 26);
  }
  const directoryStart = local.length + descriptor.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(directoryStart, 16);
  const commentBytes = Buffer.from(comment);
  end.writeUInt16LE(commentBytes.length, 20);
  return { bytes: Buffer.concat([local, descriptor, central, end, commentBytes]), central: directoryStart, end: directoryStart + central.length, data: 30 + name.length };
}

const wrap = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

test('DOCX 按正文顺序读取段落、表格、空段、实体和显式换行', () => {
  const xml = wrap(paragraph('序章：归来') + '<w:tbl><w:tr><w:tc>' + paragraph('第一格') + paragraph('格内第二段') + '</w:tc><w:tc>' + paragraph('第二格') + '</w:tc></w:tr></w:tbl><w:p/>' + '<w:p><w:r><w:t xml:space="preserve"> 小雨：&lt;归&gt;&amp;&#x4E2D;&#25991; </w:t><w:tab/><w:t>甲</w:t><w:br/><w:t>乙</w:t><w:cr/><w:t>丙</w:t></w:r></w:p>');
  const expected = '序章：归来\n第一格\n格内第二段\n第二格\n\n 小雨：<归>&中文 \t甲\n乙\n丙';
  assert.equal(extractDocxText(docx(xml, 0).bytes), expected);
  assert.equal(extractDocxText(docx(xml, 8, '中文 ZIP 注释').bytes), expected);
  assert.equal(extractDocxText(docx(xml, 8, 'PK\u0005\u0006' + 'x'.repeat(32), true).bytes), expected);
});

test('DOCX 保留当前正文，忽略删除修订与字段指令', () => {
  const xml = wrap('<w:del>' + paragraph('被删除的整段') + '</w:del><w:p><w:r><w:t>旁白：</w:t></w:r><w:del><w:r><w:delText>旧版本</w:delText></w:r></w:del><w:ins><w:r><w:t>新版本</w:t></w:r></w:ins><w:r><w:instrText> INCLUDETEXT "file:///secret" </w:instrText></w:r><w:r><w:t>可见结果</w:t></w:r></w:p>');
  assert.equal(extractDocxText(docx(xml).bytes), '旁白：新版本可见结果');
});

test('DOCX 拒绝损坏 XML、非正文 XML 和实体声明', () => {
  for (const xml of [
    wrap('<w:p><w:r><w:t>未闭合</w:r></w:p>'),
    '<other><p><t>非 Word 正文</t></p></other>',
    '<!DOCTYPE w:document [<!ENTITY injected SYSTEM "file:///private">]>' + wrap(paragraph('&injected;')),
    '<!DOCTYPE w:document SYSTEM "https://example.invalid/document.dtd">' + wrap(paragraph('不读取外部资源')),
  ]) assert.throws(() => extractDocxText(docx(xml).bytes), /DOCX.*XML|DOCX.*正文/);
});

test('DOCX 拒绝截断 ZIP、中央目录越界及长度不符，返回中文错误', () => {
  const source = docx(wrap(paragraph('正文')));
  const centralBounds = Buffer.from(source.bytes);
  centralBounds.writeUInt32LE(source.end, source.end + 16);
  const filenameBounds = Buffer.from(source.bytes);
  filenameBounds.writeUInt16LE(0xffff, source.central + 28);
  const localBounds = Buffer.from(source.bytes);
  localBounds.writeUInt32LE(0xffffffff, source.central + 42);
  const sizeMismatch = Buffer.from(source.bytes);
  sizeMismatch.writeUInt32LE(1, source.central + 24);
  for (const bytes of [Buffer.alloc(0), Buffer.from('not a zip'), source.bytes.subarray(0, -1), centralBounds, filenameBounds, localBounds, sizeMismatch]) {
    assert.throws(() => extractDocxText(bytes), error => error instanceof Error && /DOCX|文档/.test(error.message) && !(error instanceof RangeError));
  }
});

test('DOCX 拒绝正文 CRC 损坏与压缩记录不一致', () => {
  const source = docx(wrap(paragraph('ABC')), 0);
  const invalidCrc = Buffer.from(source.bytes);
  invalidCrc[invalidCrc.indexOf(Buffer.from('ABC'), source.data)] = 68;
  assert.throws(() => extractDocxText(invalidCrc), /损坏|校验/);
  const invalidMethod = Buffer.from(source.bytes);
  invalidMethod.writeUInt16LE(8, 8);
  assert.throws(() => extractDocxText(invalidMethod), /损坏|不符/);
  const invalidDeflate = docx(wrap(paragraph('DEF')));
  invalidDeflate.bytes.fill(0xff, invalidDeflate.data, invalidDeflate.central);
  assert.throws(() => extractDocxText(invalidDeflate.bytes), /DOCX.*解压失败/);
});

test('DOCX 拒绝加密、多磁盘和过大的正文', () => {
  const source = docx(wrap(paragraph('正文')));
  const encryptedLocal = Buffer.from(source.bytes);
  encryptedLocal.writeUInt16LE(1, 6);
  const encryptedCentral = Buffer.from(source.bytes);
  encryptedCentral.writeUInt16LE(1, source.central + 8);
  const multiDisk = Buffer.from(source.bytes);
  multiDisk.writeUInt16LE(1, source.end + 4);
  const oversized = Buffer.from(source.bytes);
  oversized.writeUInt32LE(16 * 1024 * 1024 + 1, source.central + 24);
  for (const bytes of [encryptedLocal, encryptedCentral, multiDisk, oversized]) {
    assert.throws(() => extractDocxText(bytes), /DOCX|文档/);
  }
});

test('TXT 与 Markdown 支持 UTF-8 BOM、UTF-16 双字节序及 GB18030 中文', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-text-import-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const text = '中文\n旁白：归来。';
  const utf16le = Buffer.from('\ufeff' + text, 'utf16le');
  const cases: [string, Buffer, string][] = [
    ['中文.txt', Buffer.from(text), text],
    ['带标记.MD', Buffer.from('\ufeff' + text), text],
    ['小端.txt', utf16le, text],
    ['大端.txt', Buffer.from(utf16le).swap16(), text],
    ['旧中文编码.txt', Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a, 0xb9, 0xe9, 0xc0, 0xb4]), '中文\n归来'],
    ['GB18030四字节.txt', Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x94, 0x39, 0xfc, 0x36]), '中文\u{1f600}'],
  ];
  for (const [name, bytes, expected] of cases) {
    const file = path.join(directory, name);
    await fs.writeFile(file, bytes);
    assert.deepEqual(await readTextDocument(file), { name, text: expected });
  }
});

test('文件读取入口支持 DOCX 并拒绝不支持的扩展名和大文件', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-document-import-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, '剧本.DOCX');
  await fs.writeFile(file, docx(wrap(paragraph('旁白：归来。'))).bytes);
  assert.deepEqual(await readTextDocument(file), { name: '剧本.DOCX', text: '旁白：归来。' });
  const unsupported = path.join(directory, '旧格式.doc');
  await fs.writeFile(unsupported, '正文');
  await assert.rejects(readTextDocument(unsupported), /请选择 DOCX、TXT 或 Markdown/);
  const oversized = path.join(directory, '大文件.txt');
  const handle = await fs.open(oversized, 'w');
  await handle.truncate(32 * 1024 * 1024 + 1);
  await handle.close();
  await assert.rejects(readTextDocument(oversized), /32 MB/);
});
