import { immutableAuthoringIndex } from './authoring-index';
import './blueprint-value-input.css';
import { uiPages } from '../core/ui-pages';
import { NumberInput } from './NumberInput';
import type { Asset, AssetCategory, Project, VariableValue, UiComponent } from '../core/model';
import { blueprintScreens, defaultBlueprintValue, type BlueprintDataType } from '../core/blueprint';
import { componentName, uiPageNames } from './UiNames';

import { AssetReferenceInput } from './AssetReferenceInput';

export function BlueprintValueInput({ project, type, value, onChange, label, assetKind, assetCategory, componentKind, componentIds, unit, min, max, step = 'any', disabled = false, compact = false }: {
  project: Project; type: BlueprintDataType; value?: VariableValue; onChange: (value: VariableValue | undefined) => void;
  label: string; assetKind?: Asset['kind'] | 'all'; assetCategory?: AssetCategory | 'all'; componentKind?: UiComponent['kind']; componentIds?:string[]; unit?: string; min?: number; max?: number; step?: number | 'any'; disabled?: boolean; compact?: boolean;
}) {
  const actualType = type === 'any' ? (value === undefined ? 'string' : typeof value) as 'number' | 'string' | 'boolean' : type;
  const invalidType = value !== undefined && (actualType === 'number' ? typeof value !== 'number' || !Number.isFinite(value) : actualType === 'boolean' ? typeof value !== 'boolean' : typeof value !== 'string');
  const uiIndex = actualType === 'component' ? immutableAuthoringIndex.ui(project) : undefined;
  const allowedComponents = componentIds && new Set(componentIds);
  const choices = actualType === 'character' ? project.characters : actualType === 'scene' ? project.scenes
      : actualType === 'ui' ? [...uiPages(project).filter(page => !page.disabled || page.id === value).map(page => ({ id: page.id, name: page.name })), ...(typeof value === 'string' && Object.hasOwn(blueprintScreens, value) ? [{ id: value, name: blueprintScreens[value] + '（旧名称兼容）' }] : [])] : actualType === 'component' ? uiIndex!.all.filter(item => (!componentKind || item.kind === componentKind)&&(!allowedComponents||allowedComponents.has(item.id)||item.id===value)).map(item => ({ id: item.id, name: `${item.page === 'custom' ? uiIndex!.customPageByComponentId.get(item.id)?.name ?? uiPageNames.custom : uiPageNames[item.page]} / ${componentName(item)}` })) : undefined;
  const control = actualType === 'asset' ? <AssetReferenceInput compact={compact} project={project} kind={assetKind} category={assetCategory} value={typeof value === 'string' ? value : undefined} onChange={onChange} label={label} disabled={disabled} /> : choices ? <select aria-label={label} disabled={disabled} value={String(value ?? '')} onChange={event => onChange(event.target.value || undefined)}>
    <option value="">请选择{actualType === 'character' ? '角色' : actualType === 'scene' ? '场景' : actualType === 'component' ? '组件' : '界面'}</option>
    {value && !choices.some(item => item.id === value) ? <option value={String(value)}>原选择已不存在，请重新选择</option> : null}
    {choices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
  </select> : actualType === 'boolean' ? <select aria-label={label} disabled={disabled} value={value === undefined ? '' : invalidType ? '__invalid__' : String(value)} onChange={event => onChange(event.target.value === '' ? undefined : event.target.value === 'true')}>
    {value === undefined && <option value="">请选择</option>}{invalidType && <option value="__invalid__" disabled>无效开关值 · {String(value)}</option>}<option value="true">是</option><option value="false">否</option>
  </select> : <NumberInput aria-label={label} disabled={disabled} type={actualType === 'number' ? 'number' : 'text'} min={min} max={max} step={step} value={value === undefined ? '' : String(value)}
    onChange={event => {
      if (actualType !== 'number') onChange(event.target.value);
      else if (event.target.value === '') onChange(undefined);
      else if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber);
    }} />;
  return <div className="blueprint-value-input" data-invalid={invalidType || undefined} data-value-unit={actualType === 'number' ? unit : undefined}>
    {type === 'any' && <select className="blueprint-value-kind" aria-label={`${label}的值类型`} disabled={disabled} value={actualType} onChange={event => onChange(defaultBlueprintValue(event.target.value as BlueprintDataType))}>
      <option value="string">文字</option><option value="number">数值</option><option value="boolean">开关</option>
    </select>}
    {control}{actualType === 'number' && unit && <small className="blueprint-value-unit" title={unit}>{unit}</small>}{invalidType && <small className="blueprint-value-error" role="status">原值类型不符（{typeof value === 'number' ? '数值' : typeof value === 'boolean' ? '开关' : '文字'}）；请重新输入，不会自动转换。</small>}
  </div>;
}
