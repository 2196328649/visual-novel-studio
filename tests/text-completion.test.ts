import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { commandSignatures, completionScore, textAssistance } from '../src/core/text-completion';
import { editTextDocument, textDocument, textEdit } from '../src/core/text-document';
import { textCommandAction } from '../src/core/text-script';

function fixture() {
  const p = createProject();
  p.characters = [
    { id: 'sui', name: '穗', color: '#ffffff', expressions: [{ id: 'normal', name: '通常', assetId: 'portrait' }, { id: 'sad', name: '悲伤', assetId: 'portrait' }] },
    { id: 'sly', name: '苏怜烟', color: '#aabbcc', expressions: [{ id: 'smile', name: '微笑', assetId: 'portrait' }] },
  ];
  p.assets = [
    { id: 'portrait', name: '穗立绘', kind: 'image', category: 'portrait', path: 'portrait.png' },
    { id: 'night', name: '夜宴', kind: 'image', category: 'scene', path: 'background/night.png' },
    { id: 'night_ui', name: '夜宴按钮', kind: 'image', category: 'ui', path: 'ui/night.png' },
    { id: 'music', name: '花街柳巷', kind: 'audio', category: 'bgm', path: 'bgm/music.ogg' },
    { id: 'voice', name: '苏怜烟对白', kind: 'audio', category: 'voice', path: 'voice/苏怜烟/hello.ogg' },
    { id: 'sound', name: '推门', kind: 'audio', category: 'sound', path: 'sound/door.ogg' },
  ];
  return p;
}
const assist = (source: string) => textAssistance(fixture(), source, source.length)!;

test('parameter names carry the type without repeating character/expression suffixes in suggestions', () => {
  const character = assist('@显示角色：sl').items.find(item => item.label === '苏怜烟')!;
  assert.equal(character.detail, '');
  const expression = assist('@显示角色：苏怜烟，w').items.find(item => item.label === '微笑')!;
  assert.equal(expression.detail, '苏怜烟');
});

test('Chinese characters, pinyin initials, full pinyin and English aliases match commands', () => {
  for (const query of ['显', 'xsjs', 'xianshijuese', 'show']) assert.equal(assist(`@${query}`).items[0].label, '显示角色');
  assert.equal(assist('xsjs').items[0].insertText, '@显示角色：');
  assert.ok(completionScore('苏怜烟', 'sly') > 0);
  assert.ok(assist('苏').items.some(item => item.insertText === '苏怜烟：'));
});

test('entry completion explains the name parameter and differs from the optional start node', () => {
  assert.equal(assist('@rk').items[0].insertText, '@入口：');
  const hint = assist('@入口：');
  assert.equal(hint.signature?.name, '入口');
  assert.equal(hint.signature?.parameters[0].kind, 'target');
  assert.match(hint.signature!.parameters[0].detail, /目录项名称/);
  assert.ok(hint.items.some(item => item.kind === '段落'));
  assert.match(assist('@开始').items.find(item => item.label === '开始')!.detail, /流程起点.*故事入口.*可省略/);
});
test('parameter help describes scale rather than mistaking it for vertical position', () => {
  const hint = assist('@显示角色：穗，通常，0.5，0.4');
  assert.equal(hint.parameterIndex, 3);
  assert.equal(hint.signature!.parameters[3].name, '缩放');
  assert.match(hint.signature!.parameters[3].detail, /40%/);
  const action = textCommandAction(fixture(), '@显示角色：穗，通常，0.5，0.4');
  assert.ok(action?.kind === 'show'); assert.equal(action.scale, 0.4); assert.equal(action.y, 1);
});

