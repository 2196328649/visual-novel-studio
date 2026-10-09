import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { createUiParameterBinding } from '../src/core/ui-logic';
import { compileProject } from '../src/runtime/compiler';
import { validateProject } from '../src/core/validate';

test('UI parameter graph uses typed pins and emits a page-scoped timer for standard and custom pages',()=>{
 for(const custom of [false,true]) {
  const p=createProject();p.variables.push({id:'visible',name:'显示标题',type:'boolean',initial:true,persistent:false});
  const component={id:'bound_title',kind:'text' as const,page:custom?'custom' as const:'main' as const,text:'动态标题',x:.1,y:.1,width:.5,height:.1};
  if(custom)p.ui.customPages.push({id:'test_page',name:'测试页面',components:[component],modal:false});else p.ui.components.push(component);
  const graph=createUiParameterBinding(p,component.id,'visible','visible',custom?'test_page':'ui:main');
  assert.equal(graph.links.length,4);assert.equal(graph.nodes.find(n=>n.type==='getVariable')!.pins.find(pin=>pin.id==='value')!.dataType,'boolean');
  assert.deepEqual(validateProject(p).filter(d=>d.severity==='error'),[]);
  const compiled=compileProject(p),screens=compiled.files['game/screens.rpy'];
  assert.ok(screens.includes('timer 0.05 repeat True action Function(vn_run_blueprint, "'+graph.id+'"'));
  assert.throws(()=>createUiParameterBinding(p,component.id,'opacity','visible',custom?'test_page':'ui:main'),/类型/);
 }
});

test('switching UI schemes preserves blueprint references and only mounts matching events',()=>{
 const p=createProject();p.variables.push({id:'visible',name:'显示',type:'boolean',initial:true,persistent:false});
 const component=(id:string)=>({id,kind:'text' as const,page:'main' as const,text:id,x:.1,y:.1,width:.5,height:.1});
 p.ui.instances=[{id:'scheme_a',name:'方案A',components:[component('title_a')]},{id:'scheme_b',name:'方案B',components:[component('title_b')]}];
 p.ui.activeInstanceId='scheme_a';const a=createUiParameterBinding(p,'title_a','visible','visible','ui:main');
 p.ui.activeInstanceId='scheme_b';const b=createUiParameterBinding(p,'title_b','visible','visible','ui:main');
 for(const [id,active,inactive] of [['scheme_a',a,b],['scheme_b',b,a]] as const) {
  p.ui.activeInstanceId=id;const result=compileProject(p);
  assert.deepEqual(result.diagnostics.filter(d=>d.severity==='error'),[]);
  const screens=result.files['game/screens.rpy'];
  assert.ok(screens.includes('timer 0.05 repeat True action Function(vn_run_blueprint, "'+active.id+'"'));
  assert.ok(!screens.includes('timer 0.05 repeat True action Function(vn_run_blueprint, "'+inactive.id+'"'));
 }
 p.ui.instances.push({id:'derived',name:'继承A',baseUiId:'scheme_a',components:[]});p.ui.activeInstanceId='derived';
 assert.ok(compileProject(p).files['game/screens.rpy'].includes('timer 0.05 repeat True action Function(vn_run_blueprint, "'+a.id+'"'));
 a.nodes.find(node=>node.type==='eventTimer')!.properties.uiInstanceId='missing';
 assert.ok(validateProject(p).some(d=>d.message.includes('作用范围')));
});
