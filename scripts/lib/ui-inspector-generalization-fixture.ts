import { createProject, projectSchema, type UiComponent } from '../../src/core/model';
import { builtinUiPages } from '../../src/core/ui-page-catalog';
import { componentNames } from '../../src/core/ui-names';
import { createUiEventGraph, ensureUiClickEvent } from '../../src/core/ui-logic';

/** A small authored project, never a copy of the author's game. Every schema kind
 * has one representative, with separate cases for missing and changing bindings. */
export function createUiInspectorGeneralizationFixture() {
  const project = createProject('通用控件属性面板验收');
  project.id = 'ui_inspector_generalization';
  project.width = 1280; project.height = 720;
  project.resourceSettings = { importMode: 'copy', directory: 'assets', ...project.resourceSettings, syncFolders: false };
  project.ui.pages = Object.fromEntries(Object.keys(builtinUiPages).map(page => [page, { layout: 'custom' }]));
  project.ui.fontSize = 28;
  project.variables = [
    { id: 'qa_number', name: '可调整数值', type: 'number', initial: 45, persistent: false, setting: { min: 0, max: 100, step: 5 } },
    { id: 'qa_text', name: '玩家姓名', type: 'string', initial: '访客', persistent: false },
    { id: 'qa_boolean', name: '显示提示', type: 'boolean', initial: true, persistent: false },
    { id: 'qa_option', name: '文字语言', type: 'string', initial: '中文', persistent: false, setting: { options: ['中文', '英文'] } },
    { id: 'qa_link_visible', name: '备用显示开关', type: 'boolean', initial: false, persistent: false },
  ];
  project.assets = Array.from({ length: 7 }, (_, index) => ({
    id: `qa_image_${index + 1}`, name: `本地检查图片 ${index + 1}`, kind: 'image' as const,
    category: 'ui' as const, path: `texture-${index + 1}.png`, width: 8, height: 8,
  }));
  const named = (id: string, kind: UiComponent['kind'], page: UiComponent['page'], values: Partial<UiComponent> = {}): UiComponent => ({
    id, kind, page, name: componentNames[kind] + ' · 验收', text: componentNames[kind],
    x: .1, y: .1, width: .8, height: .8, ...values,
  });
  const representatives = [
    named('qa_button_a', 'button', 'main', { name: '按钮 A', text: '打开设置', x: .06, y: .07, width: .32, height: .08, action: 'preferences', style: { background: '#aa3311', borderWidth: 4 } }),
    named('qa_text', 'text', 'main', { text: '默认透明的文字', x: .06, y: .22, width: .34, height: .09 }),
    named('qa_image', 'image', 'main', { x: .55, y: .22, width: .3, height: .18, assetId: 'qa_image_1', style: { imageFit: 'cover', opacity: .8, background: '#11223380' } }),
    named('qa_panel', 'panel', 'main', { x: .06, y: .51, width: .35, height: .2, layout: { version: 1, flow: 'horizontal', gap: 8, paddingLeft: 12 } }),
    named('qa_progress', 'progress', 'main', { x: .55, y: .56, width: .3, height: .07, value: .5 }),
    named('qa_video', 'video', 'main', { x: .06, y: .8, width: .32, height: .1 }),
    named('qa_spine', 'spine', 'main', { x: .55, y: .8, width: .32, height: .1 }),
    named('qa_slider', 'preference', 'preferences', { x: .08, y: .06, width: .72, height: .08, preference: 'musicVolume' }),
    named('qa_choice', 'preferenceChoice', 'preferences', { x: .08, y: .2, width: .72, height: .08, preference: 'skipAll', selector: { options: [{ label: '只跳已读', value: false }, { label: '允许全部', value: true }] } }),
    named('qa_save', 'saveSlots', 'save', { list: { columns: 2, rows: 2, captionMode: 'story', summaryFontSize: 23,
      chapter: { x: .08, y: .61, width: .82, height: .1 }, caption: { x: .08, y: .74, width: .82, height: .15 },
      number: { x: .03, y: .03, width: .15, height: .1 }, showLabels: true } }),
    named('qa_history', 'historyList', 'history', { list: { historyLayout: 'columns', historyNameWidth: 160, historyNameFontSize: 25 } }),
    named('qa_gallery', 'galleryGrid', 'gallery', { list: { assetIds: project.assets.map(asset => asset.id) } }),
    named('qa_music', 'musicTrackList', 'musicRoom'),
    named('qa_voice', 'voiceCollection', 'voiceCollection'),
    named('qa_flow', 'flowchart', 'flowchart', { list: { layout: 'flow' } }),
    named('qa_options', 'choiceList', 'choice'),
    named('qa_pause', 'pauseMenu', 'pause'),
    named('qa_chapters', 'chapterList', 'chapterSelect'),
    named('qa_title', 'chapterTitle', 'chapterTitle'),
    named('qa_message', 'messageBox', 'messageBox'),
    named('qa_staff', 'staffRoll', 'staff'),
    named('qa_keyboard', 'keyboard', 'keyboard'),
    named('qa_end', 'gameOver', 'gameOver'),
  ];
  const extras = [
    named('qa_button_b', 'button', 'main', { name: '按钮 B', text: '读取存档', x: .55, y: .07, width: .32, height: .08, action: 'load' }),
    named('qa_event_button', 'button', 'main', { name: '仅事件按钮', text: '执行事件', x: .55, y: .68, width: .3, height: .07 }),
    named('qa_panel_child', 'text', 'main', { name: '排列中的文字', text: '保留附加偏移', parentId: 'qa_panel', childLayer: 'foreground', x: .03, y: .04, width: .5, height: .6 }),
    named('qa_missing', 'preference', 'preferences', { name: '已删除参数的控件', x: .08, y: .35, width: .72, height: .08, parameterId: 'deleted_number' }),
    named('qa_input', 'preferenceChoice', 'preferences', { name: '参数输入', x: .08, y: .5, width: .72, height: .08, parameterId: 'qa_text', input: { placeholder: '请输入姓名', maxLength: 20 } }),
    named('qa_rebind', 'preferenceChoice', 'preferences', { name: '类型转换控件', x: .08, y: .66, width: .72, height: .08, parameterId: 'qa_number', controlRange: { min: 20, max: 80, step: 10 }, input: { placeholder: '保留输入设置', maxLength: 40 }, style: { textColor: '#abcdefff' } }),
  ];
  project.ui.components = [...representatives, ...extras];
  const passage = project.nodes.find(node => node.kind === 'passage');
  if (passage?.kind === 'passage') passage.lines[0].text = '这是存档对白摘要；关闭条目文字时本段和章节标题都应隐藏。';
  project.chapters[0].name = '验收章节';
  const eventGraph = createUiEventGraph(project, 'ui:main', '仅事件按钮的点击逻辑');
  ensureUiClickEvent(project, eventGraph, 'qa_event_button', 'ui:main');
  return { project: projectSchema.parse(project), representatives, componentIds: [...representatives, ...extras].map(component => component.id) };
}