test('show character offers optional vertical position and explains the bottom anchor', () => {
  const command = '显示角色';
    const hint = assist(`@${command}：穗，通常，0.5，0.4，`);
    assert.equal(hint.parameterIndex, 4);
    assert.equal(hint.signature!.parameters[4].name, '纵向位置');
    assert.match(hint.signature!.parameters[4].detail, /底部.*大于 1/);
    assert.ok(hint.items.some(item => item.insertText === '1.2'));
    const action = textCommandAction(fixture(), `@${command}：穗，通常，0.5，0.4，1.2`);
    assert.ok(action?.kind === 'show'); assert.equal(action.y, 1.2); assert.equal(action.scale, .4);
    assert.equal(assist(`@${command}：穗，通常，0.5，0.4，1.2，`).signature!.parameters[5].name, '图层');
    assert.equal(assist(`@${command}：穗，通常，0.5，0.4，1.2，10，`).signature!.parameters[6].name, '等待完成');
    assert.ok(assist(`@${command}：入场过渡=`).items.some(item => item.label === '移动'));
});
test('character-dependent expressions and initials stay in the correct parameter', () => {
  assert.equal(assist('@显示角色：sly').items[0].label, '苏怜烟');
  assert.deepEqual(assist('@显示角色：穗，tc').items.filter(i => i.kind !== '参数名').map(i => i.label), ['通常']);
  assert.ok(assist('@显示角色：穗，tc').items.some(i => i.kind === '参数名' && i.insertText === '图层='));
  assert.deepEqual(assist('@显示角色：苏怜烟，w').items.filter(i => i.kind !== '参数名').map(i => i.label), ['微笑']);
  assert.equal(assist('@显示角色：穗，通常，').signature!.parameters[2].name, '横向位置');
});
test('only the full show-character command is offered and parsed', () => {
  assert.equal(commandSignatures.some(signature => signature.name === '角色'), false);
  assert.equal(assist('@角色').items.some(item => item.label === '角色'), false);
  assert.equal(textCommandAction(fixture(), '@角色：穗，通常，0.5，0.4，1.2'), undefined);
  assert.equal(textCommandAction(fixture(), '@显示角色：穗，通常，0.5，0.4，1.2')?.kind, 'show');
});
test('asset completions respect scene, BGM, voice and sound categories', () => {
  assert.deepEqual(assist('@背景：yy').items.map(i => i.id), ['night']);
  assert.deepEqual(assist('@背景音乐：hjlx').items.map(i => i.id), ['music']);
  assert.deepEqual(assist('@配音：sly').items.map(i => i.id), ['voice']);
  assert.deepEqual(assist('@音效：tm').items.map(i => i.id), ['sound']);
});
test('completion replaces only the current value, preserves later parameters and keeps IDs hidden', () => {
  const source = '@显示角色：sl，微笑，0.5，0.4\n苏怜烟：别修改这句。';
  const context = textAssistance(fixture(), source, source.indexOf('sl') + 2)!;
  const item = context.items.find(i => i.id === 'sly')!;
  const edited = textDocument(editTextDocument(textDocument(source), { start: context.start, end: context.end, text: item.insertText }));
  assert.equal(edited.text, source.replace('sl，', '苏怜烟，'));
  assert.match(edited.source, /【sly】/);
  assert.doesNotMatch(edited.text, /【sly】/);
});
test('dialogue, comments, completed arguments and unrelated prose do not produce intrusive menus', () => {
  for (const source of ['旁白：@显示角色：穗', '# 段落：夜宴', '这是普通的一句话。']) assert.equal(assist(source), undefined);
  assert.equal(assist('@显示角色：穗').items.length, 0);
  assert.equal(textAssistance(fixture(), '@显示角色：穗', '@显示角色：穗'.length, true)!.items[0].label, '穗');
});
test('replacing a large selection retains unchanged lines and their hidden performance bindings', () => {
  const raw = '# 段落：夜宴【night】\n@演出实例：夜宴 第2行【second】 使用【snapshot_two】\n@对白标记：second\n苏怜烟：原来的台词。\n';
  const original = textDocument(raw);
  const extra = original.text + '\n# 段落：临时补全\n旁白：临时内容。';
  const expanded = textDocument(editTextDocument(original, textEdit(original.text, extra, { start: 0, end: original.text.length })));
  const restored = textDocument(editTextDocument(expanded, textEdit(expanded.text, original.text, { start: 0, end: expanded.text.length })));
  assert.equal(restored.source, raw); assert.equal(restored.text, original.text);
});

test('heading completion offers exactly three directory declarations', () => {
  assert.deepEqual(assist('#').items.map(item => item.label), ['章节', '小章节', '段落']);
  assert.equal(assist('#xzj').items[0].insertText, '# 小章节：');
  assert.equal(assist('##dl').items[0].insertText, '# 段落：');
  assert.equal(assist('# 章节：自己的名称'), undefined);
  assert.equal(assist('@fh').items[0].insertText, '@返回');
  assert.ok(['跳转', '调用', '返回', '开始', '选择', '返回标题界面'].every(name => commandSignatures.some(spec => spec.name === name)));
  assert.equal(commandSignatures.some(spec => spec.name === '结局'), false);
  assert.ok(!commandSignatures.some(spec => ['接下来', '目标', '切换场景', '提示'].includes(spec.name)));
});

