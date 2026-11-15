import { useState, type ReactNode } from 'react';
import { Ellipsis, Plus, GitBranch, Trash2 } from 'lucide-react';
import { inheritanceReaches, makeId, type Project, type UiComponent } from '../core/model';
import { projectGraphs } from '../core/project-resources';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import type { OpenBlueprintGraph } from './blueprint-navigation';
import { IconButton } from './components';
import { ParameterEditor } from './ParameterEditor';
import { UiToolbarPopover } from './UiToolbarPopover';
import { editorLayoutEvent, updateEditorLayout } from '../core/editor-layout';

export function UiPageOptions({ project, page, customPageId, commit, assetUrl, openBlueprint, createCustomPage, deleteCustomPage, clearSelection, connectionActions }: {
  project: Project; page: UiComponent['page']; customPageId?: string; commit: Commit; assetUrl: AssetUrl;
  openBlueprint?: OpenBlueprintGraph; createCustomPage: () => void; deleteCustomPage: () => void; clearSelection: () => void; connectionActions: ReactNode;
}) {
  const customPages = project.ui.customPages, activeCustomPage = customPages.find(p => p.id === customPageId);
  const instances = project.ui.instances ?? [], activeInstance = instances.find(instance => instance.id === project.ui.activeInstanceId);
  const canCreateInstance = instances.length < 64, derivedInstances = instances.filter(instance => instance.baseUiId === activeInstance?.id && !!activeInstance);
  const [minigameId, setMinigameId] = useState('');
  const pageMinigames = (project.minigames ?? []).filter(item => item.uiPageId === activeCustomPage?.id);
  const activeMinigame = pageMinigames.find(item => item.id === minigameId) ?? pageMinigames[0];
  const select = (_id?: string) => clearSelection();
  const createInstance = (derived: boolean) => {
    if (!canCreateInstance) return;
    const id = makeId('ui_instance');
    commit(derived ? '创建派生界面实例' : '新建界面实例', draft => {
      const items = draft.ui.instances ??= [];
      if (items.length >= 64) return;
      items.push({ id, name: derived && activeInstance ? activeInstance.name.slice(0, 114) + ' 派生' : '界面实例 ' + (items.length + 1), baseUiId: derived ? activeInstance?.id : undefined, components: [] });
      draft.ui.activeInstanceId = id;
    }, { separate: true });
    clearSelection();
  };
  return <UiToolbarPopover label="页面选项" title="页面选项：新建、重命名、使用位置与界面方案" icon={<Ellipsis size={17} />}>
    <div className="ui-page-menu-actions"><button type="button" className="small-button" disabled={customPages.length >= 64} onClick={createCustomPage}><Plus size={14} />新建自定义页面</button>
      {page === 'custom' && <button type="button" className="small-button" data-close-ui-popover aria-label="删除自定义页面" title={pageMinigames.length ? '先删除使用此页面的旧交互定义' : '删除自定义页面'} disabled={!activeCustomPage || pageMinigames.length > 0} onClick={deleteCustomPage}><Trash2 size={14} />删除页面</button>}
    </div>
    {page === 'custom' && activeCustomPage && <label><span>页面名称</span><input aria-label="自定义页面名称" maxLength={120} value={activeCustomPage.name} onChange={event => { if (event.target.value.trim()) commit('自定义页面名称', draft => { const target = draft.ui.customPages.find(item => item.id === activeCustomPage.id); if (target) target.name = event.target.value; }); }} /></label>}
    {connectionActions}
    {page !== 'custom' && <details className="ui-scheme-options"><summary>界面方案 · {activeInstance?.name ?? '基础界面'}</summary>
      <label title="选择要编辑并供游戏使用的界面方案；派生方案可以继承基础方案的控件和主题。"><span>界面方案</span><select aria-label="选择界面实例" value={activeInstance?.id ?? ''} onChange={event => {
        const instanceId = event.target.value || undefined;
        commit('切换界面实例', draft => { draft.ui.activeInstanceId = instanceId; });
        select(undefined);
      }}><option value="">主题默认</option>{instances.map(instance => <option key={instance.id} value={instance.id}>{instance.name}</option>)}</select></label>
      <div className="ui-page-menu-actions">
        <IconButton title={canCreateInstance ? '新建界面实例' : '界面实例已达 64 个'} disabled={!canCreateInstance} onClick={() => createInstance(false)}><Plus size={16} /></IconButton>
        <IconButton title="创建派生界面实例" disabled={!activeInstance || !canCreateInstance} onClick={() => createInstance(true)}><GitBranch size={16} /></IconButton>
        <IconButton title={derivedInstances.length ? `被 ${derivedInstances.length} 个界面实例继承，无法删除` : '删除界面实例'} disabled={!activeInstance || derivedInstances.length > 0} onClick={() => {
          if (!activeInstance || derivedInstances.length) return;
          commit('删除界面实例', draft => {
            if (draft.ui.instances?.some(instance => instance.baseUiId === activeInstance.id)) return;
            draft.ui.instances = draft.ui.instances?.filter(instance => instance.id !== activeInstance.id);
            draft.ui.activeInstanceId = activeInstance.baseUiId;
          });
          select(undefined);
        }}><Trash2 size={16} /></IconButton>
      </div>
      {activeInstance && <>
        <label><span>名称</span><input aria-label="界面实例名称" maxLength={120} value={activeInstance.name} onChange={event => {
          const name = event.target.value;
          if (!name.trim()) return;
          commit('界面实例名称', draft => { const instance = draft.ui.instances?.find(item => item.id === activeInstance.id); if (instance) instance.name = name; });
        }} /></label>
        <label><span>继承自</span><select aria-label="基础界面实例" value={activeInstance.baseUiId ?? ''} onChange={event => {
          const baseUiId = event.target.value || undefined;
          commit('界面实例继承', draft => {
            const items = draft.ui.instances ?? [];
            if (inheritanceReaches(items, baseUiId, activeInstance.id, item => item.baseUiId)) return;
            const instance = items.find(item => item.id === activeInstance.id);
            if (instance) instance.baseUiId = baseUiId;
          });
          select(undefined);
        }}><option value="">主题默认</option>{instances.filter(instance => !inheritanceReaches(instances, instance.id, activeInstance.id, item => item.baseUiId)).map(instance => <option key={instance.id} value={instance.id}>{instance.name}</option>)}</select></label>
        <label title="供当前方案的多个页面共用；只修改本页行为请使用右侧页面事件。"><span>方案共用蓝图</span><select aria-label="界面实例蓝图" value={activeInstance.blueprintId ?? ''} onChange={event => commit('界面实例蓝图', draft => { const instance = draft.ui.instances?.find(item => item.id === activeInstance.id); if (instance) instance.blueprintId = event.target.value || undefined; })}><option value="">不绑定</option>{(projectGraphs(project) ?? []).map(graph => <option key={graph.id} value={graph.id}>{graph.name}</option>)}</select></label>
      </>}
    </details>}
    {page === 'custom' && pageMinigames.length > 0 && <details><summary>旧工程交互定义</summary>
      <p className="muted">旧工程兼容：以下定义继续用于已有剧情。新交互请直接使用页面事件和通用蓝图，无需创建小游戏。</p>
      <label><span>旧交互定义</span><select aria-label="选择小游戏定义" value={activeMinigame?.id ?? ''} onChange={event => setMinigameId(event.target.value)}><option value="">选择小游戏</option>{pageMinigames.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="ui-page-menu-actions"><IconButton title={activeMinigame && project.nodes.some(node => node.kind === 'minigame' && node.minigameId === activeMinigame.id) ? '剧情节点正在使用此小游戏' : '删除小游戏定义'} disabled={!activeMinigame || project.nodes.some(node => node.kind === 'minigame' && node.minigameId === activeMinigame.id)} onClick={() => {
        if (!activeMinigame) return;
        const nextId = pageMinigames.find(item => item.id !== activeMinigame.id)?.id ?? '';
        commit('删除小游戏定义', draft => { draft.minigames = (draft.minigames ?? []).filter(item => item.id !== activeMinigame.id); });
        setMinigameId(nextId);
      }}><Trash2 size={16} /></IconButton></div>
      {activeMinigame && <><label><span>名称</span><input aria-label="小游戏名称" maxLength={120} value={activeMinigame.name} onChange={event => { if (event.target.value.trim()) commit('小游戏名称', draft => { const target = draft.minigames?.find(item => item.id === activeMinigame.id); if (target) target.name = event.target.value; }); }} /></label>
        <label><span>逻辑来源</span><select aria-label="小游戏逻辑来源" value={activeMinigame.mode} onChange={event => commit('小游戏逻辑来源', draft => { const target = draft.minigames?.find(item => item.id === activeMinigame.id); if (!target) return; target.mode = event.target.value as 'blueprint' | 'script'; if (target.mode === 'blueprint') target.blueprintId ??= projectGraphs(draft)?.find(item => item.kind === 'minigame')?.id; else { const scriptAsset = draft.assets.find(item => item.kind === 'script'); if (!scriptAsset) return; target.script ??= { assetId: scriptAsset.id, entry: 'minigame_main', args: {} }; target.script.assetId ||= scriptAsset.id; } })}><option value="blueprint">蓝图</option><option value="script" disabled={!project.assets.some(item => item.kind === 'script')}>Ren'Py 脚本</option></select></label>
        {activeMinigame.mode === 'blueprint' ? <label><span>逻辑蓝图</span><select aria-label="小游戏逻辑蓝图" value={activeMinigame.blueprintId ?? ''} onChange={event => commit('小游戏逻辑蓝图', draft => { const target = draft.minigames?.find(item => item.id === activeMinigame.id); if (target) target.blueprintId = event.target.value || undefined; })}><option value="">选择蓝图</option>{(projectGraphs(project) ?? []).filter(item => item.kind === 'minigame').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <><label><span>脚本素材</span><select aria-label="小游戏脚本素材" value={activeMinigame.script?.assetId ?? ''} onChange={event => commit('小游戏脚本素材', draft => { const target = draft.minigames?.find(item => item.id === activeMinigame.id); if (target) target.script = { assetId: event.target.value, entry: target.script?.entry ?? 'minigame_main', args: target.script?.args ?? {} }; })}><option value="">选择 .rpy 脚本</option>{project.assets.filter(item => item.kind === 'script').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>入口 Label</span><input aria-label="小游戏脚本入口" value={activeMinigame.script?.entry ?? ''} onChange={event => { if (/^[a-z][a-z0-9_]{0,63}$/.test(event.target.value)) commit('小游戏脚本入口', draft => { const target = draft.minigames?.find(item => item.id === activeMinigame.id); if (target) target.script = { assetId: target.script?.assetId ?? '', entry: event.target.value, args: target.script?.args ?? {} }; }); }} /></label><div className="minigame-script-args"><span>入口参数</span><ParameterEditor value={activeMinigame.script?.args ?? {}} onChange={args => commit('小游戏脚本参数', draft => { const target = draft.minigames?.find(item => item.id === activeMinigame.id); if (target?.script) target.script.args = args; })} /></div></>}
      </>}
      {activeMinigame?.mode === 'blueprint' && activeMinigame.blueprintId && openBlueprint && <button className="text-button" onClick={() => openBlueprint(activeMinigame.blueprintId!)}><GitBranch size={13} />编辑逻辑蓝图</button>}
    </details>}
    <div className="ui-layout-reset-menu"><button type="button" className="text-button" data-close-ui-popover aria-label="恢复面板布局" title="只恢复编辑器面板的位置与尺寸，不改变页面或控件。" onClick={() => {
      const key = updateEditorLayout(localStorage, { workspace: 'ui', reset: true });
      window.dispatchEvent(new CustomEvent(editorLayoutEvent, { detail: key }));
    }}>恢复面板布局</button></div>
  </UiToolbarPopover>;
}
