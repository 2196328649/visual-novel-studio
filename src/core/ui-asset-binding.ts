import { variableAssetKind, type Project, type UiComponent, type Variable, type VariableValue } from './model';

/** Image and video components can show the asset held by an image or video parameter. */
export const uiAssetBindingKinds = { image: 'image', video: 'video' } as const;
export type UiAssetBindingKind = keyof typeof uiAssetBindingKinds;

export function uiAssetBindable<T extends Pick<UiComponent, 'kind'>>(component: T): component is T & { kind: UiAssetBindingKind } {
  return component.kind === 'image' || component.kind === 'video';
}
/** Parameters a component of this kind may bind to. */
export function uiAssetBindingCandidates(project: Project, component: Pick<UiComponent, 'kind'>): Variable[] {
  return uiAssetBindable(component) ? project.variables.filter(variable => variableAssetKind(variable) === component.kind) : [];
}
/** The bound parameter when the binding is valid for this component. */
export function uiAssetBinding(project: Project, component: Pick<UiComponent, 'kind' | 'assetParameterId'>): Variable | undefined {
  if (!component.assetParameterId || !uiAssetBindable(component)) return;
  const variable = project.variables.find(item => item.id === component.assetParameterId);
  return variable && variableAssetKind(variable) === component.kind ? variable : undefined;
}
export function uiAssetBindingProblem(project: Project, component: UiComponent): string | undefined {
  if (!component.assetParameterId) return;
  const variable = project.variables.find(item => item.id === component.assetParameterId);
  if (!variable) return '控件绑定的素材参数已不存在，请在组件设置中重新选择。';
  if (!uiAssetBindable(component) || variableAssetKind(variable) !== component.kind) return `参数“${variable.name}”的类型与控件不符，请选择${component.kind === 'video' ? '视频' : '图片'}参数。`;
}
/** The asset shown for a bound value: the parameter's asset, else the component's own asset. */
export function uiBoundAssetId(project: Project, component: UiComponent, value: VariableValue | undefined): string | undefined {
  const variable = uiAssetBinding(project, component);
  if (!variable) return component.assetId;
  const asset = typeof value === 'string' && value ? project.assets.find(item => item.id === value) : undefined;
  return asset && asset.kind === component.kind ? asset.id : component.assetId;
}
