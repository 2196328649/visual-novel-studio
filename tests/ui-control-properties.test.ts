import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiControlPropertyFixture } from '../scripts/lib/ui-control-property-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { uiPropertyApplies, uiPropertyDefaults, uiPropertyDefault } from '../src/core/ui-properties';
import { uiControlDefinition, uiControlRatio, uiControlFromRatio } from '../src/core/ui-control-properties';
import { projectSchema, type UiComponent } from '../src/core/model';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { projectForExport } from '../src/core/export-assets';
import { compileProject } from '../src/runtime/compiler';

const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
function sample(f: ReturnType<typeof createUiControlPropertyFixture>, events: UiPreviewEvent[]) {
  return previewUiLogic(f.project, f.page.components, f.page.id, {}, events, { trace: true });
}

test('typed control capabilities follow the binding rather than the visual control kind', () => {
  const f = createUiControlPropertyFixture(), [slider, , input, toggle, choices] = f.page.components;
  assert.equal(uiPropertyApplies(slider, 'numberValue', f.project), true);
  assert.equal(uiPropertyApplies(input, 'numberValue', f.project), false);
  assert.equal(uiPropertyApplies(input, 'stringValue', f.project), true);
  assert.equal(uiPropertyApplies(input, 'focused', f.project), true);
  assert.equal(uiPropertyApplies(choices, 'focused', f.project), false);
  assert.equal(uiPropertyApplies(choices, 'optionIndex', f.project), true);
  assert.equal(uiPropertyApplies(toggle, 'booleanValue', f.project), true);
  assert.equal(uiPropertyApplies(toggle, 'sliderThumbColor', f.project), false);
  const defaults = uiPropertyDefaults(f.project, f.page.components);
  assert.equal(defaults.slider.numberValue, 30); assert.equal(defaults.slider.minimum, -20); assert.equal(defaults.slider.maximum, 80); assert.equal(defaults.slider.step, 5);
  assert.equal(defaults.input.maxLength, 6); assert.equal(defaults.input.placeholder, '请输入名字');
  assert.equal(defaults.choices.optionCount, 3); assert.equal(defaults.choices.optionIndex, 0);
  assert.equal(defaults.input.optionIndex, undefined);
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(f.project))).ui.customPages[0].components[2].input, input.input);
});

test('temporary control values preserve sources, mirror controls and author data', () => {
  const f = createUiControlPropertyFixture(), before = structuredClone(f.project), result = sample(f, [click('temporary')]);
  assert.equal(result.incomplete, false);
  assert.equal(result.controlValues.slider, 0); assert.equal(result.controlValues.mirror, 30); assert.equal(result.variables.shared_number, 30);
  assert.equal(result.controlValues.input, ''); assert.equal(result.variables.input_name, '原值');
  assert.equal(result.controlValues.toggle, false); assert.equal(result.variables.control_flag, true);
  assert.equal(result.controlValues.choices, '困难'); assert.equal(result.variables.control_mode, '简单');
  assert.equal(result.variables.changed_count, 0); assert.equal(result.variables.committed_count, 0);
  const slider = result.components.find(row=>row.component.id==='slider')!.component;
  assert.equal(slider.slider?.trackId, 'control_track'); assert.equal(slider.slider?.fillColor, '#dd7722'); assert.equal(slider.slider?.thumbWidth, 40); assert.equal(slider.slider?.reverse, true);
  const input = result.components.find(row=>row.component.id==='input')!.component;
  assert.equal(input.input?.placeholder, '蓝图占位 🦊'); assert.equal(input.input?.maxLength, 4);
  assert.deepEqual(f.project, before);
});

test('source assignments and value-alias resets stay coherent without user events', () => {
  const f = createUiControlPropertyFixture();
  const reset = sample(f, [click('temporary'), click('reset')]);
  assert.equal(reset.controlValues.slider, 30); assert.equal(reset.controlValues.input, '原值'); assert.equal(reset.controlValues.toggle, true); assert.equal(reset.controlValues.choices, '简单');
  assert.equal(reset.components.find(row=>row.component.id==='slider')!.component.slider?.trackId, 'control_track');
  const result = sample(f, [click('temporary'), click('source'), click('reset')]);
  assert.equal(result.incomplete, false);
  assert.equal(result.variables.shared_number, 60); assert.equal(result.controlValues.slider, 60); assert.equal(result.controlValues.mirror, 60);
  assert.equal(result.controlValues.input, '源🦊'); assert.equal(result.controlValues.toggle, false); assert.equal(result.controlValues.choices, '旁观');
  assert.equal(result.variables.read_ratio, .8); assert.equal(result.variables.read_min, -20); assert.equal(result.variables.read_max, 80); assert.equal(result.variables.read_step, 5);
  assert.equal(result.variables.read_index, 2); assert.equal(result.variables.read_count, 3); assert.equal(result.variables.read_label, '旁观'); assert.equal(result.variables.read_default, '原值');
  assert.equal(result.variables.changed_count, 0); assert.equal(result.variables.committed_count, 0);
});

