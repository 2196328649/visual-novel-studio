/** Strict pure numeric operations. These never coerce text/switches or write state. */
export const blueprintNumericCatalog = {
  clamp: { name: '限制范围（Clamp）', category: '状态与计算', hint: '把数值限制在最小值和最大值之间；上下限相等时输出该值，最小值不能大于最大值。' },
  abs: { name: '绝对值（Abs）', category: '状态与计算', hint: '去掉数值的负号，不修改来源值。' },
  round: { name: '取整（Round）', category: '状态与计算', hint: '选择四舍五入、向下、向上或向零取整。四舍五入的半值远离零，例如 1.5 → 2、−1.5 → −2。' },
  inRange: { name: '范围判断（In Range）', category: '状态与计算', hint: '判断数值是否在上下限之间，可分别选择是否包含两个边界。最小值不能大于最大值。' },
  nearlyEqual: { name: '近似相等（Nearly Equal）', category: '状态与计算', hint: '两个数相差不超过允许误差时输出是；误差是非负绝对数值，不是百分比。' },
  mapRange: { name: '数值映射（Map Range）', category: '状态与计算', hint: '把输入区间线性映射到输出区间；支持反向区间，输入两端不能相等。可限制在输入区间内，或允许区间外推。' },
  lerp: { name: '数值插值（Lerp）', category: '状态与计算', hint: '按比例在起点与终点之间取值；0 为起点、1 为终点。可限制比例到 0～1，或允许外推。' },
} as const;
export type BlueprintNumericType = keyof typeof blueprintNumericCatalog;
export const blueprintRoundModes = { nearest: '四舍五入（半值远离零）', floor: '向下取整', ceil: '向上取整', truncate: '向零取整' } as const;
export interface BlueprintNumericInput { id: string; name: string; dataType: 'number' | 'boolean'; defaultValue: number | boolean }
const number = (id: string, name: string, defaultValue = 0): BlueprintNumericInput => ({ id, name, dataType: 'number', defaultValue });
const boolean = (id: string, name: string, defaultValue = true): BlueprintNumericInput => ({ id, name, dataType: 'boolean', defaultValue });
export const blueprintNumericInputs: Record<BlueprintNumericType, readonly BlueprintNumericInput[]> = {
  clamp: [number('value', '数值'), number('min', '最小值'), number('max', '最大值', 1)],
  abs: [number('value', '数值')],
  round: [number('value', '数值')],
  inRange: [number('value', '数值'), number('min', '最小值'), number('max', '最大值', 1), boolean('includeMin', '包含最小值'), boolean('includeMax', '包含最大值')],
  nearlyEqual: [number('a', '数值 A'), number('b', '数值 B'), number('tolerance', '允许误差', .0001)],
  mapRange: [number('value', '数值'), number('inputMin', '输入起点'), number('inputMax', '输入终点', 1), number('outputMin', '输出起点'), number('outputMax', '输出终点', 1), boolean('clamp', '限制输入范围')],
  lerp: [number('a', '起点'), number('b', '终点', 1), number('alpha', '比例', .5), boolean('clampAlpha', '限制比例到 0～1')],
};
export function isBlueprintNumericType(type: string): type is BlueprintNumericType { return Object.hasOwn(blueprintNumericCatalog, type); }
export function blueprintNumericOutputType(type: BlueprintNumericType): 'boolean' | 'number' { return type === 'inRange' || type === 'nearlyEqual' ? 'boolean' : 'number'; }
export type BlueprintNumericResult = { ok: true; value: number | boolean } | { ok: false; message: string };

/** Read each input exactly once, in pin order; inspection must not resample values. */
export function evaluateBlueprintNumeric(type: BlueprintNumericType, input: (pin: string) => unknown, mode: unknown = 'nearest'): BlueprintNumericResult {
  const values: Record<string, number | boolean> = {};
  for (const pin of blueprintNumericInputs[type]) {
    const value = input(pin.id);
    if (typeof value !== pin.dataType || typeof value === 'number' && !Number.isFinite(value)) return { ok: false, message: '“' + pin.name + '”需要有效的' + (pin.dataType === 'number' ? '有限数值。' : '开关值（是或否）。') };
    values[pin.id] = value as number | boolean;
  }
  const n = (id: string) => values[id] as number;
  const between = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  if ((type === 'clamp' || type === 'inRange') && n('min') > n('max')) return { ok: false, message: '最小值不能大于最大值。' };
  let result: number | boolean;
  switch (type) {
    case 'clamp': result = between(n('value'), n('min'), n('max')); break;
    case 'abs': result = Math.abs(n('value')); break;
    case 'round': {
      const value = n('value');
      if (mode === 'nearest') {
        // Adding .5 first loses the fractional boundary near .5 and changes
        // already-integral odd values above 2^52. Split the magnitude instead.
        const magnitude = Math.abs(value), whole = Math.floor(magnitude);
        result = (value < 0 ? -1 : 1) * (whole + (magnitude - whole >= .5 ? 1 : 0));
      }
      else if (mode === 'floor') result = Math.floor(value);
      else if (mode === 'ceil') result = Math.ceil(value);
      else if (mode === 'truncate') result = Math.trunc(value);
      else return { ok: false, message: '请选择有效的取整方式。' };
      break;
    }
    case 'inRange': result = (values.includeMin ? n('value') >= n('min') : n('value') > n('min')) && (values.includeMax ? n('value') <= n('max') : n('value') < n('max')); break;
    case 'nearlyEqual':
      if (n('tolerance') < 0) return { ok: false, message: '允许误差不能是负数。' };
      result = Math.abs(n('a') - n('b')) <= n('tolerance'); break;
    case 'mapRange': {
      const span = n('inputMax') - n('inputMin');
      if (span === 0) return { ok: false, message: '输入起点和终点不能相等。' };
      const offset = n('value') - n('inputMin');
      if (!Number.isFinite(span) || !Number.isFinite(offset)) return { ok: false, message: '映射区间计算超出有限数值范围。' };
      let alpha = offset / span;
      if (values.clamp) alpha = between(alpha, 0, 1);
      result = n('outputMin') * (1 - alpha) + n('outputMax') * alpha; break;
    }
    case 'lerp': {
      const alpha = values.clampAlpha ? between(n('alpha'), 0, 1) : n('alpha');
      result = n('a') * (1 - alpha) + n('b') * alpha; break;
    }
  }
  return typeof result === 'number' && !Number.isFinite(result) ? { ok: false, message: '计算结果超出有限数值范围。' } : { ok: true, value: result === 0 ? 0 : result };
}
