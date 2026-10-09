import type { Project } from './model';
import { applyTextScript, type TextParseResult } from './text-script';

export type TextScriptReader = typeof applyTextScript;

/** Editor-only reader for immutable history snapshots. Results are read-only:
 * callers that edit a parsed project must clone it or call applyTextScript.
 * Text commits share every branch except scriptText, so folding, the directory
 * and diagnostics can reuse the same parse without comparing the whole novel.
 */
export function createTextScriptReader(parse: TextScriptReader = applyTextScript) {
  const entries: { project: Project; source: string; sourceName?: string; result: TextParseResult }[] = [];
  const remember = (project: Project, source: string, result: TextParseResult, sourceName = project.scriptText?.sourceName) => {
    entries.push({ project, source, sourceName, result });
    if (entries.length > 2) entries.shift();
    return result;
  };
  const read: TextScriptReader = (project, source, sourceName = project.scriptText?.sourceName) => {
    const keys = Object.keys(project).filter(key => key !== 'scriptText') as (keyof Project)[];
    const index = entries.findIndex(entry => entry.source === source && entry.sourceName === sourceName
      && Object.keys(entry.project).filter(key => key !== 'scriptText').length === keys.length
      && keys.every(key => entry.project[key] === project[key]));
    if (index >= 0) {
      const [entry] = entries.splice(index, 1); entries.push(entry);
      return entry.result;
    }
    return remember(project, source, parse(project, source, sourceName), sourceName);
  };
  return Object.assign(read, { remember });
}
