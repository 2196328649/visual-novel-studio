import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Project, UiComponent, VariableValue } from '../core/model';
import { recoverUiLayout, resolveUiLayout, uiLayoutProblem } from '../core/ui-layout';
import { applyUiDesignProperty, readUiDesignProperty, resetUiDesignProperty } from '../core/ui-design-properties';
import { uiProperties } from '../core/ui-properties';
import { uiPropertyControlDesignSnapshot } from '../core/ui-property-control-snapshot';
import { hasUiInspectorLayoutValue, uiInspectorChildScope, uiInspectorContainerProperties, uiInspectorLayoutContext, uiInspectorPaddingProperties, uiInspectorTransformProperties, type UiInspectorLayoutProperty } from '../core/ui-inspector-layout';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { componentName } from './UiNames';
import { UiPropertyGroup } from './UiPropertyGroup';
import { useUiInspectorGroupActive } from './UiInspectorContext';

type LayoutProps = {
  project: Project; component: UiComponent; components: UiComponent[];
  edit: (change: (component: UiComponent) => void, options?: { separate?: boolean }) => void;
  select?: (id: string) => void;
  /** Object transforms belong to the common area; the container edits its children. */
  section?: 'all' | 'object' | 'children';
};
const labels: Record<UiInspectorLayoutProperty, string> = {
  anchorX: '横向锚点', anchorY: '纵向锚点', pivotX: '横向轴心', pivotY: '纵向轴心', layoutRotation: '整体旋转', scaleX: '横向缩放', scaleY: '纵向缩放',
  layoutFlow: '排列方式', layoutOrder: '排列顺序', childGap: '子对象间距', paddingLeft: '左侧', paddingRight: '右侧', paddingTop: '上方', paddingBottom: '下方',
  clipChildren: '裁剪超出部分', scrollMode: '滚动方向', scrollX: '横向初始位置', scrollY: '纵向初始位置',
};
const precise = new Set<UiInspectorLayoutProperty>(['anchorX', 'anchorY', 'pivotX', 'pivotY', 'scaleX', 'scaleY']);
const layoutHints: Partial<Record<UiInspectorLayoutProperty, string>> = {
  anchorX: '父内容区中的横向参照点：0 为左侧、0.5 为中央、1 为右侧；X 是相对此点的偏移。根级相对画面。',
  anchorY: '父内容区中的纵向参照点：0 为上方、0.5 为中央、1 为下方；Y 是相对此点的偏移。根级相对画面。',
  pivotX: '自身的横向轴心：0 为左侧、0.5 为中央、1 为右侧。定位、旋转和缩放围绕此点进行。',
  pivotY: '自身的纵向轴心：0 为上方、0.5 为中央、1 为下方。定位、旋转和缩放围绕此点进行。',
  scaleY: '负值镜像；0 不可见且不可命中。先缩放再旋转，不改变排列槽位。',
  scrollX: '保存初始滚动位置（像素）。实际显示会按内容边界限制；关闭横向滚动时保留设置，横向有效位置为 0。',
  scrollY: '保存初始滚动位置（像素）。实际显示会按内容边界限制；关闭纵向滚动时保留设置，纵向有效位置为 0。',
};

