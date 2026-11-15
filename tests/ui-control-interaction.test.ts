import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiControlInteractionFixture } from '../scripts/lib/ui-control-interaction-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { uiControlDefinition, uiControlEffectiveValue, uiControlFromRatio, uiControlRangeProblem, uiControlRatio, uiControlUserValue } from '../src/core/ui-control-properties';
import { uiPropertyDefault, uiPropertyDefaults } from '../src/core/ui-properties';
import { blueprintNodeDefaults, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { validateProject } from '../src/core/validate';
import { projectSchema, type UiComponent } from '../src/core/model';
import { compileProject } from '../src/runtime/compiler';
import { blueprintTaskProblems } from '../src/core/blueprint-tasks';

const click=(action:string):UiPreviewEvent=>({kind:'click',componentId:'act_'+action});
const advance=(seconds=.8):UiPreviewEvent=>({kind:'advance',seconds});
const sample=(f:ReturnType<typeof createUiControlInteractionFixture>,events:UiPreviewEvent[]=[])=>previewUiLogic(f.project,f.page.components,f.page.id,{},events,{timed:true,trace:true});
const renderedRange=(result:ReturnType<typeof sample>)=>result.components.find(row=>row.component.id==='range_slider')!.component.controlRange;

test('authored control range is distinct from binding range and survives serialization',()=>{
  const f=createUiControlInteractionFixture(),slider=f.page.components[0],defaults=uiPropertyDefaults(f.project,f.page.components);
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(f.project))).ui.customPages[0].components[0].controlRange,{min:0,max:60,step:10});
  assert.equal(defaults.range_slider.minimum,0);assert.equal(defaults.range_slider.maximum,60);assert.equal(defaults.range_slider.step,10);
  assert.equal(defaults.range_slider.sourceMinimum,-20);assert.equal(defaults.range_slider.sourceMaximum,80);assert.equal(defaults.range_slider.sourceStep,5);
  assert.equal(uiPropertyDefault(f.project,{...slider,controlRange:{min:10,max:20,step:2}},'numberValue'),20);
  const legacy={...slider};delete legacy.controlRange;
  assert.equal(uiControlDefinition(f.project,legacy)!.range!.min,-20);
});

test('range overrides clamp only the effective display; widening/reset reveals the preserved source or value override',()=>{
  const f=createUiControlInteractionFixture(),original=structuredClone(f.project);
  let result=sample(f,[click('narrow')]);
  assert.equal(result.incomplete,false);assert.deepEqual(renderedRange(result),{min:10,max:20,step:2});
  assert.equal(result.controlValues.range_slider,20);assert.equal(result.variables.range_source,30);assert.equal(result.controlValues.range_mirror,30);
  assert.equal(result.variables.observed_ratio,1);assert.equal(result.variables.changed_count,0);assert.equal(result.variables.committed_count,0);
  result=sample(f,[click('override'),click('fixed')]);assert.equal(result.controlValues.range_slider,12);assert.equal(result.variables.range_source,30);assert.equal(result.variables.observed_ratio,0);
  result=sample(f,[click('override'),click('fixed'),click('range_reset')]);assert.equal(result.controlValues.range_slider,15);assert.deepEqual(renderedRange(result),{min:0,max:60,step:10});
  result=sample(f,[click('wide'),click('source')]);assert.equal(result.incomplete,false);assert.equal(result.variables.range_source,160);assert.equal(result.controlValues.range_slider,160);assert.equal(result.controlValues.range_mirror,80);
  assert.equal(result.variables.changed_count,0);assert.deepEqual(f.project,original);
});

test('actual and normalized program assignments use the current range without snapping or touching mirrors in override mode',()=>{
  const f=createUiControlInteractionFixture();
  const result=sample(f,[click('narrow'),click('source')]);assert.equal(result.variables.range_source,16);assert.equal(result.controlValues.range_slider,16);assert.equal(result.controlValues.range_mirror,16);
  const nonStep=sample(f,[click('source')]);assert.equal(nonStep.variables.range_source,36);assert.equal(nonStep.variables.changed_count,0);
  const user=sample(f,[click('wide'),{kind:'control',componentId:'range_slider',value:175}]);assert.equal(user.variables.range_source,175);assert.equal(user.controlValues.range_mirror,80);assert.equal(user.variables.changed_count,1);
  const info=uiControlDefinition(f.project,f.page.components[0])!;
  assert.equal(uiControlUserValue(info,.24),10);assert.equal(uiControlUserValue({...info,range:{min:0,max:10,step:3}},1),10);
});

