import type { Asset, AssetCategory, Project } from '../core/model';
import { UiAssetSelect } from './AssetPicker';
import { browserBridge } from './browserBridge';
import { useBrowserAsset } from './resource-selection';

export function AssetReferenceInput({project,kind='all',category='all',value,onChange,label,empty='选择素材',disabled=false}: {
 project:Project;kind?:Asset['kind']|'all';category?:AssetCategory|'all';value?:string;onChange:(value?:string)=>void;label:string;empty?:string;disabled?:boolean;
}) {
 const selectedId=useBrowserAsset(project.id);
 const selected=project.assets.find(asset=>asset.id===selectedId&&(kind==='all'||asset.kind===kind));
 return <fieldset disabled={disabled} className="blueprint-asset-field">
  <UiAssetSelect project={project} kind={kind} category={category} buttonOnly value={value} onChange={onChange} label={label} empty={empty} assetUrl={id=>{const asset=project.assets.find(item=>item.id===id);return asset?(window.studio??browserBridge).assetUrl(asset.path):undefined;}} />
  <button type="button" className="small-button" disabled={disabled||!selected} title={selected?'使用 '+selected.name:'先在资源管理器中选中一个适用素材'} aria-label={'使用资源管理器选中素材：'+label} onClick={()=>{if(selected)onChange(selected.id);}}>使用选中素材</button>
 </fieldset>;
}
