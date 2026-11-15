import { useEffect, useState } from 'react';
import type { Project, UiButtonState, UiComponent, UiSkin } from '../core/model';
import { collectionLayoutValues, collectionPartDefaultRect, collectionSupports, isCollectionRect, type CollectionPart, type CollectionRect } from '../core/ui-collection-layout';
import { collectionInspectorParts, collectionInspectorPartName } from '../core/ui-collection-inspector';
import { collectionTextStyle, editCollectionTextStyle, type CollectionTextPart } from '../core/ui-collection-text';
import { setCollectionOption } from '../core/ui-collection-edit';
import { galleryEntries } from '../core/gallery';
import { musicRoomEntries } from '../core/music-preview';
import { storyVoiceEntries } from '../core/story-menu';
import { defaultVoiceRemoveMessage } from '../core/voice-preview';
import { uiFitNames, uiSkinAsset } from '../core/ui';
import { uiComponentTheme } from '../core/ui-page-settings';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { UiAssetSelect } from './AssetPicker';
import { UiDesignColorField } from './UiDesignColorField';
import { UiCollectionContentDialog } from './UiCollectionContentDialog';
import { useCollectionEditing } from './UiCollectionEditing';
import type { AssetUrl } from './StageEditor';
import './UiCollectionInspector.css';

export { collectionInspectorParts, collectionInspectorPartName, collectionInspectorPartScope, collectionInspectorPartKeywords } from '../core/ui-collection-inspector';

type List = NonNullable<UiComponent['list']>;
type EditOptions = { separate?: boolean };
type Edit = (change: (component: UiComponent) => void, options?: EditOptions) => void;
type Props = { project: Project; component: UiComponent; edit: Edit; assetUrl: AssetUrl; section: 'content' | 'layout' | 'appearance' | 'interaction' };
type PartProps = Omit<Props, 'section'> & { part: CollectionPart; section: 'layout' | 'appearance' };
type SkinKey = 'pageSkin' | 'numberSkin' | 'slotActionSkin' | 'slotSaveSkin' | 'autoSlotSkin' | 'voiceReplaySkin' | 'voiceFavoriteSkin';
const stateNames: Record<UiButtonState, string> = { idle: '普通', hover: '鼠标经过', pressed: '按住', selected: '开启／当前项', disabled: '不可用' };

function collectionFields(component: UiComponent, edit: Edit) {
  const list = component.list;
  const change = <K extends keyof List>(key: K, value: List[K], separate = value === undefined) => edit(c => setCollectionOption(c, key, value), { separate });
  const numeric = (key: keyof List, label: string, fallback: number, min = 0, integer = false) => <Field label={label} key={key}><NumberInput min={min} step={integer ? 1 : 'any'} value={typeof list?.[key] === 'number' ? list[key] as number : fallback} onChange={event => {
    const value = Number(event.target.value); if (!event.target.value.trim() || !Number.isFinite(value) || value < min || integer && !Number.isInteger(value)) return;
    change(key, value as never);
  }} /></Field>;
  const toggle = (key: keyof List, label: string, fallback = false) => <Field label={label} key={key}><input type="checkbox" checked={typeof list?.[key] === 'boolean' ? list[key] as boolean : fallback} onChange={event => change(key, event.target.checked as never, true)} /></Field>;
  return { change, numeric, toggle };
}

