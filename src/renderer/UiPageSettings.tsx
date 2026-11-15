import { useState, type ReactNode } from 'react';
import { ArrowUpRight, Braces, GitBranch, Layers, Link2, Paintbrush, RotateCcw, Settings2 } from 'lucide-react';
import type { Project, UiButtonState, UiComponent, UiPageAppearance, VariableValue } from '../core/model';
import type { BlueprintNodeType } from '../core/blueprint';
import { editableUiPages } from '../core/ui';
import { uiPage } from '../core/ui-pages';
import { localUiPageAppearance, setUiPageAppearance, uiPageTheme } from '../core/ui-page-settings';
import { ownsUiEventGraph, uiPageGraphs, uiPageLifecycleHandlers, uiPageShowGraphIds } from '../core/ui-logic';
import { uiPageLifecyclePhases, type UiPageLifecyclePhase } from '../core/ui-page-interface';
import { projectGraphs } from '../core/project-resources';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { UiAssetSelect } from './UiAppearance';
import { UiPropertyGroup } from './UiPropertyGroup';
import { UiPageInterfaceEditor } from './UiPageInterfaceEditor';
import { BlueprintVariables } from './BlueprintVariables';
import { UiParameterBindings } from './UiParameterBindings';
import { UiPageOpeningFields } from './UiPageOpeningFields';
import { resolveUiPageOpening, uiPageOpeningSummary } from '../core/ui-page-opening';
import { useUiEventSidebar } from './UiEventSidebar';
import './ui-page-settings.css';

