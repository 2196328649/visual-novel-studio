import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { blueprintNodeDefaults, blueprintPin, createBlueprintGraph } from '../src/core/blueprint';
import { createProject, type BlueprintPin, type VariableValue } from '../src/core/model';
import { createFloatingText } from '../src/core/media-command';

type Renderer = typeof import('../src/renderer/BlueprintCallFields');
type Element = ReactElement<Record<string, any>>;
let rendererPromise: Promise<Renderer> | undefined;

/** Exercise the actual JSX and shared fields in Node. CSS is ignored only in
 * this in-memory bundle; no test dependency, fixture file or browser is needed. */
function renderer() {
  return rendererPromise ??= build({
    entryPoints: [fileURLToPath(new URL('../src/renderer/BlueprintCallFields.tsx', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    loader: { '.css': 'empty' }, logLevel: 'silent',
  }).then(result => {
    const module = { exports: {} as Renderer };
    new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
    return module.exports;
  });
}

function fixture(type: BlueprintPin['dataType'], value: VariableValue) {
  const project = createProject('蓝图参数引用');
  project.scenes[0].name = '校园场景';
  project.characters = [{ id: 'actor', name: '小鸢', color: '#ffffff', expressions: [{ id: 'normal', name: '微笑', assetId: 'portrait' }] }];
  project.assets = [{ id: 'portrait', name: '立绘素材', kind: 'image', path: 'portrait.png' }];
  project.ui.components = [{ id: 'start_button', name: '开始游戏按钮', page: 'main', kind: 'button', text: '开始游戏', x: .1, y: .1, width: .2, height: .1 }];
  project.ui.customPages = [{ id: 'help_page', name: '帮助页面', modal: true, components: [{ id: 'help_text', name: '帮助说明', page: 'custom', kind: 'text', text: '玩法', x: 0, y: 0, width: .5, height: .2 }] }];
  const graph = createBlueprintGraph('function', '引用测试');
  const pin = blueprintPin('target', '目标参数', 'input', type, value); graph.exposedInputs = [pin];
  project.blueprints.push(graph);
  return { project, graph, pin };
}

/** These two functions have no hooks. Expanding just them exposes their real
 * event adapters while leaving hooked NumberInput/asset controls to React. */
function elements(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate));
  if (!isValidElement<Record<string, any>>(node)) return [];
  if (typeof node.type === 'function' && ['BlueprintParameterValue', 'BlueprintValueInput'].includes(node.type.name)) {
    return elements((node.type as (props: Record<string, any>) => ReactNode)(node.props), predicate);
  }
  return [...(predicate(node) ? [node] : []), ...elements(node.props.children as ReactNode, predicate)];
}

function one(node: ReactNode, predicate: (element: Element) => boolean): Element {
  const found = elements(node, predicate); assert.equal(found.length, 1); return found[0];
}

function consumer(f: ReturnType<typeof fixture>, type: Parameters<typeof blueprintNodeDefaults>[0], pinId: string) {
  const reader = blueprintNodeDefaults('getInput'); reader.properties.inputId = f.pin.id; reader.pins[0].dataType = f.pin.dataType;
  const target = blueprintNodeDefaults(type); f.graph.nodes.push(reader, target);
  f.graph.links.push({ id: 'target_link', fromNodeId: reader.id, fromPinId: 'value', toNodeId: target.id, toPinId: pinId });
  return target;
}

const isNumeric = (element: Element) => typeof element.type === 'function' && element.type.name === 'NumberInput';
const assetUrl = (id?: string) => id ? `preview/${id}.png` : undefined;

test('parameter defaults and call overrides show named page/component choices rather than ID text boxes', async () => {
  const api = await renderer();
  for (const [type, value, names] of [
    ['ui', 'help_page', ['帮助页面', '请选择界面']],
    ['component', 'help_text', ['帮助页面 / 帮助说明', '开始游戏按钮', '请选择组件']],
    ['character', 'actor', ['小鸢', '请选择角色']],
  ] as const) {
    const f = fixture(type, value), before = structuredClone(f.project);
    const detail = renderToStaticMarkup(createElement(api.BlueprintParameterValue, { ...f, value, onChange: () => assert.fail('render must not write'), assetUrl }));
    const call = renderToStaticMarkup(createElement(api.BlueprintCallFields, { project: f.project, graph: f.graph, inputs: { target: value }, onChange: () => assert.fail('render must not write'), assetUrl }));
    for (const markup of [detail, call]) {
      assert.match(markup, /<select[^>]*aria-label="目标参数"/);
      assert.match(markup, new RegExp(`<option value="${value}" selected="">`));
      for (const name of names) assert.ok(markup.includes(name));
      assert.doesNotMatch(markup, /<input[^>]*aria-label="目标参数"/);
    }
    assert.deepEqual(f.project, before);
  }
  const f = fixture('scene', ''), sceneId = f.project.scenes[0].id;
  const markup = renderToStaticMarkup(createElement(api.BlueprintParameterValue, { ...f, value: sceneId, onChange: () => assert.fail('render must not write'), assetUrl }));
  assert.ok(markup.includes('校园场景')); assert.ok(markup.includes(`value="${sceneId}" selected=""`));
});

test('missing old page/component/character/scene IDs remain explicit selected options in defaults and calls', async () => {
  const api = await renderer();
  for (const type of ['ui', 'component', 'character', 'scene'] as const) {
    const f = fixture(type, 'removed_reference'), updates: unknown[] = [];
    const props = { ...f, value: 'removed_reference', onChange: (value: VariableValue) => updates.push(value), assetUrl };
    const detail = renderToStaticMarkup(createElement(api.BlueprintParameterValue, props));
    const call = renderToStaticMarkup(createElement(api.BlueprintCallFields, { project: f.project, graph: f.graph, inputs: { target: 'removed_reference' }, onChange: value => updates.push(value), assetUrl }));
    for (const markup of [detail, call]) assert.match(markup, /<option value="removed_reference" selected="">原选择已不存在，请重新选择<\/option>/);
    assert.deepEqual(updates, []); assert.equal(f.pin.defaultValue, 'removed_reference');
  }
});

test('clearing a page/component selection preserves an explicit empty override; only unchecking restores default', async () => {
  const api = await renderer();
  for (const [type, value] of [['ui', 'help_page'], ['component', 'help_text']] as const) {
    const f = fixture(type, value), updates: (Record<string, VariableValue> | undefined)[] = [];
    const call = api.BlueprintCallFields({ project: f.project, graph: f.graph, inputs: { target: 'removed_reference' }, onChange: next => updates.push(next), assetUrl });
    const select = one(call, element => element.type === 'select' && element.props['aria-label'] === f.pin.name);
    select.props.onChange({ target: { value: '' } });
    assert.deepEqual(updates.slice(), [{ target: '' }]);
    const empty = renderToStaticMarkup(createElement(api.BlueprintCallFields, { project: f.project, graph: f.graph, inputs: { target: '' }, onChange: () => assert.fail('render must not write'), assetUrl }));
    assert.match(empty, /aria-label="单独设置目标参数" checked=""/);
    assert.match(empty, /<option value="" selected="">/); assert.doesNotMatch(empty, /<fieldset disabled=""/);
    one(call, element => element.type === 'input' && element.props.type === 'checkbox').props.onChange({ target: { checked: false } });
    assert.equal(updates.at(-1), undefined);
    const fallbackCall = api.BlueprintCallFields({ project: f.project, graph: f.graph, onChange: next => updates.push(next), assetUrl });
    one(fallbackCall, element => element.type === 'input' && element.props.type === 'checkbox').props.onChange({ target: { checked: true } });
    assert.deepEqual(updates.at(-1), { target: value });
  }
});

test('UI disabled pages and old screen aliases retain the shared reference compatibility choices', async () => {
  const api = await renderer(), f = fixture('ui', 'ui:save'); f.project.ui.disabledPages = ['save'];
  const render = (value: string) => renderToStaticMarkup(createElement(api.BlueprintParameterValue, { ...f, value, onChange: () => assert.fail('render must not write'), assetUrl }));
  assert.match(render('ui:save'), /value="ui:save" selected=""/);
  assert.match(render('save'), /value="save" selected="">[^<]*旧名称兼容/);
});

test('primitive fields preserve authored invalid values and zero without numeric or boolean coercion', async () => {
  const api = await renderer();
  for (const value of ['', 'oops', '24', false, 0, 60, 1000] as const) {
    const f = fixture('number', value), updates: VariableValue[] = [];
    const detail = api.BlueprintParameterValue({ ...f, value, onChange: next => updates.push(next), assetUrl });
    const number = one(detail, isNumeric);
    assert.equal(number.props.value, String(value)); assert.equal(number.props.type, 'number');
    assert.equal(number.props.min, undefined); assert.equal(number.props.max, undefined);
    const markup = renderToStaticMarkup(createElement(api.BlueprintParameterValue, { ...f, value, onChange: next => updates.push(next), assetUrl }));
    if (typeof value !== 'number') { assert.match(markup, /data-invalid="true"/); assert.match(markup, /原值类型不符/); }
    else assert.doesNotMatch(markup, /原值类型不符/);
    number.props.onChange({ target: { value: '', valueAsNumber: NaN } });
    number.props.onChange({ target: { value: 'oops', valueAsNumber: NaN } });
    assert.deepEqual(updates, [], 'unfinished numeric drafts cannot unset or coerce the input');
    number.props.onChange({ target: { value: '0', valueAsNumber: 0 } });
    number.props.onChange({ target: { value: '1000', valueAsNumber: 1000 } });
    assert.deepEqual(updates, [0, 1000]);
  }
  const f = fixture('boolean', 'false'), updates: VariableValue[] = [];
  const field = api.BlueprintParameterValue({ ...f, value: 'false', onChange: next => updates.push(next), assetUrl });
  const select = one(field, element => element.type === 'select');
  assert.equal(select.props.value, '__invalid__');
  assert.match(renderToStaticMarkup(createElement(api.BlueprintParameterValue, { ...f, value: 'false', onChange: () => assert.fail('render must not write'), assetUrl })), /无效开关值 · false/);
  select.props.onChange({ target: { value: '' } }); assert.deepEqual(updates, []);
  select.props.onChange({ target: { value: 'false' } }); assert.deepEqual(updates, [false]);
});

test('call numeric edits keep the override enabled after empty draft and accept explicit zero', async () => {
  const api = await renderer(), f = fixture('number', 2), updates: (Record<string, VariableValue> | undefined)[] = [];
  const call = api.BlueprintCallFields({ project: f.project, graph: f.graph, inputs: { target: 60 }, onChange: next => updates.push(next), assetUrl });
  const number = one(call, isNumeric);
  number.props.onChange({ target: { value: '', valueAsNumber: NaN } }); assert.deepEqual(updates, []);
  number.props.onChange({ target: { value: '0', valueAsNumber: 0 } }); assert.deepEqual(updates, [{ target: 0 }]);
});

test('scene/UI/component inputs never accidentally become actor-number/lifetime/preset/expression fields', async () => {
  const api = await renderer();
  for (const type of ['scene', 'ui', 'component'] as const) for (const targetPin of ['instanceId', 'lifetime', 'presetId', 'expressionId', 'characterId']) {
    const f = fixture(type, 'removed_reference'), show = consumer(f, 'showCharacter', targetPin); show.properties.characterId = 'actor';
    const markup = renderToStaticMarkup(createElement(api.BlueprintParameterValue, { ...f, value: 'removed_reference', onChange: () => assert.fail('render must not write'), assetUrl }));
    assert.match(markup, /原选择已不存在，请重新选择/);
    assert.doesNotMatch(markup, /actor-instance-field|角色默认表情|当前台词角色（自动）|场景内（原行为）|站位|表情预览/);
  }
});

test('special role fields preserve automatic target, expression preview, legacy expression and fixed instance behavior', async () => {
  const api = await renderer();
  const role = fixture('character', ''); consumer(role, 'showCharacter', 'characterId');
  let markup = renderToStaticMarkup(createElement(api.BlueprintParameterValue, { ...role, value: '', onChange: () => assert.fail('render must not write'), assetUrl }));
  assert.match(markup, /当前台词角色（自动）/);
  markup = renderToStaticMarkup(createElement(api.BlueprintParameterValue, { ...role, value: 'removed_actor', onChange: () => assert.fail('render must not write'), assetUrl }));
  assert.match(markup, /value="removed_actor" selected="">原角色已不存在：removed_actor/);
  const expression = fixture('string', 'normal'); consumer(expression, 'showCharacter', 'expressionId').properties.characterId = 'actor';
  markup = renderToStaticMarkup(createElement(api.BlueprintParameterValue, { ...expression, value: 'normal', onChange: () => assert.fail('render must not write'), assetUrl }));
  assert.match(markup, /表情预览：微笑/); assert.match(markup, /preview\/portrait\.png/);
  markup = renderToStaticMarkup(createElement(api.BlueprintParameterValue, { ...expression, value: 'removed_expression', onChange: () => assert.fail('render must not write'), assetUrl }));
  assert.match(markup, /value="removed_expression" selected="">原表情已不存在：removed_expression/);
  const instance = fixture('string', '1'); consumer(instance, 'showCharacter', 'instanceId').properties.characterId = 'actor';
  markup = renderToStaticMarkup(createElement(api.BlueprintParameterValue, { ...instance, value: '1', onChange: () => assert.fail('render must not write'), assetUrl }));
  assert.match(markup, /actor-instance-field/); assert.match(markup, /type="number"/);
  markup = renderToStaticMarkup(createElement(api.BlueprintParameterValue, { ...instance, value: false, onChange: () => assert.fail('render must not write'), assetUrl }));
  assert.match(markup, /data-invalid="true"/); assert.match(markup, /原值类型不符/); assert.doesNotMatch(markup, /actor-instance-field/);
  const lifetime = fixture('string', 'line'); consumer(lifetime, 'showCharacter', 'lifetime');
  markup = renderToStaticMarkup(createElement(api.BlueprintParameterValue, { ...lifetime, value: 'line', onChange: () => assert.fail('render must not write'), assetUrl }));
  assert.match(markup, /value="line" selected=""/);
});

test('asset filters/previews and visual color/numeric special limits keep their domain behavior', async () => {
  const api = await renderer(), asset = fixture('asset', 'portrait'); consumer(asset, 'showBackground', 'assetId');
  const field = api.BlueprintParameterValue({ ...asset, value: 'portrait', onChange: () => undefined, assetUrl });
  assert.ok(isValidElement<Record<string, any>>(field));
  assert.equal(field.props.kind, 'image'); assert.equal(field.props.category, 'scene'); assert.equal(field.props.assetUrl, assetUrl);
  const visual = createFloatingText('文字');
  const color = fixture('string', '#ffffff'); consumer(color, 'savedAction', 'object_textEffects_outlineColor').properties.action = JSON.stringify(visual);
  const selected = api.BlueprintParameterValue({ ...color, value: '#ffffff', onChange: () => undefined, assetUrl });
  assert.ok(isValidElement<Record<string, any>>(selected)); assert.equal(selected.type, 'input'); assert.equal(selected.props.type, 'color');
  const opacity = fixture('number', 0); consumer(opacity, 'savedAction', 'object_textEffects_outlineOpacity').properties.action = JSON.stringify(visual);
  const numeric = one(api.BlueprintParameterValue({ ...opacity, value: 0, onChange: () => undefined, assetUrl }), isNumeric);
  assert.equal(numeric.props.min, 0); assert.equal(numeric.props.max, 1); assert.equal(numeric.props.step, .05); assert.equal(numeric.props.value, '0');
});
