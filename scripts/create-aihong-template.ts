import { simplifySample } from '../src/core/sample-cleanup';
import { addAihongMusic, aihongMusicTracks } from './lib/aihong-music';
import { addAihongUiSounds } from './lib/aihong-ui-sounds';
import { addAihongFlowStyles } from './lib/aihong-flow-styles';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetFiles, projectSchema, type Asset, type Project, type UiComponent, type UiSkin } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { validateProject } from '../src/core/validate';
import { UnityUi, type UnityObject, type UnityRect } from './lib/unity-ui';
import { importSpineAsset } from '../src/desktop/spine-import';
import { addAihongSettings } from './lib/aihong-settings';
import { aihongStoryAssets, populateAihongStory } from './lib/aihong-story';
import { addAihongPresentation, aihongPresentationAssets } from './lib/aihong-presentation';
import { organizeAihongResources } from './lib/aihong-resources';
import { addAihongPortraits } from './lib/aihong-portraits';
import { refineAihongFidelity } from './lib/aihong-fidelity';
import { addAihongMenus } from './lib/aihong-menus';
import { prepareAihongAuthoring } from './lib/aihong-authoring';
import { populateAihongGallery, type GallerySourceManifest } from './lib/aihong-gallery';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'artifacts/aihong-ui-assets');
const output = path.join(root, 'artifacts/aihong-template');
const ui = await UnityUi.load(path.join(root, 'artifacts/aihong-ui-inspection/2026-09-10-layout'));
if (process.argv.includes('--describe')) {
  const query = process.argv[process.argv.indexOf('--describe') + 1];
  for (const [name, node] of ui.nodes) {
    if (query ? name.startsWith(query) : name === 'Canvas-AdvUI/Gallery' || (name.startsWith('Canvas-AdvUI/Gallery/') && name.split('/').length < 5) || name === 'Canvas-AdvUI/Title/BG/Logo' || name === 'UI/MessageWindowManager/MessageWindow/RootChildren/MessageTexts/MessageText (1)') {
      const rect = ui.rectangle(node);
      console.log(JSON.stringify({ path: name, rectangle: [rect.x, rect.y, rect.width, rect.height].map(v => Math.round(v * 100) / 100), sprite: ui.localizedSprite(node)?.data.m_Name,
        text: ui.components(node).filter(c => c.data.m_fontAsset || c.class === 'UnityEngine.UI.Text').map(c => c.data.m_text ?? c.data.m_Text),
        actions: ui.components(node).filter(c => c.class === 'UnityEngine.UI.Button').flatMap(c => (c.data.m_OnClick?.m_PersistentCalls?.m_Calls ?? []).map((v: any) => v.m_MethodName)) }));
    }
  }
  process.exit(0);
}
type ExportedAsset = Asset & { source: { file: string; pathId: number }; sha256: string };
const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8')) as { assets: ExportedAsset[]; errors: unknown[] };
if (manifest.errors.length) throw new Error('Fix UI asset extraction errors before creating a template.');
const bySource = new Map(manifest.assets.map(asset => [ui.key(asset.source), asset]));
const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(root, 'resources/example/project.vns.json'), 'utf8')));
project.id = 'project_aihong_ui_template';
project.name = '哀鸿界面模板';
project.width = ui.width; project.height = ui.height;
project.ui = { accent: '#877647', background: '#e3dfca', textColor: '#292c26', fontSize: 32, dialogueHeight: 0.394, dialogueOpacity: 1, components: [], customPages: [], pages: { main: { layout: 'custom' }, say: { layout: 'custom', showQuickMenu: false } } };
for (const character of project.characters) character.name = character.name.replace(/\s*[（(]合成预览[）)]/g, '');
for (const node of project.nodes) if (node.kind === 'passage') for (const line of node.lines) line.actions = line.actions.filter(action => !['show', 'hide', 'animate'].includes(action.kind));
const used = new Map<string, ExportedAsset>();
const evidence: { componentId: string; original: string; rectangle: UnityRect }[] = [];
function asset(record: UnityObject | undefined): string {
  if (!record) throw new Error('Missing original image or font reference.');
  const exported = bySource.get(ui.key(record));
  if (!exported) throw new Error(`Asset was not exported: ${record.data.m_Name} (${ui.key(record)})`);
  used.set(exported.id, exported);
  return exported.id;
}
function namedAsset(name: string) {
  const found = manifest.assets.find(asset => asset.name === name);
  if (!found) throw new Error(`Missing named UI asset: ${name}`);
  used.set(found.id, found); return found.id;
}
function position(node: UnityObject, id: string) {
  const r = ui.rectangle(node);
  evidence.push({ componentId: id, original: ui.hierarchy(node), rectangle: r });
  if (r.width <= 0 || r.height <= 0 || r.x < -0.1 || r.y < -0.1 || r.x + r.width > ui.width + 0.1 || r.y + r.height > ui.height + 0.1) throw new Error(`UI bounds require a layout override: ${ui.hierarchy(node)} ${JSON.stringify(r)}`);
  return { x: Math.max(0, r.x / ui.width), y: Math.max(0, r.y / ui.height), width: Math.min(1, r.width / ui.width), height: Math.min(1, r.height / ui.height) };
}
function image(id: string, page: UiComponent['page'], original: string) {
  const node = ui.node(original);
  const image = ui.components(node).find(c => c.class === 'UnityEngine.UI.Image');
  const component: UiComponent = { id, page, kind: 'image', text: node.data.m_Name, assetId: asset(ui.localizedSprite(node)), ...position(node, id), style: { imageFit: image?.data.m_PreserveAspect ? 'contain' : 'stretch' } };
  project.ui.components.push(component);
  return component;
}
function skin(node: UnityObject): UiSkin {
  const states = { idle: 'normal', hover: 'highlighted', pressed: 'Pressed', selected: 'selected', disabled: 'disabled' } as const;
  const result: UiSkin = { fit: 'stretch', hideText: true };
  for (const [state, original] of Object.entries(states)) {
    const sprite = ui.localizedSprite(node, original);
    if (sprite) result[state as keyof typeof states] = asset(sprite);
  }
  return result;
}
function button(id: string, page: UiComponent['page'], original: string, action: NonNullable<UiComponent['action']>, text: string) {
  const node = ui.node(original);
  const component: UiComponent = { id, page, kind: 'button', action, text, skin: skin(node), ...position(node, id) };
  project.ui.components.push(component);
  return component;
}
function text(id: string, page: UiComponent['page'], original: string, binding: UiComponent['binding']) {
  const node = ui.node(original);
  const text = ui.components(node).find(c => c.data.m_fontAsset || c.data.m_FontData && typeof c.data.m_Text === 'string');
  if (!text) throw new Error(`Text component missing on ${original}`);
  const fontRecord = ui.reference(text.file, text.data.m_fontAsset ?? text.data.m_FontData?.m_Font);
  const fontName = fontRecord?.data.m_Name?.replace(/ SDF$/, '');
  const fontAssetId = fontName ? namedAsset(fontName) : undefined;
  const c = text.data.m_fontColor ?? text.data.m_Color ?? { r: 1, g: 1, b: 1 };
  const color = '#' + ['r', 'g', 'b'].map(k => Math.round(c[k] * 255).toString(16).padStart(2, '0')).join('');
  const component: UiComponent = { id, page, kind: 'text', text: '', binding, ...position(node, id), style: { fontSize: Math.round(text.data.m_fontSize ?? text.data.m_FontData?.m_FontSize ?? 32), fontAssetId, textColor: color, align: 'left' } };
  project.ui.components.push(component);
  return component;
}

