import { useState } from 'react';
import { Layers } from 'lucide-react';
import { UiPropertyGroup } from './UiPropertyGroup';
import { NumberInput } from './NumberInput';
import { localUiComponents, makeId, uiComponentLimit, type Project, type UiComponent } from '../core/model';
import { duplicateUiSubtree, reparentUiComponent, resolveUiHierarchy, uiSubtreeIds, uiAncestors, uiHierarchyDepthLimit, uiListOrder } from '../core/ui-hierarchy';
import { Field } from './components';
import { componentName } from './UiNames';
import type { Commit } from './editor';

export function UiChildObjects({ project, component, peers, commit, edit, select }: { project: Project; component: UiComponent; peers: UiComponent[]; commit: Commit; edit: (change: (c: UiComponent) => void) => void; select?: (id?: string) => void }) {
  const [error, setError] = useState('');
  const subtree = uiSubtreeIds(peers, component.id), children = uiListOrder(peers.filter(c => c.page === component.page)).filter(c => c.parentId === component.id);
  const customPage = project.ui.customPages.find(p => p.components.some(c => c.id === component.id));
  const local = customPage?.components ?? localUiComponents(project.ui);
  const canAdd = local.length < uiComponentLimit && uiAncestors(peers, component.id).length < uiHierarchyDepthLimit - 1 && component.width > 0 && component.height > 0;
  const targetList = (draft: Project) => customPage ? draft.ui.customPages.find(p => p.id === customPage.id)!.components : localUiComponents(draft.ui);
  const add = (kind: 'image' | 'text' | 'button', background = false) => {
    const id = makeId('ui');
    const child: UiComponent = { id, page: component.page, parentId: component.id, childLayer: background ? 'background' : 'foreground', inheritState: kind !== 'button', kind,
      name: background ? '背景' : kind === 'image' ? '子图片' : kind === 'text' ? '子文字' : '子按钮', text: kind === 'text' ? '新的文字' : kind === 'button' ? '按钮' : '',
      x: 0, y: 0, width: 1, height: 1,
    };
    commit('添加界面子对象', draft => { targetList(draft).push(child); }); select?.(id);
  };
  return <UiPropertyGroup key={component.id} className="ui-child-objects" title="父级与子对象" icon={<Layers size={15} />} defaultOpen={!!component.parentId} summary={component.parentId ? componentName(peers.find(c => c.id === component.parentId) ?? component) : children.length ? `${children.length} 个子对象` : '页面根级'}>
    <Field label="显示层级" hint="控制同级对象在画面中的前后遮挡，数值越大越靠前；与组件列表的排列顺序分别保存。"><NumberInput aria-label="显示层级" step={.5} value={component.layer ?? peers.findIndex(c => c.id === component.id)} onChange={event => edit(c => { c.layer = Number(event.target.value); })} /></Field>
    <Field label="父对象" hint={component.parentId ? '位置和大小以父对象为参照；改变父级会保留当前画面位置。' : '位于页面根级。'}><select aria-label="父对象" value={component.parentId ?? ''} onChange={e => {
      try { const change = reparentUiComponent(peers, component.id, e.target.value || undefined); edit(c => Object.assign(c, change)); setError(''); } catch (e) { setError((e as Error).message); }
    }}><option value="">页面根级</option>{resolveUiHierarchy(peers).filter(row => row.component.page === component.page && !subtree.has(row.component.id) && row.component.width > 0 && row.component.height > 0).map(({ component: c }) => <option key={c.id} value={c.id}>{componentName(c)}</option>)}</select></Field>
    {error && <p role="alert">{error}</p>}
    {component.parentId && <>
      <Field label="放置位置" hint={component.childLayer === 'background' ? '位于父级图片和文字后方，适合外框和底纹。' : '位于父级图片和文字前方，适合图标和装饰。'}><select aria-label="子对象放置位置" value={component.childLayer ?? 'foreground'} onChange={e => edit(c => { c.childLayer = e.target.value as 'background' | 'foreground'; })}><option value="background">父级内容后方（背景）</option><option value="foreground">父级内容前方</option></select></Field>
      {component.kind !== 'button' && <Field label="跟随父级按钮状态"><input aria-label="跟随父级按钮状态" type="checkbox" checked={component.inheritState ?? false} onChange={e => edit(c => { c.inheritState = e.target.checked; })} /></Field>}
    </>}
    {!!children.length && <ul aria-label="子对象列表" className="ui-child-list">{children.map(c => <li key={c.id}><button type="button" onClick={() => select?.(c.id)}>{componentName(c)}</button><small>{c.childLayer === 'background' ? '背景' : '前方'}</small></li>)}</ul>}
    <div className="button-row"><button className="small-button" disabled={!canAdd} onClick={() => add('image')}>添加子图片</button><button className="small-button" disabled={!canAdd} onClick={() => add('image', true)}>添加背景子图</button><button className="small-button" disabled={!canAdd} onClick={() => add('text')}>添加子文字</button><button className="small-button" disabled={!canAdd} onClick={() => add('button')}>添加子按钮</button></div>
    <button className="small-button" disabled={local.length + subtree.size > uiComponentLimit} onClick={() => {
      const copy = duplicateUiSubtree(peers, component.id, () => makeId('ui'));
      commit('复制界面组件及子对象', draft => { targetList(draft).push(...copy); }); select?.(copy[peers.filter(c => subtree.has(c.id)).findIndex(c => c.id === component.id)]?.id);
    }}>复制组件及子对象</button>
  </UiPropertyGroup>;
}
