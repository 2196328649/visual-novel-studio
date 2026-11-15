import { useContext } from 'react';
import type { Project, UiComponent, UiSkin } from '../core/model';
import { ensureStoryFlowScrollbar, setStoryFlowPaginationRect, setStoryFlowScrollbarRect, storyFlowBrowseLayout, storyFlowDefaults, storyFlowDirectoryLayout, storyFlowPaginationStyle } from '../core/story-flow';
import { clearPlayerFlowPositions, playerFlowPositions } from '../core/player-flow-content';
import { uiStateNames } from '../core/ui';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { UiAssetSelect } from './AssetPicker';
import { UiFlowRectFields } from './UiFlowRectFields';
import { UiFlowEditContext } from './UiFlowEditing';
import { UiPropertyGroup } from './UiPropertyGroup';
import type { AssetUrl } from './StageEditor';

const rectLabels = (name: string) => [name, `自定义${name}位置`, ...['横向', '纵向', '宽度', '高度'].map(dimension => name + dimension)];
const scrollBrightnessLabels = ['普通', '悬停', '按住', '禁用'].map(state => `滚动滑块${state}亮度 %`);
const scrollLabels = [
  ...rectLabels('主滚动条'), '在画布标出主滚动条', '滚动条轨道图片', '滑块缩放', '整张拉伸', '九宫格', '保持两端', '完整显示',
  '滑块左边距', '滑块上边距', '滑块右边距', '滑块下边距', '滚动滑块状态明暗', '滚动条轨道厚度', '滚动滑块高度',
  ...['普通', '悬停', '按住', '禁用'].map(state => `滚动滑块${state}图片`), ...scrollBrightnessLabels,
];
const viewportLabels = [...rectLabels('流程图显示区域'), '在画布标出显示区域', '显示竖向滚动条'];
const paginationLabels = [...rectLabels('翻页按钮区域'), '翻页方式', '数字页码', '上一页和下一页', '页码背景图片', '当前页背景图片'];
export const uiFlowModeSearchLabels: readonly string[] = ['展示方式', '流程图排列', '分支图', '目录列表'];
export const uiFlowArrangementSearchLabels: readonly string[] = [
  '排列方向', '从左到右', '从上到下', '每行数量', '每页行数',
  '节点宽度', '节点高度', '横向间距', '纵向间距', '恢复默认尺寸与间距', '当前节点恢复自动排列', '全部恢复自动排列',
  '连线形状', '连线样式', '折线', '直线', '曲线', '连线粗细', '连线颜色', '连线图片', '水平连线图片', '垂直连线图片',
];
export const uiFlowBrowsingSearchLabels: readonly string[] = ['显示区域与滚动', '目录翻页区域', ...viewportLabels, ...scrollLabels, ...paginationLabels];
export const uiFlowLayoutSearchLabels: readonly string[] = [...uiFlowModeSearchLabels, ...uiFlowArrangementSearchLabels, ...uiFlowBrowsingSearchLabels];

