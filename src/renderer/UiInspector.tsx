import { blueprintResources, projectGraphs } from '../core/project-resources';
import { useEffect, useId, useRef, useState } from 'react';
import { Eye, EyeOff, RefreshCw, Trash2, Layers, Move, Paintbrush, MousePointer2, Image as ImageIcon, Settings2, List, MessageSquare } from 'lucide-react';
import { effectiveUiComponents, editableUiComponent, findCustomUiComponent, localUiComponents, uiComponentLimit, type Project, type UiComponent } from '../core/model';
import { uiActionAvailable } from '../core/ui-availability';
import { removeUiObject } from '../core/ui-hierarchy-edit';
import { chapterEffectNames } from '../core/chapter';
import { playerPreferences } from '../core/preferences';
import { Field, IconButton } from './components';
import { NumberInput } from './NumberInput';
import { UiChildObjects } from './UiChildObjects';
import { UiFlowStyles } from './UiFlowStyles';
import { UiPropertyGroup } from './UiPropertyGroup';
import { UiAppearanceFields, UiAssetSelect } from './UiAppearance';
import { actionName, componentName, bindingNames } from './UiNames';
import { PlayerDefaultsFields, UiPreferenceFields } from './PlayerPreferences';
import { ChapterCompositionFields } from './ChapterFields';
import { SpinePlaybackFields } from './SpinePreview';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import './ui-inspector.css';