export function UiCollectionInspector({ project, component, edit, assetUrl, section }: Props) {
  const editing = useCollectionEditing(), [localPart, setLocalPart] = useState<CollectionPart>('item'), [dialog, setDialog] = useState(false);
  useEffect(() => { setLocalPart('item'); setDialog(false); }, [component.id]);
  if (!collectionSupports(component)) return null;
  const list = component.list, layout = collectionLayoutValues(project, component), available = collectionInspectorParts(component);
  const part = available.includes(localPart) ? localPart : 'item';
  const choose = (value: CollectionPart, reveal?: 'layout' | 'appearance') => { setLocalPart(value); editing?.select(component.id, value, undefined, reveal); };
  const { change, numeric, toggle } = collectionFields(component, edit);

  if (section === 'content') {
    const summary = component.kind === 'musicTrackList' ? list?.assetIds ? `手动选择 ${list.assetIds.length} 首曲目` : `自动收集剧情配乐 · ${musicRoomEntries(project).length} 首`
      : component.kind === 'galleryGrid' ? `${galleryEntries(project, component).length} ${list?.galleryGroups ? '组图鉴' : '张图片'}`
      : component.kind === 'voiceCollection' ? list?.assetIds ? `限定 ${list.assetIds.length} 个语音素材` : `全部剧情语音 · ${storyVoiceEntries(project).length} 条`
      : component.kind === 'saveSlots' ? '由玩家保存的进度自动生成。' : component.kind === 'historyList' ? '记录玩家当前周目已经显示的对白和语音。'
      : component.kind === 'choiceList' ? '选项文字来自当前剧情的选择分支。' : '按工程中的章节生成可重玩的章节目录。';
    return <div className="ui-collection-fields" data-collection-section="content">
      <p className="ui-collection-source">{summary}</p>
      {['musicTrackList', 'galleryGrid', 'voiceCollection'].includes(component.kind) && <><button type="button" className="ui-collection-manage" onClick={() => setDialog(true)}>{component.kind === 'galleryGrid' ? '管理图鉴内容' : component.kind === 'musicTrackList' ? '管理音乐曲目' : '管理语音范围'}</button><p className="ui-field-help">{component.kind === 'galleryGrid' ? '在内容管理中选择图片、分组、分镜和解锁条件；缩略图与未解锁图片的外观在条目部件中设置。' : component.kind === 'musicTrackList' ? '在内容管理中选择自动收集或手动曲目，并调整播放列表顺序。' : '在内容管理中选择允许出现在收藏列表中的剧情语音。'}</p></>}
      {['saveSlots', 'galleryGrid'].includes(component.kind) && toggle('showLabels', '显示条目文字', true)}
      {component.kind === 'saveSlots' && <>
        <Field label="存档文字内容"><select value={list?.captionMode ?? 'time'} onChange={event => change('captionMode', event.target.value as List['captionMode'], true)}><option value="time">保存时间</option><option value="story">章节和对白摘要</option></select></Field>
        {list?.captionMode === 'story' && !list.caption && <div className="ui-collection-guidance"><p className="ui-field-help">进入“对白摘要”部件，在“位置与大小”开启自定义位置后显示剧情摘要；未开启时底栏显示保存时间。</p><button type="button" className="text-button" onClick={() => choose('caption', 'layout')}>编辑对白摘要</button></div>}
        {toggle('fixedAutoSlot', '固定显示自动存档')}
        {list?.fixedAutoSlot && (layout.columns ?? 1) * (layout.rows ?? 1) < 2 && <p className="ui-field-help">至少需要两个存档格，才能把第一个固定为自动存档。</p>}
      </>}
      {component.kind === 'voiceCollection' && <>
        <Field label="收藏文字内容"><select value={list?.voiceCaptionMode ?? 'speaker'} onChange={event => change('voiceCaptionMode', event.target.value as List['voiceCaptionMode'], true)}><option value="speaker">姓名和对白摘要</option><option value="text">仅对白</option></select></Field>
        {toggle('voiceSingleLine', '单行显示并省略长文本')}
        <Field label="收藏排列顺序"><select value={list?.voiceOrder ?? 'source'} onChange={event => change('voiceOrder', event.target.value as List['voiceOrder'], true)}><option value="source">资源顺序</option><option value="favorites">收藏先后顺序</option></select></Field>
      </>}
      {component.kind === 'chapterList' && toggle('showProgress', '显示已读和当前位置')}
      {dialog && <UiCollectionContentDialog key={component.id} project={project} component={component} edit={edit} assetUrl={assetUrl} onClose={() => setDialog(false)} />}
    </div>;
  }

  if (section === 'layout') return <div className="ui-collection-fields" data-collection-section="layout">
    <div className="inspector-section-title">条目排列</div>
    {layout.pagination === 'fixed' && <p className="ui-field-help">按页显示；每页 {layout.columns} 列 × {layout.rows} 行。</p>}
    {layout.pagination === 'optional' && <Field label="浏览方式"><select aria-label={`${component.kind === 'musicTrackList' ? '音乐列表' : component.kind === 'voiceCollection' ? '语音列表' : '章节列表'}浏览方式`} value={list?.rows ? 'pages' : 'scroll'} onChange={event => change('rows', event.target.value === 'pages' ? 6 : undefined, true)}><option value="scroll">滚动列表</option><option value="pages">按页切换</option></select></Field>}
    {component.kind === 'historyList' && <Field label="历史条目排列"><select value={list?.historyLayout ?? 'stacked'} onChange={event => change('historyLayout', event.target.value as List['historyLayout'], true)}><option value="stacked">姓名在对白上方</option><option value="columns">姓名、语音按钮与对白分列</option></select></Field>}
    <div className="ui-collection-field-grid">
      {layout.fields.filter(key => (key !== 'rows' || layout.pagination === 'fixed' || list?.rows) && !['itemWidth', 'itemHeight'].includes(key)).map(key => numeric(key, { columns: '每行数量', rows: '每页行数', gapX: component.kind === 'historyList' ? '姓名／按钮间距' : '横向间距', gapY: '纵向间距', itemWidth: '条目宽度', itemHeight: '条目高度' }[key], layout[key] ?? 0, key === 'columns' || key === 'rows' ? 1 : 0, key === 'columns' || key === 'rows'))}
    </div>
    <button type="button" className="text-button ui-collection-link" onClick={() => choose('item', 'layout')}>编辑条目尺寸与留白</button>
    {component.kind === 'historyList' && list?.historyLayout === 'columns' && <button type="button" className="text-button ui-collection-link" onClick={() => choose('historyName', 'layout')}>编辑姓名列宽度</button>}
    {component.kind === 'galleryGrid' && <>
      <Field label="画廊排列"><select value={list?.layout === 'staggered' ? 'staggered' : 'grid'} onChange={event => change('layout', event.target.value as List['layout'], true)}><option value="grid">等距网格</option><option value="staggered">上下错列</option></select></Field>
      {list?.layout === 'staggered' && numeric('staggerX', '隔行横移', 120)}
    </>}
    {component.kind === 'saveSlots' && <>
      {numeric('pageCount', '手动存档页数', 6, 1, true)}
    </>}
    {available.includes('navigationRect') && <button type="button" className="text-button ui-collection-link" onClick={() => choose('navigationRect', 'layout')}>编辑分页位置与按钮大小</button>}
  </div>;

  if (section === 'interaction') return <div className="ui-collection-fields" data-collection-section="interaction">
    {component.kind === 'saveSlots' && toggle('showDelete', '显示删除存档', true)}
    {component.kind === 'chapterList' && <>{toggle('lockUnread', '锁定未到达的剧情')}{toggle('confirmJump', '游戏中跳转前确认', true)}<p className="ui-field-help">选择章节会从对应剧情入口重新开始。</p></>}
    {component.kind === 'voiceCollection' && <>
      {toggle('favoritesOnly', '默认只看收藏')}{toggle('showVoiceControls', '显示筛选和停止按钮', true)}{toggle('voiceRemoveConfirm', '删除收藏前确认')}
      {list?.voiceRemoveConfirm && <Field label="删除收藏提示" layout="stacked"><input value={list.voiceRemoveMessage ?? ''} placeholder={defaultVoiceRemoveMessage} maxLength={2000} onChange={event => change('voiceRemoveMessage', event.target.value || undefined)} /></Field>}
    </>}
    {component.kind === 'galleryGrid' && <>
      <Field label="详情图片缩放"><select value={list?.galleryFit ?? 'contain'} onChange={event => change('galleryFit', event.target.value as List['galleryFit'], true)}><option value="contain">完整显示</option><option value="cover">裁切铺满</option><option value="stretch">拉伸铺满</option></select></Field>
      <Field label="最后一张再点击"><select value={list?.galleryEndAction ?? 'close'} onChange={event => change('galleryEndAction', event.target.value as List['galleryEndAction'], true)}><option value="close">返回图鉴</option><option value="loop">从第一张循环</option></select></Field>
      {toggle('galleryShowControls', '详情显示翻页和关闭按钮', true)}
    </>}
  </div>;

  return <div className="ui-collection-fields ui-collection-entry" data-collection-section="appearance">
    <Field label="编辑列表部件"><select aria-label="编辑列表部件" value={part} onChange={event => choose(event.target.value as CollectionPart)}>{available.map(value => <option value={value} key={value}>{collectionInspectorPartName(component, value)}</option>)}</select></Field>
    <button type="button" className="ui-collection-manage" onClick={() => choose(part)}>编辑条目部件</button>
    <p className="ui-field-help">选择部件进入它的“位置与大小”和“外观”，也可以在画布中双击部件。内部部件的设置会应用到此列表的各个条目。</p>
  </div>;
}

