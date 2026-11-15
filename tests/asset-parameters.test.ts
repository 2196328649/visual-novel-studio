import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type Project, type UiComponent } from '../src/core/model';
import { addParameter, parameterAssetFromText, parameterAssetText, parameterDisplayValue, parameterKind, pasteParameter, setParameterKind, parametersResetWithSettings, gameParametersId, storyParametersId } from '../src/core/parameter-sets';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintNodeAssetFilter } from '../src/core/blueprint-assets';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { parseTextCondition, textCondition } from '../src/core/text-conditions';
import { validateProject } from '../src/core/validate';
import { compileProject } from '../src/runtime/compiler';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { uiBoundAssetId } from '../src/core/ui-asset-binding';
import { uiControlDefinition } from '../src/core/ui-control-properties';

function fixture() {
  const project = createProject('素材参数验收');
  project.assets.push(
    { id: 'avatar_a', name: '头像甲', kind: 'image', path: 'images/a.png' },
    { id: 'avatar_b', name: '头像乙', kind: 'image', path: 'images/b.png' },
    { id: 'theme_song', name: '主题曲', kind: 'audio', path: 'audio/theme.ogg' },
  );
  const avatarId = addParameter(project, storyParametersId, 'image');
  const avatar = project.variables.find(variable => variable.id === avatarId)!;
  avatar.name = '头像'; avatar.initial = 'avatar_a';
  const musicId = addParameter(project, storyParametersId, 'audio');
  const music = project.variables.find(variable => variable.id === musicId)!;
  music.name = '当前音乐';
  return { project, avatar, music };
}
/** Put commands after the first narration line of the default story. */
const insertAfterNarration = (text: string, commands: string) => { assert.ok(text.includes('旁白：\n')); return text.replace('旁白：\n', '旁白：\n' + commands + '\n'); };
const errors = (project: Project) => validateProject(project).filter(item => item.severity === 'error').map(item => item.message);

test('image, audio and video parameters store an asset id of their kind', () => {
  const { project, avatar, music } = fixture();
  assert.equal(avatar.type, 'asset'); assert.equal(avatar.assetKind, 'image'); assert.equal(parameterKind(avatar), 'image');
  assert.equal(music.type, 'asset'); assert.equal(music.assetKind, 'audio'); assert.equal(music.initial, '');
  assert.equal(parameterDisplayValue(project, avatar), '头像甲'); assert.equal(parameterDisplayValue(project, music), '无');
  assert.equal(projectSchema.safeParse(project).success, true);
  assert.deepEqual(errors(project), []);
  avatar.initial = 'theme_song';
  assert.ok(errors(project).some(message => message.includes('头像') && message.includes('图片')));
  avatar.initial = 'avatar_a';
  setParameterKind(avatar, 'number');
  assert.equal(avatar.type, 'number'); assert.equal(avatar.assetKind, undefined); assert.equal(avatar.initial, 0);
});

test('@设置 and @条件 write asset parameters by name and survive a round trip', () => {
  const { project, avatar, music } = fixture();
  const text = insertAfterNarration(projectToText(project), '@设置：头像 = 头像乙\n@设置：当前音乐 = 主题曲');
  const result = applyTextScript(project, text);
  assert.deepEqual(result.issues.filter(item => item.severity === 'error').map(item => item.message), []);
  const sets = result.project.nodes.filter(node => node.kind === 'set');
  assert.deepEqual(sets.map(node => node.kind === 'set' && [node.variableId, node.value]), [[avatar.id, 'avatar_b'], [music.id, 'theme_song']]);
  const rewritten = projectToText(result.project);
  assert.ok(rewritten.includes(`@设置：头像【${avatar.id}】 = "头像乙"`)); assert.ok(rewritten.includes(`@设置：当前音乐【${music.id}】 = "主题曲"`));
  const again = applyTextScript(result.project, rewritten);
  assert.deepEqual(again.project.nodes.filter(node => node.kind === 'set').map(node => node.kind === 'set' && node.value), ['avatar_b', 'theme_song']);
  const condition = parseTextCondition(project, '头像 == 头像乙');
  assert.deepEqual(condition, { kind: 'compare', variableId: avatar.id, operator: 'eq', value: 'avatar_b' });
  assert.match(textCondition(project, condition), /== "头像乙"$/);
  assert.throws(() => parseTextCondition(project, '头像 == 主题曲'), /未找到图片素材/);
  assert.throws(() => parseTextCondition(project, '头像 > 头像乙'), /数值参数/);
});

