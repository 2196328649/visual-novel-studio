import { uiScreenAvailable } from '../core/ui-availability';
import { NumberInput } from './NumberInput';
import { allUiComponents, type Asset, type AssetCategory, type Project, type VariableValue, type UiComponent } from '../core/model';
import { blueprintScreens, defaultBlueprintValue, type BlueprintDataType } from '../core/blueprint';
import { componentName, uiPageNames } from './UiNames';

import { AssetReferenceInput } from './AssetReferenceInput';

export function BlueprintValueInput({ project, type, value, onChange, label, assetKind, assetCategory, componentKind, componentIds, min, max, step = 'any', disabled = false }: {
  project: Project; type: BlueprintDataType; value?: VariableValue; onChange: (value: VariableValue | undefined) => void;
  label: string; assetKind?: Asset['kind'] | 'all'; assetCategory?: AssetCategory | 'all'; componentKind?: UiComponent['kind']; componentIds?:string[]; min?: number; max?: number; step?: number | 'any'; disabled?: boolean;
}) {
  const actualType = type === 'any' ? (value === undefined ? 'string' : typeof value) as 'number' | 'string' | 'boolean' : type;
  const choices = actualType === 'asset' ? project.assets.filter(item => !assetKind || item.kind === assetKind)
    : actualType === 'character' ? project.characters : actualType === 'scene' ? project.scenes
      : actualType === 'ui' ? [...Object.entries(blueprintScreens).filter(([id]) => uiScreenAvailable(project.ui, id)).map(([id, name]) => ({ id, name })), ...project.ui.customPages.map(page => ({ id: page.id, name: `自定义 / ${page.name}` }))] : actualType === 'component' ? allUiComponents(project).filter(item => (!componentKind || item.kind === componentKind)&&(!componentIds||componentIds.includes(item.id)||item.id===value)).map(item => ({ id: item.id, name: `${item.page === 'custom' ? project.ui.customPages?.find(page => page.components.some(component => component.id === item.id))?.name ?? uiPageNames.custom : uiPageNames[item.page]} / ${componentName(item)}` })) : undefined;
  const control = actualType === 'asset' ? <AssetReferenceInput project={project} kind={assetKind} category={assetCategory} value={typeof value === 'string' ? value : undefined} onChange={onChange} label={label} disabled={disabled} /> : choices ? <select aria-label={label} disabled={disabled} value={String(value ?? '')} onChange={event => onChange(event.target.value || undefined)}>
    <option value="">请选择{actualType === 'character' ? '角色' : actualType === 'scene' ? '场景' : actualType === 'component' ? '组件' : '界面'}</option>
    {value && !choices.some(item => item.id === value) ? <option value={String(value)}>原选择已不存在，请重新选择</option> : null}
    {choices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
  </select> : actualType === 'boolean' ? <select aria-label={label} disabled={disabled} value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value === '' ? undefined : event.target.value === 'true')}>
    {value === undefined && <option value="">请选择</option>}<option value="true">是</option><option value="false">否</option>
  </select> : <NumberInput aria-label={label} disabled={disabled} type={actualType === 'number' ? 'number' : 'text'}   step={step} value={value === undefined ? '' : String(value)}
    onChange={event => {
      if (actualType !== 'number') onChange(event.target.value);
      else if (event.target.value === '') onChange(undefined);
      else if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber);
    }} />;
  return <div className="blueprint-value-input">
    {type === 'any' && <select className="blueprint-value-kind" aria-label={`${label}的值类型`} disabled={disabled} value={actualType} onChange={event => onChange(defaultBlueprintValue(event.target.value as BlueprintDataType))}>
      <option value="string">文字</option><option value="number">数值</option><option value="boolean">开关</option>
    </select>}
    {control}
  </div>;
}
