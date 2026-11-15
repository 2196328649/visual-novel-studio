import type { Project, VariableValue } from './model';
import { uiPageInterface, uiPageInterfaceKnown, uiPageOutputDefaults, validUiPageParameterValue } from './ui-page-interface';

/** Stable completion codes; the old free-text result remains a separate value. */
export const uiPageReasons = {
  completed: '完成', cancelled: '取消', alreadyOpen: '页面已打开', shown: '已叠加显示', parentClosed: '上层页面已关闭', navigated: '已离开流程',
} as const;
export type UiPageReason = keyof typeof uiPageReasons;
export interface UiPageCompletion { result: string; reason: UiPageReason; outputs?: Record<string, VariableValue> }
export function uiPageReason(value: unknown): UiPageReason {
  return typeof value === 'string' && Object.hasOwn(uiPageReasons, value) ? value as UiPageReason : 'completed';
}

/** Cancelled or non-waiting opens never leak a previous instance's partial result. */
export function uiPageCompletion(project: Project, pageId: string, result: string, reason: UiPageReason, supplied: Record<string, VariableValue> = {}): UiPageCompletion {
  const definition = uiPageInterface(project, pageId);
  if (!uiPageInterfaceKnown(definition)) throw new Error('页面接口版本不受支持。');
  const outputs = uiPageOutputDefaults(project, pageId);
  if (reason === 'completed') for (const [id, value] of Object.entries(supplied)) {
    const parameter = definition?.outputs.find(parameter => parameter.id === id);
    if (!parameter || !validUiPageParameterValue(parameter.dataType, value)) throw new Error('页面结果定义已失效或值的类型不匹配：' + id);
    outputs[id] = value;
  }
  return { result, reason, ...(Object.keys(outputs).length ? { outputs } : {}) };
}