export function UiFlowLayoutFields({ project, component, edit, assetUrl, section }: { project: Project; component: UiComponent; edit: (change: (component: UiComponent) => void) => void; assetUrl: AssetUrl; section?: 'mode' | 'layout' | 'browsing' }) {
  const list = component.list, branch = list?.layout === 'flow', editing = useContext(UiFlowEditContext);
  const positions = playerFlowPositions(component, editing?.groupId);
  const placed = Object.keys(positions).length;
  const selectedId = editing?.inspector?.kind === 'call' ? `call:${editing.inspector.callId}` : editing?.nodeId;
  const selectedPosition = selectedId ? positions[selectedId] : undefined;
  const showMode = !section || section === 'mode', showLayout = !section || section === 'layout', showBrowsing = !section || section === 'browsing';
  const browse = storyFlowBrowseLayout(project, component), directory = storyFlowDirectoryLayout(project, component);
  const relative = (rect: { x: number; y: number; width: number; height: number }) => ({ x: rect.x / Math.max(1, browse.width), y: rect.y / Math.max(1, browse.height), width: rect.width / Math.max(1, browse.width), height: rect.height / Math.max(1, browse.height) });
  const paginationStyle = storyFlowPaginationStyle(list);
  return <>
    {showMode && <Field label="展示方式"><select aria-label="流程图排列" value={branch ? 'flow' : 'grid'} onChange={event => edit(c => { c.list = { ...c.list, layout: event.target.value as 'flow' | 'grid' }; })}><option value="flow">分支图</option><option value="grid">目录列表</option></select></Field>}
    {showLayout && <>
    {branch ? <Field label="排列方向"><select aria-label="排列方向" value={list.flowDirection ?? 'horizontal'} onChange={event => edit(c => { c.list = { ...c.list, flowDirection: event.target.value === 'vertical' ? 'vertical' : undefined }; })}><option value="horizontal">→ 从左到右</option><option value="vertical">↓ 从上到下</option></select></Field> : <div className="field-row">{(['columns', 'rows'] as const).map(key => <Field key={key} label={key === 'columns' ? '每行数量' : '每页行数（0 为滚动）'}><NumberInput min={key === 'columns' ? 1 : 0} value={list?.[key] ?? (key === 'columns' ? 1 : 0)} onChange={event => { const value = event.target.valueAsNumber; if (Number.isInteger(value) && value >= (key === 'columns' ? 1 : 0)) edit(c => { c.list = { ...c.list, [key]: value || undefined }; }); }} /></Field>)}</div>}
    <div className="field-row">{(['itemWidth', 'itemHeight', 'gapX', 'gapY'] as const).map(key => {
      const size = key === 'itemWidth' || key === 'itemHeight';
      return <Field key={key} label={`${{ itemWidth: '节点宽度', itemHeight: '节点高度', gapX: '横向间距', gapY: '纵向间距' }[key]} px`}><NumberInput aria-label={{ itemWidth: '节点宽度', itemHeight: '节点高度', gapX: '横向间距', gapY: '纵向间距' }[key]} min={size ? 1 : 0} value={list?.[key] ?? (branch ? storyFlowDefaults[key] : size ? '' : 12)} placeholder={size && !branch ? '自动适应显示区域' : undefined} onChange={event => { const value = event.target.valueAsNumber; if (!event.target.value || Number.isFinite(value) && value >= (size ? 1 : 0)) edit(c => { c.list = { ...c.list, [key]: event.target.value ? value : undefined }; }); }} /></Field>;
    })}</div>
    <button type="button" className="text-button" disabled={!(['itemWidth', 'itemHeight', 'gapX', 'gapY'] as const).some(key => list?.[key] !== undefined)} onClick={() => edit(c => { if (c.list) for (const key of ['itemWidth', 'itemHeight', 'gapX', 'gapY'] as const) delete c.list[key]; })}>恢复默认尺寸与间距</button>
    {branch && <>
      <p className="muted ui-field-help">点击节点编辑内容，拖动调整位置；按住 Alt 自由摆放。未拖过的节点自动排列。</p>
      {editing?.groupId && <p className="muted ui-field-help">位置调整和恢复自动排列只作用于当前层，其他层的位置保留。</p>}
      <div className="button-row"><button type="button" className="small-button" disabled={!selectedPosition} onClick={() => { if (selectedId) editing?.move(component.id, selectedId); }}>当前节点恢复自动排列</button><button type="button" className="small-button" disabled={!placed} onClick={() => edit(c => { clearPlayerFlowPositions(c, editing?.groupId); })}>全部恢复自动排列{placed ? `（已摆放 ${placed} 个）` : ''}</button></div>
      <Field label="连线形状"><select aria-label="连线样式" value={list.flowLineStyle ?? 'elbow'} onChange={event => edit(c => { c.list = { ...c.list, flowLineStyle: event.target.value === 'elbow' ? undefined : event.target.value as 'straight' | 'curve' }; })}><option value="elbow">┐ 折线</option><option value="straight">╱ 直线</option><option value="curve">⌁ 曲线</option></select></Field>
      <div className="field-row"><Field label="连线粗细 px"><NumberInput aria-label="连线粗细" min={.01} value={list.flowLineWidth ?? storyFlowDefaults.flowLineWidth} onChange={event => { const value = event.target.valueAsNumber; if (value > 0) edit(c => { c.list = { ...c.list, flowLineWidth: value }; }); }} /></Field><Field label="连线颜色"><input aria-label="连线颜色" type="color" value={(list.flowLineColor ?? storyFlowDefaults.flowLineColor).slice(0, 7)} onChange={event => edit(c => { c.list = { ...c.list, flowLineColor: event.target.value }; })} /></Field></div>
      {(list.flowLineAssetId || list.flowVerticalLineAssetId) && <p className="muted ui-field-help">当前使用连线图片；颜色用于没有图片的连线。</p>}
      <UiPropertyGroup id="flow-layout-line-images" title="连线图片" searchKeywords="水平连线图片 垂直连线图片">{(['flowLineAssetId', 'flowVerticalLineAssetId'] as const).map(key => <Field key={key} label={key === 'flowLineAssetId' ? '水平连线图片' : '垂直连线图片'}><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label={key === 'flowLineAssetId' ? '水平连线图片' : '垂直连线图片'} value={list[key]} onChange={value => edit(c => { c.list = { ...c.list, [key]: value }; })} /></Field>)}</UiPropertyGroup>
    </>}
    </>}
    {showBrowsing && branch && <>
      <UiPropertyGroup id="flow-layout-scroll-region" title="显示区域与滚动" searchKeywords={viewportLabels}>
        <button type="button" className="text-button" aria-pressed={editing?.region === 'viewport'} onClick={() => editing?.setRegion(editing.region === 'viewport' ? undefined : 'viewport')}>在画布标出显示区域</button>
        <UiFlowRectFields name="流程图显示区域" value={list.flowViewport} automatic={{ x: 0, y: 0, width: 1, height: 1 }} onChange={value => edit(c => { c.list = { ...c.list, flowViewport: value }; })} />
        <Field label="显示竖向滚动条"><input type="checkbox" checked={list.flowShowVerticalScrollbar ?? true} onChange={event => edit(c => { c.list = { ...c.list, flowShowVerticalScrollbar: event.target.checked }; })} /></Field>
      </UiPropertyGroup>
      <UiPropertyGroup id="flow-layout-main-scrollbar" title="主滚动条" searchKeywords={scrollLabels} searchChildren="title">
        <p className="muted ui-field-help">主滚动条沿横向摆放；控制当前排列方向的浏览进度。</p>
        <button type="button" className="text-button" aria-pressed={editing?.region === 'scrollbar'} onClick={() => editing?.setRegion(editing.region === 'scrollbar' ? undefined : 'scrollbar')}>在画布标出主滚动条</button>
        <UiFlowRectFields name="主滚动条" value={list.flowScrollbar?.rect} automatic={relative(browse.scrollbar)} onChange={value => edit(c => setStoryFlowScrollbarRect(c, value))} />
        {!list.flowScrollbar?.rect && <p className="muted ui-field-help">随显示区域自动排列。关闭自定义位置会保留下方图片与尺寸。</p>}
        <Field label="滚动条轨道图片"><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label="滚动条轨道图片" value={list.flowScrollbar?.trackId} onChange={value => edit(c => { ensureStoryFlowScrollbar(c).trackId = value; })} /></Field>
        {(['idle', 'hover', 'pressed', 'disabled'] as const).map(state => <Field key={state} label={`滚动滑块${uiStateNames[state]}图片`}><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label={`滚动滑块${uiStateNames[state]}图片`} value={list.flowScrollbar?.thumb?.[state]} onChange={value => edit(c => { const scroll = ensureStoryFlowScrollbar(c); scroll.thumb = { ...scroll.thumb, [state]: value }; })} /></Field>)}
        <Field label="滑块缩放"><select aria-label="滑块缩放" value={list.flowScrollbar?.thumb?.fit ?? 'stretch'} onChange={event => edit(c => { const scroll = ensureStoryFlowScrollbar(c); scroll.thumb = { ...scroll.thumb, fit: event.target.value as UiSkin['fit'] }; })}><option value="stretch">整张拉伸</option><option value="nineSlice">九宫格 · 保持两端</option><option value="contain">完整显示</option></select></Field>
        {list.flowScrollbar?.thumb?.fit === 'nineSlice' && <div className="ui-border-fields">{(['left', 'top', 'right', 'bottom'] as const).map(edge => <Field key={edge} label={`滑块${{ left: '左', top: '上', right: '右', bottom: '下' }[edge]}边距`}><NumberInput min={0} value={list.flowScrollbar?.thumb?.borders?.[edge] ?? 12} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value) && value >= 0) edit(c => { const scroll = ensureStoryFlowScrollbar(c); scroll.thumb = { ...scroll.thumb, borders: { left: 12, top: 12, right: 12, bottom: 12, ...scroll.thumb?.borders, [edge]: value } }; }); }} /></Field>)}</div>}
        <UiPropertyGroup id="flow-layout-scroll-brightness" title="滚动滑块状态明暗" searchKeywords={scrollBrightnessLabels}>{(['idle', 'hover', 'pressed', 'disabled'] as const).map(state => <Field key={state} label={`滚动滑块${uiStateNames[state]}亮度 %`}><NumberInput min={0} max={100} value={Math.round((list.flowScrollbar?.thumb?.brightness?.[state] ?? 1) * 100)} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value) && value >= 0 && value <= 100) edit(c => { const scroll = ensureStoryFlowScrollbar(c); scroll.thumb = { ...scroll.thumb, brightness: { ...scroll.thumb?.brightness, [state]: value / 100 } }; }); }} /></Field>)}</UiPropertyGroup>
        <div className="field-row">
          <Field label="滚动条轨道厚度"><NumberInput value={list.flowScrollbar?.trackHeight ?? (list.flowScrollbar ? 5 : 16)} min={.01} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value) && value > 0) edit(c => { ensureStoryFlowScrollbar(c).trackHeight = value; }); }} /></Field>
          <Field label="滚动滑块高度"><NumberInput value={list.flowScrollbar?.thumbHeight ?? (list.flowScrollbar ? 31 : 16)} min={.01} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value) && value > 0) edit(c => { ensureStoryFlowScrollbar(c).thumbHeight = value; }); }} /></Field>
        </div>
      </UiPropertyGroup>
    </>}
    {showBrowsing && !branch && !list?.rows && <p className="muted ui-field-help">当前目录通过滚动浏览；在“排列与连线”中填写每页行数后，可以设置翻页按钮。</p>}
    {showBrowsing && !branch && !!list?.rows && <UiPropertyGroup id="flow-layout-pagination" title="目录翻页区域" searchKeywords={paginationLabels}>
      <Field label="翻页方式"><select aria-label="翻页方式" value={paginationStyle} onChange={event => edit(c => { c.list = { ...c.list, flowPaginationStyle: event.target.value as 'numbers' | 'previousNext' }; })}><option value="previousNext">上一页和下一页</option><option value="numbers">数字页码</option></select></Field>
      <UiFlowRectFields name="翻页按钮区域" value={list.navigationRect} automatic={relative(directory.navigation)} onChange={value => edit(c => setStoryFlowPaginationRect(c, value))} />
      {!list.navigationRect && <p className="muted ui-field-help">自动放在目录下方；翻页方式和图片保持不变。</p>}
      {paginationStyle === 'numbers' && <>
        <Field label="页码背景图片"><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label="页码背景图片" value={list.pageSkin?.idle} onChange={value => edit(c => { c.list = { ...c.list, pageSkin: { ...c.list?.pageSkin, idle: value } }; })} /></Field>
        <Field label="当前页背景图片"><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label="当前页背景图片" value={list.pageSkin?.selected} onChange={value => edit(c => { c.list = { ...c.list, pageSkin: { ...c.list?.pageSkin, selected: value } }; })} /></Field>
      </>}
    </UiPropertyGroup>}
  </>;
}