test('only user input releases its own value override and emits change or commit events', () => {
  const f = createUiControlPropertyFixture();
  const result = sample(f, [click('temporary'), { kind: 'control', componentId: 'mirror', value: 10 }, { kind: 'control', componentId: 'slider', value: 5 }, { kind: 'control', componentId: 'slider', value: 5 }, { kind: 'focus', componentId: 'input', focused: true }, { kind: 'control', componentId: 'input', value: '🦊🦊🦊🦊' }, { kind: 'textCommit', componentId: 'input', method: 'enter' }]);
  assert.equal(result.incomplete, false); assert.equal(result.controlValues.slider, 5); assert.equal(result.controlValues.mirror, 5);
  assert.equal(result.variables.input_name, '🦊🦊🦊🦊'); assert.equal(result.variables.changed_count, 3); assert.equal(result.variables.committed_count, 1);
  assert.equal(result.focusedComponentId, undefined);
  const focused = sample(f, [{kind:'focus', componentId:'input', focused:true}]); assert.equal(focused.focusedComponentId, 'input');
  const closed = sample(f, [{kind:'focus', componentId:'input', focused:true}, click('close')]); assert.equal(closed.focusedComponentId, undefined);
});

test('read-only controls block user input but still accept explicit program assignment', () => {
  const f = createUiControlPropertyFixture();
  const result = sample(f, [click('lock'), {kind:'control',componentId:'slider',value:80}, {kind:'control',componentId:'input',value:'拒绝'}, {kind:'focus',componentId:'input',focused:true}, {kind:'textCommit',componentId:'input',method:'enter'}, click('source')]);
  assert.equal(result.incomplete, false); assert.equal(result.controlValues.slider, 60); assert.equal(result.variables.input_name, '源🦊');
  assert.equal(result.focusedComponentId, undefined); assert.equal(result.variables.changed_count, 0); assert.equal(result.variables.committed_count, 0);
  assert.equal(result.components.find(row=>row.component.id==='input')!.state, 'disabled');
  const unlocked = sample(f, [click('lock'), click('lock'), {kind:'control',componentId:'slider',value:80}]);
  assert.equal(unlocked.controlValues.slider, 80); assert.equal(unlocked.variables.changed_count, 1);
});

test('invalid options, ranges, read-only observations and write modes are diagnosed without mutating sources', () => {
  for (const properties of [
    {componentId:'slider',property:'sourceMinimum',value:0}, {componentId:'choices',property:'optionIndex',value:-1},
    {componentId:'slider',property:'step',value:0},
    {componentId:'input',property:'visible',value:true,writeMode:'source'},
  ]) {
    const f = createUiControlPropertyFixture(); Object.assign(f.temporaryNode.properties, properties); synchronizeBlueprintSignatures(f.project);
    assert.ok(validateBlueprints(f.project).some(issue=>issue.nodeId===f.temporaryNode.id));
    const result = sample(f,[click('temporary')]); assert.equal(result.incomplete,true); assert.equal(result.variables.shared_number,30);
  }
  const dynamic = createUiControlPropertyFixture(); Object.assign(dynamic.temporaryNode.properties,{componentId:'choices',property:'stringValue',value:'不存在'}); synchronizeBlueprintSignatures(dynamic.project);
  assert.equal(validateBlueprints(dynamic.project).some(issue=>issue.nodeId===dynamic.temporaryNode.id),false); // Runtime lists may be edited earlier in the graph.
  assert.equal(sample(dynamic,[click('temporary')]).incomplete,true);
  const outside = createUiControlPropertyFixture(); Object.assign(outside.temporaryNode.properties,{componentId:'slider',property:'numberValue',value:81}); synchronizeBlueprintSignatures(outside.project);
  assert.equal(validateBlueprints(outside.project).some(issue=>issue.nodeId===outside.temporaryNode.id),false); // A prior range operation can legitimately allow 81.
  assert.equal(sample(outside,[click('temporary')]).incomplete,true);
  const f = createUiControlPropertyFixture(); Object.assign(f.temporaryNode.properties,{componentId:'input',property:'stringValue',value:'1234567'}); synchronizeBlueprintSignatures(f.project);
  assert.equal(sample(f,[click('temporary')]).incomplete,true);
  assert.equal(sample(createUiControlPropertyFixture(),[click('temporary'),{kind:'control',componentId:'input',value:'🦊🦊🦊🦊🦊'}]).incomplete,true);
});

test('text-speed normalization retains the native instant-at-right convention', () => {
  const f = createUiControlPropertyFixture(), control: UiComponent = {id:'speed',kind:'preference',page:'preferences',text:'速度',preference:'textSpeed',x:0,y:0,width:1,height:.1};
  const info = uiControlDefinition(f.project, control)!;
  assert.equal(uiControlRatio(info, 0), 1); assert.equal(uiControlFromRatio(info, 1), 0);
  assert.equal(uiControlRatio(info, 1), 0); assert.equal(uiControlFromRatio(info, 0), 1);
  assert.equal(uiPropertyDefault(f.project, control, 'minimum'), 0);
  assert.equal(uiPropertyDefault(f.project, { ...control, preference: 'autoForwardTime' }, 'step'), .3);
});

test('new control properties are exported, typed and generated through the real runtime', () => {
  const f = createUiControlPropertyFixture(), compiled = compileProject(f.project);
  assert.deepEqual(compiled.diagnostics.filter(issue=>issue.severity==='error'), []);
  assert.ok(projectForExport(f.project).assets.some(asset=>asset.id==='control_track'));
  assert.equal(f.editorSet.pins.find(pin=>pin.id==='value')?.dataType,'number'); assert.equal(f.editorGet.pins.find(pin=>pin.id==='value')?.dataType,'boolean');
  const source = Object.values(compiled.files).join('\n');
  assert.match(source,/vn_ui_control_assign/); assert.match(source,/vn_ui_slider_options/); assert.match(source,/vn_ui_set\("slider", "normalizedValue", 0.8, "source"\)/);
  assert.match(source,/text\[:int\(vn_ui_get\(self.component_id, "maxLength"\)\)\]/);
});
