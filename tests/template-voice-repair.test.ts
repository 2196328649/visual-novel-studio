import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type Project } from '../src/core/model';
import { repairTemplateVoiceCollection, legacyTemplateVoiceArtwork, templateVoiceArtworkAssetIds, restoreTemplateVoiceArtwork } from '../src/core/template-repairs';
import { parseProject } from '../src/desktop/project-store';
import { availableUiPages } from '../src/core/ui-names';
import { validateProject } from '../src/core/validate';

function removedTemplate() {
  const project = createProject();
  project.ui.disabledPages = ['chapterSelect', 'voiceCollection', 'voiceSettings', 'staff', 'keyboard', 'gameOver'];
  project.ui.components = [
    { id: 'ai_gallery_items', kind: 'galleryGrid', page: 'gallery' },
    { id: 'ai_musicroom_items', kind: 'musicTrackList', page: 'musicRoom' },
    { id: 'ai_flowchart_items', kind: 'flowchart', page: 'flowchart' },
  ].map(component => ({ ...component, text: '', x: 0, y: 0, width: 1, height: 1 })) as Project['ui']['components'];
  return project;
}

test('the formerly restored empty buttons regain bundled artwork without changing layout or story', () => {
  const project = removedTemplate(); repairTemplateVoiceCollection(project);
  assert.ok(legacyTemplateVoiceArtwork(project));
  const items = project.ui.components.find(c => c.id === 'ai_voicecollection_items')!;
  items.x = .12; items.text = '我的收藏';
  const nodes = structuredClone(project.nodes);
  project.assets.push(...templateVoiceArtworkAssetIds.map(id => ({ id, name: id, kind: 'image' as const, path: 'assets/' + id + '.png' })));
  restoreTemplateVoiceArtwork(project);
  assert.ok(items.skin?.idle); assert.ok(items.list?.voiceFavoriteSkin?.idle); assert.equal(items.x, .12); assert.equal(items.text, '我的收藏');
  assert.ok(project.ui.components.some(c => c.id === 'ai_voicecollection_title'));
  assert.deepEqual(project.nodes, nodes); assert.equal(legacyTemplateVoiceArtwork(project), false);
});

test('old simplified template restores a usable empty voice page and both entry tabs without files', () => {
  const input = removedTemplate(), before = structuredClone(input), loaded = parseProject(input).project;
  assert.deepEqual(input, before);
  assert.ok(availableUiPages(loaded.ui).some(([id]) => id === 'voiceCollection'));
  assert.ok(loaded.ui.components.some(component => component.kind === 'voiceCollection'));
  assert.deepEqual(loaded.ui.components.filter(component => component.action === 'voiceCollection').map(component => component.page).sort(), ['gallery', 'musicRoom', 'voiceCollection']);
  assert.deepEqual(loaded.assets, []);
  assert.deepEqual(validateProject(loaded).filter(issue => issue.severity === 'error'), []);
  assert.ok(projectSchema.safeParse(loaded).success);
  assert.deepEqual(parseProject(loaded).project, loaded);
});

test('restored collection uses available original assets and omits unavailable artwork', () => {
  const project = removedTemplate();
  project.assets.push({ id: 'ai_ui_474abf89497a60f5', name: '收藏按钮', kind: 'image', path: 'button.png' });
  repairTemplateVoiceCollection(project);
  assert.equal(project.ui.components.find(component => component.id === 'ai_gallery_voicecollection')?.skin?.idle, 'ai_ui_474abf89497a60f5');
  assert.equal(project.ui.components.find(component => component.id === 'ai_gallery_voicecollection')?.skin?.hideText, true);
  assert.deepEqual(validateProject(project).filter(issue => issue.severity === 'error'), []);
});

test('authored disabled pages and authored voice components survive loading unchanged', () => {
  for (const project of [createProject(), removedTemplate()]) {
    project.ui.disabledPages ??= ['voiceCollection'];
    if (project.ui.components.length && !project.ui.pages?.voiceCollection) project.ui.components.push({ id: 'authored_voice', page: 'voiceCollection', kind: 'voiceCollection', text: '我的收藏', x: 0, y: 0, width: 1, height: 1 });
    const before = structuredClone(project);
    repairTemplateVoiceCollection(project);
    assert.deepEqual(project, before);
  }
  const pageOnly = removedTemplate(); pageOnly.ui.pages = { voiceCollection: { layout: 'native' } };
  const before = structuredClone(pageOnly); repairTemplateVoiceCollection(pageOnly); assert.deepEqual(pageOnly, before);
});
