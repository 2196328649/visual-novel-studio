import { useEffect, useState } from 'react';
import { createUiParameterBinding } from '../core/ui-logic';
import { uiProperties, uiPropertyApplies, type UiProperty } from '../core/ui';
import { addParameter, parameterSets, storyParametersId } from '../core/parameter-sets';
import { NumberInput } from './NumberInput';
import type { VariableValue } from '../core/model';
import type { Project, UiComponent } from '../core/model';
import type { Commit } from './editor';
import { componentName } from './UiNames';

export function UiParameterBindings({project,components,pageId,commit,selectedComponentId,onComponentSelect,onGraphChange}:{project:Project;components:UiComponent[];pageId:string;commit:Commit;selectedComponentId?:string;onComponentSelect:(id?:string)=>void;onGraphChange:(id:string)=>void}) {
 const setComponentId=(id:string)=>onComponentSelect(id);
 const [property,setProperty]=useState<UiProperty>('visible'),[variableId,setVariableId]=useState(''),[notice,setNotice]=useState('');
 const [creating,setCreating]=useState(false);
 const component=components.find(c=>c.id===selectedComponentId)??components[0];
 useEffect(()=>{if(component?.id!==selectedComponentId)onComponentSelect(component?.id);},[component?.id,selectedComponentId,onComponentSelect]);
 const properties=(Object.keys(uiProperties) as UiProperty[]).filter(p=>component&&uiPropertyApplies(component,p));
 const selectedProperty=properties.includes(property)?property:properties[0]??'visible';
 const variables=project.variables.filter(v=>v.type===uiProperties[selectedProperty].type);
 const variable=variables.find(v=>v.id===variableId)??variables[0];
 const setGraphId=onGraphChange;
 return <>{notice&&<p role="status">{notice}</p>}<>  <div className="workspace-toolbar"><strong>参数联动</strong><label>组件<select aria-label="联动组件" value={component?.id??''} onChange={e=>setComponentId(e.target.value)}>{components.map(c=><option key={c.id} value={c.id}>{componentName(c)}</option>)}</select></label>
   <label>属性<select aria-label="联动属性" value={selectedProperty} onChange={e=>setProperty(e.target.value as UiProperty)}>{properties.map(p=><option key={p} value={p}>{uiProperties[p].name}</option>)}</select></label>
   <label>参数<select aria-label="联动参数" value={variable?.id??''} onChange={e=>setVariableId(e.target.value)}>{!variables.length&&<option value="">需要匹配类型的参数</option>}{variables.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
   <button className="small-button" disabled={!component} onClick={()=>setCreating(value=>!value)} aria-expanded={creating}>新建参数</button>
   <button className="small-button" disabled={!component||!variable} onClick={()=>{try{let id='';commit('创建界面参数联动',draft=>{id=createUiParameterBinding(draft,component!.id,selectedProperty,variable!.id,pageId).id;});setGraphId(id);setNotice('已连接参数与组件属性。页面显示期间自动更新；可继续增加比较、计算和分支。');}catch(error){setNotice(error instanceof Error?error.message:String(error));}}}>创建联动蓝图</button>
  </div>
  {creating&&component&&<UiBindingParameter key={component.id+'/'+selectedProperty} project={project} component={component} property={selectedProperty} onCancel={()=>setCreating(false)} onCreate={(name,initial,setId)=>{try{let id='',created='';commit('创建参数与界面联动',draft=>{id=addParameter(draft,setId,uiProperties[selectedProperty].type);const parameter=draft.variables.find(v=>v.id===id)!;parameter.name=name;parameter.initial=initial;created=createUiParameterBinding(draft,component.id,selectedProperty,id,pageId).id;});setVariableId(id);setGraphId(created);setCreating(false);setNotice('参数和联动已加入界面草稿，保存界面后生效。');}catch(error){setNotice(error instanceof Error?error.message:String(error));}}}/> }
</></>;
}
function UiBindingParameter({project,component,property,onCreate,onCancel}:{project:Project;component:UiComponent;property:UiProperty;onCreate:(name:string,initial:VariableValue,setId:string)=>void;onCancel:()=>void}) {
 const type=uiProperties[property].type;
 const defaultValue=type==='boolean'?property==='visible'||property==='enabled':type==='string'?component.text??'':property==='opacity'?component.style?.opacity??1:property==='value'?component.value??0:component[property as 'x'|'y'|'width'|'height']??0;
 const [name,setName]=useState(componentName(component)+' · '+uiProperties[property].name),[initial,setInitial]=useState<VariableValue>(defaultValue),[setId,setSetId]=useState(storyParametersId);
 const duplicate=project.variables.some(variable=>variable.name===name.trim());
 const valid=name.trim().length>0&&name.trim().length<=120&&!duplicate&&typeof initial===type&&(typeof initial!=='number'||Number.isFinite(initial)&&(!['opacity','value'].includes(property)||initial>=0&&initial<=1));
 return <form className="workspace-toolbar" aria-label="新建联动参数" onSubmit={event=>{event.preventDefault();if(valid)onCreate(name.trim(),initial,setId);}}>
  <label>参数名称<input aria-label="新参数名称" maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label>
  <span>类型：{{number:'数值',boolean:'开关',string:'文字'}[type]}</span>
  <label>初始值{type==='boolean'?<input aria-label="新参数初始值" type="checkbox" checked={Boolean(initial)} onChange={event=>setInitial(event.target.checked)}/>:type==='number'?<NumberInput aria-label="新参数初始值" value={Number(initial)} onChange={event=>setInitial(Number(event.target.value))}/>:<input aria-label="新参数初始值" value={String(initial)} onChange={event=>setInitial(event.target.value)}/>}</label>
  <label>参数集<select aria-label="新参数所属参数集" value={setId} onChange={event=>setSetId(event.target.value)}>{parameterSets(project).map(set=><option key={set.id} value={set.id}>{set.name}</option>)}</select></label>
  <button className="small-button" type="submit" disabled={!valid}>创建参数并联动</button><button className="small-button" type="button" onClick={onCancel}>取消</button>
  {duplicate&&<span role="status">已有同名参数，请使用已有参数或修改名称。</span>}
  {typeof initial==='number'&&['opacity','value'].includes(property)&&(initial<0||initial>1)&&<span role="status">此属性初始值需要在 0 至 1 之间。</span>}
 </form>;
}