test('asset names resolve within their kind, with 无 and 名称【id】 for shared names', () => {
  const { project, avatar } = fixture();
  assert.equal(parameterAssetFromText(project, avatar, '无'), '');
  assert.equal(parameterAssetFromText(project, avatar, '"头像乙"'), 'avatar_b');
  assert.equal(parameterAssetFromText(project, avatar, '主题曲'), undefined);
  project.assets.push({ id: 'avatar_c', name: '头像乙', kind: 'image', path: 'images/c.png' });
  assert.equal(parameterAssetFromText(project, avatar, '头像乙'), undefined);
  assert.equal(parameterAssetText(project, avatar, 'avatar_c'), '头像乙【avatar_c】');
  assert.equal(parameterAssetFromText(project, avatar, '头像乙【avatar_c】'), 'avatar_c');
  assert.equal(parameterAssetText(project, avatar, ''), '无');
});

test('unknown asset names and += are reported instead of silently changing the parameter', () => {
  const { project } = fixture();
  const base = projectToText(project);
  const missing = applyTextScript(project, insertAfterNarration(base, '@设置：头像 = 不存在的图'));
  assert.ok(missing.issues.some(item => item.message.includes('未找到图片素材：不存在的图')));
  const add = applyTextScript(project, insertAfterNarration(base, '@设置：头像 += 头像乙'));
  assert.ok(add.issues.some(item => item.message.includes('只能用 = 设为某个素材')));
});

test('blueprints read an audio parameter into music playback, and kind mismatches are diagnosed', () => {
  const { project, avatar, music } = fixture();
  music.initial = 'theme_song';
  const graph = createBlueprintGraph('function', '播放当前音乐'); project.blueprints.push(graph);
  const read = blueprintNodeDefaults('getVariable', 1); read.properties.variableId = music.id; graph.nodes.push(read);
  const play = blueprintNodeDefaults('playMusic', 2); graph.nodes.push(play);
  const write = blueprintNodeDefaults('setVariable', 3); write.properties.variableId = avatar.id; graph.nodes.push(write);
  synchronizeBlueprintSignatures(project);
  assert.equal(read.pins.find(pin => pin.id === 'value')?.dataType, 'asset');
  assert.deepEqual(blueprintNodeAssetFilter(write, 'value', project), { kind: 'image', category: 'all' });
  assert.equal(connectBlueprintPins(graph, graph.nodes[0].id, 'exec', play.id, 'exec_in'), undefined);
  assert.equal(connectBlueprintPins(graph, read.id, 'value', play.id, 'assetId'), undefined);
  assert.deepEqual(validateBlueprints(project).filter(item => item.severity === 'error').map(item => item.message), []);
  const story = compileProject(project);
  assert.deepEqual(story.diagnostics.filter(item => item.severity === 'error'), []);
  assert.ok(story.files['game/story.rpy'].includes(`default vn_var_${music.id} = "theme_song"`));
  read.properties.variableId = avatar.id; synchronizeBlueprintSignatures(project);
  assert.ok(validateBlueprints(project).some(item => item.message.includes('素材类型不匹配') && item.message.includes('头像')));
});

