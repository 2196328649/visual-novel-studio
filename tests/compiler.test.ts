import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, effectiveCharacter, effectiveScene, effectiveUiComponents, uiComponentSchema, type Project } from '../src/core/model';
import { compileProject, conditionExpression } from '../src/runtime/compiler';
import { pythonLiteral, renpyText } from '../src/runtime/screens';

function fixture(): Project {
  return {
    ...createProject('示例作品'), id: 'fixture', entryId: 'start',
    chapters: [{ id: 'chapter', name: '第一章' }], scenes: [{ id: 'scene', name: '开场', chapterId: 'chapter' }],
    assets: [
      { id: 'background', name: '背景', kind: 'image', path: 'assets/background.jpg' },
      { id: 'portrait', name: '立绘', kind: 'image', path: 'assets/portrait.png' },
      { id: 'music', name: '音乐', kind: 'audio', path: 'assets/music.opus' },
      { id: 'voice', name: '语音', kind: 'audio', path: 'assets/voice.ogg' },
    ],
    characters: [{ id: 'hero', name: '林', color: '#55aa88', expressions: [{ id: 'normal', name: '自然', assetId: 'portrait' }] }],
    variables: [
      { id: 'trust', name: '信任', type: 'number', initial: 0, persistent: false },
      { id: 'unlocked', name: '已完成', type: 'boolean', initial: false, persistent: true },
      { id: 'nickname', name: '名字', type: 'string', initial: '旅人', persistent: false },
    ],
    nodes: [
      { id: 'start', sceneId: 'scene', name: '开始', x: 0, y: 0, kind: 'start', next: 'passage' },
      { id: 'passage', sceneId: 'scene', name: '对话', x: 100, y: 0, kind: 'passage', next: 'choice', lines: [
        { id: 'first', speakerId: 'hero', text: '第一句话。', voiceId: 'voice', actions: [
          { kind: 'background', assetId: 'background', transition: 'fade' },
          { kind: 'show', characterId: 'hero', expressionId: 'normal', x: 0.5, y: 1, scale: 0.8, layer: 3, transition: 'dissolve' },
          { kind: 'music', assetId: 'music', loop: true, fade: 0.5 },
        ] },
        { id: 'second', text: '第二句话。', actions: [
          { kind: 'sound', assetId: 'voice' }, { kind: 'pause', seconds: 0.2 },
          { kind: 'hide', characterId: 'hero', transition: 'move' }, { kind: 'stopMusic', fade: 0.5 },
        ] },
      ] },
      { id: 'choice', sceneId: 'scene', name: '选择', x: 200, y: 0, kind: 'choice', prompt: '如何回应？', choices: [
        { id: 'accept', text: '接受', target: 'increment', condition: { kind: 'compare', variableId: 'trust', operator: 'gte', value: 0 } },
        { id: 'decline', text: '拒绝', target: 'end' },
      ] },
      { id: 'increment', sceneId: 'scene', name: '加分', x: 300, y: 0, kind: 'set', variableId: 'trust', operation: 'add', value: 1, next: 'condition' },
      { id: 'condition', sceneId: 'scene', name: '判断', x: 400, y: 0, kind: 'condition', condition: { kind: 'compare', variableId: 'trust', operator: 'gt', value: 0 }, yes: 'call', no: 'end' },
      { id: 'call', sceneId: 'scene', name: '调用', x: 500, y: 0, kind: 'call', target: 'subroutine', next: 'jump' },
      { id: 'subroutine', sceneId: 'scene', name: '子程序', x: 500, y: 200, kind: 'passage', lines: [{ id: 'child', text: '子程序。', actions: [] }], next: 'return' },
      { id: 'return', sceneId: 'scene', name: '返回', x: 600, y: 200, kind: 'return' },
      { id: 'jump', sceneId: 'scene', name: '跳转', x: 600, y: 0, kind: 'jump', target: 'end' },
      { id: 'end', sceneId: 'scene', name: '结束', x: 700, y: 0, kind: 'end' },
    ],
  };
}

test('compilation is deterministic and does not mutate authored data', () => {
  const project = fixture();
  const original = structuredClone(project);
  const first = compileProject(project);
  assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
  assert.deepEqual(first, compileProject(project));
  assert.deepEqual(project, original);
  assert.ok(first.files['game/story.rpy']);
  assert.ok(first.files['game/screens.rpy']);
  assert.ok(first.files['game/options.rpy']);
  assert.doesNotMatch(Object.values(first.files).join('\n'), /E:[\\/]|C:[\\/]|renpy-8\.5\.3-sdk/);
});