/** A separate inspector scope for one internal part; never edits the list's screen rectangle. */
export function UiCollectionPartInspector({ project, component, edit, assetUrl, part, section }: PartProps) {
  const editing = useCollectionEditing();
  if (!collectionInspectorParts(component).includes(part)) return null;
  const list = component.list, name = collectionInspectorPartName(component, part);
  const { change, numeric, toggle } = collectionFields(component, edit);
  const image = (key: 'emptyAssetId' | 'hoverOverlayId' | 'lockedAssetId', label: string) => <Field label={label}><UiAssetSelect project={project} kind="image" value={list?.[key]} onChange={value => change(key, value, true)} assetUrl={assetUrl} label={label} empty="无图片" /></Field>;
  const returnToList = <button type="button" className="text-button ui-collection-link" onClick={() => editing?.clear()}>返回列表设置</button>;
  const editItem = <button type="button" className="text-button ui-collection-link" onClick={() => editing?.select(component.id, 'item', undefined, 'layout')}>编辑整个条目</button>;
  const textPart = component.kind === 'saveSlots' && (['chapter', 'caption', 'number', 'navigationRect'] as CollectionPart[]).includes(part) ? part === 'navigationRect' ? 'navigation' : part as CollectionTextPart
    : part === 'historyName' || part === 'historyText' ? part : undefined;
  const labelsHidden = component.kind === 'saveSlots' && (part === 'chapter' || part === 'caption') && list?.showLabels === false;
  const rectPart = (['thumbnail', 'chapter', 'caption', 'number', 'slotAction', 'lockedRect', 'navigationRect'] as CollectionPart[]).includes(part)
    || component.kind === 'voiceCollection' && part === 'voiceFavoriteRect';
  const rectValue = rectPart ? list?.[part as 'thumbnail'] : undefined;
  const setRect = (value?: CollectionRect) => edit(c => {
    if (value && !isCollectionRect(value)) return;
    const hadNavigation = !!c.list?.navigationRect, hadItemHeight = c.list?.itemHeight !== undefined;
    setCollectionOption(c, part as 'thumbnail', value);
    // Custom footer coordinates stop reserving a footer in the existing collection layout.
    // Preserve the card height when enabling it so entering edit mode doesn't resize every row.
    if (part === 'navigationRect' && value && !hadNavigation && ['voiceCollection', 'musicTrackList', 'chapterList'].includes(c.kind) && !hadItemHeight) setCollectionOption(c, 'itemHeight', collectionLayoutValues(project, component).itemHeight);
  }, { separate: !value || !rectValue });
  const disabledNote = labelsHidden && <div className="ui-collection-inactive" role="status"><span>列表的“显示条目文字”已关闭，当前部件设置保留。可返回列表的“内容”中开启。</span>{returnToList}</div>;
  if (section === 'layout') return <div className="ui-collection-fields ui-collection-part-editor" data-collection-section="layout" data-editing-collection-part={part}>
    {disabledNote}
    <fieldset disabled={labelsHidden} className="ui-collection-part-fields">
      {part === 'item' && <CollectionItemLayout project={project} component={component} edit={edit} />}
      {rectPart && <CollectionRectFields name={name} value={rectValue} seed={() => collectionPartDefaultRect(project, component, part)} onChange={setRect} optional={['chapter', 'number', 'slotAction'].includes(part)} scope={part === 'navigationRect' ? 'list' : component.kind === 'saveSlots' ? 'saveBody' : 'item'} />}
      {part === 'caption' && component.kind === 'saveSlots' && <p className="ui-field-help">{list?.caption ? '关闭自定义位置后，底栏恢复显示保存时间，并重新预留底栏高度。摘要显示保存时间或剧情内容，由列表“内容”中的设置决定。' : '当前文字位于存档底栏。开启自定义位置后，可以在存档格内部安排剧情摘要。'}</p>}
      {part === 'thumbnailFrame' && (list?.thumbnailFrame ? <CollectionRectFields name="相框" value={list.thumbnailFrame} fixed seed={() => collectionPartDefaultRect(project, component, 'thumbnailFrame')} scope={component.kind === 'saveSlots' ? 'saveBody' : 'item'} onChange={value => { if (value && list.thumbnailFrame) change('thumbnailFrame', { ...value, assetId: list.thumbnailFrame.assetId }); }} /> : <p className="ui-field-help">先在此部件的“外观”选择相框图片，再调整相框位置与大小。</p>)}
      {part === 'lockedRect' && <p className="ui-field-help">开启自定义位置后，未解锁图片作为底图按此区域拉伸；关闭后按默认方式完整显示。</p>}
      {part === 'autoSlot' && <div className="ui-collection-guidance"><p className="ui-field-help">固定自动存档占用列表的第一个格子，沿用普通存档格的尺寸和排列。{!list?.fixedAutoSlot ? '在列表“内容”中开启固定自动存档后生效。' : (list.columns ?? 3) * (list.rows ?? 2) < 2 ? '当前只有一个格子，至少两个格子时才显示固定自动存档。' : ''}</p>{editItem}</div>}
      {part === 'historyName' && (list?.historyLayout === 'columns' ? <>{numeric('historyNameWidth', '姓名列宽度', 165, 1)}<p className="ui-field-help">姓名列位于每行左侧，宽度受历史列表区域限制。其他空间由按钮和对白正文分配。</p></> : <div className="ui-collection-guidance"><p className="ui-field-help">当前姓名位于对白上方，宽度随历史条目自动铺开。需要单独设置姓名列宽时，在列表排列中改为分列。</p>{returnToList}</div>)}
      {part === 'historyText' && <div className="ui-collection-guidance"><p className="ui-field-help">正文按历史排列占据剩余空间，随姓名列宽、按钮尺寸和条目留白自动调整。</p>{editItem}</div>}
      {(part === 'voiceReplay' || part === 'voiceFavoriteRect' && component.kind === 'historyList') && <div className="ui-collection-guidance"><p className="ui-field-help">重播与收藏按钮随每条历史记录自动排列，两者共用同一个按钮尺寸。</p>{editItem}</div>}
      {part === 'voiceFavoriteRect' && component.kind === 'voiceCollection' && !list?.voiceFavoriteRect && <div className="ui-collection-guidance"><p className="ui-field-help">当前使用条目的默认收藏按钮大小。开启自定义位置后，此按钮使用单独的区域。</p>{editItem}</div>}
      {part === 'historyScrollbar' && <CollectionHistoryScrollbar project={project} component={component} edit={edit} assetUrl={assetUrl} section="layout" />}
      {part === 'navigationRect' && <CollectionNavigationFields project={project} component={component} edit={edit} assetUrl={assetUrl} section="layout" />}
    </fieldset>
  </div>;
  return <div className="ui-collection-fields ui-collection-part-editor" data-collection-section="appearance" data-editing-collection-part={part}>
    {disabledNote}
    <fieldset disabled={labelsHidden} className="ui-collection-part-fields">
      {part === 'item' && <>
        <div className="ui-collection-guidance"><p className="ui-field-help">条目的默认字体、底图和颜色在列表设置的“条目默认外观”中修改。内部单独设置的文字继续使用自己的样式。</p>{returnToList}</div>
        {component.kind === 'saveSlots' && image('emptyAssetId', '空槽图片')}
        {['saveSlots', 'galleryGrid'].includes(component.kind) && image('hoverOverlayId', '悬停装饰图')}
        {component.kind === 'historyList' && <>{toggle('historyBold', '历史文字加粗')}{numeric('historyLetterSpacing', '历史文字字距', 0, -Infinity)}<p className="ui-field-help">加粗与字距同时作用于历史姓名和对白正文。</p></>}
      </>}
      {(['chapter', 'number', 'slotAction'] as CollectionPart[]).includes(part) && !rectValue && <p className="ui-field-help">先在此部件的“位置与大小”开启“自定义{name}位置”，再设置它的外观。</p>}
      {textPart && (part !== 'chapter' || list?.chapter) && (part !== 'number' || list?.number) && <CollectionTextFields project={project} component={component} part={textPart} label={name} edit={edit} assetUrl={assetUrl} />}
      {part === 'caption' && component.kind !== 'saveSlots' && <div className="ui-collection-guidance"><p className="ui-field-help">{component.kind === 'choiceList' ? '选项文字' : '收藏文字'}使用列表的默认字体、字号和颜色，在列表设置的“条目默认外观”中调整。</p>{returnToList}</div>}
      {part === 'thumbnail' && component.kind === 'saveSlots' && <p className="ui-field-help">缩略图使用玩家保存进度时的画面截屏，随部件区域显示。未保存的格子可在“整个条目”部件中设置空槽图片。</p>}
      {part === 'thumbnail' && component.kind === 'galleryGrid' && <>
        <Field label="缩略图缩放"><select value={list?.thumbnailFit ?? 'contain'} onChange={event => change('thumbnailFit', event.target.value as List['thumbnailFit'], true)}><option value="contain">完整显示</option><option value="cover">裁切铺满相框</option><option value="stretch">拉伸铺满相框</option></select></Field>
        <CollectionBrightnessFields value={list?.thumbnailBrightness} onChange={(value, options) => change('thumbnailBrightness', value, options?.separate)} />
      </>}
      {part === 'thumbnailFrame' && <>
        <Field label="缩略图相框"><UiAssetSelect project={project} kind="image" assetUrl={assetUrl} label="缩略图相框" value={list?.thumbnailFrame?.assetId} empty="无相框" onChange={value => change('thumbnailFrame', value ? { ...(list?.thumbnailFrame ?? collectionPartDefaultRect(project, component, 'thumbnailFrame')), assetId: value } : undefined, true)} /></Field>
      </>}
      {part === 'lockedRect' && image('lockedAssetId', '未解锁图片')}
      {part === 'number' && list?.number && <CollectionSkinFields project={project} label="编号底图" value={list?.numberSkin} assetUrl={assetUrl} states={['idle']} onChange={(value, options) => change('numberSkin', value, options?.separate)} />}
      {part === 'autoSlot' && <>{!list?.fixedAutoSlot && <p className="ui-field-help">在列表设置的“内容”开启固定自动存档后使用此底图。</p>}<CollectionSkinFields project={project} label="自动档底图" value={list?.autoSlotSkin} fallback={component.skin} fallbackName="整个条目的图片" assetUrl={assetUrl} states={['idle', 'hover', 'pressed', 'disabled']} onChange={(value, options) => change('autoSlotSkin', value, options?.separate)} /></>}
      {part === 'slotAction' && list?.slotAction && <CollectionActionSkinFields project={project} component={component} assetUrl={assetUrl} edit={edit} />}
      {(part === 'voiceReplay' || part === 'voiceFavoriteRect') && <>
        <CollectionSkinFields project={project} label={part === 'voiceReplay' ? '重播按钮图片' : '收藏按钮图片'} value={part === 'voiceReplay' ? list?.voiceReplaySkin : list?.voiceFavoriteSkin} assetUrl={assetUrl} hideText onChange={(value, options) => change(part === 'voiceReplay' ? 'voiceReplaySkin' : 'voiceFavoriteSkin', value, options?.separate)} />
      </>}
      {part === 'historyScrollbar' && <CollectionHistoryScrollbar project={project} component={component} edit={edit} assetUrl={assetUrl} section="appearance" />}
      {part === 'navigationRect' && <CollectionNavigationFields project={project} component={component} edit={edit} assetUrl={assetUrl} section="appearance" />}
    </fieldset>
  </div>;
}

