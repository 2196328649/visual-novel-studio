import type { Project, UiComponent, VariableValue } from './model';
import { uiLayoutProblem } from './ui-layout';
import { bindingNames } from './ui-names';
import { uiProperties, uiPropertyApplies, uiPropertyDefault, uiPropertyValueProblem, type UiProperty, type UiPropertyDefinition } from './ui-properties';
import { uiSpineSkinProblem } from './ui-spine';

/** Design fields are deliberate: runtime observations, transient values and
 * ranges/source changes that must be edited atomically keep dedicated editors. */
export const uiDesignProperties = [
  'text', 'layer', 'x', 'y', 'width', 'height', 'opacity', 'value',
  'anchorX', 'anchorY', 'pivotX', 'pivotY', 'layoutRotation', 'scaleX', 'scaleY',
  'layoutFlow', 'layoutOrder', 'childGap', 'paddingLeft', 'paddingTop', 'paddingRight', 'paddingBottom',
  'clipChildren', 'scrollMode', 'scrollX', 'scrollY',
  'font', 'fontSize', 'textColor', 'hoverTextColor', 'selectedTextColor', 'disabledTextColor', 'align',
  'outlineWidth', 'outlineColor', 'outlineOpacity', 'shadowX', 'shadowY', 'shadowColor', 'shadowOpacity', 'shadowBlur', 'shadowSpread',
  'background', 'hoverBackground', 'pressedBackground', 'selectedBackground', 'disabledBackground', 'borderWidth', 'borderColor', 'radius',
  'idleImage', 'hoverImage', 'pressedImage', 'selectedImage', 'disabledImage', 'tooltip', 'hoverSound', 'clickSound',
  'image', 'imageFit', 'imageCropX', 'imageCropY', 'imageCropWidth', 'imageCropHeight', 'imageFlipX', 'imageFlipY', 'imageTint',
  'video', 'videoPoster', 'videoLoop',
  'spineSkin', 'spineLoop', 'spineSpeed', 'spineFit', 'spineScale', 'spineOriginX', 'spineOriginY', 'spineRotation', 'spineFlipX', 'spineFlipY',
  'readOnly', 'placeholder', 'maxLength',
  'sliderTrackImage', 'sliderFillImage', 'sliderThumbImage', 'sliderHoverThumbImage', 'sliderPressedThumbImage', 'sliderDisabledThumbImage',
  'sliderTrackColor', 'sliderFillColor', 'sliderThumbColor', 'sliderTrackHeight', 'sliderThumbWidth', 'sliderThumbHeight', 'sliderReverse', 'sliderShowLabel',
] as const satisfies readonly UiProperty[];

const designProperties: ReadonlySet<string> = new Set(uiDesignProperties);
const requiredFields: ReadonlySet<UiProperty> = new Set(['text', 'x', 'y', 'width', 'height']);
const staticFontKinds: readonly UiComponent['kind'][] = [
  'choiceList', 'saveSlots', 'preference', 'preferenceChoice', 'pauseMenu', 'historyList', 'galleryGrid',
  'musicTrackList', 'voiceCollection', 'chapterList', 'chapterTitle', 'staffRoll',
];
const staticTextKinds: readonly UiComponent['kind'][] = [...staticFontKinds, 'keyboard', 'messageBox', 'gameOver'];
const defaultSurfaceKinds: readonly UiComponent['kind'][] = [
  'choiceList', 'saveSlots', 'preferenceChoice', 'pauseMenu', 'historyList', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList',
];
const staticDesignKinds: Partial<Record<UiProperty, readonly UiComponent['kind'][]>> = {
  font: staticFontKinds, fontSize: staticTextKinds, textColor: staticTextKinds,
  align: ['choiceList', 'chapterTitle'],
  outlineWidth: ['chapterTitle'], outlineColor: ['chapterTitle'], outlineOpacity: ['chapterTitle'],
  shadowX: ['chapterTitle'], shadowY: ['chapterTitle'], shadowColor: ['chapterTitle'], shadowOpacity: ['chapterTitle'], shadowBlur: ['chapterTitle'], shadowSpread: ['chapterTitle'],
  background: [...staticTextKinds, 'image', 'video', 'spine'],
};
const stateImageFallbacks: Partial<Record<UiProperty, readonly UiProperty[]>> = {
  hoverImage: ['idleImage'], pressedImage: ['hoverImage', 'idleImage'], selectedImage: ['hoverImage', 'idleImage'], disabledImage: ['idleImage'],
  sliderHoverThumbImage: ['sliderThumbImage'], sliderPressedThumbImage: ['sliderHoverThumbImage', 'sliderThumbImage'], sliderDisabledThumbImage: ['sliderThumbImage'],
};