test('scene transition, inherited character expressions and feature actions compile as reusable instances', () => {
  const project = fixture();
  project.scenes.push({ id: 'scene_next', name: '下一幕', chapterId: 'chapter', baseSceneId: 'scene', parameters: { 天气: '雨' } });
  project.characters.push({
    id: 'child_character', name: '继承角色', color: '#aa6688', baseCharacterId: 'hero',
    expressions: [],
    features: [{ id: 'feature_glow', name: '发光', actions: [{ kind: 'shake', direction: 'horizontal' }] }],
  });
  const jump = project.nodes.find(node => node.id === 'jump');
  assert.ok(jump?.kind === 'jump');
  project.nodes.push(
    { id: 'next_start', sceneId: 'scene_next', name: '下一幕入口', x: 800, y: 0, kind: 'start', next: 'next_end' },
    { id: 'next_end', sceneId: 'scene_next', name: '下一幕结束', x: 900, y: 0, kind: 'end' },
  );
  jump.target = 'next_start';
  jump.sceneTransition = { mode: 'fade', duration: 0.8, color: '#112233', fromSceneId: 'scene', toSceneId: 'scene_next', parameters: { 曲线: 'ease' } };
  const passage = project.nodes.find(node => node.id === 'passage');
  assert.ok(passage?.kind === 'passage');
  passage.lines[0].actions.push({ kind: 'show', characterId: 'child_character', expressionId: 'normal', x: 0.4, y: 1, scale: 1, layer: 2, transition: 'none' });
  passage.lines[1].actions.push({ kind: 'characterFeature', characterId: 'child_character', featureId: 'feature_glow' });
  assert.equal(effectiveCharacter(project, 'child_character')?.expressions.some(item => item.id === 'normal'), true);
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
  assert.match(compiled.files['game/story.rpy'], /vn_pending_scene_transition = \{"mode": "fade", "duration": 0\.8/);
  assert.match(compiled.files['game/story.rpy'], /vn_stage_transition\(Fade\(duration \/ 2\.0, 0\.0, duration \/ 2\.0, color=transition\["color"\]\), duration\)/);
  assert.ok(compiled.files['game/story.rpy'].indexOf('vn_pending_scene_transition = {"mode": "fade"') < compiled.files['game/story.rpy'].indexOf('jump vn_node_next_start'));
  assert.match(compiled.files['game/story.rpy'], /show vn_actor_child_character normal/);
  assert.match(compiled.files['game/story.rpy'], /show layer master at vn_blueprint_shake\("horizontal"/);
});

test('UI instance chain contributes reusable components to generated screens', () => {
  const project = fixture();
  const base = { id: 'ui_base', name: '基础界面', components: [{ id: 'ui_text', page: 'main' as const, kind: 'text' as const, text: '标题', x: 0.1, y: 0.1, width: 0.5, height: 0.1 }] };
  project.ui.instances = [base, { id: 'ui_child', name: '作品界面', baseUiId: 'ui_base', components: [], parameters: { 风格: '古典' } }];
  project.ui.activeInstanceId = 'ui_child';
  assert.equal(effectiveUiComponents(project.ui).some(item => item.id === 'ui_text'), true);
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
  assert.match(compiled.files['game/screens.rpy'], /vn_components_main/);
  assert.match(compiled.files['game/screens.rpy'], /标题/);
});

test('UI instance overrides win and hidden inherited components stay hidden', () => {
  const project = fixture();
  const baseComponent = { id: 'ui_text', page: 'main' as const, kind: 'text' as const, text: '基础标题', x: 0.1, y: 0.1, width: 0.5, height: 0.1 };
  project.ui.instances = [
    { id: 'ui_base', name: '基础', components: [baseComponent] },
    { id: 'ui_child', name: '子级', baseUiId: 'ui_base', components: [{ ...baseComponent, text: '覆盖标题' }], hiddenComponentIds: [] },
  ];
  project.ui.activeInstanceId = 'ui_child';
  assert.equal(effectiveUiComponents(project.ui).find(item => item.id === 'ui_text')?.text, '覆盖标题');
  project.ui.instances[1].hiddenComponentIds = ['ui_text'];
  assert.equal(effectiveUiComponents(project.ui).some(item => item.id === 'ui_text'), false);
});

test('scene, character, and UI instances can invoke reusable blueprints', () => {
  const project = fixture();
  project.blueprints = [{
    id: 'bp_instance', name: '实例行为', kind: 'ui',
    nodes: [{ id: 'bp_instance_event', type: 'event', name: '事件', x: 0, y: 0, pins: [{ id: 'exec', name: '执行', direction: 'output', dataType: 'exec', required: false }], properties: {}, collapsed: false }],
    links: [], exposedInputs: [], exposedOutputs: [],
  }];
  project.scenes[0].blueprintId = 'bp_instance';
  project.characters[0].blueprintId = 'bp_instance';
  project.ui.instances = [{ id: 'ui_instance', name: '实例界面', blueprintId: 'bp_instance', components: [{ id: 'ui_blueprint_button', page: 'main', kind: 'button', text: '执行', action: 'blueprint', blueprintId: 'bp_instance', x: 0.2, y: 0.2, width: 0.3, height: 0.1 }] }];
  project.ui.activeInstanceId = 'ui_instance';
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
  const story = compiled.files['game/story.rpy'];
  assert.match(story, /call vn_blueprint_bp_instance from vn_blueprint_call_bp_instance/);
  assert.match(story, /call vn_blueprint_bp_instance from vn_character_blueprint_hero/);
  assert.match(compiled.files['game/screens.rpy'], /on "show" action Function\(vn_run_ui_show, "bp_instance"\)/);
  assert.match(compiled.files['game/screens.rpy'], /action Function\(vn_run_blueprint, "bp_instance"\)/);
});

test('extended Aihong UI pages accept reusable components and compile safe screens', () => {
  const project = fixture();
  const pages = [
    ['pause', 'pauseMenu'], ['history', 'historyList'], ['gallery', 'galleryGrid'], ['musicRoom', 'musicTrackList'],
    ['voiceCollection', 'voiceCollection'], ['chapterSelect', 'chapterList'], ['chapterTitle', 'chapterTitle'],
    ['messageBox', 'messageBox'], ['staff', 'staffRoll'], ['keyboard', 'keyboard'],
    ['flowchart', 'flowchart'], ['gameOver', 'gameOver'],
  ] as const;
  project.ui.components = pages.map(([page, kind], index) => ({
    id: `ui_extended_${index}`, page, kind, text: `中文${page}`, x: 0.05, y: 0.05, width: 0.9, height: 0.2,
  }));
  assert.equal(project.ui.components.every(component => uiComponentSchema.safeParse(component).success), true);
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
  for (const [page] of pages) assert.match(compiled.files['game/screens.rpy'], new RegExp(`screen vn_components_${page}`));
  assert.match(compiled.files['game/screens.rpy'], /中文voiceCollection/);
  assert.match(compiled.files['game/screens.rpy'], /action VnStoryStart\("chapterList", chapter_id, chapter_label, chapter_name\)/);
  assert.match(compiled.files['game/01-vn-story-menu.rpy'], /action = Start\(self.label\)/);
});

test('scene instances merge inherited parameters and text directives round-trip', async () => {
  const project = fixture();
  project.scenes.push({ id: 'scene_base', name: '基础场景', chapterId: 'chapter', parameters: { 时间: '白天', 雨: false } });
  project.scenes.push({ id: 'scene_child', name: '继承场景', chapterId: 'chapter', baseSceneId: 'scene_base', parameters: { 时间: '夜晚' } });
  const effective = effectiveScene(project, 'scene_child');
  assert.deepEqual(effective?.parameters, { 时间: '夜晚', 雨: false });
  const { applyTextScript, projectToText } = await import('../src/core/text-script');
  const source = '# 章节：第一章【chapter】\n# 小章节：基础场景【scene_base】\n@场景参数：时间=白天，雨=否\n# 段落：基础\n旁白：基础。\n# 小章节：继承场景【scene_child】\n@场景基础：基础场景【scene_base】\n@场景参数：时间=夜晚\n# 段落：继承\n旁白：继承。';
  const parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.project.scenes.find(scene => scene.id === 'scene_child')?.parameters, { 时间: '夜晚' });
  assert.match(projectToText(parsed.project), /场景基础：基础场景/);
});

test('dialogue and names remain literal when they contain RenPy markup or code-like text', () => {
  const text = '"[trust]" {w=10} \\ newline\n$ renpy.quit()';
  const encoded = renpyText(text);
  assert.equal(JSON.parse(encoded), '"[[trust]" {{w=10} \\ newline\n$ renpy.quit()');
  assert.equal(encoded.includes('\n'), false);
  const project = fixture();
  project.name = text;
  project.characters[0].name = text;
  const passage = project.nodes.find(node => node.kind === 'passage');
  assert.ok(passage?.kind === 'passage');
  passage.lines[0].text = text;
  const result = compileProject(project);
  assert.ok(result.files['game/story.rpy'].includes(encoded));
  assert.ok(result.files['game/screens.rpy'].includes(encoded));
  assert.doesNotMatch(result.files['game/story.rpy'], /^\$ renpy\.quit/m);
});

test('line insertion and node movement preserve call and dialogue identities', () => {
  const project = fixture();
  const first = compileProject(project);
  const passage = project.nodes.find(node => node.id === 'passage');
  assert.ok(passage?.kind === 'passage');
  passage.x += 70;
  passage.lines.unshift({ id: 'inserted', text: '新增一句。', actions: [] });
  const next = compileProject(project);
  for (const output of [first, next]) {
    assert.match(output.files['game/story.rpy'], /call vn_node_subroutine from vn_return_call/);
    assert.match(output.files['game/story.rpy'], /label vn_line_passage_first:/);
    const lineIndex = output.files['game/story.rpy'].split('\n').findIndex(line => line.includes('id vn_say_passage_first'));
    assert.deepEqual(output.sourceMap[`game/story.rpy:${lineIndex + 1}`], { nodeId: 'passage', lineId: 'first' });
    assert.deepEqual(output.sourceMap[`story.rpy:${lineIndex + 1}`], { nodeId: 'passage', lineId: 'first' });
  }
});

test('all node families and stage actions produce native engine statements', () => {
  const output = compileProject(fixture()).files['game/story.rpy'];
  for (const statement of [
    'scene vn_background_background', 'show vn_actor_hero normal at vn_stage(0.5, 1, 0.8) zorder 3',
    'vn_stage_transition(fade, 1)', 'vn_stage_transition(dissolve, 0.5)', 'vn_stage_transition(move, 0.5)', 'play music "assets/music.opus" loop fadein 0.5',
    'play sound "assets/voice.ogg"', 'voice "assets/voice.ogg"', 'pause 0.2',
    'vn_bp_hide("hero"', 'stop music fadeout 0.5', 'menu:', '$ vn_var_trust += 1',
    'if (vn_var_trust > 0):', 'call vn_node_subroutine from vn_return_call',
    'jump vn_node_end', '$ renpy.set_return_stack([])',
  ]) assert.ok(output.includes(statement), statement);
  assert.match(output, /label vn_node_return:[\s\S]*?    return/);
  assert.match(output, /default persistent\.vn_var_unlocked = False/);
});

test('legacy chapter title nodes migrate to ordinary blueprints and survive Chinese text round-trip', async () => {
  const project = fixture();
  const title = { id: 'chapter_title', sceneId: 'scene', name: '标题节点', x: 40, y: 120, kind: 'chapterTitle' as const, title: '归', subtitle: '崇祯五年', duration: 3.2, next: 'passage' };
  const start = project.nodes.find(node => node.id === 'start'); if (start?.kind === 'start') start.next = title.id; project.nodes.push(title);
  const { parseProject } = await import('../src/desktop/project-store');
  const migrated = parseProject(project).project;
  const { applyTextScript, projectToText } = await import('../src/core/text-script');
  const source = projectToText(migrated); assert.doesNotMatch(source, /@章节标题/); assert.match(source, /@独立演出/);
  const parsed = applyTextScript(migrated, source); assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.project.nodes, migrated.nodes);
  const compiled = compileProject(parsed.project); assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
  assert.match(compiled.files['game/story.rpy'], /call vn_blueprint_chapter_/);
  assert.ok(JSON.stringify(parsed.project.blueprints).includes('崇祯五年'));
});