function CollectionItemLayout({ project, component, edit }: Pick<PartProps, 'project' | 'component' | 'edit'>) {
  const editing = useCollectionEditing(), layout = collectionLayoutValues(project, component), list = component.list;
  const { change, numeric } = collectionFields(component, edit);
  return <>
    {layout.fields.some(key => key === 'itemWidth' || key === 'itemHeight') && <div className="ui-collection-field-grid">{(['itemWidth', 'itemHeight'] as const).filter(key => layout.fields.includes(key)).map(key => <div key={key}>
      <Field label={key === 'itemWidth' ? '条目宽度' : '条目高度'} hint="自动时随列表区域计算；单独填写后，可用“恢复自动”清除此项尺寸。"><NumberInput min={1} value={list?.[key] ?? ''} placeholder={`自动 · ${Math.round(layout[key] ?? 0)} px`} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) change(key, value); }} /></Field>
      {list?.[key] !== undefined && <button type="button" className="text-button ui-collection-reset" aria-label={`恢复自动${key === 'itemWidth' ? '条目宽度' : '条目高度'}`} onClick={() => change(key, undefined)}>恢复自动</button>}
      {list?.[key] !== undefined && Math.abs(list[key] - (layout[key] ?? list[key])) >= 1 && <small className="ui-field-help">当前显示 {Math.round(layout[key] ?? 0)} px，受列表区域限制。</small>}
    </div>)}</div>}
    {component.kind === 'historyList' && <>
      {list?.historyLayout === 'columns' && numeric('historyRowHeight', '历史行最小高度', list?.voiceButtonSize ?? 49)}
      {numeric('historyPaddingY', '历史行上下留白', 12)}
      {numeric('voiceButtonSize', '重播与收藏按钮大小', 49, 1)}
      <p className="ui-field-help">历史行随对白长度自动增高，重播与收藏按钮共用上面的尺寸。</p>
    </>}
    {component.kind === 'voiceCollection' && (!list?.voiceFavoriteRect ? numeric('voiceButtonSize', '收藏按钮默认大小', 49, 1) : <p className="ui-field-help">收藏按钮已使用自定义区域，大小在“收藏按钮”部件的“位置与大小”中调整。</p>)}
    <div className="ui-collection-guidance"><p className="ui-field-help">条目的行列、间距和浏览方式在列表排列中设置。</p><button type="button" className="text-button ui-collection-link" onClick={() => editing?.clear()}>返回列表设置</button></div>
  </>;
}