project.ui.fontAssetId = namedAsset('SourceHanSerifCN-Regular');
const title = 'Canvas-AdvUI/Title';
const titleBackground = image('ai_title_background', 'main', title);
titleBackground.text = '标题背景';
const spine = await importSpineAsset(output, path.join(root, 'artifacts/aihong-spine/skeleton.json'), path.join(root, 'artifacts/aihong-spine/skeleton.atlas'));
spine.name = '标题骨骼动画';
project.ui.components.push({ id: 'ai_title_animation', page: 'main', kind: 'spine', text: '标题实时动画', assetId: spine.id, x: 0, y: 0, width: 1, height: 1,
  spine: { animation: 'idle', autoplay: true, loop: true, speed: 1, fit: 'manual', scale: 0.32, originX: 0.5, originY: (ui.height - 537) / ui.height } });
image('ai_title_logo', 'main', `${title}/BG/Logo`);
for (const [name, action, caption] of [['Start', 'start', '开始游戏'], ['Archive', 'load', '读取存档'], ['PlotMap', 'flowchart', '剧情流程图'], ['Gallery', 'gallery', '收藏'], ['ExtraStory', 'chapterSelect', '额外故事']] as const) {
  const component = button(`ai_title_${name.toLowerCase()}`, 'main', `${title}/ActionBtns/${name}/Btn`, action, caption);
  if (name === 'ExtraStory') { component.disabled = true; component.skin!.disabled = asset(ui.localizedSprite(ui.node(`${title}/ActionBtns/ExtraStory/Btn/Lock`))); }
}
button('ai_title_settings', 'main', `${title}/Config`, 'preferences', '设置');
button('ai_title_quit', 'main', `${title}/Exit`, 'quit', '退出游戏');