test('generic blueprint sequence emits every execution output', () => {
  const project = fixture();
  project.blueprints = [{
    id: 'bp_sequence', name: '序列测试', kind: 'function',
    nodes: [
      { id: 'bp_event', type: 'event', name: '事件', x: 0, y: 0, pins: [{ id: 'exec', name: '执行', direction: 'output', dataType: 'exec', required: false }], properties: {}, collapsed: false },
      { id: 'bp_sequence_node', type: 'sequence', name: '序列', x: 100, y: 0, pins: [{ id: 'exec_in', name: '执行', direction: 'input', dataType: 'exec', required: false }, { id: 'then_0', name: '序列 0', direction: 'output', dataType: 'exec', required: false }, { id: 'then_1', name: '序列 1', direction: 'output', dataType: 'exec', required: false }], properties: {}, collapsed: false },
      { id: 'bp_delay_0', type: 'delay', name: '第一段', x: 200, y: 0, pins: [{ id: 'bp_delay_0_in', name: '执行', direction: 'input', dataType: 'exec', required: false }], properties: { seconds: 0.1 }, collapsed: false },
      { id: 'bp_delay_1', type: 'delay', name: '第二段', x: 200, y: 100, pins: [{ id: 'bp_delay_1_in', name: '执行', direction: 'input', dataType: 'exec', required: false }], properties: { seconds: 0.2 }, collapsed: false },
    ],
    links: [
      { id: 'bp_link_event', fromNodeId: 'bp_event', fromPinId: 'exec', toNodeId: 'bp_sequence_node', toPinId: 'exec_in' },
      { id: 'bp_link_first', fromNodeId: 'bp_sequence_node', fromPinId: 'then_0', toNodeId: 'bp_delay_0', toPinId: 'bp_delay_0_in' },
      { id: 'bp_link_second', fromNodeId: 'bp_sequence_node', fromPinId: 'then_1', toNodeId: 'bp_delay_1', toPinId: 'bp_delay_1_in' },
    ], exposedInputs: [], exposedOutputs: [],
  }];
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
  const story = compiled.files['game/story.rpy'];
  assert.match(story, /label vn_blueprint_bp_sequence:/);
  assert.match(story, /pause 0\.1[\s\S]*pause 0\.2/);
});

