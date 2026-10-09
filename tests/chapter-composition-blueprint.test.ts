import { parseProject } from '../src/desktop/project-store';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, uiComponentSchema, type VisualObject } from '../src/core/model';
import { chapterCompositionBlueprint } from '../src/core/chapter-composition-blueprint';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { compileProject } from '../src/runtime/compiler';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { chapterComposition } from '../src/core/chapter-composition';

test('generated performance names are reusable and unique across chapters', () => {
  const project = createProject();
  const first = chapterCompositionBlueprint(project, { title: '某个特定章节', subtitle: '', duration: 7 }).graph;
  project.blueprints.push(first);
  const second = chapterCompositionBlueprint(project, { title: '另一个章节', subtitle: '', duration: 7 }).graph;
  assert.equal(first.name, '标题演出');
  assert.equal(second.name, '标题演出 2');
  assert.equal(JSON.stringify(first.nodes).includes('某个特定章节 ·'), false);
});

test('generated chapter image parameter drives title and glyph without changing unrelated images', () => {
  const project = createProject();
  project.assets = ['old', 'new'].map(id => ({ id, name: id, kind: 'image', path: id + '.png' }));
  const chapter = { title: '第一章', subtitle: '', duration: 7, effect: 'ink' as const, titleImageId: 'old', backgroundId: 'old' };
  const original = structuredClone(project), { graph } = chapterCompositionBlueprint(project, chapter);
  assert.deepEqual(project, original);
  const pin = graph.exposedInputs.find(pin => pin.name === '章节题图')!;
  assert.ok(pin); assert.equal(pin.defaultValue, 'old');
  const reader = graph.nodes.find(node => node.type === 'getInput' && node.properties.inputId === pin.id)!;
  assert.equal(graph.links.filter(link => link.fromNodeId === reader.id).length, 2);
  project.blueprints.push(graph);
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: graph.id, inputs: { [pin.id]: 'new' } }];
  const restored = applyTextScript(projectSchema.parse(project), projectToText(project)).project;
  const actions = expandPreviewActions(restored, passage.lines[0].actions, previewActionContext(restored));
  const root = actions.find(action => action.kind === 'visual') as VisualObject;
  const children = root.children![1].children!;
  assert.equal(children.find(child => child.name === '章节标题')!.assetId, 'new');
  assert.equal(children.find(child => child.glyphParticles)!.glyphParticles!.assetId, 'new');
  assert.equal(children.find(child => child.name === '章节背景')!.assetId, 'old');
  assert.equal(graph.exposedInputs.filter(pin => pin.dataType === 'asset').length, 2);
  const compiled = compileProject(restored);
  assert.equal(compiled.diagnostics.filter(issue => issue.severity === 'error').length, 0);
});

test('custom chapter title components share content while retaining separate style pairs', () => {
  const project = createProject();
  project.ui.pages = { chapterTitle: { layout: 'custom' } };
  project.ui.components = [32, 64].map((fontSize, index) => uiComponentSchema.parse({ id: 'title_' + index, kind: 'chapterTitle', page: 'chapterTitle', x: .1, y: .1 + index * .3, width: .8, height: .2, style: { fontSize } }));
  const { graph } = chapterCompositionBlueprint(project, { title: '共享文字', subtitle: '', duration: 7, effect: 'ink' });
  project.blueprints.push(graph);
  const title = graph.exposedInputs.find(pin => pin.name === '章节标题')!, size = graph.exposedInputs.find(pin => pin.name === '章节标题字号')!;
  assert.equal(graph.exposedInputs.find(pin => pin.name === '章节标题 2字号')!.defaultValue, 64);
  const result = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id, inputs: { [title.id]: '新的文字', [size.id]: 48 } }], previewActionContext(project)).find(action => action.kind === 'visual') as VisualObject;
  const children = result.children![1].children!.filter(child => child.content === 'text' || child.glyphParticles);
  assert.equal(children.length, 4); assert.ok(children.every(child => child.text === '新的文字'));
  assert.equal(children.filter(child => child.fontSize === 48).length, 2); assert.equal(children.filter(child => child.fontSize === 64).length, 2);
});

