import { aiAnimationSelectionFixture } from './ai-animation-selection-fixture';
import { addUiAnimationTrack, createUiAnimationClip } from '../../src/core/ui-animation-clips';

export function aiAnimationTargetsFixture() {
  const { project, clips } = aiAnimationSelectionFixture(), base = clips[0];
  const controls = Array.from({ length: 10 }, (_, i) => ({ id: 'more_' + i, name: '动画控件 ' + i, kind: 'text' as const, page: 'main' as const, text: '控件 ' + i, x: .1, y: .1 + i * .06, width: .2, height: .05 }));
  project.ui.components.push(...controls); for (const control of controls) addUiAnimationTrack(base, control, 'x');
  const scopedControl = { id: 'scheme_text', name: '方案文字', kind: 'text' as const, page: 'preferences' as const, text: '方案文字', x: .2, y: .3, width: .4, height: .1 };
  project.ui.instances = [{ id: 'scheme', name: '另一套界面', components: [scopedControl] }]; project.ui.activeInstanceId = 'scheme';
  const scoped = createUiAnimationClip(project, 'ui:preferences'); scoped.name = '方案动画'; scoped.duration = 3; addUiAnimationTrack(scoped, scopedControl, 'opacity').keys[1].value = .4;
  const customControl = { ...scopedControl, id: 'custom_text', page: 'custom' as const };
  project.ui.customPages.push({ id: 'custom_animation_page', name: '自定义动画页', modal: false, components: [customControl] });
  const custom = createUiAnimationClip(project, 'custom_animation_page'); custom.name = '自定义动画'; custom.duration = 4; addUiAnimationTrack(custom, customControl, 'x').keys[1].value = .6;
  return { project, base, sameName: clips[1], scoped, custom };
}