test('blueprint compare, select, and loop nodes compile as data and execution flow', () => {
  const project = fixture();
  project.blueprints = [{
    id: 'bp_flow', name: '比较与循环', kind: 'function',
    nodes: [
      { id: 'bp_event', type: 'event', name: '事件', x: 0, y: 0, pins: [{ id: 'exec', name: '执行', direction: 'output', dataType: 'exec', required: false }], properties: {}, collapsed: false },
      { id: 'bp_literal_a', type: 'literal', name: 'A', x: 100, y: 0, pins: [{ id: 'value', name: '值', direction: 'output', dataType: 'number', required: false }], properties: { value: 3 }, collapsed: false },
      { id: 'bp_literal_b', type: 'literal', name: 'B', x: 100, y: 100, pins: [{ id: 'value', name: '值', direction: 'output', dataType: 'number', required: false }], properties: { value: 3 }, collapsed: false },
      { id: 'bp_compare', type: 'compare', name: '相等', x: 240, y: 0, pins: [{ id: 'a', name: 'A', direction: 'input', dataType: 'any', required: false }, { id: 'b', name: 'B', direction: 'input', dataType: 'any', required: false }, { id: 'result', name: '结果', direction: 'output', dataType: 'boolean', required: false }], properties: { operator: 'eq' }, collapsed: false },
      { id: 'bp_branch', type: 'branch', name: '判断', x: 400, y: 0, pins: [{ id: 'exec_in', name: '执行', direction: 'input', dataType: 'exec', required: false }, { id: 'condition', name: '条件', direction: 'input', dataType: 'boolean', required: false }, { id: 'true', name: '真', direction: 'output', dataType: 'exec', required: false }, { id: 'false', name: '假', direction: 'output', dataType: 'exec', required: false }], properties: {}, collapsed: false },
      { id: 'bp_loop', type: 'forLoop', name: '循环', x: 560, y: 0, pins: [{ id: 'exec_in', name: '执行', direction: 'input', dataType: 'exec', required: false }, { id: 'first_index', name: '起始', direction: 'input', dataType: 'number', required: false }, { id: 'last_index', name: '结束', direction: 'input', dataType: 'number', required: false }, { id: 'loop_body', name: '循环体', direction: 'output', dataType: 'exec', required: false }, { id: 'index', name: '索引', direction: 'output', dataType: 'number', required: false }, { id: 'completed', name: '完成', direction: 'output', dataType: 'exec', required: false }], properties: { firstIndex: 0, lastIndex: 2 }, collapsed: false },
      { id: 'bp_loop_delay', type: 'delay', name: '循环体', x: 640, y: 120, pins: [{ id: 'exec_in', name: '执行', direction: 'input', dataType: 'exec', required: false }, { id: 'seconds', name: '秒数', direction: 'input', dataType: 'number', required: false }, { id: 'exec_out', name: '完成', direction: 'output', dataType: 'exec', required: false }], properties: { seconds: 0 }, collapsed: false },
      { id: 'bp_return', type: 'return', name: '返回', x: 720, y: 0, pins: [{ id: 'exec_in', name: '执行', direction: 'input', dataType: 'exec', required: false }], properties: {}, collapsed: false },
    ],
    links: [
      { id: 'l0', fromNodeId: 'bp_event', fromPinId: 'exec', toNodeId: 'bp_branch', toPinId: 'exec_in' },
      { id: 'l1', fromNodeId: 'bp_literal_a', fromPinId: 'value', toNodeId: 'bp_compare', toPinId: 'a' },
      { id: 'l2', fromNodeId: 'bp_literal_b', fromPinId: 'value', toNodeId: 'bp_compare', toPinId: 'b' },
      { id: 'l3', fromNodeId: 'bp_compare', fromPinId: 'result', toNodeId: 'bp_branch', toPinId: 'condition' },
      { id: 'l4', fromNodeId: 'bp_branch', fromPinId: 'true', toNodeId: 'bp_loop', toPinId: 'exec_in' },
      { id: 'l4b', fromNodeId: 'bp_loop', fromPinId: 'loop_body', toNodeId: 'bp_loop_delay', toPinId: 'exec_in' },
      { id: 'l5', fromNodeId: 'bp_loop', fromPinId: 'completed', toNodeId: 'bp_return', toPinId: 'exec_in' },
    ], exposedInputs: [], exposedOutputs: [],
  }];
  const result = compileProject(project);
  assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
  const story = result.files['game/story.rpy'];
  assert.match(story, /if \(3 == 3\):/);
  assert.match(story, /while vn_bp_index_bp_loop <= vn_bp_last_bp_loop:/);
  assert.match(story, /\$ vn_bp_index_bp_loop \+= 1/);
});

