import type { Project, TextPause, TextPresentationStyle, TextSpan, TextSpanStyle } from './model';
import { animationSpec, entranceAnimations, fullAnimation } from './text-animation';
import { argumentTokens } from './text-arguments';

/** The part-line effects of one dialogue line. */
export interface TextMarks { spans?: TextSpan[]; pauses?: TextPause[] }
type MarkedLine = { text: string; textSpans?: TextSpan[]; textPauses?: TextPause[] };

export const lineMarks = (line: Pick<MarkedLine, 'textSpans' | 'textPauses'>): TextMarks => ({ spans: line.textSpans, pauses: line.textPauses });
export const hasTextMarks = (line: Pick<MarkedLine, 'textSpans' | 'textPauses'>) => !!line.textSpans?.length || !!line.textPauses?.length;

const styleKeys = ['color', 'sizeScale', 'bold', 'italic', 'fontAssetId', 'speed', 'entrance', 'entranceTime', 'loop', 'loopStrength', 'loopSpeed'] as const;
const cleanStyle = (style: TextSpanStyle): TextSpanStyle | undefined => {
  const result: TextSpanStyle = {};
  for (const key of styleKeys) if (style[key] !== undefined) (result as Record<string, unknown>)[key] = style[key];
  return Object.keys(result).length ? result : undefined;
};
const sameStyle = (a?: TextSpanStyle, b?: TextSpanStyle) => a === b || !!a && !!b && styleKeys.every(key => a[key] === b[key]);

/** One style slot per character; later spans win where old data overlaps. */
function styleSlots(length: number, spans: readonly TextSpan[] = []) {
  const slots: (TextSpanStyle | undefined)[] = new Array(length).fill(undefined);
  for (const span of spans) for (let index = span.start; index < Math.min(span.end, length); index++) slots[index] = span.style;
  return slots;
}
function slotsToSpans(slots: readonly (TextSpanStyle | undefined)[]): TextSpan[] {
  const spans: TextSpan[] = [];
  slots.forEach((slot, index) => {
    const style = slot && cleanStyle(slot);
    if (!style) return;
    const last = spans[spans.length - 1];
    if (last && last.end === index && sameStyle(last.style, style)) last.end = index + 1;
    else spans.push({ start: index, end: index + 1, style });
  });
  return spans;
}

/** Fit marks to the text: in range, ordered, non-overlapping, equal neighbours merged. */
export function normalizeTextMarks(text: string, marks: TextMarks): Required<TextMarks> {
  const length = Array.from(text).length;
  const pauses = new Map<number, number>();
  for (const pause of marks.pauses ?? []) if (pause.seconds > 0 && pause.at <= length) pauses.set(pause.at, pause.seconds);
  return { spans: slotsToSpans(styleSlots(length, marks.spans)), pauses: [...pauses].sort(([a], [b]) => a - b).map(([at, seconds]) => ({ at, seconds })) };
}

/** Change fields on a range of characters; an undefined field is removed, other fields stay. */
export function applySpanStyle(text: string, spans: readonly TextSpan[] | undefined, start: number, end: number, patch: Partial<TextSpanStyle>): TextSpan[] {
  const slots = styleSlots(Array.from(text).length, spans);
  for (let index = Math.max(0, start); index < Math.min(end, slots.length); index++) slots[index] = { ...slots[index], ...patch };
  return slotsToSpans(slots);
}

export function clearSpanStyle(text: string, spans: readonly TextSpan[] | undefined, start: number, end: number): TextSpan[] {
  const slots = styleSlots(Array.from(text).length, spans);
  for (let index = Math.max(0, start); index < Math.min(end, slots.length); index++) slots[index] = undefined;
  return slotsToSpans(slots);
}

export function setTextPause(pauses: readonly TextPause[] | undefined, at: number, seconds: number | undefined): TextPause[] {
  const others = (pauses ?? []).filter(pause => pause.at !== at);
  return (seconds && seconds > 0 ? [...others, { at, seconds }] : others).sort((a, b) => a.at - b.at);
}

/** Carry marks across a text edit. Words outside the changed part keep their effects; typing
 * inside an effect extends it; retyping a marked word keeps the word's effect. */