const dialogue = 'UI/MessageWindowManager/MessageWindow/RootChildren';
image('ai_dialogue_background', 'say', `${dialogue}/MessageWindowCanvas/Image`);
text('ai_dialogue_speaker', 'say', `${dialogue}/MessageTexts/NameText`, 'speaker');
text('ai_dialogue_text', 'say', `${dialogue}/MessageTexts/MessageText (1)`, 'dialogue');
// The original controller moves this icon to the end of the text at runtime.
// Use Ren'Py's native click-to-continue placement instead of its offscreen prefab position.
project.ui.continueIndicatorId = asset(ui.localizedSprite(ui.node(`${dialogue}/MessageTexts/MessageText (1)/IconRoot/IconBrPage`)));
project.ui.continueIndicatorWidth = 42;
// UtageUguiMainGame.Update routes Escape to OnTapConfig in the original game.
project.ui.menuShortcutPage = 'preferences';
const hud = 'Canvas-AdvUI/MainGame/Buttons';
for (const [name, action, caption] of [['PlotMap', 'flowchart', '剧情流程图'], ['Save', 'save', '保存进度'], ['Load', 'load', '读取存档'], ['Auto', 'auto', '自动播放'], ['Skip', 'skip', '跳过'], ['History', 'history', '对话历史'], ['Config', 'preferences', '设置'], ['HideUI', 'hideInterface', '隐藏界面']] as const) {
  button(`ai_dialogue_${name.toLowerCase()}`, 'say', `${hud}/${name}`, action, caption);
}