function CollectionRectFields({ name, value, seed, onChange, optional = false, fixed = false, scope = 'item' }: { name: string; value?: CollectionRect; seed: () => CollectionRect; onChange: (value?: CollectionRect) => void; optional?: boolean; fixed?: boolean; scope?: 'item' | 'saveBody' | 'list' }) {
  const basis = scope === 'list' ? '坐标相对整个列表' : scope === 'saveBody' ? '坐标相对存档内容区，不含底栏' : '坐标相对每个条目';
  return <div className="ui-collection-rect">
    {!fixed && <Field label={`自定义${name}位置`} hint={`${basis}，100% 是整个区域。${optional ? '开启后显示此部件；关闭后隐藏部件并保留外观设置。' : '关闭后恢复自动位置。'}`}><input type="checkbox" checked={!!value} onChange={event => onChange(event.target.checked ? seed() : undefined)} /></Field>}
    {value && <div className="ui-collection-field-grid">{(['x', 'y', 'width', 'height'] as const).map(key => <Field key={key} label={`${name}${{ x: '横向', y: '纵向', width: '宽度', height: '高度' }[key]} %`}><NumberInput min={key === 'width' || key === 'height' ? 0.01 : undefined} step={.1} value={Number((value[key] * 100).toFixed(4))} onChange={event => { const number = Number(event.target.value); if (!event.target.value.trim() || !Number.isFinite(number)) return; const next = { ...value, [key]: number / 100 }; if (isCollectionRect(next)) onChange(next); }} /></Field>)}</div>}
  </div>;
}