export function rebaseTextMarks(before: string, after: string, marks: TextMarks): Required<TextMarks> {
  const old = Array.from(before), next = Array.from(after);
  let prefix = 0;
  while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  const oldEnd = old.length - suffix, nextEnd = next.length - suffix;
  const slots = styleSlots(old.length, marks.spans);
  const inserted = oldEnd > prefix ? slots[prefix] : prefix > 0 && prefix < old.length && sameStyle(slots[prefix - 1], slots[prefix]) ? slots[prefix - 1] : undefined;
  const moved = [...slots.slice(0, prefix), ...new Array(nextEnd - prefix).fill(inserted), ...slots.slice(oldEnd)];
  const pauses = (marks.pauses ?? []).flatMap(pause => {
    if (pause.at < prefix || pause.at === prefix && oldEnd > prefix && nextEnd > prefix) return [pause];
    if (pause.at >= oldEnd) return [{ ...pause, at: pause.at + nextEnd - oldEnd }];
    return []; // The word it waited before was deleted.
  });
  return normalizeTextMarks(after, { spans: slotsToSpans(moved), pauses });
}

/** Replace a line's words, keeping its part-line effects attached to the same words. */
export function setLineText(line: MarkedLine, text: string) {
  if (hasTextMarks(line)) writeLineMarks(line, rebaseTextMarks(line.text, text, lineMarks(line)), text);
  line.text = text;
}

export function writeLineMarks(line: Pick<MarkedLine, 'textSpans' | 'textPauses'>, marks: TextMarks, text?: string) {
  const fitted = text === undefined ? { spans: marks.spans ?? [], pauses: marks.pauses ?? [] } : normalizeTextMarks(text, marks);
  if (fitted.spans.length) line.textSpans = fitted.spans; else delete line.textSpans;
  if (fitted.pauses.length) line.textPauses = fitted.pauses; else delete line.textPauses;
}

export interface TextCharacterMark { style?: TextSpanStyle; pause: number; /** Native glyph ordinal, including the zero-width glyphs used for pauses. */ glyphIndex: number }

/** Per visible character (line breaks skipped): its effect and the wait before it. */
export function textCharacterMarks(text: string, marks: TextMarks = {}) {
  const characters = Array.from(text), slots = styleSlots(characters.length, marks.spans);
  const pauses = new Map((marks.pauses ?? []).map(pause => [pause.at, pause.seconds]));
  const result: TextCharacterMark[] = [];
  let waiting = 0, glyphIndex = 0, paragraphHasText = false;
  characters.forEach((character, index) => {
    const pause = pauses.get(index) ?? 0;
    waiting += pause;
    if (pause > 0) glyphIndex++;
    if (character === '\n') {
      if (!paragraphHasText) glyphIndex++; // Native empty paragraphs keep one zero-width layout glyph.
      paragraphHasText = false;
      return;
    }
    paragraphHasText = true;
    result.push({ style: slots[index], pause: waiting, glyphIndex: glyphIndex++ }); waiting = 0;
  });
  return { characters: result, trailing: waiting + (pauses.get(characters.length) ?? 0) };
}

const escapeRenpy = (text: string) => text.replaceAll('[', '[[').replaceAll('{', '{{');
const number = (value: number) => String(+value.toFixed(4));

export interface TextEffectDefaults { strength: Record<string, number>; speed: Record<string, number>; entrance: Record<string, number>; entranceCap?: number; lineStyle?: TextPresentationStyle }

/** A part's entrance and loop as `{vn_fx}` data, "-" following the line. The game builds the shader from it and the line's look.
 * A time-only override uses the line's full animation with that duration; an
 * untouched entrance stays "-" so it follows the line at run time. */
export function spanEffectTag(style: TextSpanStyle, defaults: TextEffectDefaults) {
  const { entrance, loop } = style;
  if (!entrance && !loop && style.entranceTime === undefined) return undefined;
  const effect = entrance ?? (style.entranceTime !== undefined ? defaults.lineStyle?.entrance : undefined);
  const seconds = style.entranceTime ?? (effect ? defaults.entrance[effect] : undefined);
  const start = !effect ? '-' : effect === 'none' ? 'none' : animationSpec(fullAnimation(entranceAnimations, effect, entrance ? undefined : defaults.lineStyle?.entranceAnimation), Math.min(seconds!, defaults.entranceCap ?? Infinity));
  const motion = !loop ? '-' : loop === 'none' ? 'none' : `${loop}@${number(style.loopStrength ?? defaults.strength[loop])}@${number(style.loopSpeed ?? defaults.speed[loop])}`;
  return `${start}|${motion}`;
}

