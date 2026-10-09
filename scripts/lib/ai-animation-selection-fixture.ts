import { createProject } from '../../src/core/model';
import { createUiAnimationClip, addUiAnimationTrack } from '../../src/core/ui-animation-clips';
import { createUiEventGraph } from '../../src/core/ui-logic';

export function aiAnimationSelectionFixture() {
  const project = createProject('控件动画AI选择验收'); project.ui.pages = { ...project.ui.pages, main: { layout: 'custom' } };
  const component = { id: 'animated_text', name: '状态文字', kind: 'text' as const, page: 'main' as const, text: '当前动画', x: .2, y: .3, width: .3, height: .1 };
  project.ui.components.push(component); createUiEventGraph(project, 'ui:main', '标题');
  const clips = [0, 1].map(() => {
    const clip = createUiAnimationClip(project, 'ui:main'); clip.name = '同名动画'; clip.duration = 2;
    addUiAnimationTrack(clip, component, 'x'); addUiAnimationTrack(clip, component, 'opacity');
    return clip;
  });
  return { project, clips };
}
