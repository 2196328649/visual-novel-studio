import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema, type Project, type UiComponent } from '../../src/core/model';
import { applyTextScript, projectToText } from '../../src/core/text-script';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { storyMenuEntries } from '../../src/core/story-menu';
import { templateFlowSoftShadow } from '../../src/core/template-repairs';

export async function uiHierarchyFixture(directory: string) {
  const templateDirectory = path.resolve('resources/templates/aihong');
  const template = JSON.parse(await fs.readFile(path.join(templateDirectory, 'project.vns.json'), 'utf8')) as Project;
  const original = template.ui.components.find(c => c.id === 'ai_flowchart_items')!;
  const buttonSkin = template.ui.components.find(c => c.id === 'ai_title_archive')!.skin!;
  const seed = createProject('流程图框样式与界面子对象验收'); seed.width = 1920; seed.height = 1080;
  seed.ui.background = '#3c3c3c'; seed.ui.textColor = '#ffffff'; seed.ui.fontAssetId = original.style?.fontAssetId;
  const textStyle = { ...original.style, outlineOpacity: .2, ...templateFlowSoftShadow };
  seed.ui.flowStyles = [
    { id: 'main_style', name: '主线框', skin: structuredClone(original.skin), style: { ...textStyle } },
    { id: 'memory_style', name: '回忆框', skin: structuredClone(original.list!.flowChapterSkin), style: { ...textStyle } },
    { id: 'ending_style', name: '结局框', skin: structuredClone(original.list!.flowEndSkin), style: { ...textStyle } },
  ];
  const flow: UiComponent = { ...structuredClone(original), id: 'flow', name: '剧情流程图', style: textStyle, list: { ...original.list, itemWidth: 430, itemHeight: 90, gapX: 120, flowViewport: { x: 0, y: .14, width: 1, height: .65 }, flowShowControls: false, flowShowVerticalScrollbar: false, lockUnread: true, confirmJump: false } };
  seed.ui.pages = { main: { layout: 'custom', background: '#3c3c3c' }, flowchart: { layout: 'custom', background: '#3c3c3c' } };
  seed.ui.components = [
    { id: 'memory_button', name: '记忆按钮', kind: 'button', page: 'main', text: '记忆浮现', x: .2, y: .26, width: .23, height: .20, skin: structuredClone(buttonSkin), style: { opacity: .9 } },
    { id: 'button_background', name: '记忆背景', parentId: 'memory_button', childLayer: 'background', inheritState: true, kind: 'image', page: 'main', text: '', assetId: buttonSkin.idle, skin: structuredClone(buttonSkin), x: 0, y: 0, width: 1, height: 1, style: { imageFit: 'stretch' } },
    { id: 'ornament', name: '小装饰', parentId: 'button_background', childLayer: 'foreground', inheritState: true, kind: 'image', page: 'main', text: '', assetId: original.list?.flowCurrentMarker?.assetId, x: -.1, y: -.15, width: .25, height: .4, style: { opacity: .5, imageFit: 'contain' } },
    { id: 'spare_button', name: '独立按钮', kind: 'button', page: 'main', text: '新增背景测试', x: .65, y: .28, width: .22, height: .20, skin: structuredClone(buttonSkin) },
    { id: 'trace', name: '点击结果', kind: 'text', page: 'main', text: '等待点击', x: .1, y: .65, width: .8, height: .08, style: { fontSize: 36, textColor: '#ffffff' } },
    { id: 'open_flow', kind: 'button', page: 'main', text: '流程图', action: 'flowchart', x: .1, y: .83, width: .2, height: .08 },
    { id: 'flow_back', kind: 'button', page: 'flowchart', text: '返回', action: 'return', x: .03, y: .03, width: .12, height: .07 }, flow,
  ];
  const referenced = JSON.stringify(seed.ui);
  seed.assets = template.assets.filter(a => referenced.includes(a.id));
  const result = applyTextScript(seed, '#章节(样式=主线框):归\n旁白：主线正文。\n#章节(样式=回忆框):前尘旧梦\n旁白：回忆正文。\n#章节(样式=结局框):殊途\n旁白：结局正文。');
  if (result.issues.length) throw new Error(JSON.stringify(result.issues));
  const project = result.project;
  const graph = createBlueprintGraph('ui', '按钮点击验证'); graph.uiPageId = 'ui:main';
  const event = blueprintNodeDefaults('eventClick'), update = blueprintNodeDefaults('setUiProperty');
  event.properties.componentId = 'memory_button'; update.properties = { componentId: 'trace', property: 'text', value: '已点击一次' };
  graph.nodes = [event, update]; connectBlueprintPins(graph, event.id, 'exec', update.id, 'exec_in'); project.blueprints.push(graph);
  synchronizeBlueprintSignatures(project);
  project.scriptText = { format: 'vns-text-1', content: projectToText(project), performanceSyntax: 'explicit' };
  await fs.mkdir(directory, { recursive: true });
  for (const asset of project.assets) { const target = path.join(directory, asset.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(path.join(templateDirectory, asset.path), target); }
  const projectFile = path.join(directory, 'project.vns.json');
  await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project), null, 2));
  return { project, projectFile, entries: storyMenuEntries(project, 'flowchart') };
}