test('generic blueprint data links evaluate literals, variables, and math inputs', () => {
  const project = fixture();
  project.blueprints = [{
    id: 'bp_data', name: '数据引脚测试', kind: 'function',
    nodes: [
      { id: 'bp_data_event', type: 'event', name: '事件', x: 0, y: 0, pins: [{ id: 'exec', name: '执行', direction: 'output', dataType: 'exec', required: false }], properties: {}, collapsed: false },
      { id: 'bp_data_literal', type: 'literal', name: '信任值', x: 100, y: 0, pins: [{ id: 'value', name: '值', direction: 'output', dataType: 'number', required: false }], properties: { value: 7 }, collapsed: false },
      { id: 'bp_data_set', type: 'setVariable', name: '写入信任', x: 200, y: 0, pins: [
        { id: 'exec_in', name: '执行', direction: 'input', dataType: 'exec', required: false },
        { id: 'value', name: '值', direction: 'input', dataType: 'number', required: true },
        { id: 'exec_out', name: '完成', direction: 'output', dataType: 'exec', required: false },
      ], properties: { variableId: 'trust', value: 1 }, collapsed: false },
      { id: 'bp_data_get', type: 'getVariable', name: '读取完成状态', x: 300, y: 0, pins: [{ id: 'value', name: '值', direction: 'output', dataType: 'boolean', required: false }], properties: { variableId: 'unlocked' }, collapsed: false },
      { id: 'bp_data_branch', type: 'branch', name: '判断完成状态', x: 400, y: 0, pins: [
        { id: 'exec_in', name: '执行', direction: 'input', dataType: 'exec', required: false },
        { id: 'condition', name: '条件', direction: 'input', dataType: 'boolean', required: true },
        { id: 'true', name: '真', direction: 'output', dataType: 'exec', required: false },
        { id: 'false', name: '假', direction: 'output', dataType: 'exec', required: false },
      ], properties: { variableId: 'trust', value: 0 }, collapsed: false },
      { id: 'bp_data_a', type: 'literal', name: '延迟 A', x: 500, y: 0, pins: [{ id: 'value', name: '值', direction: 'output', dataType: 'number', required: false }], properties: { value: 0.25 }, collapsed: false },
      { id: 'bp_data_b', type: 'literal', name: '延迟 B', x: 500, y: 100, pins: [{ id: 'value', name: '值', direction: 'output', dataType: 'number', required: false }], properties: { value: 0.5 }, collapsed: false },
      { id: 'bp_data_math', type: 'math', name: '延迟相加', x: 600, y: 0, pins: [
        { id: 'a', name: 'A', direction: 'input', dataType: 'number', required: true },
        { id: 'b', name: 'B', direction: 'input', dataType: 'number', required: true },
        { id: 'result', name: '结果', direction: 'output', dataType: 'number', required: false },
      ], properties: { operation: 'add' }, collapsed: false },
      { id: 'bp_data_delay', type: 'delay', name: '等待', x: 700, y: 0, pins: [
        { id: 'exec_in', name: '执行', direction: 'input', dataType: 'exec', required: false },
        { id: 'seconds', name: '秒数', direction: 'input', dataType: 'number', required: true },
        { id: 'exec_out', name: '完成', direction: 'output', dataType: 'exec', required: false },
      ], properties: { seconds: 1 }, collapsed: false },
    ],
    links: [
      { id: 'bp_data_link_event', fromNodeId: 'bp_data_event', fromPinId: 'exec', toNodeId: 'bp_data_set', toPinId: 'exec_in' },
      { id: 'bp_data_link_literal', fromNodeId: 'bp_data_literal', fromPinId: 'value', toNodeId: 'bp_data_set', toPinId: 'value' },
      { id: 'bp_data_link_set', fromNodeId: 'bp_data_set', fromPinId: 'exec_out', toNodeId: 'bp_data_branch', toPinId: 'exec_in' },
      { id: 'bp_data_link_get', fromNodeId: 'bp_data_get', fromPinId: 'value', toNodeId: 'bp_data_branch', toPinId: 'condition' },
      { id: 'bp_data_link_true', fromNodeId: 'bp_data_branch', fromPinId: 'true', toNodeId: 'bp_data_delay', toPinId: 'exec_in' },
      { id: 'bp_data_link_a', fromNodeId: 'bp_data_a', fromPinId: 'value', toNodeId: 'bp_data_math', toPinId: 'a' },
      { id: 'bp_data_link_b', fromNodeId: 'bp_data_b', fromPinId: 'value', toNodeId: 'bp_data_math', toPinId: 'b' },
      { id: 'bp_data_link_math', fromNodeId: 'bp_data_math', fromPinId: 'result', toNodeId: 'bp_data_delay', toPinId: 'seconds' },
    ],
    exposedInputs: [], exposedOutputs: [],
  }];
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
  const story = compiled.files['game/story.rpy'];
  assert.match(story, /\$ vn_var_trust = 7/);
  assert.match(story, /if persistent\.vn_var_unlocked:[\s\S]*vn_performance_pause\(\(0\.25 \+ 0\.5\)\)/);
});