export function ThemeInspector({
  selectUi,
  project,
  id,
  selectionRequest,
  commit,
  assetUrl,
}: {
  project: Project;
  id?: string;
  selectionRequest?: string;
  selectUi?: (id?: string) => void;
  commit: Commit;
  assetUrl: AssetUrl;
}) {
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [section, setSection] = useState<'game' | 'component'>(id ? 'component' : 'game');
  useEffect(() => { if (id) setSection('component'); root.current?.closest('.inspector-scroll')?.scrollTo({ top: 0 }); }, [id, selectionRequest]);
  const activeInstance = project.ui.instances?.find(instance => instance.id === project.ui.activeInstanceId);
  const effectiveComponents = effectiveUiComponents(project.ui);
  const customComponent = id ? findCustomUiComponent(project, id) : undefined;
  const customPage = customComponent ? project.ui.customPages?.find(page => page.components.some(item => item.id === customComponent.id)) : undefined;
  const isCustomComponent = !!customComponent;
  const component = customComponent ?? effectiveComponents.find(c => c.id === id);
  const localComponents = isCustomComponent ? customPage?.components ?? [] : localUiComponents(project.ui);
  const localComponent = isCustomComponent ? customComponent : localComponents.find(c => c.id === id);
  const inheritedComponent = !isCustomComponent && activeInstance ? effectiveUiComponents({ ...project.ui, activeInstanceId: activeInstance.baseUiId }).find(c => c.id === id) : undefined;
  const componentPeers = isCustomComponent ? customPage?.components ?? [] : effectiveComponents;
  const hiddenComponents = !isCustomComponent ? (activeInstance?.hiddenComponentIds?.map(hiddenId => ({
    id: hiddenId,
    component: effectiveUiComponents({ ...project.ui, instances: project.ui.instances?.map(instance => instance.id === activeInstance.id ? { ...instance, hiddenComponentIds: [] } : instance) }).find(c => c.id === hiddenId),
  })) ?? []) : [];
  const canEditComponent = !!localComponent || localComponents.length < uiComponentLimit;
  const editComponent = (edit: (c: UiComponent) => void) =>
    commit("界面组件", (p) => {
      const c = id ? isCustomComponent ? findCustomUiComponent(p, id) : editableUiComponent(p.ui, id) : undefined;
      if (c) edit(c);
    });
  const nameHint = '仅用于编辑器中的查找，不改变游戏内文字。' + (!isCustomComponent && activeInstance && inheritedComponent ? '此控件来自基础界面；修改只作用于当前界面方案，可通过恢复继承撤销覆盖。' : '');
  const collection = component && ['choiceList', 'saveSlots', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'historyList', 'flowchart'].includes(component.kind);
  const hasContent = component && ['image', 'video', 'spine', 'text', 'button', 'preference', 'progress'].includes(component.kind);
  return <div className="ui-inspector" ref={root}>
    <div className="ui-inspector-tabs" role="tablist" aria-label="界面属性分类" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'component' : event.key === 'End' ? 'game' : section === 'game' ? 'component' : 'game';
      setSection(next); document.getElementById(panelId + '-' + next + '-tab')?.focus();
    }}>
      {(['component', 'game'] as const).map(value => <button key={value} type="button" id={panelId + '-' + value + '-tab'} role="tab" aria-controls={panelId + '-' + value} aria-selected={section === value} tabIndex={section === value ? 0 : -1} className={section === value ? 'active' : ''} onClick={() => setSection(value)}>{value === 'component' ? '组件设置' : '游戏设置'}</button>)}
    </div>
    {section === 'component' && <div key={component?.id} role="tabpanel" id={panelId + '-component'} aria-labelledby={panelId + '-component-tab'}>{component ? <>
      <div className="ui-inspector-selection">
        <Field label="控件名称" hint={nameHint}><input aria-label="控件显示名称" maxLength={120} value={component.name ?? ''} placeholder={componentName(component)} disabled={!canEditComponent} onChange={event => editComponent(c => { c.name = event.target.value || undefined; })} /></Field>
      </div>
      {!canEditComponent && <p className="ui-component-limit" role="status">本地组件已达 {uiComponentLimit} 个，删除本地组件后可编辑继承组件。</p>}
      <fieldset className="ui-component-properties" disabled={!canEditComponent}>
        {hasContent && <UiPropertyGroup title="内容与素材" icon={<ImageIcon size={15} />} defaultOpen>
          {component.kind === "image" || component.kind === 'video' || component.kind === 'spine' ? (
            <Field label={component.kind === 'video' ? '视频素材' : component.kind === 'spine' ? '骨骼素材' : '图片素材'}>
              <UiAssetSelect assetUrl={assetUrl} label={component.kind === 'video' ? '视频素材' : component.kind === 'spine' ? '骨骼素材' : '图片素材'}
                project={project}
                kind={component.kind}
                value={component.assetId}
                onChange={(value) =>
                  editComponent((c) => {
                    c.assetId = value;
                    if (c.kind === 'spine') c.spine = { ...c.spine, animation: project.assets.find(asset => asset.id === value)?.spine?.animations[0]?.name, skin: undefined };
                  })
                }
              />
            </Field>
          ) : (component.kind === "text" || component.kind === "button" || component.kind === "preference") && !component.binding ? (
            <Field label="文字">
              <input
                value={component.text}
                onChange={(e) =>
                  editComponent((c) => {
                    c.text = e.target.value;
                  })
                }
              />
            </Field>
          ) : null}
          {component.kind === 'video' && <>
            <Field label="循环播放"><input type="checkbox" checked={component.loop ?? true} onChange={event => editComponent(c => { c.loop = event.target.checked; })} /></Field>
            <Field label="加载时显示图片"><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" value={component.posterId} onChange={value => editComponent(c => { c.posterId = value; })} /></Field>
          </>}
          {component.kind === 'spine' && <><Field label="组件名称"><input value={component.text} onChange={event => editComponent(c => { c.text = event.target.value; })} /></Field><SpinePlaybackFields asset={project.assets.find(asset => asset.id === component.assetId)} value={component.spine} onChange={settings => editComponent(c => { c.spine = settings; })} /></>}
          {component.kind === "text" && (['main', 'say', 'messageBox', 'custom'].includes(component.page)) && <Field label="文字内容"><select value={component.binding ?? ""} onChange={event => editComponent(changed => { changed.binding = event.target.value as UiComponent['binding'] || undefined; })}><option value="">固定文字</option>{(component.page === "main" ? ['title'] as const : component.page === 'messageBox' ? ['confirmation'] as const : component.page === 'custom' ? ['minigameTitle', 'minigamePrompt', 'minigameStatus'] as const : ['speaker', 'dialogue'] as const).map(binding => <option key={binding} value={binding} disabled={componentPeers.some(other => other.id !== component.id && other.binding === binding)}>{bindingNames[binding]}</option>)}</select></Field>}
          {component.kind === 'progress' && <Field label={`初始进度 ${Math.round((component.value ?? 0) * 100)}%`}><input aria-label="进度条初始值" type="range" min="0" max="100" value={(component.value ?? 0) * 100} onChange={event => editComponent(c => { c.value = Number(event.target.value) / 100; })} /></Field>}

          {component.kind === 'button' && <Field label="按钮图片" hint="按钮普通状态的图片；其他状态在「外观与状态」中设置。"><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label="按钮图片" value={component.skin?.idle} empty="使用背景色" onChange={value => editComponent(c => { c.skin = { ...c.skin, idle: value }; })} /></Field>}
          {component.kind === 'image' && <Field label="图片缩放"><select aria-label="图片缩放" value={component.style?.imageFit ?? 'contain'} onChange={event => editComponent(c => { c.style = { ...c.style, imageFit: event.target.value as 'contain' | 'cover' | 'stretch' }; })}><option value="contain">完整容纳</option><option value="cover">裁切填满</option><option value="stretch">拉伸铺满</option></select></Field>}
          {component.kind !== 'button' && <UiPreferenceFields assetUrl={assetUrl} project={project} component={component} edit={editComponent} />}
        </UiPropertyGroup>}
        <UiPropertyGroup title="位置与大小" icon={<Move size={15} />} summary={component.parentId ? '相对父对象 · %' : '相对页面 · %'} defaultOpen>
          <div className="ui-inspector-transform">{(['x', 'y', 'width', 'height'] as const).map(key => <Field key={key} label={{ x: '横向位置', y: '纵向位置', width: '宽度', height: '高度' }[key]}>
            <div className="ui-inspector-number"><span aria-hidden="true">{{ x: 'X', y: 'Y', width: 'W', height: 'H' }[key]}</span><NumberInput aria-label={(component.parentId ? '相对父级' : '') + ({ x: '横向位置', y: '纵向位置', width: '宽度', height: '高度' }[key]) + ' %'} step={.01} value={Number((component[key] * 100).toFixed(2))} onChange={event => editComponent(c => { c[key] = Number(event.target.value) / 100; })} /></div>
          </Field>)}</div>
        </UiPropertyGroup>
        <UiPropertyGroup title="外观与状态" icon={<Paintbrush size={15} />} summary={component.kind === 'button' ? '图片 · 文字 · 边框' : '颜色 · 文字 · 边框'}>
          <UiAppearanceFields assetUrl={assetUrl} project={project} component={component} edit={editComponent} section="appearance" omitIdle={component.kind === 'button' || component.kind === 'image'} />

          {!['image', 'video', 'spine', 'panel', 'progress'].includes(component.kind) && <Field label="组件字号"><NumberInput type="number"   value={component.style?.fontSize ?? project.ui.fontSize} onChange={event => editComponent(changed => { changed.style = { ...changed.style, fontSize: Math.round(Number(event.target.value)) }; })} /></Field>}
          <div className="field-row">{!['image', 'video', 'spine', 'panel', 'progress'].includes(component.kind) && <Field label="组件文字色"><input type="color" value={component.style?.textColor ?? project.ui.textColor} onChange={event => editComponent(changed => { changed.style = { ...changed.style, textColor: event.target.value }; })} /></Field>}<Field label="组件背景色"><input type="color" value={component.style?.background ?? '#283133'} onChange={event => editComponent(changed => { changed.style = { ...changed.style, background: event.target.value }; })} /></Field></div>
          {component.kind === "button" && <details key={"colors:" + component.id} className="ui-property-group"><summary>按钮状态颜色</summary>
            <div className="field-row"><Field label="悬停背景"><input type="color" value={component.style?.hoverBackground ?? project.ui.accent} onChange={event => editComponent(changed => { changed.style = { ...changed.style, hoverBackground: event.target.value }; })} /></Field><Field label="按下背景"><input type="color" value={component.style?.pressedBackground ?? project.ui.accent} onChange={event => editComponent(changed => { changed.style = { ...changed.style, pressedBackground: event.target.value }; })} /></Field></div>
            <Field label="禁用背景"><input type="color" value={component.style?.disabledBackground ?? '#22282a'} onChange={event => editComponent(changed => { changed.style = { ...changed.style, disabledBackground: event.target.value }; })} /></Field>
            <Field label="选中背景"><input type="color" value={component.style?.selectedBackground ?? project.ui.accent} onChange={event => editComponent(changed => { changed.style = { ...changed.style, selectedBackground: event.target.value }; })} /></Field>
          </details>}
          <div className="field-row"><Field label="边框颜色"><input type="color" value={component.style?.borderColor ?? project.ui.accent} onChange={event => editComponent(changed => { changed.style = { ...changed.style, borderColor: event.target.value }; })} /></Field><Field label="边框宽度"><NumberInput type="number"   value={component.style?.borderWidth ?? 0} onChange={event => editComponent(changed => { changed.style = { ...changed.style, borderWidth: Number(event.target.value) }; })} /></Field></div>
          <Field label="圆角"><NumberInput type="number"   value={component.style?.radius ?? 0} onChange={event => editComponent(changed => { changed.style = { ...changed.style, radius: Number(event.target.value) }; })} /></Field>
          <Field label={`组件不透明度 ${Math.round((component.style?.opacity ?? 1) * 100)}%`}><input aria-label="组件不透明度" type="range" min="0" max="100" value={(component.style?.opacity ?? 1) * 100} onChange={event => editComponent(changed => { changed.style = { ...changed.style, opacity: Number(event.target.value) / 100 }; })} /></Field>
          {component.page === 'say' && <Field label="跟随玩家对话框透明度" hint="用于对话底图或装饰；文字组件通常保持关闭。"><input aria-label="跟随玩家对话框透明度" type="checkbox" checked={component.style?.playerOpacity ?? false} onChange={event => editComponent(c => { c.style = { ...c.style, playerOpacity: event.target.checked }; })} /></Field>}
          {!['image', 'video', 'spine', 'panel', 'progress'].includes(component.kind) && <Field label="文字对齐"><select value={component.style?.align ?? (component.kind === 'text' ? 'left' : 'center')} onChange={event => editComponent(changed => { changed.style = { ...changed.style, align: event.target.value as 'left' | 'center' | 'right' }; })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></Field>}
          <button className="text-button" disabled={!component.style} onClick={() => editComponent(changed => { changed.style = undefined; })}>恢复主题样式</button>

        </UiPropertyGroup>
        {collection && <UiPropertyGroup title="列表与内容" icon={<List size={15} />}><UiAppearanceFields assetUrl={assetUrl} project={project} component={component} edit={editComponent} section="content" /></UiPropertyGroup>}
        {component.kind === 'flowchart' && <UiPropertyGroup title="流程图框样式" icon={<Layers size={15} />}><UiFlowStyles project={project} component={component} commit={commit} assetUrl={assetUrl} /></UiPropertyGroup>}
        <UiPropertyGroup title={component.kind === 'button' ? '点击与交互' : '显示与事件'} icon={<MousePointer2 size={15} />} summary={component.kind === 'button' ? component.action ? actionName(component.action) : '未绑定行为' : component.visibleWhen ? '按条件显示' : '始终显示'}>
          {component.kind === "button" && (
            <Field label="点击行为">
              <select
                aria-label="点击行为"
                value={component.action ?? ''}
                onChange={(e) =>
                  editComponent((c) => {
                    c.action = e.target.value ? e.target.value as UiComponent["action"] : undefined;
                    if (c.action === 'setPlayerPreference') { c.preference ??= 'musicVolume'; c.preferenceValue ??= playerPreferences[c.preference].initial; }
                  })
                }
              >
                <option value="">{component.events?.onClick || projectGraphs(project).some(graph => graph.nodes.some(node => node.type === 'eventClick' && node.properties.componentId === component.id)) ? '仅执行点击事件' : '未绑定点击行为'}</option>{((
                  isCustomComponent ? ["minigameSuccess", "minigameFailure", "minigameCancel", "blueprint", "return"] : [
                    "start",
                    "load",
                    "preferences",
                    "gallery",
                    "music",
                    "quit",
                    "save",
                    "history",
                    "auto",
                    "skip",
                    "return", "mainMenu", "rollback", "window", "fullscreen", "mute", "skipSeen", "skipAll", "transitions", "pause", "chapterSelect", "voiceCollection", "flowchart", "staff", "blueprint", "hideInterface", "musicPrevious", "musicNext", "musicPlayPause", "musicStop", "musicLoop", "musicShuffle", "setPlayerPreference", "resetPreferences", "voiceSettings", ...(component.page === 'messageBox' ? ['confirmYes', 'confirmNo'] as const : []),
                  ]) as readonly NonNullable<UiComponent['action']>[]).filter(a => uiActionAvailable(project.ui, a)).map((a) => (
                  <option value={a} key={a}>
                    {actionName(a)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {component.kind === "button" && component.action === "blueprint" && <Field label="调用蓝图"><select value={component.blueprintId ?? ""} onChange={event => editComponent(changed => { changed.blueprintId = event.target.value || undefined; })}><option value="">选择蓝图</option>{blueprintResources(project).map(graph => <option key={graph.id} value={graph.id}>{graph.name}</option>)}</select></Field>}

          {component.kind === 'button' && <UiPreferenceFields assetUrl={assetUrl} project={project} component={component} edit={editComponent} />}
          <UiAppearanceFields assetUrl={assetUrl} project={project} component={component} edit={editComponent} section="interaction" />
          <details key={"events:" + component.id} className="ui-property-group" open={!!(component.events?.onClick || component.events?.onShow)}><summary>高级事件绑定</summary>
          {component.kind === 'button' && <Field label="点击事件蓝图" hint="先执行事件蓝图，再执行上方点击行为。"><select value={component.events?.onClick ?? ''} onChange={event => editComponent(changed => { changed.events = { ...changed.events, onClick: event.target.value || undefined }; })}><option value="">不执行</option>{blueprintResources(project).map(graph => <option key={graph.id} value={graph.id}>{graph.name}</option>)}</select></Field>}
          <Field label="显示事件蓝图" hint="控件所在屏幕显示时执行一次。"><select value={component.events?.onShow ?? ''} onChange={event => editComponent(changed => { changed.events = { ...changed.events, onShow: event.target.value || undefined }; })}><option value="">不执行</option>{blueprintResources(project).map(graph => <option key={graph.id} value={graph.id}>{graph.name}</option>)}</select></Field>
          </details>

        </UiPropertyGroup>
        <UiChildObjects project={project} component={component} peers={componentPeers.filter(c => c.page === component.page)} commit={commit} edit={editComponent} select={selectUi} />
      </fieldset>
      <div className="ui-inspector-footer">
          {!isCustomComponent && activeInstance && localComponent && inheritedComponent && <button className="small-button" onClick={() => commit('恢复继承组件', p => {
            const active = p.ui.instances?.find(instance => instance.id === activeInstance.id);
            if (active) active.components = active.components.filter(c => c.id !== id);
          })}><RefreshCw size={14} />恢复继承</button>}
          <button
            className="danger-text small-button"
            disabled={!isCustomComponent && !!activeInstance && !localComponent && (activeInstance.hiddenComponentIds?.length ?? 0) >= uiComponentLimit}
            onClick={() =>
              commit(!isCustomComponent && activeInstance && !localComponent ? '隐藏界面组件' : '删除界面组件', (p) => {
                if (!id) return;
                removeUiObject(p, id);
              })
            }
          >
            {!isCustomComponent && activeInstance && !localComponent ? <EyeOff size={14} /> : <Trash2 size={14} />}
            {!isCustomComponent && activeInstance && !localComponent ? '隐藏组件' : localComponent && inheritedComponent ? '删除本地覆盖' : '删除组件'}
          </button>

      </div>
    </> : <div className="ui-inspector-empty"><MousePointer2 size={26} /><strong>选择一个控件</strong><p>点击画布或左侧层级，调整它的内容、外观与交互。</p></div>}</div>}
      {section === 'game' && <div role="tabpanel" id={panelId + '-game'} aria-labelledby={panelId + '-game-tab'}>
      {hiddenComponents.length > 0 && <>
        <UiPropertyGroup title="已隐藏组件" icon={<EyeOff size={15} />} summary={String(hiddenComponents.length)}>
        <div className="ui-hidden-components">{hiddenComponents.map(hidden => <div key={hidden.id}><span>{hidden.component ? componentName(hidden.component) : '已移除的组件'}</span><IconButton title="显示组件" onClick={() => commit('显示界面组件', p => {
          const active = p.ui.instances?.find(instance => instance.id === activeInstance?.id);
          if (active) active.hiddenComponentIds = active.hiddenComponentIds?.filter(hiddenId => hiddenId !== hidden.id);
        })}><Eye size={14} /></IconButton></div>)}</div>
      </UiPropertyGroup></>}
      <UiPropertyGroup title="玩家与菜单" icon={<Settings2 size={15} />} defaultOpen>
      <PlayerDefaultsFields project={project} commit={commit} />
      <Field label="菜单快捷键打开" hint="游戏中按 Esc 或鼠标右键时打开的页面，再按一次返回剧情。"><select aria-label="菜单快捷键打开" value={project.ui.menuShortcutPage ?? 'save'} onChange={event => commit('菜单快捷键页面', p => { p.ui.menuShortcutPage = event.target.value as NonNullable<Project['ui']['menuShortcutPage']>; })}><option value="preferences">设置</option><option value="save">存档</option><option value="load">读档</option><option value="pause">暂停菜单</option></select></Field>
      </UiPropertyGroup>
      <UiPropertyGroup title="主题颜色与文字" icon={<Paintbrush size={15} />}>
      <div className="color-fields">
        {(["accent", "background", "textColor"] as const).map((key) => (
          <Field
            key={key}
            label={
              { accent: "强调色", background: "背景色", textColor: "文字色" }[
                key
              ]
            }
          >
            <input
              type="color"
              value={project.ui[key]}
              onChange={(e) =>
                commit(`界面颜色 ${key}`, (p) => {
                  p.ui[key] = e.target.value;
                })
              }
            />
          </Field>
        ))}
      </div>
      <Field label="主题字体"><UiAssetSelect assetUrl={assetUrl} project={project} kind="font" value={project.ui.fontAssetId} onChange={value => commit('主题字体', p => { p.ui.fontAssetId = value; })} /></Field>
      <Field label="对白等待图标" hint="文字显示完毕后，在句末提示点击继续。"><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" value={project.ui.continueIndicatorId} onChange={value => commit('对白等待图标', p => { p.ui.continueIndicatorId = value; })} /></Field>
      {project.ui.continueIndicatorId && <Field label="等待图标宽度"><NumberInput type="number"   value={project.ui.continueIndicatorWidth ?? project.assets.find(asset => asset.id === project.ui.continueIndicatorId)?.width ?? 32} onChange={event => commit('等待图标大小', p => { p.ui.continueIndicatorWidth = Number(event.target.value); })} /></Field>}
      <Field label={`字号 ${project.ui.fontSize}`}>
        <input
          type="range"
          min="16"
          max="64"
          value={project.ui.fontSize}
          onChange={(e) =>
            commit("界面字号", (p) => {
              p.ui.fontSize = Number(e.target.value);
            })
          }
        />
      </Field>
      </UiPropertyGroup>
      <UiPropertyGroup title="标题与声音" icon={<ImageIcon size={15} />}>
      <Field label="标题背景">
        <UiAssetSelect assetUrl={assetUrl} label="标题背景"
          project={project}
          kind="image"
          value={project.ui.menuBackgroundId}
          onChange={(value) =>
            commit("标题背景", (p) => {
              p.ui.menuBackgroundId = value;
            })
          }
        />
      </Field>
      <Field label="按钮悬停音效" hint="用于标题和各个菜单的按钮，跟随玩家音效音量。单个按钮可在属性中覆盖或关闭。"><UiAssetSelect project={project} kind="audio" assetUrl={assetUrl} label="默认按钮悬停音效" empty="不播放音效" value={project.ui.hoverSoundId} onChange={value => commit('按钮悬停音效', p => { p.ui.hoverSoundId = value; })} /></Field>
      <Field label="标题音乐" hint="进入标题页后循环播放，剧情配乐仍由演出动作或蓝图控制。"><UiAssetSelect project={project} kind="audio" assetUrl={assetUrl} label="标题音乐" empty="不播放音乐" value={project.ui.menuMusicId} onChange={value => commit('标题音乐', p => { p.ui.menuMusicId = value; })} /></Field>
      {project.ui.menuMusicId && <><audio aria-label="试听标题音乐" controls preload="metadata" src={assetUrl(project.ui.menuMusicId)} /><Field label="标题音乐淡入（秒）"><NumberInput type="number"   step={0.1} value={project.ui.menuMusicFade ?? 0.3} onChange={event => commit('标题音乐淡入', p => { p.ui.menuMusicFade = Number(event.target.value); })} /></Field></>}
      </UiPropertyGroup>
      <UiPropertyGroup title="章节进场" icon={<Layers size={15} />}>
        <Field label="默认章节效果"><select aria-label="主题章节效果" value={project.ui.chapterTransition?.effect ?? 'fade'} onChange={event => commit('章节效果', p => { p.ui.chapterTransition = { ...p.ui.chapterTransition, effect: event.target.value as 'none' | 'fade' | 'ink' }; })}>{Object.entries(chapterEffectNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
        <ChapterCompositionFields project={project} commit={commit} assetUrl={assetUrl} />
      </UiPropertyGroup>
      <UiPropertyGroup title="对白框" icon={<MessageSquare size={15} />}>
      <Field
        label={`对话框高度 ${Math.round(project.ui.dialogueHeight * 100)}%`}
      >
        <input
          type="range"
          min="15"
          max="60"
          value={project.ui.dialogueHeight * 100}
          onChange={(e) =>
            commit("对话框高度", (p) => {
              p.ui.dialogueHeight = Number(e.target.value) / 100;
            })
          }
        />
      </Field>
      <Field
        label={`对话框不透明度 ${Math.round(project.ui.dialogueOpacity * 100)}%`}
      >
        <input
          type="range"
          min="0"
          max="100"
          value={project.ui.dialogueOpacity * 100}
          onChange={(e) =>
            commit("对话框透明度", (p) => {
              p.ui.dialogueOpacity = Number(e.target.value) / 100;
            })
          }
        />
      </Field>

      </UiPropertyGroup></div>}
  </div>;
}