test('text chapter generates matching title and subtitle emitters with independent shared inputs', () => {
  const project = createProject();
  project.assets.push({ id: 'new_font', kind: 'font', name: '新字体', path: 'new.ttf' });
  const original = structuredClone(project);
  const chapter = { title: '同名文字', subtitle: '同名文字', duration: 10, effect: 'ink' as const };
  const generated = chapterComposition(project, chapter);
  assert.ok(!generated.warnings.some(warning => warning.includes('不支持自动字形')));
  const root = generated.actions.at(-1) as VisualObject, children = root.children![1].children!;
  for (const input of ['title', 'subtitle'] as const) {
    const ids = generated.titleTextBindings.filter(binding => binding.input === input).map(binding => binding.instanceId);
    assert.equal(ids.length, 2);
    const title = children.find(child => ids.includes(child.instanceId) && child.content === 'text')!;
    const glyph = children.find(child => ids.includes(child.instanceId) && child.glyphParticles)!;
    assert.equal(glyph.text, title.text); assert.equal(glyph.fontSize, title.fontSize); assert.equal(glyph.fontAssetId, title.fontAssetId);
    assert.equal(glyph.glyphParticles!.source, 'text');
    assert.deepEqual(glyph.glyphParticles!.rect, { x: title.keyframes[0].x - title.width / 2, y: title.keyframes[0].y - title.height / 2, width: title.width, height: title.height });
  }
  const { graph } = chapterCompositionBlueprint(project, chapter);
  assert.deepEqual(project, original);
  assert.equal(graph.exposedInputs.filter(pin => pin.dataType === 'string').length, 10);
  const title = graph.exposedInputs.find(pin => pin.name === '章节标题')!, subtitle = graph.exposedInputs.find(pin => pin.name === '章节副标题')!;
  const size = graph.exposedInputs.find(pin => pin.name === '章节标题字号')!, font = graph.exposedInputs.find(pin => pin.name === '章节标题字体')!;
  project.blueprints.push(graph);
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: graph.id, inputs: { [title.id]: '新标题', [subtitle.id]: '新副标题', [size.id]: 72, [font.id]: 'new_font', [graph.exposedInputs.find(pin => pin.name === '章节标题水平对齐')!.id]: 'right', [graph.exposedInputs.find(pin => pin.name === '章节标题垂直对齐')!.id]: 'bottom' } }];
  const restored = applyTextScript(projectSchema.parse(project), projectToText(project)).project;
  const expanded = expandPreviewActions(restored, passage.lines[0].actions, previewActionContext(restored)).find(action => action.kind === 'visual') as VisualObject;
  const output = expanded.children![1].children!;
  assert.equal(output.filter(child => child.text === '新标题').length, 2);
  assert.equal(output.filter(child => child.text === '新副标题').length, 2);
  assert.ok(output.filter(child => child.text === '新标题').every(child => child.fontSize === 72 && child.fontAssetId === 'new_font' && child.textAlign === 'right' && child.textVerticalAlign === 'bottom'));
  assert.ok(output.filter(child => child.text === '新副标题').every(child => child.fontSize === 24 && child.fontAssetId === undefined));
  assert.deepEqual(compileProject(restored).diagnostics.filter(item => item.severity === 'error'), []);
});


test('custom title copies outline and shadow to its text and glyph through save and script', () => {
  const project = createProject();
  project.ui.pages = { chapterTitle: { layout: 'custom' } };
  const effects = { outlineWidth: 3, outlineColor: '#ff0000', outlineOpacity: .8, shadowX: 12, shadowY: 6, shadowColor: '#0000ff', shadowOpacity: .5 };
  project.ui.components = [uiComponentSchema.parse({ id: 'styled', kind: 'chapterTitle', page: 'chapterTitle', x: .1, y: .1, width: .8, height: .3, style: { fontSize: 96, ...effects } })];
  const generated = chapterComposition(project, { title: '文字', subtitle: '', duration: 7, effect: 'ink' });
  assert.ok(!generated.warnings.some(w => w.includes('描边')));
  const passage = project.nodes.find(n => n.kind === 'passage')!; passage.lines[0].actions = generated.actions;
  const restored = applyTextScript(projectSchema.parse(project), projectToText(project)).project;
  const root = restored.nodes.filter(n => n.kind === 'passage').find(n => n.id === passage.id)!.lines[0].actions.at(-1) as VisualObject;
  const styled = root.children![1].children!.filter(c => c.content === 'text' || c.glyphParticles?.source === 'text');
  assert.equal(styled.length, 2); for (const item of styled) assert.deepEqual(item.textEffects, effects);
  assert.equal(compileProject(restored).diagnostics.filter(d => d.severity === 'error').length, 0);
});