test('blueprint exposed inputs are passed through nested calls', () => {
  const project = fixture();
  project.blueprints = [
    {
      id: 'bp_target', name: '带参数函数', kind: 'function',
      exposedInputs: [{ id: 'threshold', name: '阈值', direction: 'input', dataType: 'number', required: false, defaultValue: 2 }], exposedOutputs: [],
      nodes: [
        { id: 'target_event', type: 'event', name: '事件', x: 0, y: 0, pins: [{ id: 'exec', name: '执行', direction: 'output', dataType: 'exec', required: false }], properties: {}, collapsed: false },
        { id: 'target_input', type: 'getInput', name: '读取阈值', x: 100, y: 0, pins: [{ id: 'value', name: '值', direction: 'output', dataType: 'number', required: false }], properties: { inputId: 'threshold' }, collapsed: false },
        { id: 'target_set', type: 'setVariable', name: '写入状态', x: 260, y: 0, pins: [{ id: 'exec_in', name: '执行', direction: 'input', dataType: 'exec', required: false }, { id: 'value', name: '值', direction: 'input', dataType: 'number', required: false }, { id: 'exec_out', name: '完成', direction: 'output', dataType: 'exec', required: false }], properties: { variableId: 'trust' }, collapsed: false },
      ],
      links: [
        { id: 'target_exec', fromNodeId: 'target_event', fromPinId: 'exec', toNodeId: 'target_set', toPinId: 'exec_in' },
        { id: 'target_value', fromNodeId: 'target_input', fromPinId: 'value', toNodeId: 'target_set', toPinId: 'value' },
      ],
    },
    {
      id: 'bp_caller', name: '调用函数', kind: 'function', exposedInputs: [], exposedOutputs: [],
      nodes: [
        { id: 'caller_event', type: 'event', name: '事件', x: 0, y: 0, pins: [{ id: 'exec', name: '执行', direction: 'output', dataType: 'exec', required: false }], properties: {}, collapsed: false },
        { id: 'caller_literal', type: 'literal', name: '参数', x: 100, y: 100, pins: [{ id: 'value', name: '值', direction: 'output', dataType: 'number', required: false }], properties: { value: 7 }, collapsed: false },
        { id: 'caller_call', type: 'callFunction', name: '调用', x: 260, y: 0, pins: [{ id: 'exec_in', name: '执行', direction: 'input', dataType: 'exec', required: false }, { id: 'arg_0', name: '参数 1', direction: 'input', dataType: 'any', required: false }, { id: 'exec_out', name: '完成', direction: 'output', dataType: 'exec', required: false }], properties: { graphId: 'bp_target' }, collapsed: false },
      ],
      links: [
        { id: 'caller_exec', fromNodeId: 'caller_event', fromPinId: 'exec', toNodeId: 'caller_call', toPinId: 'exec_in' },
        { id: 'caller_arg', fromNodeId: 'caller_literal', fromPinId: 'value', toNodeId: 'caller_call', toPinId: 'arg_0' },
      ],
    },
  ];
  const result = compileProject(project);
  assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
  const story = result.files['game/story.rpy'];
  assert.match(story, /label vn_blueprint_bp_target\(vn_bp_in_bp_target_threshold=2\):/);
  assert.match(story, /call vn_blueprint_bp_target\(7\)/);
  assert.match(story, /\$ vn_var_trust = vn_bp_in_bp_target_threshold/);
});