/** Dialogue text with Ren'Py tags. Authored words stay escaped; only generated tags are live. */
export function renpyMarkedText(project: Project, text: string, marks: TextMarks, defaults: TextEffectDefaults) {
  const { spans, pauses } = normalizeTextMarks(text, marks);
  if (!spans.length && !pauses.length) return escapeRenpy(text);
  const characters = Array.from(text);
  const opens = new Map(spans.map(span => [span.start, span])), closes = new Map(spans.map(span => [span.end, span]));
  const waits = new Map(pauses.map(pause => [pause.at, pause.seconds]));
  // A zero-width space at 1/N characters per second waits N seconds and draws nothing.
  const wait = (seconds: number) => `{cps=${+(1 / seconds).toFixed(6)}}{space=0}{/cps}`;
  const tags = (style: TextSpanStyle) => {
    const font = project.assets.find(asset => asset.id === style.fontAssetId && asset.kind === 'font');
    const fontPath = font && !/[{}]/.test(font.path) ? font.path.replaceAll('\\', '/').replaceAll('[', '[[') : undefined;
    const effect = spanEffectTag(style, defaults);
    // The effect stays innermost so its tag wraps only the words.
    return [
      style.color && ['color=' + style.color, 'color'],
      style.sizeScale !== undefined && ['size=*' + number(style.sizeScale), 'size'],
      style.bold && ['b', 'b'],
      style.italic && ['i', 'i'],
      fontPath && ['font=' + fontPath, 'font'],
      style.speed !== undefined && ['cps=*' + number(style.speed), 'cps'],
      effect && ['vn_fx=' + effect, 'vn_fx'],
    ].filter(Boolean) as [string, string][];
  };
  let output = '';
  characters.forEach((character, index) => {
    const closing = closes.get(index), opening = opens.get(index), seconds = waits.get(index);
    if (closing) output += tags(closing.style).reverse().map(([, close]) => `{/${close}}`).join('');
    if (seconds) output += wait(seconds);
    if (opening) output += tags(opening.style).map(([open]) => `{${open}}`).join('');
    output += escapeRenpy(character);
  });
  const closing = closes.get(characters.length), seconds = waits.get(characters.length);
  if (closing) output += tags(closing.style).reverse().map(([, close]) => `{/${close}}`).join('');
  if (seconds) output += wait(seconds);
  return output;
}

const loopWords = { none: '无', shake: '抖动', wave: '波浪', pulse: '呼吸' } as const;
const entranceWords = { none: '普通', fade: '逐字淡入', zoom: '逐字放大', slam: '逐字砸入', flip: '逐字翻转', drop: '逐字落下', rise: '逐字升起' } as const;
const entranceNames = Object.fromEntries(Object.entries(entranceWords).map(([id, name]) => [name, id])) as Record<string, TextSpanStyle['entrance']>;

/** A short description of one effect for lists and chips. */
export function textSpanSummary(project: Project, style: TextSpanStyle) {
  const parts: string[] = [];
  if (style.color) parts.push(style.color);
  if (style.sizeScale !== undefined) parts.push(`大小 ${+(style.sizeScale * 100).toFixed(1)}%`);
  if (style.bold) parts.push('粗体');
  if (style.italic) parts.push('斜体');
  if (style.fontAssetId) parts.push(project.assets.find(asset => asset.id === style.fontAssetId)?.name ?? '字体已删除');
  if (style.speed !== undefined) parts.push(`速度 ${+style.speed.toFixed(3)} 倍`);
  if (style.entrance) parts.push(style.entrance === 'none' ? '无入场' : entranceWords[style.entrance]);
  if (style.loop) parts.push(style.loop === 'none' ? '无动画' : loopWords[style.loop]);
  return parts.join(' · ') || '无效果';
}

/** The characters a mark covers, or follows, for showing it to the author. */
export const textRangeWords = (text: string, start: number, end: number) => Array.from(text).slice(start, end).join('').replaceAll('\n', ' ');