function CollectionTextFields({ project, component, part, label, edit, assetUrl }: { project: Project; component: UiComponent; part: CollectionTextPart; label: string; edit: Edit; assetUrl: AssetUrl }) {
  const override = component.list?.textStyles?.[part];
  const effective = collectionTextStyle(project, component, part);
  const missingFont = !!override?.fontAssetId && !project.assets.some(asset => asset.id === override.fontAssetId && asset.kind === 'font');
  const change = <K extends keyof NonNullable<typeof override>>(key: K, value: NonNullable<typeof override>[K], separate = value === undefined) => edit(c => editCollectionTextStyle(c, part, style => { style[key] = value; }), { separate });
  return <div className="ui-collection-typography">
    <Field label={`${label}字体`}><UiAssetSelect project={project} kind="font" assetUrl={assetUrl} label={`${label}字体`} value={override?.fontAssetId} empty="沿用控件字体" onChange={value => change('fontAssetId', value, true)} /></Field>
    {missingFont && <p className="ui-field-help" role="status">字体素材已移除，当前沿用控件字体；选择项目中的字体后恢复单独设置。</p>}
    <Field label={`${label}字号`}><NumberInput min={1} step={1} value={effective.fontSize} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value > 0) change('fontSize', value); }} /></Field>
    {override?.fontSize !== undefined && <button type="button" className="text-button ui-collection-reset" onClick={() => change('fontSize', undefined)}>恢复{label}字号</button>}
    <UiDesignColorField label={`${label}文字颜色`} value={effective.textColor} source={override?.textColor === undefined ? '沿用原文字颜色' : '此部件单独设置'} onChange={value => change('textColor', value)} onReset={() => change('textColor', undefined)} canReset={override?.textColor !== undefined} />
    <Field label={`${label}对齐`}><select value={override?.align ?? ''} onChange={event => change('align', event.target.value ? event.target.value as NonNullable<typeof override>['align'] : undefined, true)}><option value="">沿用默认对齐</option><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></Field>
  </div>;
}

const allStates: UiButtonState[] = ['idle', 'hover', 'pressed', 'selected', 'disabled'];
function useCollectionPartState(states: UiButtonState[]) {
  const editing = useCollectionEditing(), [local, setLocal] = useState<UiButtonState>('idle');
  const requested = editing?.onPreviewStateChange ? editing.previewState : local, state = states.includes(requested) ? requested : states[0];
  const change = (value: UiButtonState) => { setLocal(value); editing?.onPreviewStateChange?.(value); };
  return [state, change] as const;
}
function CollectionStateField({ state, onChange, states = allStates }: { state: UiButtonState; onChange: (state: UiButtonState) => void; states?: UiButtonState[] }) {
  return <Field label="部件状态"><select aria-label="部件状态" value={state} onChange={event => onChange(event.target.value as UiButtonState)}>{states.map(value => <option key={value} value={value}>{stateNames[value]}</option>)}</select></Field>;
}

function CollectionBrightnessFields({ value, onChange }: { value: UiSkin['brightness']; onChange: (value: UiSkin['brightness'], options?: EditOptions) => void }) {
  const [state, setState] = useCollectionPartState(allStates);
  return <><CollectionStateField state={state} onChange={setState} /><Field label="缩略图亮度 %"><NumberInput min={0} max={100} value={(value?.[state] ?? 1) * 100} onChange={event => { const number = Number(event.target.value); if (event.target.value.trim() && number >= 0 && number <= 100) onChange({ ...value, [state]: number / 100 }); }} /></Field>{value?.[state] !== undefined && <button type="button" className="text-button" onClick={() => { const next = { ...value }; delete next[state]; onChange(Object.keys(next).length ? next : undefined, { separate: true }); }}>恢复此状态亮度</button>}</>;
}