const gallery = 'Canvas-AdvUI/Gallery';
const cgIds = project.assets.filter(asset => asset.kind === 'image').map(asset => asset.id);
for (const [page, original, listKind] of [['gallery', 'CgGallery', 'galleryGrid'], ['musicRoom', 'SoundRoom', 'musicTrackList'], ['voiceCollection', 'VoiceCollection', 'voiceCollection']] as const) {
  project.ui.pages![page] = { layout: 'custom' };
  image(`ai_${page.toLowerCase()}_background`, page, gallery).text = '收藏页背景';
  image(`ai_${page.toLowerCase()}_title`, page, `${gallery}/${original}/Title`).text = '页面标题';
  for (const [tab, action, caption] of [['CgGallery', 'gallery', '画廊'], ['SoundRoom', 'music', '音乐室'], ['VoiceCollection', 'voiceCollection', '语音收藏'], ['ButtonBack', 'return', '返回']] as const) button(`ai_${page.toLowerCase()}_${tab.toLowerCase()}`, page, `${gallery}/TabButtons/${tab}`, action, caption);
  if (page === 'gallery') {
    const grid = ui.node(`${gallery}/CgGallery/GridPage_Layered`);
    project.ui.components.push({ id: 'ai_gallery_items', page, kind: listKind, text: 'CG 图鉴', ...position(grid, 'ai_gallery_items'), style: { fontSize: 26, textColor: '#302f2d' },
      skin: { idle: namedAsset('extra_data_gallery_bg'), disabled: namedAsset('extra_data_gallery_bg'), fit: 'stretch' },
      list: { columns: 4, rows: 2, gapX: 42, gapY: 30, itemWidth: 401, itemHeight: 226, showLabels: false, lockedAssetId: namedAsset('extra_data_gallery_nodata'), assetIds: cgIds } });
  } else {
    const grid = ui.node(`${gallery}/${original}/GridPage/Grid`);
    project.ui.components.push({ id: `ai_${page.toLowerCase()}_items`, page, kind: listKind, text: page === 'musicRoom' ? '音乐列表' : '语音收藏', ...position(grid, `ai_${page.toLowerCase()}_items`), style: { fontSize: 36, textColor: '#000000' },
      skin: { idle: namedAsset('extra_data_music_button_normal'), hover: namedAsset('extra_data_music_button_confirm'), pressed: namedAsset('extra_data_music_button_click'), selected: namedAsset('extra_data_music_button_click'), disabled: namedAsset('extra_data_music_button_nodata'), fit: 'stretch' },
      list: { columns: 2, gapX: 106.1, gapY: 13.4, itemWidth: 632, itemHeight: 108.77 } });
  }
}

const saveLoad = 'Canvas-AdvUI/SaveLoad';
project.ui.pages!.save = { layout: 'custom' };
image('ai_save_background', 'save', saveLoad).text = '存读档背景';
image('ai_save_title', 'save', `${saveLoad}/Save/Image`).saveMode = 'save';
image('ai_load_title', 'save', `${saveLoad}/Load/Image`).saveMode = 'load';
button('ai_save_back', 'save', `${saveLoad}/ButtonBack`, 'return', '返回');
const slot = ui.node(`${saveLoad}/GridPage/Grid/SaveLoadItem`);
const slotRect = ui.rectangle(slot);
const part = (name: string) => {
  const r = ui.rectangle(ui.node(`${saveLoad}/GridPage/Grid/SaveLoadItem/${name}`));
  return { x: Math.max(0, (r.x - slotRect.x) / slotRect.width), y: Math.max(0, (r.y - slotRect.y) / slotRect.height), width: r.width / slotRect.width, height: r.height / slotRect.height };
};
project.ui.components.push({ id: 'ai_save_slots', page: 'save', kind: 'saveSlots', text: '存档书签', x: 0, y: slotRect.y / ui.height, width: 1, height: (ui.height - slotRect.y - 22) / ui.height,
  skin: { idle: asset(ui.localizedSprite(slot)), disabled: asset(ui.localizedSprite(slot)), fit: 'stretch' },
  style: { fontSize: 27, textColor: '#242a26' },
  list: { columns: 5, rows: 1, itemWidth: 311, itemHeight: 713, gapX: 0, gapY: 0, navigation: 'bottom', showDelete: false, showLabels: true, captionMode: 'story',
    thumbnail: part('Root/CaptureImage'), thumbnailFrame: { ...part('Root/Image'), assetId: asset(ui.localizedSprite(ui.node(`${saveLoad}/GridPage/Grid/SaveLoadItem/Root/Image`))) },
    caption: part('Root/text'), number: part('Image_Number/no'),
    emptyAssetId: asset(ui.localizedSprite(ui.node(`${saveLoad}/GridPage/Grid/SaveLoadItem/Image_NoData`))),
    hoverOverlayId: asset(ui.localizedSprite(ui.node(`${saveLoad}/GridPage/Grid/SaveLoadItem/Image_HighLight`))),
  } });