export function textMarksProblems(project: Project, line: Pick<MarkedLine, 'textSpans'>) {
  const missing = (line.textSpans ?? []).some(span => span.style.fontAssetId && !project.assets.some(asset => asset.id === span.style.fontAssetId && asset.kind === 'font'));
  return missing ? ['局部文字效果的字体已不存在，将使用这句的字体。'] : [];
}

/** The style a whole range shares: a field differing anywhere in the range is left out. */
export function sharedSpanStyle(text: string, spans: readonly TextSpan[] | undefined, start: number, end: number): TextSpanStyle {
  const slots = styleSlots(Array.from(text).length, spans).slice(start, end);
  const result: TextSpanStyle = {};
  for (const key of styleKeys) {
    const value = slots[0]?.[key];
    if (value !== undefined && slots.every(slot => slot?.[key] === value)) (result as Record<string, unknown>)[key] = value;
  }
  return result;
}

const markupPause = /^〖\s*停顿\s*[=＝]\s*([^〖〗｜|]*?)\s*秒?\s*〗/u;
const markupSpan = /^〖([^〖〗]+)[｜|]([^〖〗｜|]*)〗/u;

export type TextMarkupSyntax = 'legacy' | 'quoted';
export const quotedTextMarkupDeclaration = '@局部文字语法：带引号';
export const isTextMarkupDeclaration = (row: string) => /^\s*[@／/]\s*局部文字语法(?:\s*[:：]|\s|$)/.test(row);
export const spanMarkupText = (words: string, parameters: string, syntax: TextMarkupSyntax = 'legacy') => `〖${syntax === 'quoted' ? JSON.stringify(words) : words}｜${parameters}〗`;

/** Read only a JSON string, without assigning escapes to unquoted old prose. */
function quotedMarkupString(source: string, start: number) {
  if (source[start] !== '"') throw new Error('带引号的局部文字请用 JSON 双引号包住正文。');
  let escaped = false;
  for (let index = start + 1; index < source.length; index++) {
    const character = source[index];
    if (escaped) escaped = false;
    else if (character === '\\') escaped = true;
    else if (character === '"') {
      const value: unknown = JSON.parse(source.slice(start, index + 1));
      if (typeof value !== 'string') throw new Error('局部文字正文必须是字符串。');
      return { value, end: index + 1 };
    }
  }
  throw new Error('局部文字的双引号没有闭合。');
}

function quotedMarkupSpan(source: string) {
  const words = quotedMarkupString(source, 1);
  if (source[words.end] === '〗') return { words: words.value, parameters: undefined, end: words.end + 1 };
  if (!words.value) throw new Error('局部文字效果不能覆盖空正文。');
  if (!/[｜|]/.test(source[words.end] ?? '')) throw new Error('局部文字正文后需要 ｜ 和效果参数。');
  const start = words.end + 1;
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (character === '"') { index = quotedMarkupString(source, index).end - 1; continue; }
    if (character === '〗') {
      const parameters = source.slice(start, index);
      if (!parameters.trim()) throw new Error('请填写局部文字的效果参数。');
      return { words: words.value, parameters, end: index + 1 };
    }
    if (/[〖｜|\r\n]/.test(character)) throw new Error('局部文字效果中的特殊字符请放在双引号值内。');
  }
  throw new Error('局部文字效果缺少结束括号 〗。');
}

export interface ParsedTextMarkup { text: string; spans: { start: number; end: number; parameters: string }[]; pauses: TextPause[] }

/** Read one row's effects and pauses. Explicit quoted rows also accept
 * `〖"原文"〗` for words that must keep whitespace or literal delimiters. */
