export interface ArgumentSpec { name: string; id?: string; aliases?: string[] }
export interface ArgumentToken { start: number; end: number; valueStart: number; raw: string; name?: string }

/** Offsets refer to the argument text; commas inside quoted values are literal. */
export function argumentTokens(text: string, tolerant = false): ArgumentToken[] {
  const result: ArgumentToken[] = [];
  let from = 0, quote = '', escaped = false, equals = -1;
  const groups: string[] = [];
  const append = (end: number) => {
    const start = from + (text.slice(from, end).match(/^\s*/)?.[0].length ?? 0);
    const valueStart = equals >= 0 ? equals + 1 + (text.slice(equals + 1, end).match(/^\s*/)?.[0].length ?? 0) : start;
    result.push({ start, end, valueStart, raw: text.slice(valueStart, end).trimEnd(), ...(equals >= 0 ? { name: text.slice(start, equals).trim() } : {}) });
    from = end + 1; equals = -1;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '{' || c === '[') groups.push(c === '{' ? '}' : ']');
    else if ((c === '}' || c === ']') && groups.length) { if (groups.pop() !== c && !tolerant) throw new Error('参数中的括号不匹配。'); }
    else if (!groups.length && /[，,;；]/.test(c)) append(i);
    else if (!groups.length && (c === '=' || c === '＝') && equals < 0) equals = i;
  }
  if (quote && !tolerant) throw new Error('参数中的引号没有闭合。');
  if (groups.length && !tolerant) throw new Error('参数中的括号没有闭合。');
  append(text.length);
  return result;
}
export function argumentName(value: string) { return value.replace(/【[a-z][a-z0-9_]{0,63}】$/, '').replace(/=值$/, '').trim(); }
export function argumentIndex(specs: ArgumentSpec[], name: string) {
  const id = name.match(/【([a-z][a-z0-9_]{0,63})】$/)?.[1];
  return specs.findIndex(spec => id ? spec.id === id : [spec.name, spec.id, ...(spec.aliases ?? [])].some(value => value !== undefined && argumentName(value).toLowerCase() === argumentName(name).toLowerCase()));
}
export function bindArguments(text: string, specs: ArgumentSpec[], tolerant = false, allowUnknown = false) {
  const values: (string | undefined)[] = [];
  const assigned = new Set<number>();
  const extras: Record<string, string> = {};
  const bindings = argumentTokens(text, tolerant).map(token => {
    let index = token.name === undefined ? 0 : argumentIndex(specs, token.name);
    if (token.name === undefined) while (assigned.has(index)) index++;
    if (index < 0 || index >= specs.length) {
      if (!tolerant && (token.raw || token.name !== undefined)) {
        if (allowUnknown && token.name) extras[token.name] = token.raw;
        else throw new Error(token.name ? `没有参数“${argumentName(token.name)}”。可用参数：${specs.map(spec => argumentName(spec.name)).join('、')}。` : `参数过多；最多填写 ${specs.length} 项。`);
      }
    } else {
      if (!tolerant && assigned.has(index)) throw new Error(`参数“${argumentName(specs[index].name)}”重复填写。`);
      if (!tolerant && token.name !== undefined && !token.raw) throw new Error(`请填写参数“${argumentName(specs[index].name)}”的值。`);
      assigned.add(index); values[index] = token.raw;
    }
    return { token, index };
  });
  return { values, bindings, extras };
}
export function argumentValue(raw: string): string | number | boolean {
  const value = raw.trim();
  if (value.startsWith('"')) return JSON.parse(value) as string;
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/\\(['\\])/g, '$1');
  if (/^(是|true)$/i.test(value)) return true;
  if (/^(否|false)$/i.test(value)) return false;
  if (value && Number.isFinite(Number(value)) && !/^0\d+/.test(value)) return Number(value);
  return value;
}
export function argumentText(raw: string | undefined) { return raw === undefined ? '' : String(argumentValue(raw)); }
