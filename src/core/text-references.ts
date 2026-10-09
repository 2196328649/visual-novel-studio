import { commandSignature } from './command-parameters';
import { argumentTokens, bindArguments } from './text-arguments';
import { textHeading, type TextHeadingKind } from './text-headings';

export interface TextReferenceSpan {
  from: number;
  to: number;
  nameFrom: number;
  nameTo: number;
  keepNameEdits: boolean;
  heading?: TextHeadingKind;
}

const definitions = new Set(['效果定义']);
const references = new Set(['入口', '调用', '实例', '场景基础', '场景模板', '场景蓝图', '界面实例', 'ui实例', '复用节点', '节点实例', '互动实例', '小游戏实例', '背景', '切换背景', '背景音乐', '音乐', '播放音乐', '音效', '播放音效', '配音', '效果', '蓝图', '通用蓝图', '隐藏', '隐藏角色', '章节背景', '章节题图', '章节音效']);

/** Recognize reference fields, never bracketed text in dialogue or UI labels. */
export function textReferenceSpans(line: string): TextReferenceSpan[] {
  const spans: TextReferenceSpan[] = [];
  const field = (from: number, to: number, keepNameEdits = false, heading?: TextHeadingKind) => {
    while (from < to && /\s/.test(line[from])) from++;
    while (to > from && /\s/.test(line[to - 1])) to--;
    if ((line[from] === '"' || line[from] === "'") && line[to - 1] === line[from]) { from++; to--; }
    const value = line.slice(from, to);
    const match = value.match(/【[a-z][a-z0-9_]{0,63}】\s*$/);
    if (!match || match.index === undefined) return;
    const nameFrom = from + (value.match(/^\s*/)?.[0].length ?? 0);
    const nameTo = from + match.index;
    spans.push({ from: nameTo, to: nameTo + match[0].trimEnd().length, nameFrom, nameTo, keepNameEdits, heading });
  };
  const heading = textHeading(line, true);
  if (heading) {
    if (heading.parameters) for (const token of argumentTokens(line.slice(heading.parameters.start, heading.parameters.end), true)) {
      if (token.name === '样式') field(heading.parameters.start + token.valueStart, heading.parameters.start + token.end);
    }
    if (heading.nameFrom !== undefined) field(heading.nameFrom, line.length, true, heading.kind);
    return spans;
  }
  const direct = line.match(/^(\s*[@／/]\s*)([^:：]*【[a-z][a-z0-9_]{0,63}】)\s*(?:[:：]|$)/);
  if (direct) field(direct[1].length, direct[1].length + direct[2].length);
  const command = line.match(/^(\s*[@／/]\s*([^:：]+?)\s*[:：]\s*)(.*)$/) ?? line.match(/^(\s*[@／/]\s*([^\s:：]+)\s+)(.*)$/);
  if (!command) return spans;
  const name = command[2].toLowerCase(), start = command[1].length, value = command[3];
  if (name === '动作') {
    const prefix = /^[@／/]/.test(value) ? '' : '@';
    const offset = start - prefix.length;
    return textReferenceSpans(prefix + value).map(span => ({ ...span, from: span.from + offset, to: span.to + offset, nameFrom: span.nameFrom + offset, nameTo: span.nameTo + offset }));
  }
  if (name === '演出实例') {
    const snapshot = value.match(/\s+使用【[a-z][a-z0-9_]{0,63}】\s*$/);
    const end = snapshot?.index === undefined ? line.length : start + snapshot.index;
    field(start, end, true);
    if (snapshot && spans[0]) spans.push({ ...spans[0], from: end, to: end + snapshot[0].trimEnd().length });
  } else if (name === '蓝图' || name === '通用蓝图' || direct) {
    for (const token of argumentTokens(value, true)) {
      if (token.name !== undefined) field(start + token.start, start + token.start + token.name.length);
      field(start + token.valueStart, start + token.end);
    }
  } else if (name === '选项') {
    const arrow = value.match(/->|→|前往/);
    if (arrow?.index !== undefined) field(start + arrow.index + arrow[0].length, line.length);
  } else if (['设置', '变量', 'set', '如果', '条件'].includes(name)) {
    const comparison = value.match(name === '如果' || name === '条件' ? /^(\s*)(.+?)\s*(?:>=|<=|==|!=|>|<|=)/ : /^(\s*如果\s+)(.+?)\s*(?:>=|<=|==|!=|>|<|=)/);
    if (comparison) field(start + comparison[1].length, start + comparison[1].length + comparison[2].length);
  } else if (definitions.has(name)) field(start, line.length, true);
  else {
    const signature = commandSignature(name);
    if (signature) {
      const referenceKinds = new Set(['character', 'expression', 'feature', 'target', 'node', 'effect', 'blueprint', 'sceneAsset', 'image', 'asset', 'bgm', 'sound', 'voice']);
      for (const { token, index } of bindArguments(value, signature.parameters, true).bindings) {
        if (!referenceKinds.has(signature.parameters[index]?.kind)) continue;
        const loop = signature.name === '背景音乐' && index === 0 ? token.raw.match(/\s+(?:循环|不循环)\s*$/) : undefined;
        field(start + token.valueStart, loop?.index === undefined ? start + token.end : start + token.valueStart + loop.index);
      }
    } else if (references.has(name)) field(start, line.length);
  }
  return spans;
}
