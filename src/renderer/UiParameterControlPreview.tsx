import { uiComponentTheme } from '../core/ui-page-settings';
import { uiControlOptionMatches, uiControlOptionsKey, type UiControlOption } from '../core/ui-control-options';
import { UiPreviewFocusContext } from './UiPreviewFocusContext';
import { useContext, useRef, useState } from 'react';
import type { UiTextCommitMethod } from '../core/ui-control-events';
import { preferenceInfo } from '../core/preferences';
import type { Project, UiComponent, UiButtonState, VariableValue } from '../core/model';
import { uiControlDefinition, uiControlRatio, uiControlTravel, uiControlUserValue, uiControlValueProblem } from '../core/ui-control-properties';
import { AuthoredPreferencePreview } from './PlayerPreferences';
import type { AssetUrl } from './StageEditor';

export function UiParameterControlPreview({project,component,assetUrl,scale,state,value,options,onFocusChange,onChange,onCommit}:{project:Project;component:UiComponent;assetUrl:AssetUrl;scale:number;state:UiButtonState;value:VariableValue|undefined;options?:UiControlOption[];onFocusChange?:(focused:boolean)=>void;onChange:(value:VariableValue,selection?:{optionsKey:string;optionIndex:number})=>void;onCommit?:(method:UiTextCommitMethod)=>void}) {
  project = { ...project, ui: uiComponentTheme(project, component) };
 const focusController = useContext(UiPreviewFocusContext);
 const skipBlur=useRef(false), composing=useRef(false), input=useRef<HTMLInputElement>(null);
 const [draft, setDraft] = useState<string>();
 // Unopened controls have no sampled value; invalid active sources are already
 // diagnosed by the preview. Neither case should fabricate an editable value.
 if (value === undefined) return null;
 const limit = component.input?.maxLength ?? 200;
 const emitText = (text: string) => {
  const current = String(value), letters = Array.from(text);
  // An insertion cannot silently truncate an existing over-limit source after
  // the limit is lowered. Deletion/replacement and paste still follow the cap.
  if (Array.from(current).length > limit && letters.length >= Array.from(current).length) return;
  const next = letters.slice(0, limit).join('');
  if (next !== current) onChange(next);
 };
 const parameter=project.variables.find(v=>v.id===component.parameterId);
 const preference=component.preference??'musicVolume',info=preferenceInfo(project,preference);
 const variable=parameter??{id:'',name:info.name,type:info.type,initial:info.initial,setting:undefined};
 const label=component.text||variable.name,disabled=state==='disabled'||component.readOnly===true;
 const style={font:'inherit',color:'inherit',width:'100%',height:'100%',boxSizing:'border-box' as const};
 const control = uiControlDefinition(project, component)!;
 if (control.choice) {
  const choices = options ?? control.options, key = uiControlOptionsKey(choices);
  const selected = choices.findIndex(option => uiControlOptionMatches(option.value, value));
  const constraint = { ...control, choice: false }, selectable = (value: VariableValue) => !uiControlValueProblem(constraint, value, limit);
  return <select key={key} aria-label={label} disabled={disabled || !choices.length} style={style} value={selected} onChange={event => {
   const index = Number(event.target.value), option = choices[index];
   if (option && selectable(option.value)) onChange(option.value, { optionsKey: key, optionIndex: index });
  }}>{selected < 0 && <option value={-1} disabled>{choices.length ? String(value) || '当前值无匹配选项' : '暂无选项'}</option>}{choices.map((option, index) => <option key={index} value={index} disabled={!selectable(option.value)}>{option.label}</option>)}</select>;
 }
 if(variable.type==='boolean')return <label style={style}><input aria-label={label} type="checkbox" disabled={disabled} checked={!!value} onChange={e=>onChange(e.target.checked)}/>{label}</label>;
 if(variable.type==='string')return <input ref={input} data-ui-text-input aria-label={label} disabled={disabled} readOnly={component.readOnly} style={style} placeholder={component.input?.placeholder} data-max-length={limit} value={draft ?? String(value)}
      onCompositionStart={e=>{composing.current=true;setDraft(e.currentTarget.value);}}
      onCompositionEnd={e=>{composing.current=false;setDraft(undefined);emitText(e.currentTarget.value);}}
      onChange={e=>{if(composing.current)setDraft(e.target.value);else emitText(e.target.value);}}
      onFocus={()=>{skipBlur.current=false;onFocusChange?.(true);}}
      onBlur={event=>{if(event.currentTarget.isConnected)onFocusChange?.(false);if(event.currentTarget.isConnected&&!event.currentTarget.disabled&&!event.currentTarget.readOnly&&!event.currentTarget.closest('[inert],[hidden]')&&!disabled&&!skipBlur.current&&!composing.current&&!focusController?.depth)onCommit?.('focusLost');skipBlur.current=false;setDraft(undefined);composing.current=false;}}
      onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&!composing.current&&!e.repeat){e.preventDefault();e.stopPropagation();skipBlur.current=true;onCommit?.('enter');e.currentTarget.blur();}}}/>;
 const travel = uiControlTravel(control), ratio = uiControlRatio(control, value);
 const fixed = travel.span === 0, adjustment = fixed ? 1 : Math.min(1, control.range!.step / travel.span);
 const sampled={...project,playerDefaults:parameter?project.playerDefaults:{...project.playerDefaults,[preference]:value},variables:project.variables.map(v=>v.id===variable.id?{...v,initial:value}:v)};
 return <><AuthoredPreferencePreview project={sampled} component={component} assetUrl={assetUrl} scale={scale} state={state}/><input aria-label={label} type="range" disabled={disabled || fixed} min={travel.start} max={travel.start+travel.span} step="any" value={travel.start+ratio*travel.span} aria-valuemin={control.range!.min} aria-valuemax={control.range!.max} aria-valuenow={Number(value)} aria-valuetext={control.instantAtEnd && value === 0 ? '立即显示' : String(value)} onChange={e=>onChange(uiControlUserValue(control, (Number(e.target.value)-travel.start)/(travel.span||1)))} onKeyDown={e=>{
  const reverse=component.slider?.reverse ? -1 : 1;
  const delta=({ArrowRight:reverse,ArrowLeft:-reverse,ArrowUp:1,ArrowDown:-1,PageUp:10,PageDown:-10} as Record<string,number>)[e.key];
  if(delta!==undefined||e.key==='Home'||e.key==='End'){e.preventDefault();e.stopPropagation();if(!disabled&&!fixed)onChange(uiControlUserValue(control,e.key==='Home'?0:e.key==='End'?1:ratio+delta*adjustment));}
 }} style={{position:'absolute',inset:0,width:'100%',height:'100%',opacity:0,direction:component.slider?.reverse?'rtl':'ltr',cursor:disabled?'default':'pointer'}}/></>;
}
