import type { Diagnostic, VariableValue } from '../core/model';
import type { RuntimeEvent } from '../core/bridge';

export type SourceMap = Record<string, { nodeId: string; lineId?: string }>;

export function diagnosticsFromLog(log: string, sourceMap: SourceMap): Diagnostic[] {
  const locations: { nodeId: string; lineId?: string }[] = [];
  for (const match of log.matchAll(/(?:File\s+)?"([^"\r\n]+\.rpy)",?\s+line\s+(\d+)/g)) {
    const normalized = match[1].replaceAll('\\', '/');
    const origin = sourceMap[`${normalized}:${match[2]}`] ?? sourceMap[`${normalized.split('/').at(-1)}:${match[2]}`];
    if (origin) locations.push(origin);
  }
  if (!locations.length) return [];
  const details = log.split(/\r?\n/).map(line => line.trim()).filter(line => /^(?:\w*(?:Error|Exception)|expected|invalid|could not|image .*not found)/i.test(line));
  const message = details.at(-1) ?? '此处的游戏运行发生错误，请检查素材和演出属性。';
  const seen = new Set<string>();
  return locations.reverse().filter(location => {
    const key = `${location.nodeId}/${location.lineId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(location => ({ severity: 'error', message, ...location }));
}

export function runtimePosition(line: string): RuntimeEvent | undefined {
  if (!line.startsWith('VNS_EVENT:')) return;
  try {
    const data = JSON.parse(line.slice('VNS_EVENT:'.length));
    if (!data || typeof data.nodeId !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(data.nodeId)) return;
    const variables: Record<string, VariableValue> = {};
    if (data.variables && typeof data.variables === 'object') for (const [id, value] of Object.entries(data.variables)) {
      if (['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value)) variables[id] = value as VariableValue;
    }
    return { kind: 'position', message: '', nodeId: data.nodeId, lineId: typeof data.lineId === 'string' ? data.lineId : undefined, variables };
  } catch { return; }
}