export interface UiDesignPropertyValue {
  value: VariableValue;
  localValue: VariableValue | undefined;
  source: string;
  canReset: boolean;
  applies: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function definition(property: UiProperty): UiPropertyDefinition {
  if (!Object.hasOwn(uiProperties, property)) throw new Error('设计属性不存在。');
  return uiProperties[property];
}

/** The design editor also supports static styles on native/list controls.
 * This does not advertise new runtime writes or parameter bindings. */
export function uiDesignPropertyApplies(component: UiComponent, property: UiProperty, project?: Project): boolean {
  if (!designProperties.has(property) || !Object.hasOwn(uiProperties, property)) return false;
  const info = uiProperties[property];
  return info.writable && info.path.length > 0 &&
    (staticDesignKinds[property]?.includes(component.kind) === true || uiPropertyApplies(component, property, project));
}

function editableDefinition(component: UiComponent, property: UiProperty, project?: Project): UiPropertyDefinition {
  const info = definition(property);
  if (!designProperties.has(property) || !info.writable || !info.path.length) throw new Error('此属性不能单独编辑设计值，请使用对应的专用设置。');
  if (!uiDesignPropertyApplies(component, property, project)) throw new Error(info.name + '不适用于此控件。');
  return info;
}

function fieldValue(component: UiComponent, path: readonly string[]): unknown {
  let value: unknown = component;
  for (const key of path) {
    if (!isRecord(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

function fieldContainer(component: UiComponent, path: readonly string[], create: boolean): Record<string, unknown> | undefined {
  let target = component as unknown as Record<string, unknown>;
  for (const [index, key] of path.slice(0, -1).entries()) {
    let child = Object.hasOwn(target, key) ? target[key] : undefined;
    if (child === undefined) {
      if (!create) return undefined;
      child = index === 0 && key === 'layout' ? { version: 1 } : {};
      target[key] = child;
    }
    if (!isRecord(child)) throw new Error('此控件的属性分组数据无效，请先修复该分组。');
    target = child;
  }
  return target;
}

/** Writes only the authored field; callers own drafts, undo and persistence. */
export function applyUiDesignProperty(project: Project, component: UiComponent, property: UiProperty, value: VariableValue): boolean {
  const info = editableDefinition(component, property, project);
  if (property === 'text' && component.binding) throw new Error('此文字由“' + bindingNames[component.binding] + '”提供，请先将文字内容切换为“固定文字”。');
  const problem = uiPropertyValueProblem(project, property, value);
  if (problem) throw new Error(problem);
  if (info.path[0] === 'layout') {
    const layoutProblem = uiLayoutProblem(component);
    if (layoutProblem) throw new Error(layoutProblem);
  }
  if (property === 'spineSkin') {
    const skinProblem = uiSpineSkinProblem(project.assets.find(asset => asset.id === component.assetId && asset.kind === 'spine'), value);
    if (skinProblem) throw new Error(skinProblem);
  }
  // Optional resource IDs cannot store an empty ID in the project schema.
  if (info.resource && value === '') return resetUiDesignProperty(component, property);
  if (Object.is(fieldValue(component, info.path), value)) return false;
  fieldContainer(component, info.path, true)![info.path.at(-1)!] = value;
  return true;
}

/** Never clear a group: siblings, recovery data and future fields survive. */
export function resetUiDesignProperty(component: UiComponent, property: UiProperty): boolean {
  const info = editableDefinition(component, property);
  if (requiredFields.has(property)) throw new Error(info.name + '需要保留明确的设计值，请直接修改。');
  if (info.path[0] === 'layout') {
    const layoutProblem = uiLayoutProblem(component);
    if (layoutProblem) throw new Error(layoutProblem);
  }
  const target = fieldContainer(component, info.path, false), key = info.path.at(-1)!;
  if (!target || !Object.hasOwn(target, key)) return false;
  delete target[key];
  return true;
}

function defaultSource(component: UiComponent, property: UiProperty, value: VariableValue): string {
  const style = component.style;
  if (['font', 'fontSize', 'textColor', 'hoverSound', 'clickSound'].includes(property)) return '页面默认';
  if (['hoverTextColor', 'selectedTextColor', 'disabledTextColor'].includes(property)) return style?.textColor != null ? '沿用普通状态' : '页面默认';
  if (property === 'hoverBackground' && style?.background != null) return '沿用普通状态';
  if ((property === 'pressedBackground' || property === 'selectedBackground') && !(component.kind === 'progress' && property === 'selectedBackground')) {
    if (style?.hoverBackground != null) return '沿用鼠标经过状态';
    if (component.kind !== 'button' && style?.background != null) return '沿用普通状态';
  }
  if (property === 'disabledBackground' && component.kind !== 'button' && style?.background != null) return '沿用普通状态';
  if ((component.kind === 'button' && ['hoverBackground', 'pressedBackground', 'selectedBackground'].includes(property)) || (component.kind === 'progress' && property === 'selectedBackground')) return '页面默认';
  if (property === 'sliderFillColor' && !component.slider?.trackId) return '页面默认';
  if (property === 'tooltip' && component.skin?.hideText) return '沿用按钮文字';
  if (property === 'layer') return '同级顺序';
  if (uiProperties[property].color && typeof value === 'string' && /^#[0-9a-f]{6}00$/i.test(value)) return '默认透明';
  if (uiProperties[property].resource) return '未设置';
  return '默认值';
}

/** Reading never materializes inherited/default values in the authored model. */
export function readUiDesignProperty(project: Project, component: UiComponent, property: UiProperty): UiDesignPropertyValue {
  const info = definition(property), applies = uiDesignPropertyApplies(component, property, project);
  if (!applies) return { value: info.initial, localValue: undefined, source: '不适用于设计编辑', canReset: false, applies: false };
  const raw = fieldValue(component, info.path);
  const localValue = typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw
    : raw === null && info.resource === 'audio' ? '' : undefined;
  const canReset = !requiredFields.has(property) && raw !== undefined && !(info.path[0] === 'layout' && uiLayoutProblem(component));
  const imageFallbacks = stateImageFallbacks[property];
  if (imageFallbacks && !raw) {
    for (const fallback of imageFallbacks) {
      const image = fieldValue(component, uiProperties[fallback].path);
      if (typeof image === 'string' && image) return { value: image, localValue, canReset, applies,
        source: fallback === 'hoverImage' || fallback === 'sliderHoverThumbImage' ? '沿用鼠标经过状态' : '沿用普通状态' };
    }
    return { value: '', localValue, source: '未设置', canReset, applies };
  }
  let value = uiPropertyDefault(project, component, property);
  // These controls render their own repeated/native surfaces. Their static
  // design defaults are intentionally separate from runtime property support.
  if (property === 'background' && raw == null && defaultSurfaceKinds.includes(component.kind) && !(component.kind === 'historyList' && component.list?.historyLayout === 'columns')) value = '#283133';
  const source = property === 'text' && component.binding ? '由“' + bindingNames[component.binding] + '”提供'
    : localValue !== undefined ? '本控件' : defaultSource(component, property, value);
  return { value, localValue, source, canReset, applies };
}
