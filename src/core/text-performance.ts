import type { Project } from './model';
import { applyTextScript, type TextParseResult } from './text-script';
import { textDocument, type PerformanceFold, type TextSourceRange } from './text-document';

/** Fold only successfully parsed performances with a visible, editable owner. */
export function performanceTextFolds(source: string, parsed: TextParseResult, revealLine?: number): PerformanceFold[] {
  const rows = source.replace(/\r\n?/g, '\n').split('\n');
  const errors = new Set(parsed.issues.filter(issue => issue.severity === 'error').map(issue => issue.sourceLine));
  const locations = parsed.sourceMap.filter(location => Number.isInteger(location.sourceLine) && location.sourceLine >= 1 && location.sourceLine <= rows.length);
  const dialogue = new Map<string, number>();
  for (const location of locations) if (!location.reference && location.actionCount === undefined && !dialogue.has(location.lineId)) dialogue.set(location.lineId, location.sourceLine);
  const folds = new Map<number, PerformanceFold>();
  for (const location of locations) {
    const targetLine = dialogue.get(location.lineId);
    if (location.reference || location.actionCount === undefined || !targetLine || targetLine <= location.sourceLine) continue;
    folds.set(location.sourceLine, { sourceLine: location.sourceLine, targetLine });
  }
  for (const targetLine of dialogue.values()) {
    for (let index = targetLine - 2; index >= 0; index--) {
      const row = rows[index].trim();
      if (/^[@／/]\s*配音\s*[:：]/.test(row)) folds.set(index + 1, { sourceLine: index + 1, targetLine });
      else if (row && !folds.has(index + 1) && !/^[@／/]\s*对白标记\s*[:：]/.test(row) && !/^(?:\/\/|;)/.test(row)) break;
    }
  }
  return [...folds.values()].filter(fold => fold.sourceLine !== revealLine && !errors.has(fold.sourceLine)).sort((a, b) => a.sourceLine - b.sourceLine);
}

export function performanceTextDocument(project: Project, source: string, hide: boolean, revealLine?: number, range?: TextSourceRange, parse = applyTextScript) {
  if (!hide) return textDocument(source, [], { range });
  const parsed = parse(project, source);
  return textDocument(source, parsed.sourceMap, { performances: hide ? performanceTextFolds(source, parsed, revealLine) : [], range });
}
