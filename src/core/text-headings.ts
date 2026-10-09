export type TextHeadingKind = '章节' | '小章节' | '段落';
export interface TextHeading {
  kind: TextHeadingKind;
  parameters?: { start: number; end: number; closed: boolean };
  nameFrom?: number;
}

/** Heading offsets exclude punctuation inside quoted parameter values. */
export function textHeading(line: string, tolerant = false): TextHeading | undefined {
  const prefix = line.match(/^\s*#{1,3}\s*(章节|小章节|段落)\s*/);
  if (!prefix) return;
  const result: TextHeading = { kind: prefix[1] as TextHeadingKind };
  let cursor = prefix[0].length;
  if (/[（(]/.test(line[cursor] ?? '')) {
    const start = cursor + 1;
    let quote = '', escaped = false, close = -1, colon = -1;
    for (let index = start; index < line.length; index++) {
      const character = line[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (/[）)]/.test(character)) { close = index; break; }
      else if (colon < 0 && /[:：]/.test(character)) colon = index;
    }
    if (close < 0 && !tolerant) return;
    // While typing an opening parenthesis, the existing title and its hidden
    // identity still follow the colon, even before the closing one is typed.
    const end = close >= 0 ? close : colon >= 0 ? colon : line.length;
    result.parameters = { start, end, closed: close >= 0 };
    cursor = close >= 0 ? close + 1 : end;
    while (/\s/.test(line[cursor] ?? '')) cursor++;
  }
  if (/[:：]/.test(line[cursor] ?? '')) {
    cursor++;
    while (/\s/.test(line[cursor] ?? '')) cursor++;
    result.nameFrom = cursor;
    if (cursor < line.length || tolerant) return result;
  } else if (tolerant && cursor === line.length) return result;
}
