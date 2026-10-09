import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject } from '../src/core/model';
import { compileProject } from '../src/runtime/compiler';

test('new stories and previews stop menu music before entering the selected story, while retaining authored BGM', () => {
  const project = createProject();
  project.assets.push({ id: 'story_music', kind: 'audio', name: 'Story', path: 'story.ogg' });
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines = [{ id: 'first', text: 'First line', actions: [{ kind: 'music', assetId: 'story_music', loop: true, fade: .5 }] }];
  for (const options of [{}, { preview: { entryId: passage.id } }]) {
    const built = compileProject(project, options);
    assert.deepEqual(built.diagnostics.filter(issue => issue.severity === 'error'), []);
    assert.match(built.files['game/story.rpy'], /label start:\n    stop music fadeout 0\n/);
    assert.match(built.files['game/story.rpy'], /play music "story\.ogg" loop fadein 0\.5/);
  }
});