export interface UiInspectorPageContext {
  pageId: string;
  settings: ReactNode;
  onOpenGraph?: (graphId: string, nodeId?: string) => void;
  previewState?: UiButtonState;
  /** Read-only canvas snapshot, including parameter values and parent layout/opacity. */
  previewComponent?: UiComponent;
  onPreviewStateChange?: (state: UiButtonState) => void;
}
interface Props {
  project: Project; pageId: string; components: UiComponent[]; selectedId?: string;
  commit: Commit; assetUrl: AssetUrl; onOpenGlobal?: () => void; usageHint?: ReactNode;
  onOpenGraph: (graphId: string, nodeId?: string) => void;
  onAddNode: (type: BlueprintNodeType, properties?: Record<string, VariableValue>) => void;
  onPageEvent: (phase: UiPageLifecyclePhase | 'show') => void;
}
export function UiPageSettings({ project, pageId, components, selectedId, commit, assetUrl, onOpenGlobal, onOpenGraph, onAddNode, onPageEvent, usageHint }: Props) {
  const [notice, setNotice] = useState('');
  const eventSidebar = useUiEventSidebar();
  const page = uiPage(project, pageId);
  if (!page) return <div className="ui-inspector-empty"><strong>尚未创建页面</strong><p>从顶部页面选项新建一个页面。</p></div>;
  const custom = project.ui.customPages.find(item => item.id === pageId);
  const instance = page.template ? project.ui.instances?.find(item => item.id === project.ui.activeInstanceId) : undefined;
  const theme = uiPageTheme(project, pageId), local = localUiPageAppearance(project, pageId);
  const settings = custom ?? theme.pages?.[page.kind];
  const graphs = uiPageGraphs(project, pageId), ownGraph = graphs.find(graph => ownsUiEventGraph(project, graph, pageId));
  const inputCount = project.ui.pageInterfaces?.[pageId]?.inputs.length ?? 0, outputCount = project.ui.pageInterfaces?.[pageId]?.outputs.length ?? 0;
  const change = <K extends keyof UiPageAppearance>(key: K, value: UiPageAppearance[K]) => commit('页面默认外观', draft => setUiPageAppearance(draft, pageId, key, value));
  const restore = (key: keyof UiPageAppearance, name: string) => <button type="button" className="icon-button ui-page-inherit" aria-label={'恢复继承' + name} title={local[key] === undefined ? '正在沿用上级默认值' : '移除本页覆盖，沿用上级默认值'} disabled={local[key] === undefined} onClick={() => change(key, undefined)}><RotateCcw size={13} /></button>;
  const eventButton = (phase: UiPageLifecyclePhase | 'show', label: string) => {
    const count = phase === 'show' ? uiPageShowGraphIds(project, pageId).length : uiPageLifecycleHandlers(project, pageId, phase).length;
    return <button key={phase} type="button" className="ui-page-event-link" aria-label={'编辑' + label + '事件'} title={phase === 'show' ? '显示页面时执行。已有本页入口会直接打开。' : uiPageLifecyclePhases[phase].hint} onClick={() => onPageEvent(phase)}><span>{label}</span><small>{count ? count + ' 个入口' : '添加事件'}</small><ArrowUpRight size={13} /></button>;
  };
  return <section className="ui-page-settings" aria-label="当前页面设置" data-page-id={pageId}>
    <div className="ui-page-settings-heading"><strong title={page.name}>{page.name}</strong><span>{page.template ? instance?.name ?? '基础界面' : '自定义页面'}</span></div>
    {usageHint}
    <UiPropertyGroup title="默认外观" icon={<Paintbrush size={15} />} summary={Object.keys(local).length ? '本页已覆盖' : '沿用上级'} defaultOpen>
      <p className="ui-page-help">未单独设置样式的控件沿用这里。修改仅作用于本页{instance ? '的当前方案' : ''}。</p>
      <Field label="默认字号"><div className="ui-page-override"><NumberInput aria-label="页面默认字号" min={1} step={1} value={theme.fontSize} onChange={event => change('fontSize', Math.max(1, Math.round(event.target.valueAsNumber)))} />{restore('fontSize', '字号')}</div></Field>
      <div className="field-row">{(['textColor', 'accent'] as const).map(key => <Field key={key} label={key === 'textColor' ? '文字色' : '强调色'}><div className="ui-page-override"><input type="color" aria-label={key === 'textColor' ? '页面文字色' : '页面强调色'} value={theme[key]} onChange={event => change(key, event.target.value)} />{restore(key, key === 'textColor' ? '文字色' : '强调色')}</div></Field>)}</div>
      <Field label="默认字体"><div className="ui-page-override"><select aria-label="页面默认字体" value={local.fontAssetId === undefined ? '@inherit' : local.fontAssetId || '@builtin'} onChange={event => change('fontAssetId', event.target.value === '@inherit' ? undefined : event.target.value === '@builtin' ? '' : event.target.value)}><option value="@inherit">沿用上级字体</option><option value="@builtin">内置字体</option>{project.assets.filter(asset => asset.kind === 'font').map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>{restore('fontAssetId', '字体')}</div></Field>
      <Field label="按钮悬停音效"><div className="ui-page-override"><select aria-label="页面按钮悬停音效" value={local.hoverSoundId === undefined ? '@inherit' : local.hoverSoundId || '@silent'} onChange={event => change('hoverSoundId', event.target.value === '@inherit' ? undefined : event.target.value === '@silent' ? '' : event.target.value)}><option value="@inherit">沿用上级音效</option><option value="@silent">不播放</option>{project.assets.filter(asset => asset.kind === 'audio').map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>{restore('hoverSoundId', '音效')}</div></Field>
      <Field label="按钮点击音效"><div className="ui-page-override"><select aria-label="页面按钮点击音效" value={local.clickSoundId === undefined ? '@inherit' : local.clickSoundId || '@silent'} onChange={event => change('clickSoundId', event.target.value === '@inherit' ? undefined : event.target.value === '@silent' ? '' : event.target.value)}><option value="@inherit">沿用上级音效</option><option value="@silent">不播放</option>{project.assets.filter(asset => asset.kind === 'audio').map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>{restore('clickSoundId', '音效')}</div></Field>
      <p className="ui-page-help">背景使用画布中的图片或色块控件。</p>
    </UiPropertyGroup>
    <UiPropertyGroup title="页面行为" icon={<Settings2 size={15} />} summary={custom ? uiPageOpeningSummary(resolveUiPageOpening(project, pageId)) : settings && 'layout' in settings && settings.layout === 'custom' ? '仅自制控件' : '含系统内容'}>
      {page.template && <><label className="ui-page-check"><input type="checkbox" aria-label="显示系统默认内容" checked={theme.pages?.[page.kind]?.layout !== 'custom'} onChange={event => commit('页面内容', draft => { const pages = editableUiPages(draft.ui); pages[page.kind] = { ...pages[page.kind], layout: event.target.checked ? 'native' : 'custom' }; })} />显示系统默认内容</label><p className="ui-page-help">关闭后只显示自制控件，不改变控件位置。</p></>}
      {custom && <UiPageOpeningFields defaults project={project} pageId={pageId} value={custom.opening} onChange={opening => commit('页面默认打开方式', draft => { const target = draft.ui.customPages.find(item => item.id === pageId); if (target) { target.opening = opening; if (opening?.input) target.modal = opening.input === 'block'; } })} />}
      {page.kind === 'say' && <label className="ui-page-check"><input type="checkbox" aria-label="显示底部快捷菜单" checked={theme.pages?.say?.showQuickMenu ?? true} onChange={event => commit('快捷菜单显示', draft => { const pages = editableUiPages(draft.ui); pages.say = { ...pages.say, showQuickMenu: event.target.checked }; })} />显示底部快捷菜单</label>}
      {page.menuScreen && <p className="ui-page-help">系统菜单会等待关闭，并阻止下层交互。</p>}
    </UiPropertyGroup>
    {!eventSidebar && <><UiPropertyGroup title="输入与结果" icon={<Braces size={15} />} summary={inputCount || outputCount ? inputCount + ' 输入 · ' + outputCount + ' 结果' : '打开与关闭时传递'}>
      <UiPageInterfaceEditor embedded canAddNode project={project} pageId={pageId} graph={ownGraph} commit={commit} add={onAddNode} />
    </UiPropertyGroup>
    <UiPropertyGroup title="页面状态" icon={<Layers size={15} />} summary={(project.ui.pageVariables?.[pageId]?.length ?? 0) + ' 项'}>
      <BlueprintVariables pageOnly project={project} pageId={pageId} graph={ownGraph} commit={commit} canAddNode add={onAddNode} onNotice={setNotice} />
    </UiPropertyGroup>
    <UiPropertyGroup title="属性关联参数" icon={<Link2 size={15} />} summary="设置属性来源">
      <p className="ui-page-help">每项属性可使用默认设置、单向跟随参数，或与参数双向同步。</p>
      {components.length ? <UiParameterBindings embedded project={project} components={components} pageId={pageId} commit={commit} selectedComponentId={selectedId} onComponentSelect={() => {}} onGraphChange={onOpenGraph} /> : <p className="ui-page-help">先添加一个控件，再连接参数。</p>}
    </UiPropertyGroup></>}
    <UiPropertyGroup title="页面事件" icon={<GitBranch size={15} />} summary={graphs.length ? graphs.length + ' 个关联蓝图' : '连接页面行为'}>
      <div className="ui-page-event-links">{eventButton('show', '显示时')}{eventButton('closeRequested', '请求关闭时')}{eventButton('closed', '关闭完成时')}</div>
      <details className="ui-page-more-events"><summary>创建与焦点事件</summary>{eventButton('created', '创建时')}{eventButton('focusGained', '获得焦点时')}{eventButton('focusLost', '失去焦点时')}</details>
      {!!graphs.length && <div className="ui-page-linked-graphs">{graphs.map(graph => <button type="button" className="text-button" key={graph.id} onClick={() => onOpenGraph(graph.id)} title={graph.name}><GitBranch size={13} /><span>{graph.name}</span><small>{ownsUiEventGraph(project, graph, pageId) ? '本页' : '继承 / 共用'}</small></button>)}</div>}
      <p className="ui-page-help">新增事件只写入本页{instance ? '的当前方案' : ''}，不会修改继承或共用蓝图。</p>
      {custom?.onShowBlueprintId && <Field label="已有显示蓝图"><select aria-label="自定义页面显示事件" value={custom.onShowBlueprintId} onChange={event => commit('页面显示蓝图', draft => { const target = draft.ui.customPages.find(item => item.id === pageId); if (target) target.onShowBlueprintId = event.target.value || undefined; })}><option value="">解除绑定</option>{projectGraphs(project).map(graph => <option key={graph.id} value={graph.id}>{graph.name}</option>)}</select></Field>}
    </UiPropertyGroup>
    {(settings?.backgroundId || settings?.background) && <UiPropertyGroup title="已有页面背景">
      <p className="ui-page-help">保留旧页面背景。新背景请使用图片或色块控件。</p>
      <Field label="背景图片"><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" value={settings.backgroundId} label="当前页面背景" empty="主题默认" onChange={value => commit('页面背景', draft => { if (custom) { const target = draft.ui.customPages.find(item => item.id === pageId); if (target) target.backgroundId = value; } else { const pages = editableUiPages(draft.ui); pages[page.kind] = { ...pages[page.kind], backgroundId: value }; } })} /></Field>
      {settings.background && <Field label="底色"><input type="color" aria-label="页面背景底色" value={settings.background} onChange={event => commit('页面底色', draft => { if (custom) { const target = draft.ui.customPages.find(item => item.id === pageId); if (target) target.background = event.target.value; } else { const pages = editableUiPages(draft.ui); pages[page.kind] = { ...pages[page.kind], background: event.target.value }; } })} /></Field>}
      {page.template && <Field label="背景不透明度 %"><NumberInput aria-label="页面背景不透明度" min={0} max={100} value={Math.round((theme.pages?.[page.kind]?.backgroundOpacity ?? 1) * 100)} onChange={event => commit('页面背景透明度', draft => { const pages = editableUiPages(draft.ui); pages[page.kind] = { ...pages[page.kind], backgroundOpacity: Math.max(0, Math.min(100, Number(event.target.value))) / 100 }; })} /></Field>}
    </UiPropertyGroup>}
    {notice && <p className="ui-page-help" role="status">{notice}</p>}
    {onOpenGlobal && <button type="button" className="text-button ui-page-global-link" onClick={onOpenGlobal}>全局主题与玩家设置<ArrowUpRight size={13} /></button>}
  </section>;
}
