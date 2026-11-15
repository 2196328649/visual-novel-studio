import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type Project, type StoryLine } from '../src/core/model';
import { mutateProject } from '../src/core/project-mutation';
import { sameScriptRowContext } from '../src/core/script-row-context';
import { currentScriptText } from '../src/core/script-text';

function fixture() {
  const project = createProject();
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines.push({ id: 'other_line', text: '另一句', actions: [] });
  return project;
}
const lines = (project: Project) => project.nodes.find(node => node.kind === 'passage')!.lines;

test('sibling prose, line styles, marks and undo keep unrelated row controls reusable', () => {
  const project = fixture();
  for (const edit of [
    (line: StoryLine) => { line.text = '改字与换行\n😀'; },
    (line: StoryLine) => { line.textPresentation = { color: '#ff0000', sizeScale: 1.3 }; },
    (line: StoryLine) => { line.textSpans = [{ start: 0, end: 1, style: { bold: true } }]; },
    (line: StoryLine) => { line.textPauses = [{ at: 1, seconds: .3 }]; },
  ]) {
    const next = mutateProject(project, draft => { edit(lines(draft)[0]); draft.scriptText = currentScriptText('最新文本'); });
    assert.notEqual(lines(project)[0], lines(next)[0], 'the edited row must still receive a changed line');
    assert.equal(lines(project)[1], lines(next)[1]);
    assert.equal(sameScriptRowContext(project, next), true);
    assert.equal(sameScriptRowContext(next, project), true, 'undo has the same dependencies');
  }
});

test('stage choices, identities, order, resources and unknown fields refresh other rows', () => {
  const project = fixture();
  const changes: ((draft: Project) => void)[] = [
    draft => { lines(draft)[0].actions.push({ kind: 'pause', seconds: 1 }); },
    draft => { lines(draft)[0].speakerId = 'other'; },
    draft => { lines(draft)[0].silent = true; },
    draft => { lines(draft)[0].id = 'new_line'; },
    draft => { lines(draft).reverse(); },
    draft => { lines(draft).pop(); },
    draft => { draft.nodes.find(node => node.kind === 'passage')!.name = '新段落'; },
    draft => { draft.nodes.find(node => node.kind === 'passage')!.next = 'another'; },
    draft => { draft.characters.push({ id: 'new_character', name: '新角色', color: '#ffffff', expressions: [] }); },
    draft => { draft.assets.push({ id: 'font', name: '新字体', kind: 'font', path: 'font.ttf' }); },
    draft => { draft.ui.fontSize += 1; },
    draft => { draft.textPresets = [{ id: 'look', name: '预设', style: { bold: true } }]; },
    draft => { (lines(draft)[0] as unknown as Record<string, unknown>).futureField = true; },
  ];
  for (const change of changes) {
    const next = mutateProject(project, change);
    assert.equal(sameScriptRowContext(project, next), false, String(change));
    assert.equal(sameScriptRowContext(next, project), false, 'undo must refresh the same controls');
  }
});
