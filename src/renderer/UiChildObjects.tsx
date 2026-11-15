import { useState } from 'react';
import { Layers } from 'lucide-react';
import { UiPropertyGroup } from './UiPropertyGroup';
import { NumberInput } from './NumberInput';
import { effectiveUiComponents, localUiComponents, makeId, uiComponentLimit, type Project, type UiComponent } from '../core/model';
import { duplicateUiSubtree, reparentUiComponent, uiSubtreeIds, uiAncestors, uiHierarchyDepthLimit, uiListOrder } from '../core/ui-hierarchy';
import { uiLayoutProblem } from '../core/ui-layout';
import { uiInspectorChildScope } from '../core/ui-inspector-layout';
import { Field } from './components';
import { componentName } from './UiNames';
import type { Commit } from './editor';

type ChildObjectsProps = {
  project: Project; component: UiComponent; peers: UiComponent[]; commit: Commit;
  edit: (change: (c: UiComponent) => void) => void; select?: (id?: string) => void;
  section?: 'all' | 'parent' | 'children';
  /** The caller already provides a named inspector group. */
  embedded?: boolean;
};

export function UiChildObjects({ project, component, peers, commit, edit, select, section = 'all', embedded = false }: ChildObjectsProps) {
  const [failure, setFailure] = useState<{ id: string; message: string }>();
  const subtree = uiSubtreeIds(peers, component.id), ordered = uiListOrder(peers.filter(c => c.page === component.page)), children = ordered.filter(c => c.parentId === component.id);
  const ancestors = uiAncestors(peers, component.id), parent = ancestors[0];
  const buttonAncestor = ancestors.some(c => c.kind === 'button'), scope = uiInspectorChildScope(component);
  const customPage = project.ui.customPages.find(p => p.components.some(c => c.id === component.id));
  const local = customPage?.components ?? localUiComponents(project.ui);
  const hasLayoutProblem = [component, ...ancestors].some(c => !!uiLayoutProblem(c));
  const canAdd = !hasLayoutProblem && local.length < uiComponentLimit && ancestors.length < uiHierarchyDepthLimit - 1 && component.width > 0 && component.height > 0;
  const fail = (error: unknown) => setFailure({ id: component.id, message: error instanceof Error ? error.message : String(error) });
  const targetList = (draft: Project) => {
    if (draft.id !== project.id) throw new Error('工程已切换，请重新选择对象后操作。');
    const page = customPage ? draft.ui.customPages.find(p => p.id === customPage.id) : undefined;
    if (customPage && !page) throw new Error('此界面已删除，请重新选择对象。');
    if (!customPage && draft.ui.activeInstanceId !== project.ui.activeInstanceId) throw new Error('界面方案已切换，请重新选择对象。');
    const current = page?.components ?? effectiveUiComponents(draft.ui);
    if (!current.some(c => c.id === component.id && c.page === component.page)) throw new Error('此对象已删除、隐藏或移动，请重新选择。');
    return page?.components ?? localUiComponents(draft.ui);
  };
  const add = (kind: 'image' | 'text' | 'button', background = false) => {
    const id = makeId('ui');
    const child: UiComponent = { id, page: component.page, parentId: component.id, childLayer: background ? 'background' : 'foreground', inheritState: kind !== 'button', kind,
      name: background ? '背景' : kind === 'image' ? '子图片' : kind === 'text' ? '子文字' : '子按钮', text: kind === 'text' ? '新的文字' : kind === 'button' ? '按钮' : '',
      x: 0, y: 0, width: 1, height: 1,
    };
    try {
      let added = false;
      commit('添加界面子对象', draft => {
        const list = targetList(draft);
        if (list.length >= uiComponentLimit) throw new Error('当前界面的对象数量已达上限。');
        list.push(child); added = true;
      }, { separate: true });
      if (added) setFailure(undefined);
    } catch (error) { fail(error); }
  };
  const showParent = section !== 'children', showChildren = section !== 'parent';
  const parentSummary = parent ? componentName(parent) : component.parentId ? '父对象已不存在' : '页面根级';
  const childrenSummary = `${children.length} 个子对象`;
  const content = <>
    {showParent && <><Field label="显示层级" hint="控制同级对象在画面中的前后遮挡，数值越大越靠前；与组件列表的排列顺序分别保存。" uiProperty="layer"><NumberInput aria-label="显示层级" step={.5} value={component.layer ?? peers.findIndex(c => c.id === component.id)} onChange={event => edit(c => { c.layer = Number(event.target.value); })} /></Field>
    <Field label="父对象" hint={component.parentId ? '位置和大小以父对象为参照；改变父级会保留当前画面位置。' : '位于页面根级。'}><select aria-label="父对象" disabled={hasLayoutProblem} value={component.parentId ?? ''} onChange={e => {
      try { const change = reparentUiComponent(peers, component.id, e.target.value || undefined, project); edit(c => Object.assign(c, change)); setFailure(undefined); } catch (error) { fail(error); }
    }}><option value="">页面根级</option>{component.parentId && !parent && <option value={component.parentId} disabled>父对象已不存在</option>}{ordered.filter(c => !subtree.has(c.id) && (c.id === component.parentId || c.width > 0 && c.height > 0)).map(c => <option key={c.id} value={c.id}>{componentName(c)}</option>)}</select></Field>
    {parent && select && <p className="ui-child-parent"><button type="button" className="text-button" onClick={() => select(parent.id)}>编辑父对象：{componentName(parent)}</button></p>}
    {hasLayoutProblem && <p className="ui-child-scope">先恢复不受支持的布局版本，再调整父子关系。</p>}
    {component.parentId && <>
      <Field label="放置位置" hint={component.childLayer === 'background' ? '位于父级图片和文字后方，适合外框和底纹。' : '位于父级图片和文字前方，适合图标和装饰。'}><select aria-label="子对象放置位置" disabled={hasLayoutProblem} value={component.childLayer ?? 'foreground'} onChange={e => edit(c => { c.childLayer = e.target.value as 'background' | 'foreground'; })}><option value="background">父级内容后方（背景）</option><option value="foreground">父级内容前方</option></select></Field>
      {(buttonAncestor || component.inheritState !== undefined) && <Field label="跟随父级按钮状态" hint={buttonAncestor ? '跟随直接父对象的普通、经过、按下和选中状态；跨多层时，中间各层也需要跟随状态。父级禁用会始终传到子对象。' : '当前没有按钮父级，设置会保留；放入按钮子树后可用于跟随按钮状态。'}><input aria-label="跟随父级按钮状态" type="checkbox" checked={component.inheritState ?? false} onChange={e => edit(c => { c.inheritState = e.target.checked; })} /></Field>}
    </>}</>}
    {failure?.id === component.id && <p role="alert">{failure.message}</p>}
    {showChildren && <>{scope && <p className="ui-child-scope">{scope}</p>}
    {children.length ? <ul aria-label="子对象列表" className="ui-child-list">{children.map(c => <li key={c.id}><button type="button" disabled={!select} onClick={() => select?.(c.id)}>{componentName(c)}</button><small>{c.childLayer === 'background' ? '背景' : '前方'}</small></li>)}</ul> : <p className="ui-child-scope">当前没有子对象。可以添加图片、文字或按钮，它们会跟随这个控件移动。</p>}
    <UiPropertyGroup id="structure-create" title="添加或复制对象" className="ui-child-add" searchKeywords="子图片 背景 子文字 子按钮 复制 副本">
      <div className="button-row"><button type="button" className="small-button" disabled={!canAdd} onClick={() => add('image')}>添加子图片</button><button type="button" className="small-button" disabled={!canAdd} onClick={() => add('image', true)}>添加背景子图</button><button type="button" className="small-button" disabled={!canAdd} onClick={() => add('text')}>添加子文字</button><button type="button" className="small-button" disabled={!canAdd} onClick={() => add('button')}>添加子按钮</button></div>
      {!canAdd && <p className="ui-child-action-help">{hasLayoutProblem ? '恢复布局版本后可添加子对象。' : '添加子对象需要非零宽高，且不能超过对象数量或层级深度上限。'}</p>}
      <button type="button" className="small-button" disabled={local.length + subtree.size > uiComponentLimit} onClick={() => {
        try {
          const originals = peers.filter(c => subtree.has(c.id)), copy = duplicateUiSubtree(peers, component.id, () => makeId('ui'));
          let added = false;
          commit('复制界面组件及子对象', draft => {
            const list = targetList(draft);
            if (list.length + copy.length > uiComponentLimit) throw new Error('复制后的对象数量超过当前界面的上限。');
            list.push(...copy); added = true;
          });
          if (added) { setFailure(undefined); select?.(copy[originals.findIndex(c => c.id === component.id)]?.id); }
        } catch (error) { fail(error); }
      }}>复制组件及子对象</button>
      <p className="ui-child-action-help">复制后各自独立，修改一份不会自动更新另一份。</p>
    </UiPropertyGroup></>}
  </>;
  if (embedded) return <div className="ui-child-objects" data-ui-structure-section={section}>{content}</div>;
  return <UiPropertyGroup id={section === 'all' ? 'structure' : `structure-${section}`} className="ui-child-objects"
    title={section === 'parent' ? '父级与层级' : section === 'children' ? '子对象' : '父级与子对象'} icon={<Layers size={15} />}
    summary={section === 'parent' ? parentSummary : (children.length || section === 'children') ? childrenSummary : parentSummary}
    searchKeywords={section === 'parent' ? '父对象 显示层级 前景 背景 跟随父级按钮状态' : section === 'children' ? '子对象 添加 图片 文字 按钮 复制 组合' : '父对象 层级 子对象 前景 背景 按钮状态 添加 图片 文字 按钮 复制 组合'}>
    {content}
  </UiPropertyGroup>;
}
