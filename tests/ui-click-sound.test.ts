import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { uiClickSound } from '../src/core/ui-sound';
import { softShadowOutlines, uiTextOutlines, uiTextShadow } from '../src/core/ui-text-effects';
import { templateFlowSoftShadow } from '../src/core/template-repairs';
import { uiPropertyDefaults } from '../src/core/ui-properties';
import { compileProject } from '../src/runtime/compiler';
import { validateProject } from '../src/core/validate';

function withSounds() {
  const project = createProject();
  project.assets.push(...['theme', 'page', 'own'].map(id => ({ id, name: id, kind: 'audio' as const, category: 'sound' as const, path: `assets/${id}.ogg` })));
  project.ui.clickSoundId = 'theme';
  const button: UiComponent = { id: 'go', page: 'main', kind: 'button', text: '开始', x: 0, y: 0, width: .2, height: .1, action: 'start' };
  project.ui.components.push(button);
  return { project, button };
}

test('a click sound inherits from the theme and the page, and a control can replace or silence it', () => {
  const { project, button } = withSounds();
  assert.equal(uiClickSound(project), 'theme');
  assert.equal(uiClickSound(project, button), 'theme');
  button.clickSoundId = 'own';
  assert.equal(uiClickSound(project, button), 'own');
  button.clickSoundId = null;
  assert.equal(uiClickSound(project, button), undefined);
  button.clickSoundId = undefined;
  assert.equal(uiPropertyDefaults(project, [button]).go.clickSound, 'theme');
  button.clickSoundId = null;
  assert.equal(uiPropertyDefaults(project, [button]).go.clickSound, '');
});

test('click sound defaults reach the game and are checked like hover sounds', () => {
  const { project, button } = withSounds();
  project.ui.components.push({ id: 'map', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, clickSoundId: 'own', hoverSoundId: null, list: { layout: 'flow' } });
  const code = Object.values(compileProject(project).files).join('\n');
  assert.ok(code.includes('style.button.activate_sound = "assets/theme.ogg"'));
  assert.ok(code.includes('"clickSoundPath": "assets/own.ogg"'));
  assert.ok(code.includes('"hoverSoundPath": None'));
  assert.ok(!code.includes('"clickSoundPath": None'));
  button.clickSoundId = 'missing';
  project.ui.clickSoundId = 'also_missing';
  const problems = validateProject(project).map(item => item.message).join('\n');
  assert.ok(problems.includes('missing'));
  assert.ok(problems.includes('also_missing'));
});

test('shadow spread thickens the shadow before it softens, and only when asked', () => {
  assert.deepEqual(softShadowOutlines(4, '#000000', 1), softShadowOutlines(4, '#000000', 1, 0, 0, 0));
  const plain = softShadowOutlines(4, '#000000', 1), grown = softShadowOutlines(4, '#000000', 1, 0, 0, 3);
  assert.deepEqual(grown.map(item => item[0]), plain.map(item => item[0] + 3));
  assert.deepEqual(uiTextOutlines({ style: { shadowSpread: 3, shadowOpacity: .5 } }), [[3, '#00000080', 0, 0]]);
  assert.equal(uiTextShadow({ style: { shadowBlur: 7, shadowColor: '#000000', shadowOpacity: .4 } }, 1), '0px 0px 7px #00000066');
  assert.equal(uiTextShadow({ style: { shadowBlur: 7, shadowSpread: 2, shadowColor: '#000000', shadowOpacity: .4 } }, 1)!.split(', ').length, 8);
  const style = projectSchema.parse(JSON.parse(JSON.stringify({ ...createProject(), ui: { ...createProject().ui, components: [{ id: 'label', page: 'main', kind: 'text', text: 'x', x: 0, y: 0, width: 1, height: 1, style: { shadowSpread: 3 } }] } }))).ui.components[0].style;
  assert.equal(style?.shadowSpread, 3);
});

test('the bundled template uses the original game click sounds and a dark flow caption halo', () => {
  const template = projectSchema.parse(JSON.parse(readFileSync(new URL('../resources/templates/aihong/project.vns.json', import.meta.url), 'utf8')));
  const of = (id: string) => template.ui.components.find(component => component.id === id) ?? (template.ui.customPages ?? []).flatMap(page => page.components).find(component => component.id === id);
  assert.equal(template.ui.clickSoundId, 'ai_ui_click');
  assert.ok(['ai_ui_click', 'ai_ui_click_back', 'ai_ui_click_title'].every(id => template.assets.some(asset => asset.id === id && asset.kind === 'audio')));
  assert.equal(of('ai_title_start')?.clickSoundId, 'ai_ui_click_title');
  assert.equal(of('ai_save_back')?.clickSoundId, 'ai_ui_click_back');
  assert.equal(of('ai_dialogue_save')?.clickSoundId, undefined);
  assert.equal(of('ai_settings_skip_skipread')?.clickSoundId, null);
  assert.equal(of('ai_flowchart_items')?.clickSoundId, 'ai_ui_click_title');
  assert.equal(of('ai_flowchart_items')?.hoverSoundId, 'ai_ui_hover_highlight');
  for (const style of [of('ai_flowchart_items')?.style, ...(template.ui.flowStyles ?? []).map(item => item.style)]) assert.deepEqual([style?.shadowBlur, style?.shadowSpread, style?.shadowOpacity], [templateFlowSoftShadow.shadowBlur, templateFlowSoftShadow.shadowSpread, templateFlowSoftShadow.shadowOpacity]);
  assert.deepEqual(validateProject(template).filter(item => item.severity === 'error'), []);
});
