import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { exportSettings } from '../src/core/export-settings';
import { projectForExport } from '../src/core/export-assets';
import { textCommandAction } from '../src/core/text-script';
import { initialPreviewStage, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { repairTemplateHistory, historyTemplateAssets } from '../src/core/template-history';

test('interface commands survive schema and sample in timeline order', () => {
  const project = createProject();
  const hidden = textCommandAction(project, '@隐藏界面'), shown = textCommandAction(project, '@显示界面');
  assert.deepEqual(hidden, { kind: 'hideInterface' }); assert.deepEqual(shown, { kind: 'showInterface' });
  const before = initialPreviewStage(); before.dialogue = { id: 'previous', text: '保留对白', actions: [] };
  const plan = linePlaybackPlan(before, [{ kind: 'hideInterface' }, { kind: 'pause', seconds: 2 }, { kind: 'showInterface' }]);
  assert.equal(sampleLinePlayback(before, plan, 1000).state.interfaceVisible, false);
  assert.equal(sampleLinePlayback(before, plan, 2000).state.interfaceVisible, true);
  assert.equal(sampleLinePlayback(before, plan, 1000).state.dialogue?.text, '保留对白');
});

test('export uses work name while empty setting stays empty and prunes only safe resources', () => {
  const project = createProject('中文作品'); project.ui.disabledPages = ['gallery'];
  project.assets = [{ id: 'used', name: '使用', kind: 'image', path: 'assets/used.png' }, { id: 'unused', name: '闲置', kind: 'audio', path: 'assets/unused.ogg' }];
  project.ui.menuBackgroundId = 'used';
  assert.equal(exportSettings(project).fileName, '中文作品'); assert.equal(project.exportSettings, undefined);
  assert.deepEqual(projectForExport(project).assets.map(a => a.id), ['used']);
  assert.equal(project.assets.length, 2);
  project.assets.push({ id: 'script', name: '脚本', kind: 'script', path: 'assets/script.rpy' });
  assert.equal(projectForExport(project).assets.length, 3);
});

test('history repair targets the old bundled signature and preserves authored styles', () => {
  const project = createProject();
  project.assets = historyTemplateAssets.map((id, index) => ({ id, name: id, kind: index ? 'image' as const : 'font' as const, path: `assets/${id}` }));
  project.ui.components = [{ id: 'ai_history_items', page: 'history', kind: 'historyList', text: '', x: .086479187, y: 50 / 1080, width: .804145813, height: .796481493, style: { fontSize: 30 }, list: { historyLayout: 'columns', historyNameWidth: 165, gapX: 22, gapY: 18 } }];
  const authored = structuredClone(project); authored.ui.components[0].style!.fontSize = 42;
  repairTemplateHistory(authored); assert.equal(authored.ui.components[0].style!.fontSize, 42); assert.equal(authored.ui.components[0].list!.historyScrollbar, undefined);
  repairTemplateHistory(project); projectSchema.parse(project);
  assert.equal(project.ui.components[0].style!.fontAssetId, historyTemplateAssets[0]);
  assert.ok(project.ui.components[0].list!.historyScrollbar);
  const snapshot = structuredClone(project); repairTemplateHistory(project); assert.deepEqual(project, snapshot);
});