function CollectionSkinFields({ project, label, value, fallback, fallbackName, assetUrl, onChange, hideText = false, states = ['idle', 'hover', 'pressed', 'selected', 'disabled'] }: { project: Project; label: string; value?: UiSkin; fallback?: UiSkin; fallbackName?: string; assetUrl: AssetUrl; onChange: (value?: UiSkin, options?: EditOptions) => void; hideText?: boolean; states?: UiButtonState[] }) {
  const [state, setState] = useCollectionPartState(states);
  const current = value ?? fallback, asset = uiSkinAsset(current, state), source = asset ? project.assets.find(entry => entry.id === asset)?.name ?? '图片素材已移除' : '无图片，使用默认底色';
  const update = (change: Partial<UiSkin>, separate = true) => {
    const next = { ...(value ?? fallback), ...change };
    for (const key of Object.keys(next) as (keyof UiSkin)[]) if (next[key] === undefined) delete next[key];
    onChange(Object.keys(next).length ? next : undefined, { separate });
  };
  return <div className="ui-collection-skin">
    {states.length > 1 && <CollectionStateField state={state} onChange={setState} states={states} />}
    <Field label={label}><UiAssetSelect project={project} kind="image" assetUrl={assetUrl} label={label} value={value?.[state]} empty={value?.[state] === undefined ? !value && fallback ? `沿用${fallbackName ?? '默认图片'}` : state === 'idle' ? '无图片' : '沿用其他状态' : '无图片'} onChange={assetId => update({ [state]: assetId })} /></Field>
    <p className="ui-field-help">{stateNames[state]}：{source}</p>
    {value?.[state] && <button type="button" className="text-button ui-collection-reset" onClick={() => update({ [state]: undefined })}>移除此状态图片</button>}
    <Field label={`${label}缩放`}><select value={current?.fit ?? 'stretch'} onChange={event => update({ fit: event.target.value as UiSkin['fit'] })}>{Object.entries(uiFitNames).map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></Field>
    {current?.fit === 'nineSlice' && <div className="ui-collection-field-grid">{(['left', 'top', 'right', 'bottom'] as const).map(edge => <Field key={edge} label={`${label}${{ left: '左', top: '上', right: '右', bottom: '下' }[edge]}边距`}><NumberInput min={0} value={current?.borders?.[edge] ?? 12} onChange={event => { const number = Number(event.target.value); if (event.target.value.trim() && number >= 0) update({ borders: { left: 12, top: 12, right: 12, bottom: 12, ...current?.borders, [edge]: number } }, false); }} /></Field>)}</div>}
    {hideText && <Field label="图片已含文字"><input type="checkbox" checked={current?.hideText ?? false} onChange={event => update({ hideText: event.target.checked })} /></Field>}
    {value && <button type="button" className="text-button" onClick={() => onChange(undefined, { separate: true })}>清除{label}设置</button>}
  </div>;
}

function CollectionActionSkinFields({ project, component, edit, assetUrl }: Omit<Props, 'section'>) {
  const editing = useCollectionEditing();
  const [localMode, setLocalMode] = useState<'load' | 'save'>(component.saveMode ?? editing?.savePreviewMode ?? 'save');
  const selectedMode = editing?.selection?.componentId === component.id && editing.selection.part === 'slotAction' ? editing.selection.actionMode : undefined;
  const mode = component.saveMode === 'load' ? 'load' : selectedMode ?? (!component.saveMode && editing?.onSavePreviewModeChange ? editing.savePreviewMode : localMode);
  const key: SkinKey = mode === 'save' ? 'slotSaveSkin' : 'slotActionSkin';
  const setMode = (value: 'save' | 'load') => {
    setLocalMode(value);
    editing?.select(component.id, 'slotAction', value);
    if (!component.saveMode || component.saveMode === value) editing?.onSavePreviewModeChange?.(value);
  };
  return <>
    {component.saveMode !== 'load' && <Field label="编辑读写按钮"><select aria-label="编辑读写按钮" value={mode} onChange={event => setMode(event.target.value as 'load' | 'save')}><option value="load">读取存档</option><option value="save">保存存档</option></select></Field>}
    {mode === 'load' && <p className="ui-field-help">{component.saveMode === 'save' ? '读取图片用于固定自动存档格，也作为保存按钮图片的默认来源。' : '读取按钮显示在已有存档上；画布预览可切到“示例存档”查看。'}</p>}
    <CollectionSkinFields project={project} label={mode === 'save' ? '保存按钮底图' : '读取按钮底图'} value={component.list?.[key]} fallback={mode === 'save' ? component.list?.slotActionSkin : undefined} fallbackName="读取按钮图片" assetUrl={assetUrl} hideText onChange={(value, options) => edit(c => setCollectionOption(c, key, value), options)} />
  </>;
}

function CollectionHistoryScrollbar({ project, component, edit, assetUrl, section }: Omit<PartProps, 'part'>) {
  const bar = component.list?.historyScrollbar;
  const change = (value: List['historyScrollbar'], separate = value === undefined) => edit(c => setCollectionOption(c, 'historyScrollbar', value), { separate });
  if (section === 'layout') return <>
    <Field label="历史滚动条样式"><select aria-label="历史滚动条样式" value={bar ? 'custom' : 'default'} onChange={event => change(event.target.value === 'custom' ? { rect: collectionPartDefaultRect(project, component, 'historyScrollbar') } : undefined, true)}><option value="default">系统滚动条</option><option value="custom">自定义滚动条</option></select></Field>
    {bar && <>
      <CollectionRectFields name="滚动条" value={bar.rect} fixed seed={() => collectionPartDefaultRect(project, component, 'historyScrollbar')} scope="list" onChange={value => { if (value) change({ ...bar, rect: value }); }} />
      <Field label="滚动条轨道宽度"><NumberInput min={1} value={bar.trackWidth ?? 5} onChange={event => { const number = Number(event.target.value); if (number > 0) change({ ...bar, trackWidth: number }); }} /></Field>
    </>}
  </>;
  if (!bar) return <p className="ui-field-help">当前使用系统滚动条。在此部件的“位置与大小”选择自定义滚动条后，可以设置轨道和滑块图片。</p>;
  return <>
    <Field label="历史滚动条轨道"><UiAssetSelect project={project} kind="image" assetUrl={assetUrl} label="历史滚动条轨道" value={bar.trackId} empty="默认轨道" onChange={value => change({ ...bar, trackId: value }, true)} /></Field>
    <CollectionSkinFields project={project} label="历史滑块图片" value={bar.thumb} states={['idle', 'hover', 'pressed', 'disabled']} assetUrl={assetUrl} onChange={(value, options) => change({ ...bar, thumb: value }, options?.separate)} />
  </>;
}

function CollectionNavigationFields({ project, component, edit, assetUrl, section }: Omit<PartProps, 'part'>) {
  const list = component.list, theme = uiComponentTheme(project, component), gallery = component.kind === 'galleryGrid';
  const { change, numeric } = collectionFields(component, edit);
  const hasSkin = component.kind === 'saveSlots' || gallery || !!list?.navigationRect;
  const automaticNumber = (key: 'pageButtonWidth' | 'pageButtonHeight' | 'pageGap' | 'pageFontSize') => {
    const label = { pageButtonWidth: '页码按钮宽度', pageButtonHeight: '页码按钮高度', pageGap: '页码按钮间距', pageFontSize: '页码字号' }[key];
    return <div key={key}><Field label={label}><NumberInput min={key === 'pageGap' ? 0 : 1} step={key === 'pageFontSize' ? 1 : 'any'} value={list?.[key] ?? ''} placeholder="自动" onChange={event => { const number = Number(event.target.value); if (event.target.value.trim() && Number.isFinite(number) && (key === 'pageGap' ? number >= 0 : number > 0) && (key !== 'pageFontSize' || Number.isInteger(number))) change(key, number); }} /></Field>{list?.[key] !== undefined && <button type="button" className="text-button ui-collection-reset" aria-label={`恢复自动${label}`} onClick={() => change(key, undefined)}>恢复自动</button>}</div>;
  };
  if (section === 'layout') return <>
    {component.kind === 'saveSlots' && <Field label="分页位置"><select value={list?.navigation ?? 'top'} onChange={event => change('navigation', event.target.value as List['navigation'], true)}><option value="top">顶部</option><option value="bottom">底部</option></select></Field>}
    {gallery && <><div className="ui-collection-field-grid">{(['pageButtonWidth', 'pageButtonHeight', 'pageGap'] as const).map(automaticNumber)}</div>{numeric('galleryPageButtonLimit', '最多同时显示页码', 9, 1, true)}</>}
    {!gallery && <p className="ui-field-help">分页按钮按分页区域自动分配宽高，按钮数量由列表的页数决定。</p>}
  </>;
  return <>
    {gallery && <>
      {automaticNumber('pageFontSize')}
      <Field label="页码字体"><UiAssetSelect project={project} kind="font" assetUrl={assetUrl} label="页码字体" value={list?.pageFontAssetId} empty="沿用控件字体" onChange={value => change('pageFontAssetId', value, true)} /></Field>
      <Field label="页码粗体"><input type="checkbox" checked={list?.pageBold ?? false} onChange={event => change('pageBold', event.target.checked, true)} /></Field>
    </>}
    {hasSkin ? <>
      <CollectionSkinFields project={project} label="分页按钮图片" value={list?.pageSkin} assetUrl={assetUrl} onChange={(value, options) => change('pageSkin', value, options?.separate)} />
      {component.kind !== 'saveSlots' && <UiDesignColorField label="分页文字颜色" value={list?.pageTextColor ?? component.style?.textColor ?? theme.textColor} onChange={value => change('pageTextColor', value)} onReset={() => change('pageTextColor', undefined)} canReset={list?.pageTextColor !== undefined} allowAlpha={false} />}
      <UiDesignColorField label="当前页文字颜色" value={list?.pageSelectedTextColor ?? (component.kind === 'saveSlots' ? list?.textStyles?.navigation?.textColor : undefined) ?? list?.pageTextColor ?? component.style?.textColor ?? theme.textColor} onChange={value => change('pageSelectedTextColor', value)} onReset={() => change('pageSelectedTextColor', undefined)} canReset={list?.pageSelectedTextColor !== undefined} allowAlpha={false} />
    </> : <p className="ui-field-help">当前使用“上一页／下一页”。在此部件的“位置与大小”开启自定义分页位置后，可以设置页码按钮图片。</p>}
  </>;
}