test('custom subtitle uses measured multi-line title geometry and independent style bindings', () => {
  const project = createProject(); project.ui.pages = { chapterTitle: { layout: 'custom' } };
  project.ui.components = [uiComponentSchema.parse({ id: 'stack', kind: 'chapterTitle', page: 'chapterTitle', x: .1, y: .1, width: .3, height: .6, style: { fontSize: 96, align: 'right' } })];
  const layout = { stack: { title: { x: .1, y: .1, width: .3, height: .25 }, subtitle: { x: .1, y: .37, width: .3, height: .05 } } };
  const { graph, warnings } = chapterCompositionBlueprint(project, { title: '长标题换行', subtitle: '副标题', duration: 7, effect: 'ink' }, layout);
  assert.ok(!warnings.some(w => w.includes('尚未按字体测量'))); project.blueprints.push(graph);
  const pin = graph.exposedInputs.find(pin => pin.name === '章节副标题')!;
  const root = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id, inputs: { [pin.id]: '新副标题' } }], previewActionContext(project)).find(a => a.kind === 'visual') as VisualObject;
  const children = root.children![1].children!, subtitle = children.find(c => c.content === 'text' && c.text === '新副标题')!;
  assert.equal(subtitle.fontSize, 32); assert.equal(subtitle.textAlign, 'right'); assert.equal(subtitle.color, project.ui.textColor);
  assert.ok(Math.abs(subtitle.keyframes[0].y - subtitle.height / 2 - .37) <= 1 / project.height);
  const glyph = children.find(c => c.glyphParticles && c.text === '新副标题')!;
  assert.deepEqual(glyph.glyphParticles!.rect, { x: subtitle.keyframes[0].x - subtitle.width / 2, y: subtitle.keyframes[0].y - subtitle.height / 2, width: subtitle.width, height: subtitle.height });
});


test('generated custom text and glyph retain their original UI clipping area', () => {
  const project = createProject(); project.ui.pages = { chapterTitle: { layout: 'custom' } };
  project.ui.components = [uiComponentSchema.parse({ id: 'clipped', page: 'chapterTitle', kind: 'chapterTitle', x: .1, y: .1, width: .2, height: .1, style: { fontSize: 48 } })];
  const result = chapterComposition(project, { title: '多行标题', subtitle: '隐藏副标题', duration: 7, effect: 'ink' }, { clipped: { title: { x: .1, y: .1, width: .2, height: .2 }, subtitle: { x: .1, y: .32, width: .2, height: .05 } } });
  const root = result.actions.at(-1) as VisualObject, children = root.children![1].children!;
  const title = children.find(c => c.content === 'text' && c.text === '多行标题')!, subtitle = children.find(c => c.content === 'text' && c.text === '隐藏副标题')!;
  assert.ok(Math.abs(title.textClip!.height - .5) < .01); assert.ok(subtitle.textClip!.y + subtitle.textClip!.height < 0);
  for (const text of [title, subtitle]) assert.deepEqual(children.find(c => c.glyphParticles && c.text === text.text)!.textClip, text.textClip);
});


test('zero and oversized measured text generate valid editable objects without moving visible text', () => {
  for (const height of [0, .00001, 8]) {
    const project = createProject(); project.ui.pages = { chapterTitle: { layout: 'custom' } };
    project.ui.components = [uiComponentSchema.parse({ id: 'bounds', page: 'chapterTitle', kind: 'chapterTitle', x: .1, y: .1, width: .2, height: .5 })];
    const title = height > 4 ? '多行标题\n'.repeat(80) : '';
    const layout = { bounds: { title: { x: .1, y: .1, width: .2, height }, subtitle: { x: .1, y: .1 + height + 12 / project.height, width: .2, height: .05 } } };
    const { graph } = chapterCompositionBlueprint(project, { title, subtitle: '副标题', duration: 7, effect: 'ink' }, layout);
    project.blueprints.push(graph);
    const saved = projectSchema.parse(JSON.parse(JSON.stringify(project)));
    const root = expandPreviewActions(saved, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(saved)).find(a => a.kind === 'visual') as VisualObject;
    const children = root.children![1].children!, text = children.find(c => c.content === 'text' && c.text === title)!;
    assert.ok(text.height > 0 && text.height <= 4);
    assert.equal(text.text, title);
    assert.ok(Math.abs(text.keyframes[0].y - text.height / 2 - .1) < 1 / project.height);
    if (height > 4) assert.equal(text.textVerticalAlign, 'top');
    const glyph = children.find(c => c.glyphParticles && c.text === title)!;
    assert.equal(glyph.textVerticalAlign, text.textVerticalAlign);
    assert.equal(glyph.glyphParticles!.rect.height, text.height);
    const subtitle = children.find(c => c.content === 'text' && c.text === '副标题')!;
    assert.ok(Math.abs(subtitle.keyframes[0].y - subtitle.height / 2 - layout.bounds.subtitle.y) < 1 / project.height);
  }
});


