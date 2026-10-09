import { projectGraphs } from './project-resources';
import type { TextSourceLocation } from './text-script';
import { textReferenceSpans, type TextReferenceSpan } from './text-references';
import { textHeading, type TextHeadingKind } from './text-headings';
import type { Project } from './model';
import { blueprintCallName } from './blueprint-names';

export interface TextEdit { start: number; end: number; text: string }
interface DialogueAnchor { text: string; start: number; end: number }
interface PerformanceAnchor extends DialogueAnchor { after?: boolean }
export interface PerformanceFold { sourceLine: number; targetLine: number; after?: boolean }
export interface TextSourceRange { start: number; end: number }
export interface TextDocumentOptions { performances?: PerformanceFold[]; range?: TextSourceRange }
interface ReferenceAnchor { text: string; at: number; start: number; end: number; keepNameEdits: boolean; heading?: TextHeadingKind }
interface ProjectedLine { rawStart: number; start: number; hidden: boolean; performance?: boolean; spans: TextReferenceSpan[] }
export interface TextDocument {
  folding?: { document: TextDocument; ranges: { start: number; end: number }[] };
  source: string;
  text: string;
  sourceLines: number[];
  anchors: DialogueAnchor[];
  nodeAnchors: DialogueAnchor[];
  references: ReferenceAnchor[];
  projection: ProjectedLine[];
  performances: PerformanceAnchor[];
  scope?: { start: number; end: number; firstLine: number; lastLine: number; inner: TextDocument };
}

function lineStarts(source: string) {
  const starts = [0];
  for (const match of source.matchAll(/\r\n|\r|\n/g)) starts.push(match.index! + match[0].length);
  return starts;
}

function lineNumberAt(starts: number[], offset: number) {
  let low = 0, high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.max(1, low);
}

function wrapRangeDocument(source: string, start: number, end: number, firstLine: number, inner: TextDocument): TextDocument {
  const starts = lineStarts(source);
  const projection = starts.map((rawStart, index): ProjectedLine => {
    const local = inner.projection[index - firstLine + 1];
    return local ? { ...local, rawStart: local.rawStart + start } : { rawStart, start: index < firstLine - 1 ? 0 : inner.text.length, hidden: true, spans: [] };
  });
  const visibleLines = inner.text.split('\n').length;
  const lastLine = Math.max(firstLine, lineNumberAt(starts, Math.max(start, end - 1)));
  return { ...inner, source, projection, sourceLines: starts.map((_, index) => inner.sourceLines[index - firstLine + 1] ?? (index < firstLine - 1 ? 1 : visibleLines)), scope: { start, end, firstLine, lastLine, inner } };
}