export function parseTextMarkup(row: string, syntax: TextMarkupSyntax = 'legacy'): ParsedTextMarkup {
  const spans: ParsedTextMarkup['spans'] = [], pauses: TextPause[] = [];
  let text = '', length = 0, rest = row;
  const append = (words: string) => { text += words; length += Array.from(words).length; };
  while (rest) {
    const at = rest.indexOf('〖');
    if (at < 0) { append(rest); break; }
    append(rest.slice(0, at)); rest = rest.slice(at);
    if (rest.startsWith('〖〖')) { append('〖'); rest = rest.slice(2); continue; }
    const pause = rest.match(markupPause);
    if (pause) {
      const seconds = Number(pause[1]);
      if (!pause[1] || !Number.isFinite(seconds) || seconds <= 0) throw new Error(`停顿需大于 0 秒：${pause[0]}`);
      pauses.push({ at: length, seconds }); rest = rest.slice(pause[0].length); continue;
    }
    if (syntax === 'quoted') {
      const span = quotedMarkupSpan(rest), start = length;
      append(span.words);
      if (span.parameters !== undefined) spans.push({ start, end: length, parameters: span.parameters });
      rest = rest.slice(span.end); continue;
    }
    const span = rest.match(markupSpan);
    if (span) {
      const start = length;
      append(span[1]);
      spans.push({ start, end: length, parameters: span[2] }); rest = rest.slice(span[0].length); continue;
    }
    append('〖'); rest = rest.slice(1);
  }
  return { text, spans, pauses };
}

/** Source selections inside an existing mark cannot be wrapped with another
 * mark: that would edit JSON escapes or effect parameters instead of words. */
export function plainTextMarkupRange(row: string, start: number, end: number, syntax: TextMarkupSyntax = 'legacy'): boolean {
  let index = 0;
  while (index < row.length) {
    const at = row.indexOf('〖', index);
    if (at < 0) break;
    if (row.startsWith('〖〖', at)) { index = at + 2; continue; }
    const rest = row.slice(at), old = rest.match(markupPause) ?? (syntax === 'legacy' ? rest.match(markupSpan) : undefined);
    let markEnd = old ? at + old[0].length : undefined;
    if (syntax === 'quoted' && markEnd === undefined) {
      try { markEnd = at + quotedMarkupSpan(rest).end; }
      catch { markEnd = row.length; }
    }
    if (markEnd === undefined) { index = at + 1; continue; }
    if (start === end ? start > at && start < markEnd : start < markEnd && end > at) return false;
    index = markEnd;
  }
  return true;
}

/** Write a line as one row per line break, the inverse of `parseTextMarkup`. */
export function textMarkupRows(line: MarkedLine, parameters: (style: TextSpanStyle) => string, syntax: TextMarkupSyntax = 'legacy'): string[] {
  const { spans, pauses } = normalizeTextMarks(line.text, lineMarks(line));
  const characters = Array.from(line.text), marked = spans.length > 0 || pauses.length > 0;
  const slots = styleSlots(characters.length, spans), waits = new Map(pauses.map(pause => [pause.at, pause.seconds]));
  const literal = (index: number) => {
    const character = characters[index];
    if (character !== '〖') return character;
    const remaining = characters.slice(index).join('');
    return marked || remaining.startsWith('〖〖') || markupPause.test(remaining) || markupSpan.test(remaining) ? '〖〖' : character;
  };
  // Quoted words retain even styled delimiters and line breaks. Old rows keep
  // their original spelling and escape meanings.
  const plain = (index: number) => !slots[index] || syntax === 'legacy' && (characters[index] === '\n' || characters[index] === '〖' || characters[index] === '〗');
  let output = '';
  for (let index = 0; index < characters.length;) {
    if (waits.has(index)) output += `〖停顿=${number(waits.get(index)!)}〗`;
    if (plain(index)) {
      if (syntax === 'legacy' || characters[index] === '\n') { output += characters[index] === '\n' ? '\n' : literal(index); index++; continue; }
      let end = index + 1;
      while (end < characters.length && plain(end) && characters[end] !== '\n' && !waits.has(end)) end++;
      const words = characters.slice(index, end).join('');
      // Keep ordinary unstyled words directly editable. A quoted literal only
      // protects text that line trimming or markup scanning would otherwise change.
      output += /[〖〗\r]|^\s|\s$/u.test(words) ? `〖${JSON.stringify(words)}〗` : words;
      index = end; continue;
    }
    let end = index + 1;
    while (end < characters.length && !plain(end) && !waits.has(end) && sameStyle(slots[end], slots[index])) end++;
    output += spanMarkupText(characters.slice(index, end).join(''), parameters(slots[index]!), syntax);
    index = end;
  }
  if (waits.has(characters.length)) output += `〖停顿=${number(waits.get(characters.length)!)}〗`;
  // An empty first row still owns the declaration when the line begins with a
  // break. Empty literal rows also remain visible when editing the script.
  return output.split('\n').map(row => syntax === 'quoted' && !row ? '〖""〗' : row);
}