test('empty and multiline standalone chapter titles round trip without breaking following commands', () => {
  for (const title of ['', '第一行\n第二行', ' A｜B|C=值 "引号" ']) {
    const project = createProject();
    const passage = project.nodes.find(node => node.kind === 'passage')!;
    passage.lines = [{ id: 'chapter_line', text: '', silent: true, actions: [{ kind: 'chapter', title, subtitle: '副标题\n第二行｜内容', duration: 7, effect: 'none' }] }];
    const migrated = parseProject(project).project;
    const parsed = applyTextScript(migrated, projectToText(migrated));
    assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
    const parsedAgain = applyTextScript(parsed.project, projectToText(parsed.project));
    assert.deepEqual(parsedAgain.issues.filter(issue => issue.severity === 'error'), []);
    const graph = parsedAgain.project.blueprints.find(graph => graph.chapterVariant === 'text')!;
    assert.equal(graph.exposedInputs.find(pin => pin.id === 'title')?.defaultValue, title);
    assert.equal(graph.exposedInputs.find(pin => pin.id === 'right_text')?.defaultValue, '副标题\n第二行｜内容');
  }
});


test('title effects share blueprint inputs with glyphs while subtitle effects stay independent', () => {
  const project = createProject();
  const { graph } = chapterCompositionBlueprint(project, { title: '标题', subtitle: '副标题', duration: 7, effect: 'ink' });
  project.blueprints.push(graph);
  const supplied: Record<string, string | number> = { '章节标题描边宽度': 5, '章节标题描边颜色': '#ff0000', '章节标题描边透明度': .4, '章节标题阴影横向偏移': -8, '章节标题阴影纵向偏移': 6, '章节标题阴影柔化': 9, '章节标题阴影颜色': '#0000ff', '章节标题阴影透明度': .8 };
  const inputs = Object.fromEntries(Object.entries(supplied).map(([name,value]) => { const pin = graph.exposedInputs.find(pin => pin.name === name); assert.ok(pin,name); return [pin.id,value]; }));
  const saved = applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(project))),projectToText(project)).project;
  const root = expandPreviewActions(saved,[{kind:'blueprint',blueprintId:graph.id,inputs}],previewActionContext(saved)).find(a=>a.kind==='visual') as VisualObject;
  const children = root.children![1].children!, pair = children.filter(c=>c.text==='标题');
  assert.equal(pair.length,2);
  for(const object of pair) assert.deepEqual(object.textEffects,{outlineWidth:5,outlineColor:'#ff0000',outlineOpacity:.4,shadowX:-8,shadowY:6,shadowBlur:9,shadowColor:'#0000ff',shadowOpacity:.8});
  for(const object of children.filter(c=>c.text==='副标题')) {assert.equal(object.textEffects!.outlineWidth,0);assert.equal(object.textEffects!.shadowX,0);assert.equal(object.textEffects!.shadowBlur,0);}
  assert.equal(compileProject(saved).diagnostics.filter(d=>d.severity==='error').length,0);
});


test('multiple custom title components retain their full style interfaces beyond 32 inputs and 66 node pins', () => {
  const project=createProject();project.ui.pages={chapterTitle:{layout:'custom'}};
  project.ui.components=Array.from({length:5},(_,i)=>uiComponentSchema.parse({id:'title_'+i,kind:'chapterTitle',page:'chapterTitle',x:.1,y:.05+i*.18,width:.8,height:.15,style:{fontSize:32,outlineWidth:i+1}}));
  const {graph}=chapterCompositionBlueprint(project,{title:'标题',subtitle:'副标题',duration:7,effect:'ink'});project.blueprints.push(graph);
  assert.ok(graph.exposedInputs.length>32);assert.ok(graph.nodes.some(n=>n.pins.length>66));
  const input=graph.exposedInputs.find(p=>p.name==='章节标题 5描边宽度')!;assert.ok(input);
  const saved=projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const root=expandPreviewActions(saved,[{kind:'blueprint',blueprintId:graph.id,inputs:{[input.id]:9}}],previewActionContext(saved)).find(a=>a.kind==='visual') as VisualObject;
  const children=root.children![1].children!,texts=children.filter(c=>c.content==='text'&&c.text==='标题');
  assert.deepEqual(texts.map(t=>t.textEffects!.outlineWidth),[1,2,3,4,9]);
  assert.deepEqual(children.filter(c=>c.glyphParticles&&c.text==='标题').map(t=>t.textEffects!.outlineWidth),[1,2,3,4,9]);
  assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);
});
