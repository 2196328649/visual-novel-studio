import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type BlueprintNode, type UiComponent, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent } from '../../src/core/ui-logic';
import { applyUiPropertySnapshot, type UiProperty } from '../../src/core/ui-properties';
import { resolveUiLayout, uiGeometryContains, uiTransformPoint, type UiLayoutGeometry, type UiPoint } from '../../src/core/ui-layout';

/** One authored project drives unit, editor and native acceptance. Nothing is generated on import. */
export function createUiLayoutFixture() {
  const project=createProject('通用布局与容器');project.id='ui_layout_fixture';project.width=1280;project.height=720;
  const observations: [UiProperty,string][]=[['screenX','layout_x'],['screenY','layout_y'],['screenWidth','layout_width'],['screenHeight','layout_height'],['scrollX','layout_scroll_x'],['scrollY','layout_scroll_y'],['scrollMaximumY','layout_scroll_max'],['contentHeight','layout_content_height']];
  for(const id of [...observations.map(([,id])=>id),'layout_hit','layout_background_done','layout_committed'])project.variables.push({id,name:id,type:'number',initial:0,persistent:false});
  project.variables.push({id:'layout_text',name:'布局输入',type:'string',initial:'初始文字',persistent:false},{id:'layout_number',name:'布局数值',type:'number',initial:30,persistent:false,setting:{min:0,max:100,step:5}},{id:'layout_option',name:'布局选项',type:'string',initial:'A',persistent:false,setting:{options:['A','B','C']}});
  project.assets.push({id:'layout_grid',name:'布局标记图',kind:'image',path:'assets/layout-grid.png',width:64,height:32});
  const actions=[['apply','旋转缩放容器'],['scroll','滚动到底'],['observe','读取布局'],['hide','隐藏首项'],['reset','恢复布局'],['child','打开布局子页'],['native','打开布局模板'],['background','后台滚动'],['controls','打开布局输入'],['close','关闭布局页']] as const;
  const panel:UiComponent={id:'layout_panel',page:'custom',kind:'panel',text:'',name:'被测容器',x:.04,y:.06,width:.5,height:.68,style:{background:'#16344888',borderColor:'#80ddff',borderWidth:3},layout:{version:1,flow:'vertical',gap:16,paddingLeft:20,paddingTop:20,paddingRight:20,paddingBottom:20,clip:true,scroll:'both'}};
  const items:UiComponent[]=Array.from({length:3},(_,i)=>({id:'layout_item_'+i,page:'custom',parentId:panel.id,kind:'button',text:'布局子项 '+(i+1),name:'布局子项 '+(i+1),x:0,y:0,width:.9,height:.4,layout:{version:1,order:i},style:{background:['#32745f','#52568c','#825338'][i],fontSize:26}}));
  const page={id:'layout_page',name:'布局场景',modal:true,background:'#182330',components:[panel,{id:'layout_background',page:'custom',kind:'image',parentId:panel.id,childLayer:'background',text:'',assetId:'layout_grid',x:0,y:0,width:1,height:1,style:{imageFit:'stretch'}},...items,...actions.map(([id,text],i):UiComponent=>({id:'layout_action_'+id,page:'custom',kind:'button',text,x:.64,y:.045+i*.097,width:.32,height:.075,style:{fontSize:22},...(id==='close'?{action:'return' as const}:{})}))] as UiComponent[]};
  const child={id:'layout_child',name:'布局子页',modal:true,background:'#21302a',components:[
    {id:'layout_child_panel',page:'custom',kind:'panel',text:'',x:.25,y:.2,width:.5,height:.45,style:{background:'#2c5340'},layout:{version:1,scroll:'vertical',clip:true,paddingTop:12}},
    {id:'layout_child_tall',page:'custom',kind:'text',text:'可滚动的子页内容',parentId:'layout_child_panel',x:0,y:0,width:1,height:2,style:{background:'#315b47',fontSize:28}},
    {id:'layout_child_close',page:'custom',kind:'button',text:'关闭布局子页',action:'return',x:.35,y:.78,width:.3,height:.1},
  ] as UiComponent[]};
  const controlsPage={id:'layout_controls',name:'布局与控件焦点',modal:true,background:'#162a30',components:[
    {id:'layout_controls_panel',page:'custom',kind:'panel',text:'',x:.06,y:.08,width:.7,height:.52,layout:{version:1,flow:'vertical',gap:12,paddingLeft:16,paddingTop:16,paddingRight:16,paddingBottom:16,clip:true,scroll:'vertical'},style:{background:'#345764'}},
    {id:'layout_input',page:'custom',kind:'preferenceChoice',parentId:'layout_controls_panel',parameterId:'layout_text',text:'布局输入',x:0,y:0,width:1,height:.3},
    {id:'layout_slider',page:'custom',kind:'preference',parentId:'layout_controls_panel',parameterId:'layout_number',text:'布局滑条',x:0,y:0,width:1,height:.3},
    {id:'layout_choices',page:'custom',kind:'preferenceChoice',parentId:'layout_controls_panel',parameterId:'layout_option',text:'布局选项',x:0,y:0,width:1,height:.3},
    {id:'layout_spacer',page:'custom',kind:'panel',parentId:'layout_controls_panel',text:'',x:0,y:0,width:1,height:2,style:{background:'#465b4c'}},
    {id:'layout_popup',page:'custom',kind:'preferenceChoice',text:'变换后的标准弹层',preference:'skipAll',x:.39,y:.73,width:.45,height:.09,layout:{version:1,pivotX:.5,pivotY:.5,rotation:12,scaleX:.9,scaleY:.9}},
    ...(['focus','animate','scroll','reset','close'] as const).map((action,i):UiComponent=>({id:'layout_controls_'+action,page:'custom',kind:'button',text:{focus:'聚焦输入',animate:'动画移出',scroll:'滚动移出',reset:'恢复控件',close:'关闭布局输入'}[action],x:.79,y:.08+i*.17,width:.19,height:.1,...(action==='close'?{action:'return' as const}:{})})),
  ] as UiComponent[]};
  // Keep the native preference popup on its supported settings host; custom controls remain parameter-bound.
  const popup = controlsPage.components.find(component => component.id === 'layout_popup')!;
  // Leave room for the transformed AABB and a 0.1-page move. Starting at .04
  // with a centered pivot clamps both popup positions to the screen's edge.
  controlsPage.components.splice(controlsPage.components.indexOf(popup), 1); popup.page = 'preferences'; popup.x = .39; popup.y = .16;
  project.ui.customPages.push(page,child,controlsPage);
  project.ui.pages??={};project.ui.pages.preferences={layout:'custom',background:'#243346'};
  project.ui.components=project.ui.components.filter(c=>c.page!=='preferences');
  project.ui.components.push(popup,{...panel,id:'layout_native_panel',page:'preferences',x:.3,y:.4,layout:{...panel.layout,version:1,pivotX:.5,pivotY:.5,rotation:12,scaleX:.85,scaleY:.85}},...items.map((c,i):UiComponent=>({...c,id:'layout_native_item_'+i,page:'preferences',parentId:'layout_native_panel'})),{id:'layout_native_close',page:'preferences',kind:'button',text:'关闭布局模板',action:'return',x:.65,y:.78,width:.3,height:.1});
  const graph=createUiEventGraph(project,page.id,'布局共用事件');let serial=0;
  const node=(owner:BlueprintGraph,type:BlueprintNode['type'],properties:Record<string,VariableValue>={})=>{const n=blueprintNodeDefaults(type);n.id='layout_node_'+ ++serial;Object.assign(n.properties,properties);n.x=80+serial%5*360;n.y=350+Math.floor(serial/5)*240;owner.nodes.push(n);synchronizeBlueprintSignatures(project);return n;};
  const wire=(owner:BlueprintGraph,from:BlueprintNode,output:string,to:BlueprintNode,input:string)=>assert.equal(connectBlueprintPins(owner,from.id,output,to.id,input),undefined);
  const next=(owner:BlueprintGraph,from:BlueprintNode,to:BlueprintNode)=>{wire(owner,from,from.pins.find(p=>p.direction==='output'&&p.dataType==='exec')!.id,to,'exec_in');return to;};
  const action=(name:typeof actions[number][0])=>ensureUiClickEvent(project,graph,'layout_action_'+name,page.id);
  const step=(previous:BlueprintNode,type:BlueprintNode['type'],properties:Record<string,VariableValue>={})=>next(graph,previous,node(graph,type,properties));
  const mutations:Record<string,BlueprintNode>={};let tail=action('apply');
  for(const [property,value] of Object.entries({x:.3,y:.4,pivotX:.5,pivotY:.5,layoutRotation:18,scaleX:.9,scaleY:.9}))tail=mutations[property]=step(tail,'setUiProperty',{componentId:panel.id,property,value});
  mutations.scroll=step(action('scroll'),'setUiProperty',{componentId:panel.id,property:'scrollY',value:1000000});
  mutations.hide=step(action('hide'),'setUiProperty',{componentId:items[0].id,property:'visible',value:false});
  tail=action('reset');for(const c of [panel,...items])tail=step(tail,'resetUiComponent',{componentId:c.id});
  step(action('child'),'showUiPage',{pageId:child.id,wait:true});step(action('native'),'showUiPage',{pageId:'ui:preferences',wait:true});
  tail=action('observe');for(const [property,variableId] of observations){const source=node(graph,'getUiProperty',{componentId:panel.id,property}),store=node(graph,'setVariable',{variableId});wire(graph,source,'value',store,'value');tail=next(graph,tail,store);}
  items.forEach((c,i)=>step(ensureUiClickEvent(project,graph,c.id,page.id),'setVariable',{variableId:'layout_hit',value:i+1}));
  step(action('controls'),'showUiPage',{pageId:controlsPage.id,wait:true});
  const controlsGraph=createUiEventGraph(project,controlsPage.id,'布局焦点共用事件');
  const controlEvent=(id:string)=>ensureUiClickEvent(project,controlsGraph,'layout_controls_'+id,controlsPage.id);
  next(controlsGraph,controlEvent('focus'),node(controlsGraph,'focusUiComponent',{componentId:'layout_input',focused:true}));
  const animateFocus=next(controlsGraph,controlEvent('animate'),node(controlsGraph,'focusUiComponent',{componentId:'layout_input',focused:true}));
  next(controlsGraph,animateFocus,node(controlsGraph,'animateUiProperty',{componentId:'layout_input',property:'y',value:2,duration:1,easing:'linear',wait:false}));
  next(controlsGraph,controlEvent('scroll'),node(controlsGraph,'setUiProperty',{componentId:'layout_controls_panel',property:'scrollY',value:1000000}));
  let controlTail=controlEvent('reset');for(const id of ['layout_input','layout_controls_panel'])controlTail=next(controlsGraph,controlTail,node(controlsGraph,'resetUiComponent',{componentId:id}));
  next(controlsGraph,node(controlsGraph,'eventTextCommitted',{componentId:'layout_input'}),node(controlsGraph,'setVariable',{variableId:'layout_committed',value:1}));
  const nativeGraph=createUiEventGraph(project,'ui:preferences','布局模板共用事件');
  for(let i=0;i<3;i++)next(nativeGraph,ensureUiClickEvent(project,nativeGraph,'layout_native_item_'+i,'ui:preferences'),node(nativeGraph,'setVariable',{variableId:'layout_hit',value:10+i}));
  const background=createBlueprintGraph('function','后台容器滚动');project.blueprints.push(background);
  const changed=next(background,background.nodes[0],node(background,'setUiProperty',{componentId:panel.id,property:'scrollY',value:80}));
  next(background,changed,node(background,'setVariable',{variableId:'layout_background_done',value:1}));
  step(action('background'),'startTask',{graphId:background.id,scope:'page',pageId:page.id,seconds:.2,conflict:'parallel'});
  const open=createBlueprintGraph('function','打开布局场景');project.blueprints.push(open);next(open,open.nodes[0],node(open,'showUiPage',{pageId:page.id,wait:true}));
  const passage=project.nodes.find(n=>n.kind==='passage');if(!passage||passage.kind!=='passage')throw Error('Missing passage');
  passage.lines[0].text='布局页关闭后继续剧情。';passage.lines[0].actions=[{kind:'blueprint',blueprintId:open.id}];
  const editGraph=createBlueprintGraph('function','布局属性创作');project.blueprints.push(editGraph);
  const editorSet=node(editGraph,'setUiProperty',{componentId:panel.id,property:'layoutRotation',value:0});
  const editorGet=node(editGraph,'getUiProperty',{componentId:panel.id,property:'scrollMaximumY'});
  synchronizeBlueprintSignatures(project);
  return {project,page,panel,items,child,controlsPage,controlsGraph,graph,nativeGraph,open,editGraph,editorSet,editorGet,mutations,observations,node,wire,next};
}

