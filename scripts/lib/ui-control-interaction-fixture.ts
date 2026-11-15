import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type BlueprintNode, type UiComponent, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent, ensureUiTextCommittedEvent, ensureUiValueChangedEvent } from '../../src/core/ui-logic';
import { uiProperties, type UiProperty } from '../../src/core/ui-properties';

/** Shared authoring, interpreter and native scenarios; no test-only runtime operators. */
export function createUiControlInteractionFixture() {
  const project = createProject('控件范围与焦点'); project.id = 'control_interaction'; project.width = 1280; project.height = 720;
  const variable = (id: string, initial: VariableValue, name = id) => {
    if (!project.variables.some(item => item.id === id)) project.variables.push({ id, name, initial, type: typeof initial as 'number' | 'string' | 'boolean', persistent: false });
  };
  variable('range_source', 30, '共享数值'); variable('input_a', '甲', '输入甲'); variable('input_b', '乙', '输入乙');
  variable('changed_count', 0, '用户改值次数'); variable('committed_count', 0, '用户提交次数'); variable('job_done', false);
  project.variables.find(item=>item.id==='range_source')!.setting = { min: -20, max: 80, step: 5 };
  const actions = [
    ['narrow', '缩小范围'], ['wide', '跨越原范围'], ['range_reset', '重置控件范围'], ['fixed', '固定数值'],
    ['source', '写入归一化来源'], ['override', '覆盖数值 15'], ['focus_a', '请求输入甲'], ['focus_b', '请求输入乙'],
    ['release_a', '释放输入甲'], ['release_b', '释放输入乙'], ['chain', '程序焦点移动'], ['coalesce', '同帧后请求优先'],
    ['hide', '父级隐藏后恢复'], ['modal', '模态遮挡后恢复'], ['reopen', '关闭重开子页'], ['readonly', '只读拒绝焦点'],
    ['background', '后台范围与焦点'], ['observe', '读取当前状态'], ['disable', '禁用后恢复'], ['fresh', '打开并聚焦子页'], ['native', '模板页面焦点'], ['close', '关闭页面'],
  ] as const;
  const components: UiComponent[] = [
    { id:'range_slider',page:'custom',kind:'preference',text:'局部范围滑条',parameterId:'range_source',controlRange:{min:0,max:60,step:10},x:.04,y:.04,width:.42,height:.11 },
    { id:'range_mirror',page:'custom',kind:'preference',text:'来源范围镜像',parameterId:'range_source',x:.04,y:.20,width:.42,height:.11 },
    { id:'input_panel',page:'custom',kind:'panel',text:'输入组',x:.52,y:.03,width:.43,height:.29,style:{background:'#243844'} },
    { id:'focus_a_input',parentId:'input_panel',page:'custom',kind:'preferenceChoice',text:'输入甲',parameterId:'input_a',input:{placeholder:'输入甲',maxLength:20},x:.03,y:.08,width:.94,height:.36 },
    { id:'focus_b_input',parentId:'input_panel',page:'custom',kind:'preferenceChoice',text:'输入乙',parameterId:'input_b',input:{placeholder:'输入乙',maxLength:20},x:.03,y:.55,width:.94,height:.36 },
    ...actions.map(([id,text],i): UiComponent=>({id:'act_'+id,page:'custom',kind:'button',text,x:.035+i%4*.245,y:.37+Math.floor(i/4)*.098,width:.23,height:.08,style:{fontSize:22},...(id==='close'?{action:'return' as const}:{})})),
  ];
  const page = { id:'interaction_page',name:'范围与焦点',modal:true,background:'#14222c',components };
  const child = { id:'interaction_child',name:'焦点子页',modal:true,background:'#304554',components:[
    {id:'child_input',page:'custom',kind:'preferenceChoice',text:'子页输入',parameterId:'input_b',x:.2,y:.25,width:.6,height:.12},
    {id:'child_close',page:'custom',kind:'button',text:'关闭遮挡',action:'return',x:.3,y:.55,width:.4,height:.1},
  ] as UiComponent[] };
  project.ui.customPages.push(page,child);
  project.ui.pages ??= {};project.ui.pages.preferences={...project.ui.pages.preferences,layout:'custom'};
  project.ui.components=project.ui.components.filter(component=>component.page!=='preferences');
  project.ui.components.push(
    {id:'native_focus_input',page:'preferences',kind:'preferenceChoice',text:'模板输入',parameterId:'input_a',x:.2,y:.25,width:.6,height:.12},
    {id:'native_focus_close',page:'preferences',kind:'button',text:'返回范围焦点页',action:'return',x:.3,y:.55,width:.4,height:.1},
  );
  const graph = createUiEventGraph(project,page.id,'范围焦点同源场景'); let serial=0;
  const node = (owner: BlueprintGraph,type: BlueprintNode['type'],properties: Record<string,VariableValue> = {}) => {
    const result=blueprintNodeDefaults(type);result.id='range_focus_'+ ++serial;Object.assign(result.properties,properties);
    result.x=100+serial%5*370;result.y=380+Math.floor(serial/5)*250;owner.nodes.push(result);synchronizeBlueprintSignatures(project);
    if (owner.uiPageId === page.id && child.components.some(component => component.id === properties.componentId)) {
      // Cross-page operations require an explicit typed reference, not an implicit page-local target.
      const reference = blueprintNodeDefaults('literal'); reference.id = 'range_focus_' + ++serial;
      reference.pins[0].dataType = 'component'; reference.properties.value = properties.componentId; owner.nodes.push(reference);
      assert.equal(connectBlueprintPins(owner, reference.id, 'value', result.id, 'componentId'), undefined);
    }
    return result;
  };
  const wire=(owner:BlueprintGraph,from:BlueprintNode,output:string,to:BlueprintNode,input:string)=>assert.equal(connectBlueprintPins(owner,from.id,output,to.id,input),undefined);
  const next=(owner:BlueprintGraph,from:BlueprintNode,to:BlueprintNode)=>{wire(owner,from,from.pins.find(pin=>pin.direction==='output'&&pin.dataType==='exec')!.id,to,'exec_in');return to;};
  const action=(name:typeof actions[number][0])=>ensureUiClickEvent(project,graph,'act_'+name,page.id);
  const step=(previous:BlueprintNode,type:BlueprintNode['type'],properties:Record<string,VariableValue>={})=>next(graph,previous,node(graph,type,properties));
  const assign=(previous:BlueprintNode,componentId:string,property:UiProperty,value:VariableValue)=>step(previous,'setUiProperty',{componentId,property,value});
  const record=(previous:BlueprintNode,componentId:string,property:UiProperty,id:string,design=false)=>{
    variable(id,uiProperties[property].type==='boolean'?false:uiProperties[property].type==='number'?-999:'unset');
    const read=node(graph,design?'getUiDefault':'getUiProperty',{componentId,property}),store=node(graph,'setVariable',{variableId:id});
    wire(graph,read,'value',store,'value');return next(graph,previous,store);
  };
  const capture=(previous:BlueprintNode,source:BlueprintNode,pin:string,id:string)=>{
    variable(id,false);const store=node(graph,'setVariable',{variableId:id});wire(graph,source,pin,store,'value');return next(graph,previous,store);
  };
  const focus=(previous:BlueprintNode,componentId:string,focused:boolean,id?:string)=>{
    const request=step(previous,'focusUiComponent',{componentId,focused});return id?capture(request,request,'accepted',id):request;
  };
  const wait=(previous:BlueprintNode)=>step(previous,'delay',{seconds:.2});
  const done=(previous:BlueprintNode,name:string)=>{variable(name+'_done',false);return step(previous,'setVariable',{variableId:name+'_done',value:true});};
  const observe=(previous:BlueprintNode)=>{
    for(const [componentId,property,id] of [
      ['range_slider','numberValue','observed_value'],['range_slider','normalizedValue','observed_ratio'],['range_slider','minimum','observed_min'],['range_slider','maximum','observed_max'],['range_slider','step','observed_step'],
      ['range_slider','sourceMinimum','source_min'],['range_slider','sourceMaximum','source_max'],['range_slider','sourceStep','source_step'],['focus_a_input','focused','observed_a'],['focus_b_input','focused','observed_b'],
    ] as const) previous=record(previous,componentId,property,id);
    return previous;
  };
  const rangeNodes:Record<string,BlueprintNode>={};
  for(const [name,min,max,increment] of [['narrow',10,20,2],['wide',100,200,25],['fixed',12,12,3]] as const){
    rangeNodes[name]=step(action(name),'setUiControlRange',{componentId:'range_slider',minimum:min,maximum:max,step:increment});observe(rangeNodes[name]);
  }
  observe(step(action('range_reset'),'resetUiControlRange',{componentId:'range_slider'}));
  observe(step(action('source'),'setUiProperty',{componentId:'range_slider',property:'normalizedValue',value:.6,writeMode:'source'}));
  observe(assign(action('override'),'range_slider','numberValue',15));observe(action('observe'));
  const focusNodes:Record<string,BlueprintNode>={};
  for(const [name,target,focused] of [['focus_a','focus_a_input',true],['focus_b','focus_b_input',true],['release_a','focus_a_input',false],['release_b','focus_b_input',false]] as const){
    const request=step(action(name),'focusUiComponent',{componentId:target,focused});focusNodes[name]=request;
    let previous=capture(request,request,'accepted',name+'_accepted');previous=record(previous,target,'focused',name+'_immediate');
    record(wait(previous),target,'focused',name+'_after');
  }
  let chain=focus(action('chain'),'focus_a_input',true,'chain_a_accepted');
  chain=record(chain,'focus_a_input','focused','chain_a_immediate');chain=record(wait(chain),'focus_a_input','focused','chain_a_after');
  chain=focus(chain,'focus_b_input',true,'chain_b_accepted');chain=record(chain,'focus_a_input','focused','chain_a_before_move');chain=record(chain,'focus_b_input','focused','chain_b_immediate');
  chain=record(wait(chain),'focus_a_input','focused','chain_a_moved');chain=record(chain,'focus_b_input','focused','chain_b_after');
  chain=focus(chain,'focus_b_input',false);chain=record(wait(chain),'focus_b_input','focused','chain_b_released');
  variable('chain_done',false);step(chain,'setVariable',{variableId:'chain_done',value:true});
  let coalesce=focus(action('coalesce'),'focus_a_input',true);coalesce=focus(coalesce,'focus_b_input',true);
  coalesce=record(wait(coalesce),'focus_a_input','focused','coalesce_a');coalesce=record(coalesce,'focus_b_input','focused','coalesce_b');
  coalesce=focus(coalesce,'focus_a_input',false);coalesce=record(wait(coalesce),'focus_b_input','focused','coalesce_b_after_release_a');
  variable('coalesce_done',false);step(coalesce,'setVariable',{variableId:'coalesce_done',value:true});
  for(const [name,target,property] of [['hide','input_panel','visible'],['disable','focus_a_input','enabled']] as const){
    let previous=focus(action(name),'focus_a_input',true,name+'_accepted');previous=assign(previous,target,property,false);previous=assign(previous,target,property,true);
    done(record(wait(previous),'focus_a_input','focused',name+'_after'),name);
  }
  let locked=assign(action('readonly'),'focus_a_input','readOnly',true);locked=focus(locked,'focus_a_input',true,'readonly_accepted');locked=assign(locked,'focus_a_input','readOnly',false);
  done(record(wait(locked),'focus_a_input','focused','readonly_after'),'readonly');
  let modal=focus(action('modal'),'focus_a_input',true,'modal_accepted');modal=step(modal,'showUiPage',{pageId:child.id,wait:false,modal:'modal'});modal=step(modal,'closeUiPage',{pageId:child.id});
  done(record(wait(modal),'focus_a_input','focused','modal_after'),'modal');
  let reopen=step(action('reopen'),'showUiPage',{pageId:child.id,wait:false,modal:'modal'});reopen=focus(reopen,'child_input',true,'child_accepted');reopen=step(reopen,'closeUiPage',{pageId:child.id});
  reopen=step(reopen,'showUiPage',{pageId:child.id,wait:false,modal:'modal'});done(record(wait(reopen),'child_input','focused','child_reopened_focus'),'reopen');
  let fresh=step(action('fresh'),'showUiPage',{pageId:child.id,wait:false,modal:'modal'});fresh=focus(fresh,'child_input',true,'fresh_accepted');
  fresh=record(fresh,'child_input','focused','fresh_immediate');record(wait(fresh),'child_input','focused','fresh_after');
  step(action('native'),'showUiPage',{pageId:'ui:preferences',wait:true});
  const nativeGraph=createUiEventGraph(project,'ui:preferences','模板页面焦点');
  variable('native_accepted',false);variable('native_immediate',false);variable('native_after',false);
  const nativeFocus=next(nativeGraph,nativeGraph.nodes[0],node(nativeGraph,'focusUiComponent',{componentId:'native_focus_input',focused:true}));
  const nativeAccepted=node(nativeGraph,'setVariable',{variableId:'native_accepted'});wire(nativeGraph,nativeFocus,'accepted',nativeAccepted,'value');
  let nativeTail=next(nativeGraph,nativeFocus,nativeAccepted);
  for(const name of ['native_immediate','native_after']){
    if(name==='native_after')nativeTail=next(nativeGraph,nativeTail,node(nativeGraph,'delay',{seconds:.05}));
    const read=node(nativeGraph,'getUiProperty',{componentId:'native_focus_input',property:'focused'}),store=node(nativeGraph,'setVariable',{variableId:name});
    wire(nativeGraph,read,'value',store,'value');nativeTail=next(nativeGraph,nativeTail,store);
  }
  const count=(event:BlueprintNode,id:string)=>{const read=node(graph,'getVariable',{variableId:id}),add=node(graph,'math',{operation:'add',b:1}),store=node(graph,'setVariable',{variableId:id});wire(graph,read,'value',add,'a');wire(graph,add,'result',store,'value');next(graph,event,store);};
  for(const id of ['range_slider','range_mirror','focus_a_input','focus_b_input'])count(ensureUiValueChangedEvent(project,graph,id,page.id),'changed_count');
  for(const id of ['focus_a_input','focus_b_input'])count(ensureUiTextCommittedEvent(project,graph,id,page.id),'committed_count');
  const background=createBlueprintGraph('function','后台控件调整');project.blueprints.push(background);
  let job=next(background,background.nodes[0],node(background,'setUiControlRange',{componentId:'range_slider',minimum:25,maximum:45,step:5}));
  job=next(background,job,node(background,'focusUiComponent',{componentId:'focus_a_input',focused:true}));next(background,job,node(background,'setVariable',{variableId:'job_done',value:true}));
  step(action('background'),'startTask',{graphId:background.id,scope:'page',pageId:page.id,seconds:.05,conflict:'parallel'});
  const openGraph=createBlueprintGraph('function','打开范围焦点页');project.blueprints.push(openGraph);
  next(openGraph,openGraph.nodes[0],node(openGraph,'showUiPage',{pageId:page.id,wait:true}));
  const passage=project.nodes.find(item=>item.kind==='passage');if(!passage||passage.kind!=='passage')throw new Error('Missing passage');
  passage.lines[0].text='范围焦点页面已关闭。';passage.lines[0].actions=[{kind:'blueprint',blueprintId:openGraph.id}];
  const editGraph=createBlueprintGraph('function','范围焦点字段创作');project.blueprints.push(editGraph);
  const editorRange=node(editGraph,'setUiControlRange',{componentId:'range_slider',minimum:0,maximum:60,step:10}),editorFocus=node(editGraph,'focusUiComponent',{componentId:'focus_a_input',focused:true});
  editorRange.x=100;editorRange.y=320;editorFocus.x=640;editorFocus.y=320;
  synchronizeBlueprintSignatures(project);
  return {project,page,child,graph,nativeGraph,background,openGraph,editGraph,editorRange,editorFocus,rangeNodes,focusNodes};
}
