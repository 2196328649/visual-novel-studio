import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { storyMenuEntries, storyVoiceEntries } from '../src/core/story-menu';
import { compileProject } from '../src/runtime/compiler';
import { validateProject } from '../src/core/validate';

test('chapter navigation skips empty scenes and preserves the real entry node', () => {
  const project = createProject();
  const firstScene = project.scenes[0];
  project.scenes.unshift({ ...firstScene, id: 'empty_scene', name: '空目录' });
  assert.equal(storyMenuEntries(project, 'chapterList')[0].nodeId, project.entryId);
  project.nodes[0].textHeading = false;
  assert.equal(storyMenuEntries(project, 'flowchart').some(entry => entry.id === project.nodes[0].id), true);
  const ending = project.nodes.find(node => node.kind === 'end');
  if (ending) { ending.textHeading = false; ending.flowchart = { visible: true }; assert.ok(storyMenuEntries(project, 'flowchart').some(entry => entry.id === ending.id)); }
});

test('voice collection uses bound speech and explicit audio choices without including unrelated music or images', () => {
  const project = createProject();
  project.assets = [{ id: 'voice', name: '录音', kind: 'audio', path: 'assets/voice.ogg' }, { id: 'music', name: '背景音乐', kind: 'audio', path: 'assets/music.ogg' }, { id: 'image', name: '界面图片', kind: 'image', path: 'assets/image.png' }];
  project.characters = [{ id: 'speaker', name: '苏怜烟', color: '#ffffff', expressions: [] }];
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines[0] = { id: 'line', speakerId: 'speaker', voiceId: 'voice', text: '等雨停了，我们再走。', actions: [] };
  const entries = storyVoiceEntries(project);
  assert.deepEqual(entries.map(entry => entry.id), ['voice']);
  assert.equal(entries[0].caption, '苏怜烟：等雨停了，我们再走。');
  assert.equal(entries[0].speakerId, 'speaker');
  passage.lines[0].text = '{b}原样的长对白{/b} [player] ' + '继续说下去。'.repeat(12);
  const longEntry = storyVoiceEntries(project)[0];
  assert.equal(longEntry.text, passage.lines[0].text);
  assert.ok(longEntry.text.length > longEntry.caption.length);
  const compiled = compileProject(project);
  assert.ok(compiled.files['game/01-vn-story-menu.rpy'].includes(JSON.stringify(passage.lines[0].text)));
});

test('history skin references validate and survive schema loading into both replay and favorite buttons', () => {
  const project = createProject();
  project.assets.push({ id: 'voice_button', name: '语音按钮', kind: 'image', path: 'assets/button.png' });
  project.ui.components.push({ id: 'history', page: 'history', kind: 'historyList', text: '', x: 0, y: 0, width: 1, height: 1, list: { historyLayout: 'columns', historyNameWidth: 165, voiceButtonSize: 49, voiceReplaySkin: { idle: 'voice_button' }, voiceFavoriteSkin: { selected: 'voice_button' } } });
  const loaded = projectSchema.parse(project);
  const result = compileProject(loaded);
  assert.deepEqual(result.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.match(result.files['game/screens.rpy'], /"voiceReplaySkin": \{"idle": "assets\/button.png"/);
  assert.match(result.files['game/screens.rpy'], /"voiceFavoriteSkin": \{"selected": "assets\/button.png"/);
  project.assets = [];
  assert.equal(validateProject(project).filter(issue => issue.message.includes('voice_button')).length, 2);
});
