import { useState } from 'react';
import { Plus } from 'lucide-react';
import { createUiGraphVariable } from '../core/ui-logic';
import { parameterSets, parameterSetFor, storyParametersId } from '../core/parameter-sets';
import { defaultBlueprintValue, type BlueprintNodeType } from '../core/blueprint';
import type { Project, Variable, VariableValue } from '../core/model';
import type { Commit } from './editor';
import { BlueprintValueInput } from './BlueprintValueInput';

export function UiGraphVariables({project,commit,canAddNode,add,onNotice}:{project:Project;commit:Commit;canAddNode:boolean;add:(type:BlueprintNodeType,properties?:Record<string,VariableValue>)=>void;onNotice:(message:string)=>void}) {
 const [creating,setCreating]=useState(false),[name,setName]=useState(''),[type,setType]=useState<Variable['type']>('boolean'),[initial,setInitial]=useState<VariableValue|undefined>(false),[setId,setSetId]=useState(storyParametersId),[error,setError]=useState('');
 const duplicate=project.variables.some(v=>v.name===name.trim()),valid=!!name.trim()&&name.trim().length<=120&&!duplicate&&typeof initial===type&&(typeof initial!=='number'||Number.isFinite(initial));
 return <section className="ui-graph-variables"><h3>变量<button className="text-button" aria-expanded={creating} onClick={()=>{setCreating(v=>!v);setError('');}}><Plus size={13}/>新建变量</button></h3>
 {creating&&<form aria-label="创建界面图变量" onSubmit={event=>{event.preventDefault();if(!valid)return;try{commit('创建界面图变量',draft=>{createUiGraphVariable(draft,name,type,initial!,setId);});setCreating(false);setName('');setError('');onNotice('变量已加入界面草稿。拖入图中选择读取或设置，也可使用变量旁的按钮。');}catch(error){setError(error instanceof Error?error.message:String(error));}}}>
  <label>名称<input autoFocus aria-label="变量名称" maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
  <label>类型<select aria-label="变量类型" value={type} onChange={e=>{const type=e.target.value as Variable['type'];setType(type);setInitial(defaultBlueprintValue(type));}}><option value="boolean">开关</option><option value="number">数值</option><option value="string">文字</option></select></label>
  <label>初始值<BlueprintValueInput project={project} type={type} label="变量初始值" value={initial} onChange={setInitial}/></label>
  <label>参数集<select aria-label="变量所属参数集" value={setId} onChange={e=>setSetId(e.target.value)}>{parameterSets(project).map(set=><option key={set.id} value={set.id}>{set.name}</option>)}</select></label>
  <small>变量可在其他蓝图中使用；属于游戏设置的变量会持久保存。</small>
  {(duplicate||error)&&<p role="status">{error||'已有同名变量，请修改名称或使用现有变量。'}</p>}
  <div><button className="small-button" type="submit" disabled={!valid}>创建变量</button><button className="text-button" type="button" onClick={()=>setCreating(false)}>取消</button></div>
 </form>}
 {project.variables.map(v=><div key={v.id} className="ui-event-variable"><span data-ui-variable-id={v.id} draggable title={parameterSetFor(project,v).name+' · '+({boolean:'开关',number:'数值',string:'文字'}[v.type])} onDragStart={e=>{e.dataTransfer.setData('application/vns-variable',v.id);e.dataTransfer.effectAllowed='copy';}}>{v.name}</span><button disabled={!canAddNode} aria-label={'读取 '+v.name} onClick={()=>add('getVariable',{variableId:v.id})}>读</button><button disabled={!canAddNode} aria-label={'设置 '+v.name} onClick={()=>add('setVariable',{variableId:v.id,value:v.initial})}>写</button></div>)}
 {!project.variables.length&&!creating&&<p>新建开关、数值或文字变量，用节点读取和修改。</p>}
 </section>;
}
