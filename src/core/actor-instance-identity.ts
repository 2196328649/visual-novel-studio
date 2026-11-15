/** Actor numbers are stable per character; old named instances remain global. */
export const maxActorInstanceNumber = Number.MAX_SAFE_INTEGER;
const numberedInstance = /^[1-9][0-9]*(?![\s\S])/;
const namedInstance = /^[a-z][a-z0-9_]{0,63}(?![\s\S])/;
export const actorInstanceError = '第几个需要填写 1～9007199254740991 的整数，不带前导零；旧实例 ID 仍可使用小写字母开头的字母、数字或下划线，最多 64 位。';

export function actorInstanceNumber(value?: string): number | undefined {
  if (value === undefined || value === '') return 1;
  if (typeof value !== 'string' || !numberedInstance.test(value)) return;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export function actorInstanceProblem(value: unknown): string | undefined {
  if (value === undefined) return;
  if (typeof value !== 'string' || (actorInstanceNumber(value) === undefined && !namedInstance.test(value))) return actorInstanceError;
}

/** Never coerce numbers/booleans: blueprint instance pins remain string typed. */
export function parseActorInstance(value?: unknown): string | undefined {
  const problem = actorInstanceProblem(value);
  if (problem) throw new Error(problem);
  return value === undefined || value === '' || value === '1' ? undefined : value as string;
}

export function actorInstanceLabel(value?: string): string {
  const number = actorInstanceNumber(value);
  return number === undefined ? `旧实例：${value}` : `第 ${number} 个`;
}

export const actorLifetimes = { line: '仅本句', persistent: '持续显示' } as const;
export function parseActorLifetime(value: string): keyof typeof actorLifetimes | undefined {
  if (!value || /^(场景内|scene|legacy)$/.test(value)) return undefined;
  if (/^(仅本句|本句|一次性|line)$/.test(value)) return 'line';
  if (/^(持续显示|持续|persistent)$/.test(value)) return 'persistent';
  throw new Error('显示范围请选择“仅本句”或“持续显示”。');
}
