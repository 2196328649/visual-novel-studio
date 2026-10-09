export function pythonLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pythonLiteral).join(', ')}]`;
  if (typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).map(([key, item]) => `${pythonLiteral(key)}: ${pythonLiteral(item)}`).join(', ')}}`;
  return 'None';
}

/** Keep large generated collections within Ren'Py's source column limit. */
export function pythonBlockLiteral(value: unknown, indent = 0): string {
  const compact = pythonLiteral(value);
  if (compact.length <= 8000 || value === null || typeof value !== 'object') return compact;
  const padding = '    '.repeat(indent), childPadding = padding + '    ';
  if (Array.isArray(value)) return '[\n' + value.map(item => childPadding + pythonBlockLiteral(item, indent + 1) + ',').join('\n') + '\n' + padding + ']';
  return '{\n' + Object.entries(value).map(([key, item]) => childPadding + pythonLiteral(key) + ': ' + pythonBlockLiteral(item, indent + 1) + ',').join('\n') + '\n' + padding + '}';
}

export function renpyText(text: string): string {
  return pythonLiteral(text.replaceAll('[', '[[').replaceAll('{', '{{'));
}