test('目录括号内提示参数名、是或否，并支持中文括号和未闭合输入', () => {
  for (const source of ['#章节(', '# 小章节（', '##段落(']) {
    const hint = assist(source);
    assert.deepEqual(hint.items.map(item => item.label), ['流程图', '显示名称', '样式']);
    assert.equal(hint.syntax, 'heading');
  }
  for (const source of ['#章节(流程图=)', '#小章节（流程图=）', '#段落(流程图=，显示名称="第一段")']) {
    const offset = source.indexOf('=') + 1, hint = textAssistance(fixture(), source, offset)!;
    assert.deepEqual(hint.items.map(item => item.label), ['是', '否']);
    assert.equal(hint.signature?.parameters[hint.parameterIndex!].name, '流程图');
    const item = hint.items.find(item => item.label === '否')!;
    assert.equal(source.slice(0, hint.start) + item.insertText + source.slice(hint.end), source.slice(0, offset) + '否' + source.slice(offset));
  }
});

test('目录参数补全只修改括号中的当前参数，保留后续参数与章节标题', () => {
  const source = '#章节(流，显示名称="酒醒, A)B: C"):第一章\n旁白：保留正文。';
  const hint = textAssistance(fixture(), source, source.indexOf('流') + 1)!;
  assert.deepEqual(hint.items.map(item => item.label), ['流程图']);
  const item = hint.items[0];
  const next = source.slice(0, hint.start) + item.insertText + source.slice(hint.end);
  assert.equal(next, source.replace('(流，', '(流程图=，'));
  const named = textAssistance(fixture(), next, next.indexOf('流程图=') + '流程图='.length)!;
  const edit = named.parameterEdits!.find(item => item.label === '显示名称')!;
  const selected = next.slice(0, edit.replaceStart) + edit.insertText + next.slice(edit.replaceEnd);
  assert.ok(selected.endsWith('):第一章\n旁白：保留正文。'));
  assert.ok(selected.includes('显示名称="酒醒, A)B: C"'));
  assert.equal(textAssistance(fixture(), source, source.indexOf('第一章') + 3), undefined);
});

test('jump, call and option completion offer stable destinations at every directory level', () => {
  const project = fixture();
  project.chapters = [{ id: 'chapter', name: '第二章' }];
  project.scenes = [{ id: 'home', name: '归家', chapterId: 'chapter' }];
  project.nodes = [{ id: 'arrival', name: '相遇', kind: 'passage', sceneId: 'home', x: 0, y: 0, lines: [] }];
  for (const prefix of ['@跳转：', '@调用：', '@选项：留下 -> ']) {
    const result = textAssistance(project, prefix, prefix.length)!;
    assert.deepEqual(result.items.filter(item => item.kind !== '参数名').map(item => item.kind), ['章节', '小章节', '段落']);
    assert.deepEqual(result.items.filter(item => item.kind !== '参数名').map(item => item.insertText), ['第二章【chapter】', '归家【home】', '相遇【arrival】']);
    for (const [query, expected] of [['dez', 'chapter'], ['gj', 'home'], ['xy', 'arrival'], ['第二章/归家/相', 'arrival']]) {
      const source = prefix + query;
      const result = textAssistance(project, source, source.length)!;
      assert.equal(result.items[0].id, expected);
      assert.equal(source.slice(result.start, result.end), query);
    }
  }
});

test('jump completion preserves transition parameters and literal brackets after the target', () => {
  const project = fixture();
  project.scenes = [{ id: 'home', name: '归家', chapterId: project.chapters[0].id }];
  const source = '@跳转：gj，切换方式=淡入淡出，时长=1.2，备注="【literal】"\n旁白：下一句。';
  const result = textAssistance(project, source, source.indexOf('gj') + 2)!;
  assert.equal(source.slice(result.start, result.end), 'gj');
  const item = result.items.find(item => item.id === 'home')!;
  const edited = textDocument(editTextDocument(textDocument(source), { start: result.start, end: result.end, text: item.insertText }));
  assert.equal(edited.text, source.replace('gj，', '归家，'));
  assert.match(edited.source, /@跳转：归家【home】，切换方式/);
  assert.ok(edited.text.includes('【literal】'));
  const parameters = textAssistance(project, source, source.indexOf('1.2') + 3)!;
  assert.deepEqual(parameters.items, []);
});