function UiLayoutPropertyField({ project, component, property, change, reset }: {
  project: Project; component: UiComponent; property: UiInspectorLayoutProperty;
  change: (property: UiInspectorLayoutProperty, value: VariableValue) => void; reset: (properties: readonly UiInspectorLayoutProperty[]) => void;
}) {
  const info = uiProperties[property], state = readUiDesignProperty(project, component, property);
  const unit = info.unit === '画面像素' ? 'px' : property === 'layoutRotation' ? '°' : property.startsWith('scale') ? '倍' : '';
  const hint = layoutHints[property] ?? info.description;
  const input = info.options
    ? <select aria-label={info.name} value={String(state.value)} onChange={event => change(property, event.target.value)}>{Object.entries(info.options).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
    : info.type === 'boolean'
      ? <input aria-label={info.name} type="checkbox" checked={Boolean(state.value)} onChange={event => change(property, event.target.checked)} />
      : <span className="ui-layout-value"><NumberInput aria-label={info.name} min={info.min} max={info.max} step={precise.has(property) ? .01 : 1} value={Number(state.value)} onChange={event => change(property, Number(event.target.value))} />{unit && <small aria-hidden="true">{unit}</small>}</span>;
  return <div className={`ui-layout-property-field${info.options || info.type === 'boolean' || property === 'layoutRotation' || property === 'layoutOrder' ? ' ui-layout-wide' : ''}${info.type === 'boolean' ? ' ui-layout-toggle' : ''}`} title={state.source} data-ui-layout-property={property}>
    <Field label={labels[property]} hint={hint} uiProperty={property}>{input}</Field>
    {state.canReset && !component.propertyControls?.[property] && <button type="button" className="text-button ui-layout-reset" title={`恢复${labels[property]}默认值`} aria-label={`恢复${info.name}默认值`} onClick={() => reset([property])}><RotateCcw size={13} /></button>}
  </div>;
}

function UiLayoutScrollReadout({ project, component, components }: Pick<LayoutProps, 'project' | 'component' | 'components'>) {
  const active = useUiInspectorGroupActive();
  const geometry = useMemo(() => {
    if (!active) return;
    const snapshots = components.map(item => uiPropertyControlDesignSnapshot(project, item));
    const hidden = new Set(snapshots.filter(snapshot => snapshot.values.visible === false).map(snapshot => snapshot.component.id));
    return resolveUiLayout(snapshots.map(snapshot => snapshot.component), project, item => !hidden.has(item.id)).get(component.id);
  }, [active, components, project, component.id]);
  if (!geometry) return null;
  return <output className="ui-layout-output" aria-label="容器设计滚动范围">
    横向 {geometry.scrollMinimumX.toFixed(1)}～{geometry.scrollMaximumX.toFixed(1)} px<br />
    纵向 {geometry.scrollMinimumY.toFixed(1)}～{geometry.scrollMaximumY.toFixed(1)} px<br />
    有效位置 {geometry.scrollX.toFixed(1)}, {geometry.scrollY.toFixed(1)} px<br />
    内容 {geometry.contentWidth.toFixed(1)} × {geometry.contentHeight.toFixed(1)} px
  </output>;
}

/** Keep object coordinates and child arrangement in separate common-property groups. */
export function UiLayoutFields({ project, component, components, edit, select, section = 'all' }: LayoutProps) {
  const [failure, setFailure] = useState<{ id: string; message: string }>(), [configureId, setConfigureId] = useState<string>();
  const context = uiInspectorLayoutContext(component, components), { parent, layout, parentLayout } = context;
  const problem = uiLayoutProblem(component), scope = uiInspectorChildScope(component);
  const apply = (change: (target: UiComponent) => void, separate = false) => {
    try { edit(change, { separate }); setFailure(undefined); } catch (error) { setFailure({ id: component.id, message: error instanceof Error ? error.message : String(error) }); }
  };
  const change = (property: UiInspectorLayoutProperty, value: VariableValue) => apply(target => { applyUiDesignProperty(project, target, property, value); });
  const reset = (properties: readonly UiInspectorLayoutProperty[]) => apply(target => { for (const property of properties) if (!target.propertyControls?.[property]) resetUiDesignProperty(target, property); }, true);
  const fields = (properties: readonly UiInspectorLayoutProperty[]) => <div className="ui-layout-property-grid">{properties.map(property => <UiLayoutPropertyField key={property} project={project} component={component} property={property} change={change} reset={reset} />)}</div>;
  const resetButton = (properties: readonly UiInspectorLayoutProperty[], label: string) => properties.some(property => !component.propertyControls?.[property] && hasUiInspectorLayoutValue(component, property)) && <button type="button" className="text-button ui-layout-group-reset" title={properties.some(property => component.propertyControls?.[property]) ? '只恢复未关联项；已关联项的原设计默认值保留。' : undefined} onClick={() => reset(properties)}>{label}</button>;
  const showObject = section !== 'children', showChildren = section !== 'object';
  return <div className="ui-layout-fields" data-ui-layout-section={section}>
    {showObject && <><p className="ui-layout-context">
      {parent ? <>父对象：{select ? <button type="button" className="text-button" onClick={() => select(parent.id)}>{componentName(parent)}</button> : componentName(parent)}。<br />
        {context.background ? '背景子对象相对父对象外框定位，不参与前景排列和滚动。' : context.arranged ? `${parentLayout?.flow === 'horizontal' ? '横向' : '纵向'}排列：X/Y 为排列中的附加偏移；宽高按父内容区比例计算。` : '自由布局：位置和宽高均以父内容区为参照。'}
      </> : component.parentId ? '父对象已不存在，请在“父对象”中重新选择。' : '页面根级：位置和宽高以画面为参照。'}
    </p>
    {parent && uiLayoutProblem(parent) && <p className="ui-layout-note">父对象的布局版本暂不支持，当前按默认布局显示；可选中父对象恢复。</p>}</>}
    {failure?.id === component.id && <p role="alert" className="ui-layout-problem">{failure.message}</p>}
    {problem ? <div role="alert" className="ui-layout-problem"><p>{problem}</p>{showObject ? <button type="button" className="small-button" onClick={() => apply(target => { target.layout = recoverUiLayout(target); }, true)}>保留原数据并恢复默认布局</button> : <p>请在通用属性的“位置与大小”中恢复布局，再调整子对象。</p>}</div> : <>
      {showObject && <>{context.showOrder && <>{fields(['layoutOrder'])}{!context.arranged && <p className="ui-layout-note">排列顺序已保留，仅在父对象采用横向或纵向排列且本对象位于前景时影响位置。</p>}</>}
      <UiPropertyGroup id="layout-transform" title="更多布局" summary={`${layout.rotation}° · ${layout.scaleX} × ${layout.scaleY}`} searchKeywords="锚点 轴心 旋转 缩放 镜像 anchor pivot rotation scale">
        {fields(uiInspectorTransformProperties)}
        {resetButton(uiInspectorTransformProperties, '恢复锚点与变换默认值')}
      </UiPropertyGroup></>}
      {showChildren && (section === 'children' || context.container || configureId === component.id ? <UiPropertyGroup id="layout-children" title="子对象布局" summary={uiProperties.layoutFlow.options?.[layout.flow]} defaultOpen={section === 'children'} revealOn={configureId === component.id ? component.id : undefined} searchKeywords="容器 前景 排列 自由布局 横向 纵向 间距 内边距 裁剪 滚动">
        {section === 'all' && scope && <p className="ui-layout-note">{scope}</p>}
        {!context.children.length && <p className="ui-layout-note">当前没有子对象。添加后会使用这里的布局设置。</p>}
        {fields(context.showGap ? ['layoutFlow', 'childGap'] : ['layoutFlow'])}
        {context.showGap && layout.flow === 'absolute' && <p className="ui-layout-note">子对象间距已保留，切换为横向或纵向排列后生效。</p>}
        <UiPropertyGroup id="layout-padding" title="内边距" summary={`左 ${layout.paddingLeft} · 上 ${layout.paddingTop} · 右 ${layout.paddingRight} · 下 ${layout.paddingBottom}`} searchKeywords="左侧 上方 右侧 下方 padding 内容区">
          {fields(uiInspectorPaddingProperties)}
        </UiPropertyGroup>
        <UiPropertyGroup id="layout-scroll" title="裁剪与滚动" summary={layout.scroll === 'none' ? layout.clip ? '裁剪超出部分' : '不裁剪、不滚动' : uiProperties.scrollMode.options?.[layout.scroll]} searchKeywords="裁剪 滚动 横向 纵向 位置 范围 内容 clip scroll" defaultOpen={layout.scroll !== 'none'}>
          {fields(['scrollMode', 'clipChildren'])}
          {layout.scroll !== 'none' && !layout.clip && <p className="ui-layout-note">启用滚动时会自动裁剪；上方开关决定关闭滚动后是否仍裁剪。</p>}
          {(context.showScrollX || context.showScrollY) && fields([...(context.showScrollX ? ['scrollX' as const] : []), ...(context.showScrollY ? ['scrollY' as const] : [])])}
          {(context.showScrollX && !context.scrollXEnabled || context.showScrollY && !context.scrollYEnabled) && <p className="ui-layout-note">未开启方向的初始位置已保留，当前有效位置为 0。</p>}
          {(layout.scroll !== 'none' || context.showScrollX || context.showScrollY) && <UiPropertyGroup id="layout-scroll-range" title="查看滚动范围" searchKeywords="有效位置 内容宽度 高度 范围 上限 下限">
            <UiLayoutScrollReadout project={project} component={component} components={components} />
          </UiPropertyGroup>}
        </UiPropertyGroup>
        {resetButton(uiInspectorContainerProperties, '恢复子对象布局默认值')}
      </UiPropertyGroup> : <button type="button" className="text-button" onClick={() => setConfigureId(component.id)}>设置子对象布局…</button>)}
      {showObject && component.layout?.recovery && <p className="ui-layout-note">恢复前的布局数据已保留在工程中。</p>}
    </>}
  </div>;
}