const loopNames: Record<string, TextSpanStyle['loop']> = { 无: 'none', 抖动: 'shake', 波浪: 'wave', 呼吸: 'pulse' };
const sizeWords: Record<string, number> = { 较小: .8, 较大: 1.3, 很大: 1.7 };
const speedWords: Record<string, number> = { 很慢: .25, 慢: .5, 快: 2, 很快: 4 };

/** `颜色=#ff0000，抖动` → a span style. Bare words work for the common effects. */
export function parseSpanParameters(project: Project, parameters: string, syntax: TextMarkupSyntax = 'legacy'): TextSpanStyle {
  const style: TextSpanStyle = {};
  const parts = syntax === 'quoted' ? argumentTokens(parameters).map(token => ({ raw: parameters.slice(token.start, token.end).trim(), name: token.name, value: token.raw }))
    : parameters.split(/[，,]/).map(part => part.trim()).map(raw => { const [name, ...rest] = raw.split(/[=＝]/); return { raw, name: rest.length ? name.trim() : undefined, value: rest.length ? rest.join('=').trim() : name }; });
  for (const { raw, name, value: sourceValue } of parts.filter(part => part.raw)) {
    const key = name ?? sourceValue.trim();
    let value = sourceValue.replace(/^["“](.*)["”]$/, '$1');
    if (syntax === 'quoted' && sourceValue.startsWith('"')) {
      const quoted = quotedMarkupString(sourceValue, 0);
      if (quoted.end !== sourceValue.length) throw new Error('局部文字参数的引号后有多余内容。');
      value = quoted.value;
    }
    if (name === undefined) {
      if (key === '粗体') style.bold = true;
      else if (key === '斜体') style.italic = true;
      else if (loopNames[key]) style.loop = loopNames[key];
      else if (entranceNames[key]) style.entrance = entranceNames[key];
      else if (sizeWords[key]) style.sizeScale = sizeWords[key];
      else if (speedWords[key]) style.speed = speedWords[key];
      else if (/^#[0-9a-fA-F]{6}$/.test(key)) style.color = key;
      else throw new Error(`不认识的文字效果：${key}。可写 颜色、大小、粗体、斜体、字体、速度、入场、入场时间、持续效果、幅度、频率。`);
      continue;
    }
    const positive = (label: string) => { const parsed = Number(value.replace(/[%％倍]$/, '')); if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label}需大于 0：${raw}`); return parsed; };
    const flag = () => { if (/^(是|true)$/i.test(value)) return true as const; if (/^(否|false)$/i.test(value)) return undefined; throw new Error(`${key}请填写是或否：${raw}`); };
    switch (key) {
      case '颜色': if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`颜色请填写六位颜色，例如 #ff0000：${raw}`); style.color = value; break;
      case '大小': style.sizeScale = sizeWords[value] ?? positive('大小') / 100; break;
      case '粗体': style.bold = flag(); break;
      case '斜体': style.italic = flag(); break;
      case '字体': {
        const match = value.match(/^(.*?)【([a-z][a-z0-9_]{0,63})】$/s);
        const font = project.assets.find(asset => asset.kind === 'font' && (match ? asset.id === match[2] : asset.name === value || asset.id === value));
        if (!font && !match) throw new Error(`找不到字体素材：${value}`);
        style.fontAssetId = font?.id ?? match![2]; break;
      }
      case '速度': style.speed = speedWords[value] ?? positive('速度'); break;
      case '入场': if (!entranceNames[value]) throw new Error(`入场只支持：${Object.values(entranceWords).join('、')}。`); style.entrance = entranceNames[value]; break;
      case '入场时间': { const parsed = Number(value.replace(/秒$/, '')); if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`入场时间不能小于 0：${raw}`); style.entranceTime = parsed; break; }
      case '持续效果': if (!loopNames[value]) throw new Error(`持续效果只支持：无、抖动、波浪、呼吸。`); style.loop = loopNames[value]; break;
      case '幅度': { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`幅度不能小于 0：${raw}`); style.loopStrength = parsed; break; }
      case '频率': style.loopSpeed = positive('频率'); break;
      default: throw new Error(`没有文字效果参数“${key}”。可用：颜色、大小、粗体、斜体、字体、速度、入场、入场时间、持续效果、幅度、频率。`);
    }
  }
  return cleanStyle(style) ?? {};
}