export interface UiLayoutFixtureChange { componentId:string; property:UiProperty; value:VariableValue }
const rectValues=(rect:{x:number;y:number;width:number;height:number})=>[rect.x,rect.y,rect.width,rect.height];
/** Independent TS expectations become fixed native click coordinates and numeric assertions. */
export function uiLayoutFixtureExpectations(f:ReturnType<typeof createUiLayoutFixture>) {
  const change=(componentId:string,values:Partial<Record<UiProperty,VariableValue>>):UiLayoutFixtureChange[]=>Object.entries(values).map(([property,value])=>({componentId,property:property as UiProperty,value:value!}));
  const affine=change('layout_panel',{x:.3,y:.4,pivotX:.5,pivotY:.5,layoutRotation:18,scaleX:.9,scaleY:.9});
  const cases:Record<string,UiLayoutFixtureChange[]>={
    initial:[], transformed:affine, scrolled:[...affine,...change('layout_panel',{scrollY:1000000})],
    hidden:[...affine,...change('layout_panel',{scrollY:1000000}),...change('layout_item_0',{visible:false})],
    horizontal:[...affine,...change('layout_panel',{scrollMode:'both'}),...change('layout_item_0',{width:2})],
    mirrored:[...affine,...change('layout_panel',{scaleX:-.9,scrollY:1000000})],
    nested:[...affine,...change('layout_item_1',{layoutRotation:-24,pivotX:.5,pivotY:.5,scaleX:1.2,scaleY:.7})],
    zero:[...affine,...change('layout_panel',{scaleX:0})],
  };
  const snapshot=(g:UiLayoutGeometry)=>({width:g.width,height:g.height,matrix:[...g.matrix],renderMatrix:[...g.renderMatrix],bounds:rectValues(g.bounds),content:rectValues(g.content),scrollX:g.scrollX,scrollY:g.scrollY,scrollMinimumX:g.scrollMinimumX,scrollMinimumY:g.scrollMinimumY,scrollMaximumX:g.scrollMaximumX,scrollMaximumY:g.scrollMaximumY,contentWidth:g.contentWidth,contentHeight:g.contentHeight,clippedOut:g.clippedOut,visible:g.visible});
  return Object.fromEntries(Object.entries(cases).map(([name,changes])=>{
    const components=structuredClone(f.page.components);
    for(const item of changes)applyUiPropertySnapshot(components.find(c=>c.id===item.componentId)!,item.property,item.value);
    const values=new Map(changes.filter(c=>c.property==='visible').map(c=>[c.componentId,Boolean(c.value)]));
    const rows=resolveUiLayout(components,f.project,c=>values.get(c.id)??true),third=rows.get('layout_item_2')!;
    const center=(points:UiPoint[])=>points.length?{x:points.reduce((v,p)=>v+p.x,0)/points.length,y:points.reduce((v,p)=>v+p.y,0)/points.length}:undefined;
    const inside=center(third.visiblePolygon),outside=[.9,.7,.5,.3,.1].flatMap(y=>[.5,.2,.8].map(x=>uiTransformPoint(third.renderMatrix,{x:third.width*x,y:third.height*y}))).find(p=>p.x>4&&p.y>4&&p.x<f.project.width*.6&&p.y<f.project.height-4&&!uiGeometryContains(third,p));
    const pixel=(p:UiPoint|undefined)=>p?[Math.round(p.x),Math.round(p.y)]:null;
    return [name,{changes,rows:Object.fromEntries([...rows].map(([id,g])=>[id,snapshot(g)])),insideThird:pixel(inside),outsideThird:pixel(outside),wheel:pixel(center(rows.get('layout_panel')!.visiblePolygon))}];
  }));
}
