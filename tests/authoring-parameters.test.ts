import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type Project } from '../src/core/model';
import { actionText, applyTextScript, jumpCommandText, projectToText, replaceLegacyJumpCommands, textCommandAction } from '../src/core/text-script';
import { bindArguments } from '../src/core/text-arguments';
import { textAssistance } from '../src/core/text-completion';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';

function fixture(): Project {
  const project = createProject();
  project.assets = [{ id: 'courtyard', name: '庭院，夜色', kind: 'image', path: 'assets/bg.png', category: 'scene' }, { id: 'portrait', name: '立绘', kind: 'image', path: 'assets/portrait.png', category: 'portrait' }, { id: 'music', name: '夜宴', kind: 'audio', path: 'assets/music.ogg', category: 'bgm' }, { id: 'sound', name: '风，雨', kind: 'audio', path: 'assets/sound.ogg', category: 'sound' }];
  project.characters = [{ id: 'wang', name: '王生', color: '#ffffff', defaultExpressionId: 'sad', expressions: [{ id: 'normal', name: '通常', assetId: 'portrait' }, { id: 'sad', name: '担忧', assetId: 'portrait' }] }];
  return project;
}

test('serializing same-named media preserves the exact asset through text editing',()=>{
 const project=fixture();project.assets.push({id:'music_other',name:'夜宴',kind:'audio',path:'other.ogg'},{id:'courtyard_other',name:'庭院，夜色',kind:'image',path:'other.png'});
 const actions=[{kind:'music' as const,assetId:'music',loop:true,fade:.8},{kind:'sound' as const,assetId:'music_other'},{kind:'background' as const,assetId:'courtyard',transition:'none' as const}];
 for(const action of actions){const text=actionText(project,action);assert.ok(text.includes('【'+action.assetId+'】'));assert.deepEqual(textCommandAction(project,text,true),action);}
 const node=project.nodes.find(n=>n.kind==='passage')!;node.lines[0].actions=actions;
 const roundtrip=applyTextScript(project,projectToText(project));assert.deepEqual(roundtrip.issues.filter(i=>i.severity==='error'),[]);const restored=roundtrip.project.nodes.find(n=>n.id===node.id);assert.ok(restored?.kind==='passage');assert.deepEqual(restored.lines[0].actions,actions);
});
test('named parameters skip optional slots and keep the default expression and vertical position', () => {
  const project = fixture();
  assert.deepEqual(textCommandAction(project, '@显示角色：王生，缩放=1'), { kind: 'show', characterId: 'wang', expressionId: '', x: .5, y: 1, scale: 1, layer: 10, transition: 'dissolve' });
  const action = textCommandAction(project, '@显示角色：缩放=1.25，角色=王生，表情=通常，纵向位置=1.7，横向位置=-0.4，图层=-2，入场秒数=0，等待完成=否', true);
  assert.ok(action?.kind === 'show');
  assert.equal(action.y, 1.7); assert.equal(action.x, -.4); assert.equal(action.scale, 1.25); assert.deepEqual(action.actorTransitions?.enter, { mode: 'dissolve', duration: 0 }); assert.equal(action.wait, false);
  assert.deepEqual(textCommandAction(project, actionText(project, action), true), action);
});
test('mixed positional and named arguments fill unassigned fields and report invalid entries', () => {
  const specs = [{ name: '角色' }, { name: '表情' }, { name: '缩放' }];
  assert.deepEqual(bindArguments('缩放=1，王生，通常', specs).values, ['王生', '通常', '1']);
  for (const value of ['缩放=1，缩放=2', '错字=', '错字=1', '角色="未闭合', '角色=']) assert.throws(() => bindArguments(value, specs));
  assert.throws(() => textCommandAction(fixture(), '@显示角色：王生，缩方=1', true), /没有参数/);
});
test('invalid named durations and waits identify the parameter while positions remain unrestricted', () => {
  const project = fixture();
  assert.throws(() => textCommandAction(project, '@隐藏角色：王生，时长=稍后', true), /时长.*数值/);
  assert.throws(() => textCommandAction(project, '@显示角色：王生，等待完成=也许', true), /等待完成.*是或否/);
  assert.throws(() => textCommandAction(project, '@背景："庭院，夜色"，等待完成=也许', true), /等待完成.*是或否/);
  assert.throws(() => textCommandAction(project, '@等待：秒数=-1', true), /秒数.*非负/);
  assert.throws(() => textCommandAction(project, '@背景音乐：夜宴，淡入=-1', true), /淡入.*非负/);
  const parsed = applyTextScript(project, '#段落：检查\n@隐藏角色：王生，时长=稍后\n旁白：测试。');
  assert.ok(parsed.issues.some(issue => issue.message.includes('时长') && issue.message.includes('数值')));
  assert.equal(textCommandAction(project, '@显示角色：王生，横向位置=-20，纵向位置=30，缩放=-2', true)?.kind, 'show');
});

