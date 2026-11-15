import { createProject, uiComponentSchema, uiInstanceSchema } from '../../src/core/model';
import { createUiEventGraph } from '../../src/core/ui-logic';

export function createUiPageSettingsFixture() {
  const project = createProject('独立页面设置验收');
  project.width = 1280; project.height = 720;
  project.ui.fontSize = 26; project.ui.textColor = '#e6eeec'; project.ui.accent = '#bc8748';
  project.playerDefaults = { masterVolume: .7, musicVolume: .4 };
  project.variables.push({ id: 'page_unlocked', name: '已解锁', type: 'boolean', initial: false, persistent: false, parameterSetId: 'parameters_story' });
  const control = (id: string, page: 'main' | 'preferences' | 'custom', text: string, x = .12, y = .14) => uiComponentSchema.parse({ id, page, kind: 'text', text, x, y, width: .56, height: .16 });
  project.ui.components = [control('page_main_text', 'main', '当前页面的默认外观'), { ...control('page_main_button', 'main', '打开设置', .14, .48), kind: 'button', action: 'preferences', width: .3, height: .1 }, { ...control('page_main_start', 'main', '开始', .14, .68), kind: 'button', action: 'start', width: .3, height: .1 }, control('page_preferences_text', 'preferences', '此页使用自己的默认值', .18, .4)];
  project.ui.pages = { main: { layout: 'custom', appearance: { fontSize: 30, textColor: '#b8d9df' } } };
  project.ui.customPages = ['page_notes', 'page_overlay'].map((id, index) => ({ id, name: index ? '提示浮层' : '说明页面', modal: !index, components: [control(id + '_text', 'custom', index ? '另一页独立配置' : '本页临时状态与参数'), { ...control(id + '_close', 'custom', '关闭', .5, .72), kind: 'button' as const, action: 'return' as const, width: .24, height: .1 }] }));
  const inherited = createUiEventGraph(project, 'ui:main', '基础标题');
  project.ui.instances = [uiInstanceSchema.parse({ id: 'page_scheme', name: '派生方案', parameters: { fontSize: 28 } })];
  project.ui.activeInstanceId = 'page_scheme';
  project.ui.animations = [{ id: 'page_theme_animation', name: '页面外观动画预览', pageId: 'ui:main', uiInstanceId: 'page_scheme', duration: 1, tracks: [] }];
  return { project, inherited };
}
