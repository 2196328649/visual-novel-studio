import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type StageAction } from '../src/core/model';
import { chapterBlueprintPair, createChapterPerformance } from '../src/core/chapter-performances';
import { upgradeChapterPresetSlots } from '../src/core/chapter-preset-slots';
import { consolidateChapterPresets } from '../src/core/chapter-preset-catalog';
import { blueprintAssetFilter } from '../src/core/blueprint-assets';
import { commandPerformanceBlueprints } from '../src/core/builtin-performances';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { applyTextScript, textCommandAction, actionText } from '../src/core/text-script';
import { textAssistance } from '../src/core/text-completion';
import { performanceTargetAt, targetPerformance } from '../src/core/performance-workspace';
import { timelineCallPreviewProject } from '../src/core/timeline-call-preview';
import { validateProject } from '../src/core/validate';
const walk = (a: StageAction): StageAction[] => [a, ...(a.kind === 'visual' ? a.children?.flatMap(walk) ?? [] : [])];
function fixture() {
 const p = createProject();
 for (const id of ['back', 'overlay', 'mask', 'frame', 'picture', 'other']) p.assets.push({ id, name: id, kind: 'image', path: id + '.png' });
 for (const id of ['long', 'short']) p.assets.push({ id, name: id, kind: 'audio', category: 'sound', path: id + '.wav' });
 p.assets.push({ id: 'font', name: 'font', kind: 'font', path: 'font.ttf' }, { id: 'video', name: 'video', kind: 'video', path: 'video.webm' });
 p.ui.chapterTransition = { effect: 'ink', overlayId: 'overlay', maskId: 'mask', particles: true };
 p.ui.pages = { ...p.ui.pages, chapterTitle: { layout: 'custom', backgroundId: 'back' } };
 p.ui.components.push({ id: 'decor_frame', page: 'chapterTitle', kind: 'image', text: '装饰背景', assetId: 'frame', x: 0, y: 0, width: 1, height: 1 });
 p.ui.components = p.ui.components.filter(c => c.page !== 'chapterTitle' || c.kind !== 'chapterTitle');
 p.ui.components.push({ id: 'chapter_title', page: 'chapterTitle', kind: 'chapterTitle', text: '章节标题', x: .14, y: .445, width: .36, height: .12 });
 p.blueprints.push(...chapterBlueprintPair(createChapterPerformance(p, 'text', { kind: 'chapter', title: '醉梦', subtitle: '1645', soundId: 'long', duration: 7, backgroundId: 'back' })));
 return p;
}

test('text chapters retain all image layers and overrides reach their actual objects', () => {
 const p = fixture(), graph = p.blueprints[0];
 for (const name of ['章节背景', '笔触叠图', '笔触遮罩', '装饰背景']) assert.ok(graph.exposedInputs.some(p => p.name === name));
 const action = textCommandAction(p, '@章节进入演出文字版：章节背景=other，笔触叠图=picture，笔触遮罩=无，装饰背景=无，章节音效=无')!;
 const actions = expandPreviewActions(p, [action], previewActionContext(p));
 assert.equal(actions.some(a => a.kind === 'sound'), false);
 const objects = actions.flatMap(walk);
 assert.ok(objects.some(a => a.kind === 'visual' && a.name === '章节背景' && a.assetId === 'other'));
 assert.ok(objects.some(a => a.kind === 'visual' && a.name === '笔触遮罩层' && a.assetId === 'picture' && !a.maskAssetId));
 assert.ok(objects.some(a => a.kind === 'visual' && a.name === '装饰背景' && !a.assetId));
 assert.deepEqual(textCommandAction(p, actionText(p, action)), action);
 const sound = textCommandAction(p, '@章节进入演出文字版：章节音效=short')!;
 assert.deepEqual(expandPreviewActions(p, [sound], previewActionContext(p)).filter(a => a.kind === 'sound').map(a => a.assetId), ['short']);
});

test('nested previews keep an explicit empty sound instead of restoring the child default', () => {
 const p = fixture(), [owner, child] = p.blueprints, call = owner.nodes.find(n => n.type === 'callFunction')!;
 for (const id of ['', 'short']) {
  const preview = timelineCallPreviewProject(p, child.id, [{ graphId: owner.id, callNodeId: call.id }], { sound: id });
  const actions = expandPreviewActions(preview, [{ kind: 'blueprint', blueprintId: child.id }], previewActionContext(preview));
  assert.deepEqual(actions.filter(a => a.kind === 'sound').map(a => a.assetId), id ? [id] : []);
 }
});