// The template contains a short, editable demonstration story. Its content and
// unlocks are intentionally separate from the original game's story and saves.
addAihongSettings({ project, ui, image, button, text, asset, skin, position });

// Complete the menu family with the same authored assets used by the
// original game. These pages are intentionally ordinary components so users
// can move, replace, or rebind them in the UI editor after creating a copy.
const aihongSkin = (idle: string, hover = idle, pressed = hover, disabled = idle): UiSkin => ({
  idle: namedAsset(idle), hover: namedAsset(hover), pressed: namedAsset(pressed), selected: namedAsset(hover), disabled: namedAsset(disabled), fit: 'stretch', hideText: false,
});
const pageBackground = (page: UiComponent['page'], id: string, assetName: string, textLabel: string) => {
  project.ui.pages![page] = { ...(project.ui.pages![page] ?? {}), layout: 'custom' };
  project.ui.components.push({ id, page, kind: 'image', text: textLabel, assetId: namedAsset(assetName), x: 0, y: 0, width: 1, height: 1, style: { imageFit: 'stretch' } });
};
const pageTitle = (page: UiComponent['page'], id: string, assetName: string, x: number, y: number, width: number, height: number) => {
  project.ui.components.push({ id, page, kind: 'image', text: '页面标题', assetId: namedAsset(assetName), x, y, width, height, style: { imageFit: 'contain' } });
};
const menuButton = (page: UiComponent['page'], id: string, textLabel: string, action: NonNullable<UiComponent['action']>, x: number, y: number, width = 0.105, height = 0.067) => {
  project.ui.components.push({ id, page, kind: 'button', text: textLabel, action, x, y, width, height, skin: aihongSkin('sys_button_title_normal', 'sys_button_title_click') });
};

pageBackground('pause', 'ai_pause_background', 'sys_bg', '暂停背景');
pageTitle('pause', 'ai_pause_title', 'sys_title', 0.06, 0.06, 0.14, 0.27);
project.ui.components.push({ id: 'ai_pause_items', page: 'pause', kind: 'pauseMenu', text: '暂停菜单', x: 0.31, y: 0.24, width: 0.38, height: 0.56,
  skin: aihongSkin('sys_button_title_normal', 'sys_button_title_click'), list: { itemHeight: 74, gapY: 16 } });
menuButton('pause', 'ai_pause_back', '返回游戏', 'return', 0.82, 0.86, 0.105, 0.067);

pageBackground('history', 'ai_history_background', 'history_bg', '历史背景');
pageTitle('history', 'ai_history_title', 'history_title', 0.02, 0.02, 0.14, 0.27);
project.ui.components.push({ id: 'ai_history_items', page: 'history', kind: 'historyList', text: '对话历史', x: 0.09, y: 0.06, width: 0.78, height: 0.78,
  skin: aihongSkin('flowchart_data_bg_L'), style: { fontSize: 27, textColor: '#242a26' }, list: { gapY: 12 } });
menuButton('history', 'ai_history_back', '返回', 'return', 0.86, 0.86, 0.105, 0.067);

pageBackground('chapterSelect', 'ai_chapter_background', 'extra_bg', '章节背景');
pageTitle('chapterSelect', 'ai_chapter_title', 'extra_title_gallery', 0.02, 0.02, 0.25, 0.13);
project.ui.components.push({ id: 'ai_chapter_items', page: 'chapterSelect', kind: 'chapterList', text: '章节选择', x: 0.20, y: 0.23, width: 0.60, height: 0.58,
  skin: aihongSkin('extra_button_music_normal', 'extra_button_music_click'), style: { fontSize: 28, textColor: '#242a26' }, list: { itemHeight: 74, gapY: 12 } });
menuButton('chapterSelect', 'ai_chapter_back', '返回', 'return', 0.86, 0.86, 0.105, 0.067);