export function spanParameterText(project: Project, style: TextSpanStyle, syntax: TextMarkupSyntax = 'legacy'): string {
  const parts: string[] = [];
  if (style.color) parts.push('颜色=' + style.color);
  if (style.sizeScale !== undefined) parts.push('大小=' + number(style.sizeScale * 100));
  if (style.bold) parts.push('粗体');
  if (style.italic) parts.push('斜体');
  if (style.fontAssetId) {
    const reference = `${project.assets.find(asset => asset.id === style.fontAssetId)?.name ?? '字体'}【${style.fontAssetId}】`;
    parts.push('字体=' + (syntax === 'quoted' ? JSON.stringify(reference) : reference));
  }
  if (style.speed !== undefined) parts.push('速度=' + number(style.speed));
  if (style.entrance) parts.push('入场=' + entranceWords[style.entrance]);
  if (style.entranceTime !== undefined) parts.push('入场时间=' + number(style.entranceTime));
  if (style.loop) parts.push('持续效果=' + loopWords[style.loop]);
  if (style.loopStrength !== undefined) parts.push('幅度=' + number(style.loopStrength));
  if (style.loopSpeed !== undefined) parts.push('频率=' + number(style.loopSpeed));
  return parts.join('，');
}

/** Parse one source row into words and marks, offsets counted from `offset`. */
export function readMarkedRow(project: Project, row: string, offset = 0, syntax: TextMarkupSyntax = 'legacy'): { text: string; spans: TextSpan[]; pauses: TextPause[] } {
  const parsed = parseTextMarkup(row, syntax);
  return {
    text: parsed.text,
    spans: parsed.spans.flatMap(span => { const style = parseSpanParameters(project, span.parameters, syntax); return Object.keys(style).length ? [{ start: span.start + offset, end: span.end + offset, style }] : []; }),
    pauses: parsed.pauses.map(pause => ({ ...pause, at: pause.at + offset })),
  };
}

export const lineMarkupRows = (project: Project, line: MarkedLine, syntax: TextMarkupSyntax = 'legacy') => textMarkupRows(line, style => spanParameterText(project, style, syntax), syntax);

/** Only words or font references that the old grammar cannot carry opt in.
 * Every styled part of that one line is then quoted, including ordinary words
 * starting with a quote; no unversioned text is reinterpreted. */
export function lineMarkupSyntax(project: Project, line: MarkedLine): TextMarkupSyntax {
  const characters = Array.from(line.text);
  const { spans } = normalizeTextMarks(line.text, lineMarks(line));
  const trimmedWords = /\r/.test(line.text) || line.text.split('\n').some(row => /^\s|\s$/u.test(row));
  return trimmedWords || spans.some(span => characters.slice(span.start, span.end).some(character => /[〖〗\r\n]/.test(character))
    || span.style.fontAssetId && /[〖〗｜|，,=＝;；"“”'\\\r\n]/.test(project.assets.find(asset => asset.id === span.style.fontAssetId)?.name ?? '')) ? 'quoted' : 'legacy';
}

/** One shared source writer for full export, property edits and revisions.
 * The declaration belongs immediately to this dialogue, never to its actions. */
export function dialogueMarkupRows(project: Project, line: MarkedLine, speakerPrefix: string): string[] {
  const syntax = lineMarkupSyntax(project, line), [first, ...rest] = lineMarkupRows(project, line, syntax);
  return [...(syntax === 'quoted' ? [quotedTextMarkupDeclaration] : []), speakerPrefix + first, ...rest.map(row => `@续行：${row}`)];
}

export function dialogueMarkupDeclarationRows(rows: readonly string[], firstDialogueRow: number): number[] {
  const declarations: number[] = [];
  for (let index = firstDialogueRow - 1; index >= 0; index--) {
    const row = rows[index].trim();
    if (isTextMarkupDeclaration(row)) declarations.push(index);
    else if (!row || !/^[@／/]\s*对白标记\s*[:：]/.test(row)) break;
  }
  return declarations;
}
