import type { Project } from './model';
import type { TextSourceRange } from './text-document';
import { textHeading } from './text-headings';

export interface TextChapter extends TextSourceRange {
  key: string;
  chapterId?: string;
  name: string;
  firstLine: number;
  lastLine: number;
}

/** A newly generated preamble must not replace the author's current chapter. */
export function selectedTextChapter(chapters: TextChapter[], choice: { key: string; index: number }) {
  const exact = chapters.find(chapter => chapter.key === choice.key);
  if (exact) return exact;
  const indexed = chapters[Math.min(choice.index, chapters.length - 1)];
  return indexed.key === 'frontmatter' && choice.key !== 'frontmatter' ? chapters.find(chapter => chapter.key !== 'frontmatter') ?? indexed : indexed;
}

/** Source ranges retain the separators between chapters, even after select-all. */
export function textChapters(source: string, chapters: Project['chapters'] = []): TextChapter[] {
  const rows = source.split(/\r\n|\r|\n/), separators = [...source.matchAll(/\r\n|\r|\n/g)];
  const headings: { start: number; line: number; name: string; id?: string }[] = [];
  let offset = 0, definition = false;
  rows.forEach((row, index) => {
    if (/^\s*[@／/]?效果定义(?:\s*[:：]|\s)/.test(row)) definition = true;
    if (/^\s*[@／/]?效果结束\s*$/.test(row)) definition = false;
    const heading = !definition ? textHeading(row, true) : undefined;
    if (heading?.kind === '章节' && heading.nameFrom !== undefined) {
      const name = row.slice(heading.nameFrom), ref = name.trim().match(/^(.*?)【([a-z][a-z0-9_]{0,63})】$/);
      headings.push({ start: offset, line: index + 1, name: (ref?.[1] ?? name).trim() || '未命名章节', id: ref?.[2] });
    }
    offset += row.length + (separators[index]?.[0].length ?? 0);
  });
  if (!headings.length) return [{ key: 'unsectioned', name: '未分章文本', start: 0, end: source.length, firstLine: 1, lastLine: rows.length }];
  const result: TextChapter[] = [], occurrences = new Map<string, number>();
  if (source.slice(0, headings[0].start).trim()) {
    result.push({ key: 'frontmatter', name: '序言与全局设置', start: 0, end: headings[0].start - (source.slice(0, headings[0].start).endsWith('\r\n') ? 2 : 1), firstLine: 1, lastLine: headings[0].line - 1 });
  }
  headings.forEach((heading, index) => {
    const next = headings[index + 1], occurrence = occurrences.get(heading.id ?? '') ?? 0;
    occurrences.set(heading.id ?? '', occurrence + 1);
    const start = index === 0 && !result.length ? 0 : heading.start;
    result.push({
      key: heading.id ? `chapter:${heading.id}:${occurrence}` : `chapter:${index}`,
      chapterId: heading.id ?? chapters.find(chapter => chapter.name === heading.name)?.id,
      name: heading.name,
      start, end: next ? next.start - (source.slice(0, next.start).endsWith('\r\n') ? 2 : 1) : source.length,
      firstLine: start === 0 ? 1 : heading.line, lastLine: next ? next.line - 1 : rows.length,
    });
  });
  return result;
}

export function textChapterAtLine(chapters: TextChapter[], line: number): TextChapter | undefined {
  return chapters.find(chapter => line >= chapter.firstLine && line <= chapter.lastLine);
}