test('blueprint call signatures expose typed outputs to the caller graph', () => {
  const project = fixture();
  project.blueprints = [
    {
      id: 'bp_target_out', name: '带返回值函数', kind: 'function',
      exposedInputs: [{ id: 'amount', name: '数量', direction: 'input', dataType: 'number', required: false, defaultValue: 1 }],
      exposedOutputs: [{ id: 'result', name: '结果', direction: 'output', dataType: 'number', required: false, defaultValue: 0 }],
      nodes: [
        { id: 'target_out_event', type: 'event', name: '事件', x: 0, y: 0, pins: [{ id: 'exec', name: '执行', direction: 'output', dataType: 'exec', required: false }], properties: {}, collapsed: false },
        { id: 'target_out_input', type: 'getInput', name: '读取数量', x: 100, y: 0, pins: [{ id: 'value', name: '值', direction: 'output', dataType: 'number', required: false }], properties: { inputId: 'amount' }, collapsed: false },
        { id: 'target_out_set', type: 'setOutput', name: '写入结果', x: 260, y: 0, pins: [
          { id: 'exec_in', name: '执行', direction: 'input', dataType: 'exec', required: false },
          { id: 'value', name: '值', direction: 'input', dataType: 'number', required: true },
          { id: 'exec_out', name: '完成', direction: 'output', dataType: 'exec', required: false },
        ], properties: { outputId: 'result' }, collapsed: false },
      ],
      links: [
        { id: 'target_out_exec', fromNodeId: 'target_out_event', fromPinId: 'exec', toNodeId: 'target_out_set', toPinId: 'exec_in' },
        { id: 'target_out_value', fromNodeId: 'target_out_input', fromPinId: 'value', toNodeId: 'target_out_set', toPinId: 'value' },
      ],
    },
    {
      id: 'bp_caller_out', name: '读取返回值', kind: 'function', exposedInputs: [], exposedOutputs: [],
      nodes: [
        { id: 'caller_out_event', type: 'event', name: '事件', x: 0, y: 0, pins: [{ id: 'exec', name: '执行', direction: 'output', dataType: 'exec', required: false }], properties: {}, collapsed: false },
        { id: 'caller_out_literal', type: 'literal', name: '参数', x: 100, y: 100, pins: [{ id: 'value', name: '值', direction: 'output', dataType: 'number', required: false }], properties: { value: 7 }, collapsed: false },
        { id: 'caller_out_call', type: 'callFunction', name: '调用', x: 260, y: 0, pins: [
          { id: 'exec_in', name: '执行', direction: 'input', dataType: 'exec', required: false },
          { id: 'arg_amount', name: '数量', direction: 'input', dataType: 'number', required: false },
          { id: 'exec_out', name: '完成', direction: 'output', dataType: 'exec', required: false },
          { id: 'out_result', name: '结果', direction: 'output', dataType: 'number', required: false },
        ], properties: { graphId: 'bp_target_out' }, collapsed: false },
        { id: 'caller_out_delay', type: 'delay', name: '等待返回值', x: 460, y: 0, pins: [
          { id: 'exec_in', name: '执行', direction: 'input', dataType: 'exec', required: false },
          { id: 'seconds', name: '秒数', direction: 'input', dataType: 'number', required: false },
          { id: 'exec_out', name: '完成', direction: 'output', dataType: 'exec', required: false },
        ], properties: {}, collapsed: false },
      ],
      links: [
        { id: 'caller_out_exec', fromNodeId: 'caller_out_event', fromPinId: 'exec', toNodeId: 'caller_out_call', toPinId: 'exec_in' },
        { id: 'caller_out_arg', fromNodeId: 'caller_out_literal', fromPinId: 'value', toNodeId: 'caller_out_call', toPinId: 'arg_amount' },
        { id: 'caller_out_next', fromNodeId: 'caller_out_call', fromPinId: 'exec_out', toNodeId: 'caller_out_delay', toPinId: 'exec_in' },
        { id: 'caller_out_result', fromNodeId: 'caller_out_call', fromPinId: 'out_result', toNodeId: 'caller_out_delay', toPinId: 'seconds' },
      ],
    },
  ];
  const result = compileProject(project);
  assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
  const story = result.files['game/story.rpy'];
  assert.match(story, /default vn_bp_out_bp_target_out_result = 0/);
  assert.match(story, /label vn_blueprint_bp_target_out\(vn_bp_in_bp_target_out_amount=1\):[\s\S]*\$ vn_bp_out_bp_target_out_result = vn_bp_in_bp_target_out_amount/);
  assert.match(story, /call vn_blueprint_bp_target_out\(7\)[\s\S]*\$ vn_bp_result_caller_out_call_result = vn_bp_out_bp_target_out_result[\s\S]*pause vn_bp_result_caller_out_call_result/);
});

test('custom minigame definitions bind a reusable UI page and blueprint', () => {
  const project = fixture();
  project.ui.customPages = [{ id: 'game_page', name: '自定义玩法页', components: [{ id: 'game_button', page: 'custom', kind: 'button', text: '完成', action: 'minigameSuccess', x: 0.4, y: 0.75, width: 0.2, height: 0.1 }], modal: true }];
  project.minigames = [{ id: 'game', name: '自定义玩法', mode: 'blueprint', blueprintId: 'bp_game', uiPageId: 'game_page' }];
  project.blueprints = [{ id: 'bp_game', name: '玩法蓝图', kind: 'minigame', nodes: [{ id: 'event', type: 'event', name: '开始', x: 0, y: 0, pins: [{ id: 'exec', name: '开始', direction: 'output', dataType: 'exec', required: false }], properties: {}, collapsed: false }], links: [], exposedInputs: [], exposedOutputs: [] }];
  project.nodes.push({ id: 'custom_game', sceneId: 'scene', name: '自定义玩法', x: 200, y: 0, kind: 'minigame', template: 'custom', title: '自定义玩法', prompt: '完成挑战', password: '', caseSensitive: false, attempts: 1, targetClicks: 1, timeLimit: 60, minigameId: 'game', success: 'end', failure: 'end', cancel: 'end' });
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
  assert.match(compiled.files['game/screens.rpy'], /screen vn_minigame_custom/);
  assert.match(compiled.files['game/story.rpy'], /call screen vn_minigame_custom/);
});

test('nested conditions use typed Python literals and declared persistence', () => {
  assert.equal(pythonLiteral(true), 'True');
  assert.equal(pythonLiteral(false), 'False');
  assert.equal(conditionExpression(fixture(), { kind: 'all', conditions: [] }), 'True');
  assert.equal(conditionExpression(fixture(), { kind: 'any', conditions: [] }), 'False');
  assert.equal(conditionExpression(fixture(), { kind: 'not', condition: { kind: 'compare', variableId: 'unlocked', operator: 'eq', value: true } }), '(not (persistent.vn_var_unlocked == True))');
});

test('preview uses an isolated save identity and validates its entry and variable types', () => {
  const project = fixture();
  const normal = compileProject(project);
  const preview = compileProject(project, { development: true, preview: { entryId: 'choice', variables: { trust: 4, unlocked: true } } });
  assert.deepEqual(preview.diagnostics.filter(item => item.severity === 'error'), []);
  assert.match(normal.files['game/options.rpy'], /config.save_directory = "vns_fixture"/);
  assert.match(preview.files['game/options.rpy'], /config.save_directory = "vns_fixture_preview"/);
  assert.match(preview.files['game/story.rpy'], /label start:\n    stop music fadeout 0\n    \$ vn_performance_reset\(\)\n    \$ vn_actor_reset_transitions\(\)\n    \$ vn_var_trust = 4\n    \$ persistent.vn_var_unlocked = True\n    jump vn_node_choice/);
  for (const options of [{ preview: { entryId: 'missing' } }, { preview: { variables: { trust: 'bad type' } } }]) {
    const result = compileProject(project, options);
    assert.ok(result.diagnostics.some(item => item.severity === 'error'));
    assert.deepEqual(result.files, {});
  }
});

