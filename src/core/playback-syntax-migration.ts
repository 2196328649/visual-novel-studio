import type { Project } from './model';
import { argumentText } from './text-arguments';
import { applyTextScript, serializeParameterValue, standaloneArguments, standaloneText } from './text-script';
import { isStandaloneNode } from './standalone-performance';

/** Move old call settings onto their declaration without rewriting author text or nodes. */
export function migratePlaybackSyntax(project: Project): boolean {
  const script = project.scriptText;
  if (!script || script.playbackSyntax === 'inline') return false;
  const separator = script.content.includes('\r\n') ? '\r\n' : '\n';
  const declaration = /^(\s*)[@／/]\s*独立演出\s*(?:[:：]\s*(.*))?$/;
  const rows = script.content.split(/\r?\n/).map(row => {
    const match = row.match(declaration), value = match?.[2];
    if (!match || !value || !project.nodes.some(node => isStandaloneNode(node) && node.name === value)) return row;
    const quoted = serializeParameterValue(value);
    return quoted === value ? row : match[1] + '@独立演出：' + quoted;
  });
  if (!rows.some(row => /^\s*[@／/]\s*演出(?:设置|转场)\s*[:：]/.test(row))) {
    const content = rows.join(separator), changed = content !== script.content;
    script.content = content; script.playbackSyntax = 'inline';
    return changed;
  }
  const parsed = applyTextScript(project, rows.join(separator));
  // An unfinished draft must remain editable, including its invalid settings.
  if (parsed.issues.some(issue => issue.severity === 'error')) return false;
  const remove = new Set<number>();
  for (const location of parsed.sourceMap) {
    if (location.reference) continue;
    const index = location.sourceLine - 1, match = rows[index].match(declaration);
    if (!match) continue;
    const node = parsed.project.nodes.find(node => node.id === location.nodeId);
    const line = node?.kind === 'passage' && node.lines.find(line => line.id === location.lineId);
    if (!line || !line.silent) continue;
    const settings = parsed.sourceMap.filter(other => other.playback && other.nodeId === location.nodeId && other.lineId === location.lineId);
    if (!settings.length) continue;
    const name = argumentText(standaloneArguments(match[2] ?? '')[0]);
    rows[index] = match[1] + standaloneText(name, line.playback);
    settings.forEach(other => remove.add(other.sourceLine - 1));
  }
  const content = rows.filter((_, index) => !remove.has(index)).join(separator);
  const changed = content !== script.content;
  script.content = content; script.playbackSyntax = 'inline';
  return changed;
}