test('an image component can follow an image parameter, falling back to its own image', () => {
  const { project, avatar } = fixture();
  const image: UiComponent = { ...project.ui.components[0], id: 'portrait', kind: 'image', page: 'main', text: '', assetId: 'avatar_b', assetParameterId: avatar.id, x: .1, y: .1, width: .2, height: .2 } as UiComponent;
  delete (image as Partial<UiComponent>).binding; delete (image as Partial<UiComponent>).action;
  project.ui.components.push(image);
  assert.deepEqual(errors(project), []);
  assert.equal(uiBoundAssetId(project, image, 'avatar_a'), 'avatar_a');
  assert.equal(uiBoundAssetId(project, image, ''), 'avatar_b');
  assert.equal(uiBoundAssetId(project, image, 'theme_song'), 'avatar_b');
  const preview = previewUiLogic(project, [image], 'ui:main', { [avatar.id]: 'avatar_a' });
  assert.equal(preview.components.find(row => row.component.id === 'portrait')?.component.assetId, 'avatar_a');
  const empty = previewUiLogic(project, [image], 'ui:main', { [avatar.id]: '' });
  assert.equal(empty.components.find(row => row.component.id === 'portrait')?.component.assetId, 'avatar_b');
  const output = compileProject(project);
  assert.deepEqual(output.diagnostics.filter(item => item.severity === 'error'), []);
  const runtime = Object.values(output.files).join('\n');
  assert.ok(runtime.includes(`"portrait": {"parameterId": "${avatar.id}", "kind": "image", "property": "image"}`));
  assert.match(runtime, /binding = vn_ui_asset_bindings\.get\(component_id\)/);
  image.assetParameterId = project.variables.find(variable => variable.name === '当前音乐')!.id;
  assert.ok(errors(project).some(message => message.includes('请选择图片参数')));
});

test('asset parameters have no player control, and repair stale saved assets at runtime', () => {
  const project = createProject('设置中的素材参数');
  project.assets.push({ id: 'skin_a', name: '皮肤甲', kind: 'image', path: 'images/skin.png' });
  const id = addParameter(project, gameParametersId, 'image'), variable = project.variables.find(item => item.id === id)!;
  variable.initial = 'skin_a';
  assert.equal(variable.persistent, true); assert.ok(parametersResetWithSettings(project).some(item => item.id === id));
  const control = { ...project.ui.components[0], id: 'skin_control', kind: 'preference', page: 'preferences', parameterId: id } as UiComponent;
  assert.equal(uiControlDefinition(project, control), undefined);
  project.ui.components.push(control);
  assert.ok(errors(project).some(message => message.includes('设置控件不能绑定图片参数')));
  project.ui.components.pop();
  const output = compileProject(project);
  assert.deepEqual(output.diagnostics.filter(item => item.severity === 'error'), []);
  const runtime = output.files['game/00-vn-parameters.rpy'];
  assert.doesNotMatch(runtime, /vn_parameter_groups|screen vn_parameter_settings\(/);
  assert.ok(runtime.includes(`vn_parameter_reset_ids = ["${id}"]`));
  assert.match(runtime, /isinstance\(value, str\) if kind in \("string", "asset"\)/);
  assert.match(runtime, /config\.after_load_callbacks\.append\(vn_parameter_repair_assets\)/);
});

test('empty music parameters skip playback instead of raising', () => {
  const { project, music } = fixture();
  const graph = createBlueprintGraph('function', '播放'); project.blueprints.push(graph);
  const read = blueprintNodeDefaults('getVariable', 1); read.properties.variableId = music.id; graph.nodes.push(read);
  const play = blueprintNodeDefaults('playMusic', 2); graph.nodes.push(play);
  synchronizeBlueprintSignatures(project);
  connectBlueprintPins(graph, graph.nodes[0].id, 'exec', play.id, 'exec_in'); connectBlueprintPins(graph, read.id, 'value', play.id, 'assetId');
  const output = Object.values(compileProject(project).files).join('\n');
  assert.match(output, new RegExp(`if vn_var_${music.id}:\\n\\s+\\$ renpy\\.music\\.play\\(vn_bp_asset\\(vn_var_${music.id}, "audio"\\), channel="music"`));
});

test('pasting an asset parameter into another project drops a missing asset', () => {
  const { project, avatar } = fixture();
  const other = createProject('另一个工程');
  const result = pasteParameter(other, { kind: 'variable', variable: avatar, projectId: project.id }, storyParametersId);
  const copy = other.variables.find(item => item.id === result.variableId)!;
  assert.equal(copy.type, 'asset'); assert.equal(copy.assetKind, 'image'); assert.equal(copy.initial, '');
});