test('invalid project identifiers cannot become generated Python or labels', () => {
  const project = fixture();
  project.nodes[0].id = 'start:\n    $ renpy.quit()';
  const result = compileProject(project);
  assert.ok(result.diagnostics.some(item => item.severity === 'error'));
  assert.deepEqual(result.files, {});
});

test('runtime inspection is emitted only for development builds', () => {
  const release = compileProject(fixture()).files['game/story.rpy'];
  const preview = compileProject(fixture(), { development: true }).files['game/story.rpy'];
  assert.doesNotMatch(release, /VNS_EVENT:|_vn_debug_emit|interact_callbacks/);
  assert.match(preview, /print\("VNS_EVENT:" \+ message, flush=True\)/);
  assert.match(preview, /"trust": vn_var_trust/);
  assert.match(preview, /"unlocked": persistent.vn_var_unlocked/);
});

test('custom UI exports its asset and command without developer filesystem paths', () => {
  const project = fixture();
  project.ui.components = [
    { id: 'load_button', page: 'main', kind: 'button', text: '继续', action: 'load', x: 0.5, y: 0.5, width: 0.2, height: 0.1 },
    { id: 'portrait_image', page: 'say', kind: 'image', assetId: 'portrait', text: '', x: 0.02, y: 0.5, width: 0.2, height: 0.3 },
  ];
  const screens = compileProject(project).files['game/screens.rpy'];
  assert.match(screens, /id "vn_component_load_button"[\s\S]*?action ShowMenu\("load"\)/);
  assert.match(screens, /vn_ui_surface\(\{"idle": "assets\/portrait\.png", "fit": "contain"\}/);
  for (const name of ['save', 'load', 'preferences', 'history', 'gallery', 'music_room', 'confirm', 'quick_menu']) assert.ok(screens.includes(`screen ${name}(`));
});

test('custom choice, save, and preference components preserve native actions and replacement slots', () => {
  const project = fixture();
  const geometry = { x: 0.1, y: 0.3, width: 0.8, height: 0.5, text: '' };
  project.ui.components = [
    { ...geometry, id: 'choices_ui', page: 'choice', kind: 'choiceList', style: { background: '#125d46', textColor: '#ffffff', fontSize: 22, opacity: 0.9, align: 'right' } },
    { ...geometry, id: 'slots_ui', page: 'save', kind: 'saveSlots' },
    { ...geometry, id: 'music_ui', page: 'preferences', kind: 'preference', preference: 'musicVolume' },
    { ...geometry, id: 'back_ui', page: 'preferences', kind: 'button', action: 'return', text: 'Return' },
    { ...geometry, id: 'dialogue_ui', page: 'say', kind: 'text', binding: 'dialogue' },
  ];
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
  const screens = compiled.files['game/screens.rpy'];
  assert.match(screens, /use vn_components_choice\(items\)/);
  assert.match(screens, /use vn_choice_items\(items, max\(1, int\(vn_ui_get\("choices_ui", "width"\)/);
  assert.match(screens, /vn_ui_get\("choices_ui", "height"\)/);
  assert.match(screens, /action item.action/);
  assert.match(screens, /action FileAction\(slot\)/);
  assert.match(screens, /use vn_preference_slider\("musicVolume", None,[^\n]+"vn_component_music_ui", component_id="music_ui"\)/);
  assert.match(screens, /value \(VnParameterValue\(parameter_id, reverse=options.get\("reverse", False\), component_id=component_id\) if parameter_id else VnPreferenceValue\(key, character_id, reverse=options.get\("reverse", False\), component_id=component_id\)\)/);
  assert.equal((screens.match(/text what id "what"/g) ?? []).length, 2);
  assert.match(screens, /else:\n(?:\s+#[^\n]*\n)*\s+vn_dialogue_text what id "what" color "#00000000" size 1/);
  assert.match(screens, /null height 72/);
});

test('UI schema rejects misplaced native controls and invalid style values', () => {
  const base = { id: 'control', text: '', x: 0.1, y: 0.1, width: 0.5, height: 0.3 };
  assert.equal(uiComponentSchema.safeParse({ ...base, kind: 'text', page: 'main' }).success, true);
  for (const invalid of [
    { kind: 'choiceList', page: 'main' },
    { kind: 'saveSlots', page: 'choice' },
    { kind: 'preference', page: 'preferences' },
    { kind: 'text', page: 'main', binding: 'dialogue' },
    { kind: 'text', page: 'say', style: { opacity: 2 } },
  ]) assert.equal(uiComponentSchema.safeParse({ ...base, ...invalid }).success, false);
});

test('music used through a reusable effect is available in the music room', () => {
  const project = fixture();
  project.effects = [{ id: 'scene_music', name: '场景音乐', commands: [], actions: [{ kind: 'music', assetId: 'music', loop: true, fade: 0.5 }] }];
  for (const node of project.nodes) if (node.kind === 'passage') for (const line of node.lines) line.actions = line.actions.map(action => action.kind === 'music' ? { kind: 'effect', effectId: 'scene_music' } : action);
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
  assert.match(compiled.files['game/screens.rpy'], /\("音乐", "assets\/music.opus"\)/);
});

test('music room discovers inherited scene entry music', () => {
  const project = fixture();
  project.effects = [{ id: 'scene_music', name: '场景音乐', commands: [], actions: [{ kind: 'music', assetId: 'music', loop: true, fade: 0.5 }] }];
  project.scenes.unshift({ id: 'scene_base', name: '基础场景', chapterId: 'chapter', entryActions: [{ kind: 'effect', effectId: 'scene_music' }] });
  project.scenes.find(scene => scene.id === 'scene')!.baseSceneId = 'scene_base';
  for (const node of project.nodes) if (node.kind === 'passage') for (const line of node.lines) line.actions = line.actions.filter(action => action.kind !== 'music');
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
  assert.match(compiled.files['game/screens.rpy'], /\("音乐", "assets\/music.opus"\)/);
});
