import { immutableAuthoringIndex } from './authoring-index';
import type { Asset, AssetCategory, Project } from '../core/model';
import { UiAssetSelect } from './AssetPicker';
import { browserBridge } from './browserBridge';
import { useBrowserAsset } from './resource-selection';
import { ArrowDownToLine } from 'lucide-react';

export function AssetReferenceInput({project,kind='all',category='all',value,onChange,label,empty='选择素材',disabled=false,preview=false,compact=false}: {
 project:Project;kind?:Asset['kind']|'all';category?:AssetCategory|'all';value?:string;onChange:(value?:string)=>void;label:string;empty?:string;disabled?:boolean;
 /** Show the thumbnail and searchable name, as asset fields in property panels do. */
 preview?:boolean;
 compact?:boolean;
}) {
 const selectedId=useBrowserAsset(project.id);
 const assets = immutableAuthoringIndex.assets(project), candidate = assets.byId.get(selectedId ?? '');
 const selected = candidate && (kind === 'all' || candidate.kind === kind) ? candidate : undefined;
 return <fieldset disabled={disabled} className={`blueprint-asset-field${compact ? ' asset-reference-compact' : ''}`}>
  <UiAssetSelect project={project} kind={kind} category={category} buttonOnly={!preview} value={value} onChange={onChange} label={label} empty={empty} assetUrl={id=>{const asset=assets.byId.get(id ?? '');return asset?(window.studio??browserBridge).assetUrl(asset.path):undefined;}} />
  <button type="button" className="small-button" disabled={disabled||!selected} title={selected?'使用 '+selected.name:'先在资源管理器中选中一个适用素材'} aria-label={'使用资源管理器选中素材：'+label} onClick={()=>{if(selected)onChange(selected.id);}}>{compact ? <ArrowDownToLine size={14} /> : '使用选中素材'}</button>
 </fieldset>;
}
