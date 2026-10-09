import { foldedTextOffset, type TextDocument } from './text-document';
import { textHeading } from './text-headings';

export function textSections(source: string) {
  const occurrences = new Map<string, number>();
  let offset = 0;
  const headings = source.split('\n').flatMap((line, index) => {
    const start = offset; offset += line.length + 1;
    const heading = textHeading(line, true);
    if (heading?.nameFrom === undefined) return [];
    const name = line.slice(heading.nameFrom), identity = heading.kind + ':' + name, occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return [{ key: identity + ':' + occurrence, name, level: heading.kind === '章节' ? 1 : heading.kind === '小章节' ? 2 : 3, line: index + 1, start, contentStart: Math.min(source.length, start + line.length + 1) }];
  });
  return headings.map((heading, index) => ({ ...heading, end: headings.slice(index + 1).find(next => next.level <= heading.level)?.start ?? source.length })).filter(heading => heading.end > heading.contentStart);
}

/** A reversible projection: collapsed text remains in the source and in edits. */
export function foldTextDocument(document: TextDocument, collapsed: Set<string>): TextDocument {
  const ranges: { start: number; end: number }[] = [];
  for (const section of textSections(document.text)) {
    if (collapsed.has(section.key) && !ranges.some(range => section.start >= range.start && section.start < range.end)) ranges.push({ start: section.contentStart, end: section.end });
  }
  if (!ranges.length) return document;
  const parts: string[] = []; let at = 0;
  for (const range of ranges) { parts.push(document.text.slice(at, range.start)); at = range.end; }
  parts.push(document.text.slice(at));
  const text = parts.join('');
  const projection = document.projection.map(line => ({ ...line, start: foldedTextOffset(ranges, line.start), hidden: line.hidden || ranges.some(range => line.start >= range.start && line.start < range.end) }));
  return { ...document, text, projection, sourceLines: projection.map(line => text.slice(0, line.start).split('\n').length), folding: { document, ranges } };
}

export function visibleTextSections(document: TextDocument, collapsed: Set<string>) {
  const base = document.folding?.document ?? document, ranges = document.folding?.ranges ?? [];
  return textSections(base.text).filter(section => !ranges.some(range => section.start >= range.start && section.start < range.end)).map(section => ({ ...section, collapsed: collapsed.has(section.key), line: document.text.slice(0, foldedTextOffset(ranges, section.start)).split('\n').length }));
}