test('invalid atomic ranges are rejected without partially changing existing values',()=>{
  for(const fields of [{minimum:20,maximum:10,step:1},{minimum:0,maximum:60,step:0},{minimum:NaN,maximum:60,step:1},{minimum:-1e308,maximum:1e308,step:1}]){
    const f=createUiControlInteractionFixture();Object.assign(f.rangeNodes.narrow.properties,fields);synchronizeBlueprintSignatures(f.project);
    assert.ok(validateBlueprints(f.project).some(issue=>issue.nodeId===f.rangeNodes.narrow.id));
    const result=sample(f,[click('narrow')]);assert.equal(result.incomplete,true);assert.deepEqual(renderedRange(result),{min:0,max:60,step:10});assert.equal(result.variables.range_source,30);
  }
});

test('single-field range reset refuses an incompatible endpoint; whole-range reset remains available',()=>{
  const f=createUiControlInteractionFixture();
  const event=f.graph.nodes.find(node=>node.type==='eventClick'&&node.properties.componentId==='act_range_reset')!;
  const reset=f.graph.nodes.find(node=>node.type==='resetUiControlRange')!;
  Object.assign(reset,{...blueprintNodeDefaults('resetUiProperty'),id:reset.id,x:reset.x,y:reset.y,properties:{componentId:'range_slider',property:'maximum'}});
  synchronizeBlueprintSignatures(f.project);assert.ok(f.graph.links.some(link=>link.fromNodeId===event.id&&link.toNodeId===reset.id));
  const result=sample(f,[click('wide'),click('range_reset')]);assert.equal(result.incomplete,true);assert.deepEqual(renderedRange(result),{min:100,max:200,step:25});
});

test('player engine boundaries and the text-speed sentinel remain explicit in subranges and fixed ranges',()=>{
  const f=createUiControlInteractionFixture();const component:UiComponent={id:'speed',kind:'preference',page:'preferences',text:'速度',preference:'textSpeed',x:0,y:0,width:1,height:.1};
  const full=uiControlDefinition(f.project,component)!;assert.equal(uiControlRatio(full,0),1);assert.equal(uiControlFromRatio(full,1),0);
  const finite={...full,range:{min:20,max:60,step:5}};assert.equal(uiControlEffectiveValue(finite,0),60);assert.equal(uiControlFromRatio(finite,1),60);assert.equal(uiControlRatio(finite,0),1);
  const fixed={...full,range:{min:0,max:0,step:1}};assert.equal(uiControlRatio(fixed,0),0);assert.equal(uiControlFromRatio(fixed,.7),0);
  // Text speed has no engine ceiling; authors may go past the default 200, never below 0.
  assert.equal(uiControlRangeProblem(full,{min:0,max:500,step:1}),undefined);assert.ok(uiControlRangeProblem(full,{min:-1,max:100,step:1}));
  const volume=uiControlDefinition(f.project,{...component,preference:'musicVolume'})!;assert.ok(uiControlRangeProblem(volume,{min:0,max:2,step:.1}));
  const authored={...component,preference:'musicVolume' as const,controlRange:{min:0,max:2,step:.1}};f.project.ui.components.push(authored);
  assert.ok(validateProject(f.project).some(issue=>issue.message.includes('引擎边界')));
});

test('focus accepted is a queued command, while same-chain observation stays actual until the refresh boundary',()=>{
  const f=createUiControlInteractionFixture(),result=sample(f,[click('focus_a')]);
  assert.equal(result.incomplete,false);assert.equal(result.variables.focus_a_accepted,true);assert.equal(result.variables.focus_a_immediate,false);
  assert.equal(result.focusedComponentId,'focus_a_input');assert.equal(result.variables.focus_a_after,false);
  const after=sample(f,[click('focus_a'),advance()]);assert.equal(after.variables.focus_a_after,true);assert.equal(after.focusedComponentId,'focus_a_input');
  assert.equal(after.variables.changed_count,0);assert.equal(after.variables.committed_count,0);
});

test('program focus movement and release do not synthesize user changes or text submissions',()=>{
  const f=createUiControlInteractionFixture(),result=sample(f,[click('chain'),advance()]);
  assert.equal(result.incomplete,false);assert.equal(result.variables.chain_done,true);
  assert.equal(result.variables.chain_a_immediate,false);assert.equal(result.variables.chain_a_after,true);assert.equal(result.variables.chain_a_before_move,true);
  assert.equal(result.variables.chain_b_immediate,false);assert.equal(result.variables.chain_a_moved,false);assert.equal(result.variables.chain_b_after,true);assert.equal(result.variables.chain_b_released,false);
  assert.equal(result.focusedComponentId,undefined);assert.equal(result.variables.changed_count,0);assert.equal(result.variables.committed_count,0);
});

test('last accepted request wins; releasing a different input never steals the current focus',()=>{
  const f=createUiControlInteractionFixture(),result=sample(f,[click('coalesce'),advance()]);
  assert.equal(result.incomplete,false);assert.equal(result.variables.coalesce_done,true);assert.equal(result.variables.coalesce_a,false);assert.equal(result.variables.coalesce_b,true);assert.equal(result.variables.coalesce_b_after_release_a,true);
  assert.equal(result.focusedComponentId,'focus_b_input');assert.equal(result.variables.committed_count,0);
  const user=sample(f,[click('coalesce'),advance(),{kind:'focus',componentId:'focus_a_input',focused:true},advance()]);assert.equal(user.focusedComponentId,'focus_a_input');
});