pageBackground('staff', 'ai_staff_background', 'extra_bg', '制作人员背景');
pageTitle('staff', 'ai_staff_title', 'extra_title_gallery', 0.02, 0.02, 0.25, 0.13);
project.ui.components.push({ id: 'ai_staff_roll', page: 'staff', kind: 'staffRoll', text: '制作人员名单', x: 0.20, y: 0.20, width: 0.60, height: 0.62,
  skin: aihongSkin('extra_button_staffroll_normal', 'extra_button_staffroll_click'), style: { fontSize: 28, textColor: '#242a26' } });
menuButton('staff', 'ai_staff_back', '返回', 'return', 0.86, 0.86, 0.105, 0.067);

pageBackground('flowchart', 'ai_flowchart_background', 'flowchart_bg', '流程图背景');
pageTitle('flowchart', 'ai_flowchart_title', 'flowchart_title', 0.02, 0.02, 0.14, 0.27);
project.ui.components.push({ id: 'ai_flowchart_items', page: 'flowchart', kind: 'flowchart', text: '剧情流程图', x: 0.16, y: 0.12, width: 0.72, height: 0.73,
  skin: aihongSkin('flowchart_data_bg_L', 'flowchart_data_bg_BE'), style: { fontSize: 25, textColor: '#242a26' }, list: { itemHeight: 64, gapY: 12 } });
menuButton('flowchart', 'ai_flowchart_back', '返回', 'return', 0.86, 0.86, 0.105, 0.067);

pageBackground('chapterTitle', 'ai_chapter_title_background', 'chapter_img_fg', '章节标题背景');
project.ui.components.push({ id: 'ai_chapter_title_text', page: 'chapterTitle', kind: 'chapterTitle', text: '章节标题', x: 0.20, y: 0.33, width: 0.60, height: 0.25,
  style: { fontSize: 52, textColor: '#ede6ce', align: 'center', outlineWidth: 2, outlineColor: '#1a211d' } });

// Context screens keep the original small-window treatment. Game interaction
// is authored through reusable custom pages and blueprints rather than a
// fixed mini-game template.
for (const [page, label, background] of [['keyboard', '键盘输入', 'smallwindow_b_bg'], ['gameOver', '游戏结束', 'smallwindow_b_bg']] as const) {
  const pageId = page.toLowerCase();
  pageBackground(page, `ai_${pageId}_background`, background, `${label}背景`);
  project.ui.components.push({ id: `ai_${pageId}_panel`, page, kind: page === 'gameOver' ? 'gameOver' : page, text: label, x: 0.22, y: 0.20, width: 0.56, height: 0.60,
    skin: aihongSkin('smallwindow_button_sure_normal', 'smallwindow_button_sure_click'), style: { fontSize: 30, textColor: '#242a26', align: 'center' } });
}
project.ui.pages!.choice = { layout: 'custom' };
project.ui.components.push({ id: 'ai_story_choices', page: 'choice', kind: 'choiceList', text: '剧情选项', x: 0.25, y: 0.34, width: 0.5, height: 0.26,
  skin: { idle: namedAsset('dialog_select_button_bg_normal'), hover: namedAsset('dialog_select_button_bg_click'), pressed: namedAsset('dialog_select_button_bg_click'), selected: namedAsset('dialog_select_button_bg_click'), fit: 'stretch' },
  style: { fontSize: 32, textColor: '#141b1b', background: '#dcd6c3', align: 'center' } });
