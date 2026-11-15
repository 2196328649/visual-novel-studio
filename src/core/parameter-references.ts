import { conditionSchema, type Project, type Variable } from './model';
import { parameterReference } from './parameter-sets';

interface ParameterOperand { from: number; to: number; format: 'reference' | 'json' }
export interface ParameterTextReference extends ParameterOperand { variableId: string }
// Prefer the stable identity when a display name itself contains an operator.
export const parameterAssignmentPattern = /^(.+?【[a-z][a-z0-9_]{0,63}】|.+?)\s*(\+=|=|设为|增加)\s*(.+)$/;
export const parameterConditionPattern = /^(.+?【[a-z][a-z0-9_]{0,63}】|.+?)\s*(>=|<=|==|!=|>|<|=)\s*(.+)$/;

/** Find the condition/assignment separator outside JSON and quoted values. */
export function parameterConditionalAssignment(source: string): { condition: string; assignment: string; assignmentFrom: number } | undefined {
  let quote = '', escaped = false, depth = 0;
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (quote) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === quote) quote = ''; }
    else if (character === '"' || character === "'") quote = character;
    else if (character === '{' || character === '[' || character === '【') depth++;
    else if (character === '}' || character === ']' || character === '】') depth--;
    else if (!depth && /[，,]/.test(character)) {
      const condition = source.slice(0, i).trimEnd(), assignmentFrom = i + 1 + (source.slice(i + 1).match(/^\s*/)?.[0].length ?? 0);
      const assignment = source.slice(assignmentFrom);
      if ((condition.trimStart().startsWith('{') || parameterConditionPattern.test(condition)) && parameterAssignmentPattern.test(assignment)) return { condition, assignment, assignmentFrom };
    }
  }
}

/** The parser, hidden-ID projection and reference manager share operand ranges.
 * Dialogue, comments, assignment values and quoted JSON text are never refs. */
export function parameterOperandRanges(line: string): ParameterOperand[] {
  const ranges: ParameterOperand[] = [];
  const content = line.endsWith('\r') ? line.slice(0, -1) : line;
  const add = (text: string, offset: number) => {
    const value = text.trim();
    if (value) ranges.push({ from: offset + text.indexOf(value), to: offset + text.indexOf(value) + value.length, format: 'reference' });
  };
  const command = content.match(/^(\s*[@／/]\s*(设置|变量|条件|如果)\s*[:：]\s*)(.*)$/)
    ?? content.match(/^(\s*[@／/]\s*(设置|变量|条件|如果)\s+)(.*)$/);
  if (!command) return ranges;
  let text = command[3], offset = command[1].length;
  const condition = (value: string, start: number) => {
    if (value.trim().startsWith('{')) {
      try {
        conditionSchema.parse(JSON.parse(value));
        const strings = [...value.matchAll(/"(?:\\.|[^"\\])*"/g)];
        strings.forEach((token, index) => {
          const next = strings[index + 1];
          if (JSON.parse(token[0]) === 'variableId' && next && /^\s*:\s*$/.test(value.slice(token.index! + token[0].length, next.index))) {
            ranges.push({ from: start + next.index!, to: start + next.index! + next[0].length, format: 'json' });
          }
        });
      } catch { /* Keep unfinished conditions untouched until the author repairs them. */ }
      return;
    }
    const match = value.match(parameterConditionPattern);
    if (match) add(match[1], start);
  };
  if (command[2] === '条件') { condition(text, offset); return ranges; }
  if (command[2] === '如果' || /^如果\s*/.test(text)) {
    const prefix = text.match(/^如果\s*/)?.[0] ?? '';
    text = text.slice(prefix.length); offset += prefix.length;
    const match = parameterConditionalAssignment(text);
    if (!match) return ranges;
    condition(match.condition, offset);
    offset += match.assignmentFrom; text = match.assignment;
  }
  const assignment = text.match(parameterAssignmentPattern);
  if (assignment) add(assignment[1], offset);
  return ranges;
}

export function parameterTextReferences(project: Project, line: string): ParameterTextReference[] {
  return parameterOperandRanges(line).flatMap(range => {
    const value = line.slice(range.from, range.to);
    if (range.format === 'json') return [{ ...range, variableId: JSON.parse(value) as string }];
    const explicit = value.match(/【([a-z][a-z0-9_]{0,63})】$/)?.[1];
    const named = project.variables.filter(variable => variable.name === value);
    const id = explicit ?? project.variables.find(variable => variable.id === value)?.id ?? (named.length === 1 ? named[0].id : undefined);
    return id ? [{ ...range, variableId: id }] : [];
  });
}

export function rewriteParameterReferences(project: Project, source: string, id: string, replacement: Pick<Variable, 'id' | 'name'>): string {
  let definitionOpen = false;
  return source.split('\n').map(line => {
    if (/^\s*[@／/]?效果定义\s*[:：]/.test(line)) definitionOpen = true;
    if (/^\s*[@／/]?效果结束\s*$/.test(line)) definitionOpen = false;
    if (definitionOpen) return line;
    for (const ref of parameterTextReferences(project, line).filter(ref => ref.variableId === id).reverse()) {
      line = line.slice(0, ref.from) + (ref.format === 'json' ? JSON.stringify(replacement.id) : parameterReference(replacement)) + line.slice(ref.to);
    }
    return line;
  }).join('\n');
}