test('a disconnected generated sound slot is repaired once without changing authored motion', () => {
 const p = fixture(), [owner, child] = p.blueprints, sound = child.nodes.find(n => n.type === 'playSound')!;
 delete owner.chapterPresetRevision;
 child.exposedInputs = child.exposedInputs.filter(p => p.id !== 'sound');
 child.links = child.links.filter(l => l.toNodeId !== sound.id || l.toPinId !== 'assetId');
 owner.links = owner.links.filter(l => l.toPinId !== 'arg_sound');
 const before = child.nodes.find(n => n.type === 'savedAction')!.properties.action;
 assert.equal(upgradeChapterPresetSlots(p), true);
 assert.equal(child.nodes.find(n => n.type === 'savedAction')!.properties.action, before);
 assert.equal(owner.exposedInputs.find(p => p.id === 'sound')!.defaultValue, '');
 assert.deepEqual(expandPreviewActions(p, [{ kind: 'blueprint', blueprintId: owner.id }], previewActionContext(p)).filter(a => a.kind === 'sound'), []);
 assert.deepEqual(expandPreviewActions(p, [{ kind: 'blueprint', blueprintId: owner.id, inputs: { sound: 'short' } }], previewActionContext(p)).filter(a => a.kind === 'sound').map(a => a.assetId), ['short']);
 assert.equal(upgradeChapterPresetSlots(p), false);
 assert.ok(projectSchema.safeParse(p).success);
});

test('generated chapter duplicates merge while per-chapter image arguments survive', () => {
 const p = fixture(); p.blueprints = [];
 for (let i = 0; i < 2; i++) {
  const g = createChapterPerformance(p, 'image', { kind: 'chapter', title: String(i), subtitle: '', duration: 7, titleImageId: i ? 'other' : 'picture', backgroundId: i ? 'picture' : 'back' });
  g.id = 'chapter_' + i; g.name = i ? '章节进入演出 2' : '章节进入演出'; delete g.callName;
  p.blueprints.push(...chapterBlueprintPair(g));
 }
 const parsed = applyTextScript(p, '@章节进入演出\n@独立演出：第一章\n@章节进入演出 2\n@独立演出：第二章');
 parsed.project.scriptText = { format: 'vns-text-1', content: '@章节进入演出 2\n@独立演出：第二章' };
 assert.equal(consolidateChapterPresets(parsed.project), true);
 assert.equal(parsed.project.blueprints.filter(g => g.chapterVariant === 'image').length, 1);
 const a = textCommandAction(parsed.project, parsed.project.scriptText.content.split('\n')[0])!;
 const objects = expandPreviewActions(parsed.project, [a], previewActionContext(parsed.project)).flatMap(walk);
 assert.ok(objects.some(o => o.kind === 'visual' && o.name === '章节标题' && o.assetId === 'other'));
 assert.equal(commandPerformanceBlueprints(parsed.project).filter(g => g.chapterVariant === 'image').length, 1);
 assert.equal(consolidateChapterPresets(parsed.project), false);
 assert.deepEqual(validateProject(parsed.project).filter(d => d.severity === 'error'), []);
});

test('chapter material pickers and completion use the actual nested media types', () => {
 const p = fixture(), graph = p.blueprints[0];
 for (const [name, kind] of [['章节音效', 'audio'], ['章节背景', 'image'], ['笔触遮罩', 'image'], ['装饰背景', 'image']]) {
  const pin = graph.exposedInputs.find(p => p.name === name)!;
  assert.equal(blueprintAssetFilter(p, graph, pin).kind, kind);
  const source = '@章节进入演出文字版：' + name + '=';
  const help = textAssistance(p, source, source.length, true)!;
  assert.equal(help.resource?.kind, kind);
  assert.ok(help.items.every(item => item.id === 'none' || p.assets.find(a => a.id === item.id)?.kind === kind));
 }
});

test('chapter consolidation retains presets used by UI and character hooks', () => {
 for (const hook of ['ui', 'character']) {
  const p = fixture(); p.blueprints = [];
  for (let i = 0; i < 2; i++) {
   const graph = createChapterPerformance(p, 'image', { kind: 'chapter', title: '', subtitle: '', duration: 7, titleImageId: i ? 'other' : 'picture', backgroundId: 'back' });
   graph.id = 'chapter_' + i; graph.name = i ? '章节进入演出 2' : '章节进入演出'; delete graph.callName;
   p.blueprints.push(...chapterBlueprintPair(graph));
  }
  if (hook === 'ui') p.ui.customPages.push({ id: 'hook_page', name: '章节页面', onShowBlueprintId: 'chapter_1', components: [], modal: true });
  else p.characters.push({ id: 'hook_actor', name: '角色', color: '#ffffff', expressions: [], blueprintId: 'chapter_1' });
  consolidateChapterPresets(p);
  assert.ok(p.blueprints.some(g => g.id === 'chapter_1'), hook);
  assert.equal(p.blueprints.find(g => g.id === 'chapter_1')!.exposedInputs.find(pin => pin.name === '章节题图')?.defaultValue, 'other');
 }
});

test('clicking a later blueprint call previews that invocation and its own arguments', () => {
 const p = fixture(), source = '@章节进入演出文字版：章节音效=long\n@章节进入演出文字版：章节音效=short\n@独立演出：两次';
 const parsed = applyTextScript(p, source), target = performanceTargetAt(parsed, 2)!;
 assert.equal(target.actionIndex, 1);
 assert.equal(targetPerformance(parsed.project, target)[0].kind, 'blueprint');
 assert.deepEqual(targetPerformance(parsed.project, target), [{ kind: 'blueprint', blueprintId: p.blueprints[0].id, inputs: { sound: 'short' } }]);
});
