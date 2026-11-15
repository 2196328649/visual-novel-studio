import type { ParameterUsage } from '../core/parameter-usages';
export function ParameterUsageList({ usages, locate }: { usages: ParameterUsage[]; locate?: (usage: ParameterUsage) => void }) {
  return usages.length ? <ul className="parameter-references">{usages.map(usage => <li key={usage.key}>
    {locate ? <button type="button" className="text-button" onClick={() => locate(usage)} title={usage.label}>{usage.label}</button> : <span>{usage.label}</span>}
  </li>)}</ul> : <p className="parameter-help">暂无引用。</p>;
}