/** Keep serialized dialogue IDs out of the editing surface and clipboard. */
export function textDocument(source: string, sourceMap: TextSourceLocation[] = [], options: TextDocumentOptions = {}): TextDocument {
  if (options.range && (options.range.start > 0 || options.range.end < source.length)) {
    const { start, end } = options.range;
    // A chapter range is the common editing path. Build the expensive text
    // projection only for that chapter; the outer projection keeps its line
    // indexes for navigation and is made from line starts without tokenizing
    // every line in the rest of the novel.
    const starts = lineStarts(source);
    const firstLine = lineNumberAt(starts, start);
    const lastLine = Math.max(firstLine, lineNumberAt(starts, Math.max(start, end - 1)));
    const included = (line: number) => line >= firstLine && line <= lastLine;
    const inner = textDocument(source.slice(start, end), sourceMap.filter(item => included(item.sourceLine)).map(item => ({ ...item, sourceLine: item.sourceLine - firstLine + 1 })), {
      performances: options.performances?.filter(fold => included(fold.sourceLine) && included(fold.targetLine)).map(fold => ({ ...fold, sourceLine: fold.sourceLine - firstLine + 1, targetLine: fold.targetLine - firstLine + 1 })),
    });
    return wrapRangeDocument(source, start, end, firstLine, inner);
  }
  const lines = source.split(/\r\n|\r|\n/), separators = [...source.matchAll(/\r\n|\r|\n/g)];
  let effectDefinition = false;
  const markerTypes: ('dialogue' | 'node' | undefined)[] = [];
  const markerIds = lines.map((line, index) => {
    if (/^\s*[@／/]?效果定义(?:\s*[:：]|\s)/.test(line)) effectDefinition = true;
    if (/^\s*[@／/]?效果结束\s*$/.test(line)) effectDefinition = false;
    if (effectDefinition) return undefined;
    const command = line.trim().match(/^[@／/]\s*(对白标记|节点标记)(?:\s*[:：]\s*|\s+)(.+)$/);
    if (!command) return undefined;
    const value = command[2].trim();
    const id = /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : value.match(/^.*?【([a-z][a-z0-9_]{0,63})】$/)?.[1];
    if (id) markerTypes[index] = command[1] === '节点标记' ? 'node' : 'dialogue';
    return id;
  });
  const dialogueLines = new Map<string, number>();
  for (const location of sourceMap) {
    if (!location.reference && location.actionCount === undefined && !dialogueLines.has(location.lineId)) dialogueLines.set(location.lineId, location.sourceLine - 1);
  }
  const visible: string[] = [];
  const starts: number[] = [];
  const sourceLines: number[] = [];
  const projection: ProjectedLine[] = [];
  const references: ReferenceAnchor[] = [];
  const folds = new Map((options.performances ?? []).filter(fold => Number.isInteger(fold.sourceLine) && fold.sourceLine >= 1 && fold.sourceLine <= lines.length && Number.isInteger(fold.targetLine) && fold.targetLine >= 1 && fold.targetLine <= lines.length).map(fold => [fold.sourceLine - 1, fold]));
  let offset = 0;
  let rawOffset = 0;
  lines.forEach((line, index) => {
    starts.push(offset);
    sourceLines.push(visible.length + 1);
    const hidden = !!markerIds[index] || folds.has(index);
    const spans = hidden ? [] : textReferenceSpans(line);
    projection.push({ rawStart: rawOffset, start: offset, hidden, performance: folds.has(index) || undefined, spans });
    rawOffset += line.length + (separators[index]?.[0].length ?? 0);
    if (hidden) return;
    const at = (column: number) => offset + column - spans.reduce((count, span) => count + Math.max(0, Math.min(column, span.to) - span.from), 0);
    for (const span of spans) references.push({ text: line.slice(span.from, span.to), at: at(span.from), start: at(span.nameFrom), end: at(span.nameTo), keepNameEdits: span.keepNameEdits, heading: span.heading });
    let clean = line;
    for (const span of [...spans].reverse()) clean = clean.slice(0, span.from) + clean.slice(span.to);
    visible.push(clean);
    offset += clean.length + 1;
  });
  const text = visible.join('\n');
  const performances: PerformanceAnchor[] = [];
  for (const [index, fold] of folds) {
    const target = fold.targetLine - 1;
    if (!projection[target] || projection[target].hidden) continue;
    const start = Math.min(starts[target], text.length);
    const end = Math.min(start + lines[target].length - projection[target].spans.reduce((count, span) => count + span.to - span.from, 0), text.length);
    performances.push({ text: lines[index], start, end, after: fold.after });
    sourceLines[index] = sourceLines[target];
    projection[index].start = start;
  }
  const anchors: DialogueAnchor[] = [];
  const nodeAnchors: DialogueAnchor[] = [];
  markerIds.forEach((id, index) => {
    if (!id) return;
    // A source map anchors the ID to its dialogue, past any stage commands.
    // During an incomplete edit there may be no parse location yet; keep the
    // marker hidden and anchored to the next visible line until parsing recovers.
    let target = markerTypes[index] === 'node' ? undefined : dialogueLines.get(id);
    if (target === undefined || !Number.isInteger(target) || target <= index || target >= lines.length) target = Math.min(index + 1, lines.length - 1);
    while (projection[target].hidden && target < lines.length - 1) target++;
    const start = Math.min(starts[target], text.length);
    const targetLength = lines[target].length - projection[target].spans.reduce((count, span) => count + span.to - span.from, 0);
    if (markerTypes[index] === 'node') {
      let boundary = index + 1;
      while (boundary < lines.length && markerTypes[boundary] !== 'node' && !/^\s*#{1,3}\s*(章节|小章节|段落)\s*(?:[（(].*?[）)]\s*)?[:：]/.test(lines[boundary])) boundary++;
      nodeAnchors.push({ text: lines[index], start, end: starts[boundary] ?? text.length });
    } else anchors.push({ text: lines[index], start, end: Math.min(start + (markerIds[target] ? 0 : targetLength), text.length) });
    sourceLines[index] = Math.min(sourceLines[target], Math.max(1, visible.length));
  });
  return { source, text, sourceLines, anchors, nodeAnchors, references, projection, performances };
}

export function textDocumentContainsLine(document: TextDocument, sourceLine: number): boolean {
  return !document.scope || sourceLine >= document.scope.firstLine && sourceLine <= document.scope.lastLine;
}

/** Resolve a caret on the editable surface to the corresponding stored line. */
export function sourceTextOffset(document: TextDocument, offset: number): number {
  if (document.folding) return sourceTextOffset(document.folding.document, unfoldedTextOffset(document.folding.ranges, offset));
  if (document.scope) return document.scope.start + sourceTextOffset(document.scope.inner, offset);
  const at = Math.max(0, Math.min(offset, document.text.length));
  let line: ProjectedLine | undefined;
  for (const candidate of document.projection) if (!candidate.hidden && candidate.start <= at) line = candidate;
  if (!line) return 0;
  let column = at - line.start;
  for (const span of line.spans) if (column >= span.from) column += span.to - span.from;
  return Math.min(document.source.length, line.rawStart + column);
}

export function visibleTextOffset(document: TextDocument, rawOffset: number): number {
  if (document.folding) return foldedTextOffset(document.folding.ranges, visibleTextOffset(document.folding.document, rawOffset));
  if (document.scope) return visibleTextOffset(document.scope.inner, rawOffset - document.scope.start);
  let low = 0, high = document.projection.length;
  while (low < high) { const middle = (low + high) >>> 1; if (document.projection[middle].rawStart <= rawOffset) low = middle + 1; else high = middle; }
  const line = document.projection[Math.max(0, low - 1)];
  const column = Math.max(0, rawOffset - line.rawStart);
  return Math.min(document.text.length, line.start + (line.hidden ? 0 : column - line.spans.reduce((count, span) => count + Math.max(0, Math.min(column, span.to) - span.from), 0)));
}

export function foldedTextOffset(ranges: { start: number; end: number }[], offset: number): number {
  return offset - ranges.reduce((removed, range) => removed + Math.max(0, Math.min(offset, range.end) - range.start), 0);
}

export function unfoldedTextOffset(ranges: { start: number; end: number }[], offset: number): number {
  let result = offset;
  for (const range of ranges) if (result >= range.start) result += range.end - range.start;
  return result;
}

export function visibleTextLine(document: TextDocument, sourceLine: number): number {
  return document.sourceLines[Math.max(0, Math.min(document.sourceLines.length - 1, sourceLine - 1))] ?? 1;
}

function plainTextDocumentEdit(document: TextDocument, edit: TextEdit) {
  if (/[\r\n【】]/.test(edit.text)) return;
  const rawStart = sourceTextOffset(document, edit.start), rawEnd = sourceTextOffset(document, edit.end);
  if (rawStart > rawEnd || /[\r\n]/.test(document.source.slice(rawStart, rawEnd))) return;
  let low = 0, high = document.projection.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (document.projection[middle].rawStart <= rawStart) low = middle + 1;
    else high = middle;
  }
  const lineIndex = Math.max(0, low - 1), line = document.projection[lineIndex];
  if (!line || line.hidden || line.spans.length) return;
  if (rawEnd > (document.projection[lineIndex + 1]?.rawStart ?? document.source.length)) return;
  const lineEnd = document.text.indexOf('\n', line.start);
  const visibleEnd = lineEnd < 0 ? document.text.length : lineEnd;
  if (edit.start < line.start || edit.end > visibleEnd) return;
  const oldLine = document.text.slice(line.start, visibleEnd);
  const nextLine = oldLine.slice(0, edit.start - line.start) + edit.text + oldLine.slice(edit.end - line.start);
  // Blank lines can remove a hidden dialogue identity; command/reference edits
  // can change the projection. Both need the full edit path.
  if (!nextLine.trim() || /^\s*[@／/#]/.test(oldLine) || /^\s*[@／/#]/.test(nextLine)) return;
  return { rawStart, rawEnd, lineIndex, delta: edit.text.length - (edit.end - edit.start) };
}

/**
 * Update a document for the common case of typing inside one plain visible
 * line. Re-tokenizing every line of a large script for each character makes
 * the controlled textarea feel sticky, while the surrounding line metadata
 * only needs offset adjustments. Structural edits and reference edits return
 * undefined so callers can fall back to the complete projection builder.
 */
export function patchTextDocument(document: TextDocument, source: string, edit: TextEdit): TextDocument | undefined {
  if (document.folding || document.source === source || /[\r\n【】]/.test(edit.text)) return;
  if (document.scope) {
    const { start, end, firstLine, inner } = document.scope;
    const rawStart = sourceTextOffset(document, edit.start), rawEnd = sourceTextOffset(document, edit.end);
    if (rawStart < start || rawEnd > end || /[\r\n]/.test(document.source.slice(rawStart, rawEnd))) return;
    const nextEnd = end + (source.length - document.source.length);
    const nextInner = source.slice(start, nextEnd);
    const patched = patchTextDocument(inner, nextInner, edit);
    if (!patched) return;
    const rawDelta = source.length - document.source.length;
    let low = 0, high = document.projection.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (document.projection[middle].rawStart <= rawStart) low = middle + 1;
      else high = middle;
    }
    const lineIndex = Math.max(0, low - 1), projection = document.projection.slice();
    for (let index = lineIndex + 1; index < projection.length; index++) {
      const candidate = projection[index];
      projection[index] = { ...candidate, rawStart: candidate.rawStart + rawDelta, start: candidate.start >= edit.end ? candidate.start + edit.text.length - (edit.end - edit.start) : candidate.start };
    }
    return { ...document, source, text: patched.text, projection, anchors: patched.anchors, nodeAnchors: patched.nodeAnchors, references: patched.references, performances: patched.performances, scope: { ...document.scope, end: nextEnd, inner: patched } };
  }
  const plain = plainTextDocumentEdit(document, edit);
  if (!plain) return;
  const { rawStart, rawEnd, lineIndex, delta } = plain;
  const expected = document.source.slice(0, rawStart) + edit.text + document.source.slice(rawEnd);
  if (expected !== source) return;
  const rawDelta = source.length - document.source.length;
  if (delta !== rawDelta) return;
  const nextText = document.text.slice(0, edit.start) + edit.text + document.text.slice(edit.end);
  const move = (value: number) => value <= edit.start ? value : value >= edit.end ? value + delta : edit.start + edit.text.length;
  const projection = document.projection.map((candidate, index) => ({
    ...candidate,
    rawStart: index > lineIndex ? candidate.rawStart + rawDelta : candidate.rawStart,
    start: index > lineIndex && candidate.start >= edit.end ? candidate.start + delta : candidate.start,
    spans: index === lineIndex ? [] : candidate.spans,
  }));
  return {
    ...document,
    source,
    text: nextText,
    projection,
    anchors: document.anchors.map(anchor => ({ ...anchor, start: move(anchor.start), end: move(anchor.end) })),
    nodeAnchors: document.nodeAnchors.map(anchor => ({ ...anchor, start: move(anchor.start), end: move(anchor.end) })),
    references: document.references.map(reference => ({ ...reference, at: move(reference.at), start: move(reference.start), end: move(reference.end) })),
    performances: document.performances.map(performance => ({ ...performance, start: move(performance.start), end: move(performance.end) })),
  };
}

/** After applying a rename, show the current label at every stable reference. */
export function refreshTextReferenceNames(project: Project, source: string): string {
  const names = new Map([...project.chapters, ...project.scenes, ...project.nodes, ...project.variables, ...project.assets, ...project.characters, ...project.effects, ...projectGraphs(project), ...projectGraphs(project).flatMap(graph => graph.exposedInputs), ...(project.ui.instances ?? []), ...(project.ui.flowStyles ?? []), ...project.characters.flatMap(character => [...character.expressions, ...(character.features ?? [])])].map(item => [item.id, item.name]));
  return source.split('\n').map(line => {
    for (const span of textReferenceSpans(line).reverse()) {
      if (span.from !== span.nameTo) continue;
      const id = line.slice(span.from, span.to).match(/^【([^】]+)】$/)?.[1];
      const graph = id && /^\s*[@／/]\s*$/.test(line.slice(0, span.nameFrom)) ? projectGraphs(project).find(graph => graph.id === id) : undefined;
      const name = graph ? blueprintCallName(graph) : id ? names.get(id) : undefined;
      if (name) {
        const quote = line[span.nameFrom - 1];
        const escaped = quote === '"' ? JSON.stringify(name).slice(1, -1) : quote === "'" ? name.replaceAll('\\', '\\\\').replaceAll("'", "\\'") : name;
        line = line.slice(0, span.nameFrom) + escaped + line.slice(span.nameTo);
      }
    }
    return line;
  }).join('\n');
}

/** The pre-input selection disambiguates edits within repeated text. */
export function textEdit(before: string, after: string, selection?: { start: number; end: number }): TextEdit {
  let start = 0;
  const prefixLimit = Math.min(before.length, after.length, selection?.start ?? before.length);
  while (start < prefixLimit && before[start] === after[start]) start++;
  let end = before.length;
  let afterEnd = after.length;
  const suffixLimit = Math.max(start, selection?.end ?? start);
  while (end > suffixLimit && afterEnd > start && before[end - 1] === after[afterEnd - 1]) { end--; afterEnd--; }
  // A paste can replace a large selection while leaving entire lines unchanged.
  // Keep those lines outside the edit so their invisible bindings survive. Only
  // trim complete lines; the explicit selection still disambiguates duplicates.
  if (before.slice(start, end).includes('\n') && after.slice(start, afterEnd).includes('\n')) {
    let common = start;
    while (common < end && common < afterEnd && before[common] === after[common]) common++;
    const prefix = before.lastIndexOf('\n', common - 1) + 1;
    if (prefix > start) start = prefix;
    let tail = 0;
    while (end - tail > start && afterEnd - tail > start && before[end - tail - 1] === after[afterEnd - tail - 1]) tail++;
    const tailStart = end - tail;
    // A shared suffix can already start at a complete line. Skipping to its
    // next newline would include that unchanged dialogue in the replacement
    // and discard its hidden ID, performance and voice bindings.
    const boundary = tailStart > 0 && before[tailStart - 1] === '\n' ? tailStart - 1 : before.indexOf('\n', tailStart);
    if (boundary >= tailStart - 1 && boundary < end) { const count = end - boundary - 1; end -= count; afterEnd -= count; }
  }
  return { start, end, text: after.slice(start, afterEnd) };
}

/** Apply a visible edit while keeping surviving dialogue IDs with their lines. */
export function editTextDocument(document: TextDocument, edit: TextEdit): string {
  return applyTextDocumentEdit(document, edit).source;
}

/** Return caret mapping as well as source, including newly inserted references. */
export function applyTextDocumentEdit(document: TextDocument, edit: TextEdit): { source: string; sourceOffset: (offset: number) => number } {
  if (document.folding) {
    const { ranges, document: base } = document.folding;
    const start = unfoldedTextOffset(ranges, edit.start), end = unfoldedTextOffset(ranges, edit.end);
    const result = applyTextDocumentEdit(base, { ...edit, start, end });
    const visibleDelta = edit.text.length - (edit.end - edit.start), baseDelta = edit.text.length - (end - start);
    return { source: result.source, sourceOffset: offset => result.sourceOffset(offset <= edit.start ? unfoldedTextOffset(ranges, offset) : offset <= edit.start + edit.text.length ? start + offset - edit.start : unfoldedTextOffset(ranges, offset - visibleDelta) + baseDelta) };
  }
  if (document.scope) {
    const { start, end, inner } = document.scope;
    const result = applyTextDocumentEdit(inner, edit);
    return { source: document.source.slice(0, start) + result.source + document.source.slice(end), sourceOffset: at => start + result.sourceOffset(at) };
  }
  const plain = plainTextDocumentEdit(document, edit);
  if (plain) {
    const { rawStart, rawEnd, delta } = plain;
    // Splice a plain line in the stored source directly. This retains CRLF
    // separators and avoids reconstructing every hidden marker and reference.
    return {
      source: document.source.slice(0, rawStart) + edit.text + document.source.slice(rawEnd),
      sourceOffset: offset => offset <= edit.start ? sourceTextOffset(document, offset)
        : offset <= edit.start + edit.text.length ? rawStart + offset - edit.start
        : sourceTextOffset(document, offset - delta) + delta,
    };
  }
  const next = document.text.slice(0, edit.start) + edit.text + document.text.slice(edit.end);
  if (next === document.text) return { source: document.source, sourceOffset: offset => sourceTextOffset(document, offset) };
  const delta = edit.text.length - (edit.end - edit.start);
  const insertions: { at: number; text: string }[] = [];
  for (const reference of document.references) {
    if (reference.heading) {
      const start = reference.start === 0 ? 0 : document.text.lastIndexOf('\n', reference.start - 1) + 1;
      const newline = document.text.indexOf('\n', start), end = newline < 0 ? document.text.length : newline;
      if (edit.start >= start && edit.end <= end && !/[\r\n]/.test(edit.text)) {
        const line = next.slice(start, end + delta), heading = textHeading(line, true);
        // Renaming or replacing a declaration edits the same directory item,
        // including the empty-name state between Backspace and new input.
        // An explicitly pasted identity takes precedence over the old one.
        if (heading?.kind === reference.heading && heading.nameFrom !== undefined && !textReferenceSpans(line).some(span => span.heading)) {
          insertions.push({ at: start + line.trimEnd().length, text: reference.text });
        }
        continue;
      }
    }
    const appendName = edit.start === edit.end && edit.start === reference.end && !!edit.text && !/^[\s，,]/.test(edit.text);
    const touchesName = edit.start < reference.end && edit.end > reference.start || appendName || edit.start === edit.end && edit.start >= reference.start && edit.start < reference.end;
    if (touchesName && (!reference.keepNameEdits || edit.start < reference.start || edit.end > reference.end || edit.text.includes('\n'))) continue;
    if (touchesName && edit.start <= reference.start && edit.end >= reference.end && !edit.text.trim()) continue;
    let at = reference.at;
    if (edit.end < at || edit.end === at && edit.start < edit.end || appendName) at += delta;
    else if (edit.start < at && edit.end > at) continue;
    insertions.push({ at, text: reference.text });
  }
  // If the user changed a command into plain text, don't expose its old ID.
  const byLine = new Map<number, typeof insertions>();
  for (const insertion of insertions) {
    const start = insertion.at === 0 ? 0 : next.lastIndexOf('\n', insertion.at - 1) + 1;
    byLine.set(start, [...(byLine.get(start) ?? []), insertion]);
  }
  insertions.length = 0;
  for (const [start, entries] of byLine) {
    const end = next.indexOf('\n', start);
    const line = next.slice(start, end < 0 ? next.length : end);
    let candidate = '', offset = 0;
    const ranges: { entry: (typeof entries)[number]; from: number; to: number }[] = [];
    for (const entry of entries.sort((a, b) => a.at - b.at)) {
      candidate += line.slice(offset, entry.at - start);
      ranges.push({ entry, from: candidate.length, to: candidate.length + entry.text.length });
      candidate += entry.text; offset = entry.at - start;
    }
    candidate += line.slice(offset);
    const spans = textReferenceSpans(candidate);
    for (const range of ranges) if (spans.some(span => span.from === range.from && span.to === range.to)) insertions.push(range.entry);
  }
  const retainedLine = (anchor: DialogueAnchor): number | undefined => {
    let position = anchor.start;
    if (edit.end <= anchor.start) position += delta;
    else if (edit.start < anchor.end) {
      if (edit.start <= anchor.start && edit.end >= anchor.end) {
        // Deleting a dialogue also deletes its hidden ID. Replacing only that
        // line's contents preserves its identity, as ordinary typing does.
        if (edit.start !== anchor.start || edit.end !== anchor.end || !edit.text.trim()) return;
        position = edit.start;
      } else if (edit.start <= anchor.start) position = edit.start + edit.text.length;
    }
    position = Math.max(0, Math.min(position, next.length));
    const lineStart = position === 0 ? 0 : next.lastIndexOf('\n', position - 1) + 1;
    const lineEnd = next.indexOf('\n', lineStart);
    if (!next.slice(lineStart, lineEnd < 0 ? next.length : lineEnd).trim()) return;
    return lineStart;
  };
  const markers = new Map<number, string>();
  for (const anchor of document.anchors) {
    const lineStart = retainedLine(anchor);
    if (lineStart === undefined) continue;
    // Joining lines keeps the first identity, instead of leaving a second
    // hidden marker to create a stray dialogue or take the next line's ID.
    if (!markers.has(lineStart)) markers.set(lineStart, anchor.text);
  }
  const performances: { at: number; text: string; afterCaret?: boolean }[] = [];
  for (const anchor of document.performances) {
    const start = retainedLine(anchor);
    if (start === undefined) continue;
    if (anchor.after) {
      const end = next.indexOf('\n', start);
      performances.push({ at: end < 0 ? next.length : end, text: `\n${anchor.text}`, afterCaret: true });
    } else {
      // The caret before a folded dialogue is after its existing performances.
      // Insert a new directive after those, just as in the unfolded editor.
      const appendingCommands = edit.start === anchor.start && edit.start === edit.end && edit.text.endsWith('\n') && edit.text.split('\n').every(row => !row.trim() || /^\s*[@／/]/.test(row));
      performances.push({ at: appendingCommands ? edit.start : start, text: `${anchor.text}\n` });
    }
  }
  const pieces: string[] = [];
  let offset = 0;
  const nodeMarkers = new Map<number, string>();
  for (const anchor of document.nodeAnchors) {
    if (edit.start <= anchor.start && edit.end >= anchor.end && edit.end > edit.start) continue;
    let position = anchor.start;
    if (edit.end <= anchor.start) position += delta;
    else if (edit.start <= anchor.start) position = edit.start + edit.text.length;
    const end = Math.min(next.length, anchor.end + (edit.end <= anchor.end ? delta : 0));
    position = Math.max(0, Math.min(position, next.length));
    let lineStart = position === 0 ? 0 : next.lastIndexOf('\n', position - 1) + 1;
    while (lineStart < end) {
      const lineEnd = next.indexOf('\n', lineStart);
      if (next.slice(lineStart, lineEnd < 0 ? next.length : lineEnd).trim()) break;
      if (lineEnd < 0) { lineStart = next.length; break; }
      lineStart = lineEnd + 1;
    }
    if (lineStart < end && !nodeMarkers.has(lineStart)) nodeMarkers.set(lineStart, anchor.text);
  }
  const additions: { at: number; text: string; afterCaret?: boolean }[] = [...nodeMarkers, ...markers].map(([at, text]) => ({ at, text: `${text}\n` })).concat(performances, insertions).sort((a, b) => a.at - b.at);
  for (const { at, text } of additions) {
    pieces.push(next.slice(offset, at), text);
    offset = at;
  }
  pieces.push(next.slice(offset));
  return { source: pieces.join(''), sourceOffset: at => at + additions.reduce((length, addition) => length + (addition.at < at || addition.at === at && !addition.afterCaret ? addition.text.length : 0), 0) };
}