test('hidden ancestors, disable, read-only and modal coverage invalidate requests instead of restoring them later',()=>{
  for(const action of ['hide','disable','readonly','modal']){
    const f=createUiControlInteractionFixture(),result=sample(f,[click(action),advance()]);
    assert.equal(result.incomplete,false);assert.equal(result.variables[action+'_after'],false);assert.equal(result.focusedComponentId,undefined);
    assert.equal(result.variables[action+'_accepted'],action!=='readonly');assert.equal(result.variables.committed_count,0);
  }
});

test('closing/reopening a page rejects its old queued request and stale DOM focus observations',()=>{
  const f=createUiControlInteractionFixture(),events=[click('reopen'),advance()],result=sample(f,events);
  assert.equal(result.incomplete,false);assert.equal(result.variables.child_accepted,true);assert.equal(result.variables.child_reopened_focus,false);
  const old=result.pageResults.find(page=>page.pageId===f.child.id)!.instance,newInstance=result.layers.find(page=>page.pageId===f.child.id)!.instance;
  assert.notEqual(old,newInstance);assert.equal(result.focusedComponentId,undefined);
  const stale=sample(f,[...events,{kind:'focus',componentId:'child_input',pageInstance:old,focused:true}]);assert.equal(stale.focusedComponentId,undefined);
});

test('new pages queue focus before rendering, and templates use the same operation',()=>{
  const f=createUiControlInteractionFixture();
  const fresh=sample(f,[click('fresh'),advance()]);assert.equal(fresh.incomplete,false);assert.equal(fresh.variables.fresh_accepted,true);assert.equal(fresh.variables.fresh_immediate,false);assert.equal(fresh.variables.fresh_after,true);assert.equal(fresh.focusedComponentId,'child_input');
  const native=sample(f,[click('native'),advance()]);assert.equal(native.incomplete,false);assert.equal(native.variables.native_accepted,true);assert.equal(native.variables.native_immediate,false);assert.equal(native.variables.native_after,true);assert.equal(native.focusedComponentId,'native_focus_input');
});

test('background execution uses the same range and focus operations',()=>{
  const f=createUiControlInteractionFixture();assert.deepEqual(blueprintTaskProblems(f.project,f.background.id),[]);
  const result=sample(f,[click('background'),advance()]);assert.equal(result.incomplete,false);assert.equal(result.variables.job_done,true);
  assert.deepEqual(renderedRange(result),{min:25,max:45,step:5});assert.equal(result.focusedComponentId,'focus_a_input');assert.equal(result.variables.committed_count,0);
});

test('range/focus nodes compile in front and background, and accepted has an invocation-local default',()=>{
  const f=createUiControlInteractionFixture(),original=structuredClone(f.project),compiled=compileProject(f.project);
  assert.deepEqual(compiled.diagnostics.filter(issue=>issue.severity==='error'),[]);assert.deepEqual(f.project,original);
  const source=Object.values(compiled.files).join('\n');
  assert.ok(source.includes('vn_ui_control_set_range("range_slider", 100, 200, 25)'));
  assert.ok(source.includes('vn_input_request_focus("focus_a_input", True)'));
  assert.match(source,/layers = vn_ui_visible_page_order\(\)\n        if page in vn_ui_open_pages and \(page not in layers or vn_ui_page_sessions.get\(page, \{\}\).get\("opening", \{\}\).get\("input"\) == "none"\):\n            return False/);
  assert.match(source,/vn_bp_focus_accepted_/);assert.match(source,/class VnInputFocusRequests/);assert.match(source,/config.start_callbacks.append\(vn_input_after_load\)/);
  assert.equal(f.editorFocus.pins.find(pin=>pin.id==='accepted')!.dataType,'boolean');
  const invalid=blueprintNodeDefaults('focusUiComponent');invalid.id='invalid_focus';invalid.properties.componentId='range_slider';f.editGraph.nodes.push(invalid);synchronizeBlueprintSignatures(f.project);
  assert.ok(validateBlueprints(f.project).some(issue=>issue.nodeId===invalid.id));
});

test('snapped slider values keep the step precision instead of floating point remainders',()=>{
  const f=createUiControlInteractionFixture(),base=uiControlDefinition(f.project,f.page.components[0])!;
  const info={...base,instantAtEnd:false,range:{min:0,max:1,step:.01}};
  for(const value of [.07,.29,.35,.57,.7])assert.equal(uiControlUserValue(info,value),value);
  assert.equal(uiControlUserValue({...info,range:{min:.1,max:.9,step:.05}},.5),.5);
});
