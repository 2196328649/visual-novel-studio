import { promises as fs } from 'node:fs';
import path from 'node:path';
import { containedPath } from './project-store';
import type { VoiceFile } from '../core/voice-matching';

export async function scanVoiceLibrary(directory: string, check: () => void = () => {}) {
  const root = path.resolve(directory), files: VoiceFile[] = [], warnings: string[] = [];
  const metadata = new Map<string, Partial<VoiceFile>>();
  const readSmall = async (file: string) => { const size = (await fs.stat(file)).size; if (size > 2 * 1024 * 1024) throw new Error('配音文本索引超过 2 MB。'); return fs.readFile(file, 'utf8'); };
  for (const name of ['voices.json', 'voice-manifest.json', 'manifest.json']) {
    try {
      const raw = JSON.parse(await readSmall(path.join(root, name)));
      const entries = Array.isArray(raw) ? raw : Array.isArray(raw.voices) ? raw.voices : Object.entries(raw).map(([file, value]) => typeof value === 'string' ? { file, text: value } : { ...(value as object), file });
      for (const entry of entries) {
        if (!entry || typeof entry.file !== 'string') continue;
        const relative = path.relative(root, containedPath(root, entry.file)).replaceAll('\\', '/');
        metadata.set(relative.toLowerCase(), { text: typeof entry.text === 'string' ? entry.text : undefined, speaker: typeof entry.speaker === 'string' ? entry.speaker : undefined, lineId: typeof entry.lineId === 'string' ? entry.lineId : undefined });
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`${name} 无法读取：${error instanceof Error ? error.message : String(error)}`); }
  }
  let inspected = 0;
  const visit = async (folder: string, depth: number) => {
    check();
    if (depth > 16) throw new Error('配音目录层级超过 16 层，请选择更具体的目录。');
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))) {
      check();
      if (++inspected > 30000) throw new Error('配音目录超过 30000 项，请选择更具体的目录。');
      if (entry.isSymbolicLink()) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) { await visit(full, depth + 1); continue; }
      if (!entry.isFile() || !/\.(ogg|opus|wav|mp3|flac)$/i.test(entry.name)) continue;
      const key = path.relative(root, full).replaceAll('\\', '/'), stem = full.slice(0, -path.extname(full).length);
      const details = { ...metadata.get(key.toLowerCase()) };
      if (!details.text) for (const extension of ['.txt', '.srt', '.vtt']) {
        try {
          const text = await readSmall(stem + extension);
          details.text = extension === '.txt' ? text.trim() : text.replace(/^WEBVTT.*$|^\d+\s*$|^.*-->.*$/gm, '').replace(/<[^>]*>/g, '').trim();
          break;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`${key} 的文本旁注无法读取。`); }
      }
      files.push({ key, name: key.replace(/\.[^/.]+$/, ''), ...details });
      if (files.length > 10000) throw new Error('配音文件超过 10000 个，请按章节选择目录。');
    }
  };
  await visit(root, 0);
  return { files, warnings };
}
