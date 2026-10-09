import { useRef } from 'react';
import type { UiTextCommitMethod } from '../core/ui-control-events';
import { playerPreferences, playerPreferenceOptions } from '../core/preferences';
import type { Project, UiComponent, UiButtonState, VariableValue } from '../core/model';
import { parameterRange } from '../core/parameter-sets';
import { AuthoredPreferencePreview } from './PlayerPreferences';
import type { AssetUrl } from './StageEditor';

export function UiParameterControlPreview({project,component,assetUrl,scale,state,value,onChange,onCommit}:{project:Project;component:UiComponent;assetUrl:AssetUrl;scale:number;state:UiButtonState;value:VariableValue;onChange:(value:VariableValue)=>void;onCommit?:(method:UiTextCommitMethod)=>void}) {
 const skipBlur=useRef(false);
 const parameter=project.variables.find(v=>v.id===component.parameterId);
 const preference=component.preference??'musicVolume',info=playerPreferences[preference];
 const variable=parameter??{id:'',name:info.name,type:info.type,initial:info.initial,setting:undefined};
 const label=component.text||variable.name,disabled=state==='disabled';
 const style={font:'inherit',color:'inherit',width:'100%',height:'100%',boxSizing:'border-box' as const};
 if(!parameter&&component.kind==='preferenceChoice') {const choices=component.selector?.options??playerPreferenceOptions(preference);return <select aria-label={label} disabled={disabled} style={style} value={choices.findIndex(option=>option.value===value)} onChange={e=>{const option=choices[Number(e.target.value)];if(option)onChange(option.value);}}>{choices.map((option,index)=><option key={index} value={index}>{option.label}</option>)}</select>;}
 if(variable.type==='boolean')return <label style={style}><input aria-label={label} type="checkbox" disabled={disabled} checked={!!value} onChange={e=>onChange(e.target.checked)}/>{label}</label>;
 if(variable.type==='string')return variable.setting?.options?.length
  ? <select aria-label={label} disabled={disabled} style={style} value={String(value)} onChange={e=>onChange(e.target.value)}>{variable.setting.options.map(option=><option key={option} value={option}>{option}</option>)}</select>
  : <input aria-label={label} disabled={disabled} style={style} maxLength={200} value={String(value)} onChange={e=>onChange(e.target.value)} onFocus={()=>{skipBlur.current=false;}} onBlur={()=>{if(!disabled&&!skipBlur.current)onCommit?.('focusLost');skipBlur.current=false;}} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&!e.repeat){e.preventDefault();e.stopPropagation();skipBlur.current=true;onCommit?.('enter');e.currentTarget.blur();}}}/>;
 const instant=!parameter&&preference==='textSpeed';
 const range=parameter?parameterRange(parameter):{min:instant?1:info.min!,max:instant?info.max!+1:info.max!,step:info.max===1?.01:1};
 const sampled={...project,playerDefaults:parameter?project.playerDefaults:{...project.playerDefaults,[preference]:value},variables:project.variables.map(v=>v.id===variable.id?{...v,initial:value}:v)};
 return <><AuthoredPreferencePreview project={sampled} component={component} assetUrl={assetUrl} scale={scale} state={state}/><input aria-label={label} type="range" disabled={disabled} min={range.min} max={range.max} step={range.step} value={instant&&value===0?range.max:Number(value)} onChange={e=>onChange(instant&&Number(e.target.value)===range.max?0:Number(e.target.value))} style={{position:'absolute',inset:0,width:'100%',height:'100%',opacity:0,direction:component.slider?.reverse?'rtl':'ltr',cursor:disabled?'default':'pointer'}}/></>;
}
