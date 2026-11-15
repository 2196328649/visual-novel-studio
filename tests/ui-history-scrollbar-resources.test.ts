import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type UiComponent } from '../src/core/model';
import { validateProject } from '../src/core/validate';
import { removeContentSelection } from '../src/core/content-browser';
import { projectForExport } from '../src/core/export-assets';

const targets = ['track', 'idle', 'hover', 'pressed', 'selected', 'disabled'] as const;
type Target = typeof targets[number];

function fixture(target: Target) {
  const project = createProject('历史滚动条素材');
  const component: UiComponent = {
    id: 'history_items', kind: 'historyList', page: 'history', text: '', x: .1, y: .1, width: .8, height: .8,
    list: { historyScrollbar: {
      rect: { x: .97, y: 0, width: .03, height: 1 },
      ...(target === 'track' ? { trackId: 'scrollbar_image' } : { thumb: { [target]: 'scrollbar_image' } }),
    } },
  };
  project.ui.components = [component];
  return { project, component };
}

test('history scrollbar track and every thumb state require images with a navigable diagnostic', () => {
  for (const target of targets) for (const kind of ['missing', 'font', 'image'] as const) {
    const { project, component } = fixture(target);
    if (kind !== 'missing') project.assets.push({ id: 'scrollbar_image', name: '滚动条素材', kind, path: `assets/scrollbar.${kind === 'image' ? 'png' : 'ttf'}` });
    const diagnostics = validateProject(project).filter(item => item.message.startsWith('素材不存在或格式不匹配：'));
    assert.equal(diagnostics.length, kind === 'image' ? 0 : 1, `${target}/${kind}`);
    if (kind !== 'image') {
      assert.equal(diagnostics[0].severity, 'error');
      assert.deepEqual(diagnostics[0].ui, { page: 'history', componentId: component.id });
      assert.match(diagnostics[0].help!, /定位控件/);
    }
  }
});

test('history scrollbar references stay protected and exportable until the custom scrollbar is removed', () => {
  for (const target of targets) {
    const { project, component } = fixture(target);
    project.ui.disabledPages = ['gallery'];
    project.assets.push({ id: 'scrollbar_image', name: '滚动条素材', kind: 'image', path: 'assets/scrollbar.png' });
    const before = structuredClone(project);
    assert.throws(() => removeContentSelection(project, ['asset:scrollbar_image']), /仍被/, target);
    assert.deepEqual(project, before);
    assert.equal(projectForExport(project).assets[0]?.id, 'scrollbar_image', target);
    delete component.list!.historyScrollbar;
    assert.equal(projectForExport(project).assets.length, 0);
    assert.equal(removeContentSelection(project, ['asset:scrollbar_image']), 1);
  }
});