addAihongMenus({ project, ui, asset, skin });
refineAihongFidelity({ project, ui, asset, skin, namedAsset });
await fs.mkdir(path.join(output, 'assets'), { recursive: true });
for (const a of project.assets) {
  await fs.mkdir(path.dirname(path.join(output, a.path)), { recursive: true });
  await fs.copyFile(path.join(root, 'resources/example', a.path), path.join(output, a.path));
}
for (const a of used.values()) {
  await fs.copyFile(path.join(source, a.path), path.join(output, a.path));
  project.assets.push({ id: a.id, name: a.name, kind: a.kind, path: a.path, width: a.width, height: a.height });
}
project.assets.push(spine);
populateAihongStory(project);
const storySource = process.env.VNS_AIHONG_ASSETS ?? 'E:/Project/Model/SLY/T/Assets/Resources/starveling';
for (const asset of aihongStoryAssets) {
  const relative = project.assets.find(item => item.id === asset.id)!.path;
  let bytes: Buffer;
  try { bytes = await fs.readFile(path.join(storySource, asset.source)); }
  catch { bytes = await fs.readFile(path.join(root, 'resources/templates/aihong', relative)); }
  await fs.mkdir(path.dirname(path.join(output, relative)), { recursive: true });
  await fs.writeFile(path.join(output, relative), bytes);
  if (asset.kind === 'image') {
    const target = project.assets.find(item => item.id === asset.id)!;
    target.width = bytes.readUInt32BE(16); target.height = bytes.readUInt32BE(20);
  }
}
addAihongPresentation(project);
for (const definition of aihongPresentationAssets) {
  const target = project.assets.find(asset => asset.id === definition.id)!;
  const sourceFile = path.join(process.env.VNS_AIHONG_PRESENTATION_ASSETS ?? 'E:/Project/Model/SLY/T/Assets', definition.source);
  let bytes: Buffer;
  try { bytes = await fs.readFile(sourceFile); }
  catch { bytes = await fs.readFile(path.join(root, 'resources/templates/aihong', target.path)); }
  await fs.writeFile(path.join(output, target.path), bytes);
  if (target.kind === 'image') { target.width = bytes.readUInt32BE(16); target.height = bytes.readUInt32BE(20); }
}
await addAihongPortraits(project, output, undefined, path.join(root, 'resources/templates/aihong'));
addAihongMusic(project);
for (const [index, [, name]] of aihongMusicTracks.entries()) {
  const id = project.ui.components.find(c => c.id === 'ai_musicroom_items')!.list!.assetIds![index];
  const target = project.assets.find(a => a.id === id)!;
  await fs.copyFile(path.join(process.env.VNS_AIHONG_PRESENTATION_ASSETS ?? 'E:/Project/Model/SLY/T/Assets', 'Resources/starveling/sound/BGM', name + '.ogg'), path.join(output, target.path));
}
await addAihongUiSounds(project, output);
organizeAihongResources(project);
prepareAihongAuthoring(project);
  simplifySample(project);
addAihongFlowStyles(project);
const valid = projectSchema.parse(project);
const errors = validateProject(valid).filter(item => item.severity === 'error');
if (errors.length) throw new Error(JSON.stringify(errors));
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(valid, null, 2) + '\n');
await fs.copyFile(path.join(root, 'docs/aihong-story-sample.md'), path.join(output, '示例说明.md'));
if (process.argv.includes('--bundle')) {
  const bundled = path.join(root, 'resources/templates/aihong');
  await fs.mkdir(bundled, { recursive: true });
  for (const relative of ['project.vns.json', ...valid.assets.flatMap(assetFiles)]) {
    const destination = path.join(bundled, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(output, relative), destination);
  }
  await fs.copyFile(path.join(root, 'docs/aihong-story-sample.md'), path.join(bundled, '示例说明.md'));
}
await fs.writeFile(path.join(output, 'layout-evidence.json'), JSON.stringify({ source: 'E:/Game/GAMES/TheLamentingGeese_Data', referenceResolution: [ui.width, ui.height], componentCount: valid.ui.components.length, components: evidence,
  animation: { componentId: 'ai_title_animation', type: 'Spine 4.2 real-time', source: 'artifacts/aihong-spine/source.json', authoredThrough: '普通骨骼素材导入、界面组件和蓝图节点' },
  limitations: ['额外故事展示锁定图片；原作解锁逻辑尚未移植。', '历史与语音收藏支持重播、收藏、筛选和角色音量；原作分类与完整解锁规则仍需逐页核对。', '章节与流程支持已读、锁定和确认重开；当前流程图采用目录列表，未恢复原作空间排布。', '尚无原作运行画面逐页截图对比。'] }, null, 2) + '\n');
console.log(JSON.stringify({ output, components: valid.ui.components.length, templateAssets: valid.assets.length, diagnostics: errors }, null, 2));