test('assets containing commas and names with equals signs are quoted and round trip', () => {
  const project = fixture();
  const background = textCommandAction(project, '@背景：图片="庭院，夜色"，时长=1.2，转场=淡入淡出，等待完成=否', true)!;
  assert.equal(background.kind, 'background');
  assert.deepEqual(textCommandAction(project, actionText(project, background), true), background);
  const sound = textCommandAction(project, '@音效：音效素材="风，雨"', true)!;
  assert.deepEqual(textCommandAction(project, actionText(project, sound), true), sound);
  assert.deepEqual(textCommandAction(project, '@背景音乐：夜宴，淡入=0，循环=否'), { kind: 'music', assetId: 'music', fade: 0, loop: false });
});
test('jump accepts positional and named transition values and emits concise comma syntax', () => {
  const project = fixture();
  for (const command of ['@跳转：终点，淡入淡出，1.2，#112233', '@跳转：颜色=#112233，目标=终点，时长=1.2，切换方式=淡入淡出']) {
    const parsed = applyTextScript(project, '# 段落：起点\n' + command + "\n# 段落：终点\n@返回标题界面");
    assert.deepEqual(parsed.issues, []);
    const jump = parsed.project.nodes.find(node => node.kind === 'jump');
    assert.ok(jump?.kind === 'jump'); assert.equal(jump.sceneTransition?.duration, 1.2); assert.equal(jump.sceneTransition?.color, '#112233');
    assert.doesNotMatch(projectToText(parsed.project), /-切换方式-|参数：/);
    assert.deepEqual(applyTextScript(parsed.project, projectToText(parsed.project)).issues, []);
  }
  assert.equal(jumpCommandText('段落 2', { mode: 'none', duration: 0, color: '#000000' }), '@跳转：段落 2');
  const old = '// 注释\n@跳转：段落 2-切换方式-淡入淡出-参数：时长=1，颜色=#000000\n旁白：保留原文。';
  assert.equal(replaceLegacyJumpCommands(old), '// 注释\n@跳转：段落 2，淡入淡出，1，#000000\n旁白：保留原文。');
});
test('clickable signatures insert a missing named argument and replace an existing value precisely', () => {
  const project = fixture(), source = '@显示角色：王生，缩放=1\n王生：你好。';
  const assistance = textAssistance(project, source, source.indexOf('\n'), true)!;
  const edit = assistance.parameterEdits!.find(item => item.label === '表情')!;
  const inserted = source.slice(0, edit.replaceStart) + edit.insertText + source.slice(edit.replaceEnd);
  assert.equal(inserted, '@显示角色：王生，缩放=1，表情=\n王生：你好。');
  const suggestions = textAssistance(project, inserted, edit.replaceStart! + edit.insertText.length, true)!;
  assert.equal(suggestions.parameterIndex, 1); assert.ok(suggestions.items.some(item => item.label === '担忧'));
  const scale = assistance.parameterEdits!.find(item => item.label === '缩放')!;
  assert.equal(source.slice(scale.replaceStart, scale.replaceEnd), '缩放=1');
  assert.equal(scale.caretOffset, '缩放='.length);
});
test('resource completion uses small-image metadata and preserves comma-containing references', () => {
  const project = fixture(), source = '@背景：ty';
  const assistance = textAssistance(project, source, source.length)!;
  assert.deepEqual(assistance.resource, { kind: 'image', category: 'scene' });
  const item = assistance.items.find(item => item.id === 'courtyard')!;
  assert.equal(item.assetId, 'courtyard'); assert.match(item.insertText, /^"/);
  const command = source.slice(0, assistance.start) + item.insertText;
  assert.equal((textCommandAction(project, command, true) as { assetId: string }).assetId, 'courtyard');
});
test('reusable performances accept positional resources and named parameters together', () => {
  const project = fixture(), graph = blueprintFromPerformance(project, [{ kind: 'chapter', title: '默认', subtitle: '', duration: 4, backgroundId: 'courtyard', soundId: 'music' }, { kind: 'sound', assetId: 'sound' }], '哀鸿进场演出');
  const inputs = performanceInputs(graph);
  exposePerformanceInputs(graph, ['title', 'backgroundId', 'assetId'].map(pinId => inputs.find(input => input.pinId === pinId)!));
  project.blueprints.push(graph);
  const call = textCommandAction(project, '@哀鸿进场演出："第一章，城破"，"庭院，夜色"，"风，雨"', true);
  assert.ok(call?.kind === 'blueprint');
  assert.deepEqual(call.inputs, { [graph.exposedInputs[0].id]: '第一章，城破', [graph.exposedInputs[1].id]: 'courtyard', [graph.exposedInputs[2].id]: 'sound' });
  const prefix = '@哀鸿进场演出：标题=下一章，章节背景=ty';
  const assistance = textAssistance(project, prefix, prefix.length)!;
  assert.equal(assistance.resource?.category, 'scene'); assert.equal(assistance.items[0].id, 'courtyard');
  assert.deepEqual(textCommandAction(project, actionText(project, call), true), call);
});
