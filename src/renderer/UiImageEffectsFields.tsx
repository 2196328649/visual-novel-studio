import type { Project, UiComponent } from '../core/model';
import { uiImageCropFields } from '../core/ui-image';
import { applyUiDesignProperty, readUiDesignProperty, resetUiDesignProperty } from '../core/ui-design-properties';
import { uiProperties, type UiProperty } from '../core/ui-properties';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { RotateCcw } from 'lucide-react';
import { UiDesignColorField } from './UiDesignColorField';
import { UiPropertyGroup } from './UiPropertyGroup';

/** Property labels, defaults and paths are shared with blueprint authoring. */
export function UiImageEffectsFields({ project, component, edit }: { project: Project; component: UiComponent; edit: (change: (component: UiComponent) => void, options?: { separate?: boolean }) => void }) {
  const tint = readUiDesignProperty(project, component, 'imageTint');
  const properties: readonly UiProperty[] = [...Object.keys(uiImageCropFields) as (keyof typeof uiImageCropFields)[], 'imageFlipX', 'imageFlipY', 'imageTint'];
  return <UiPropertyGroup id="appearance-image-effects" title="图片裁切、翻转与乘色" searchKeywords="图片 裁切 裁剪 翻转 乘色 透明">
    <p className="muted ui-field-help">裁切使用源图比例，超出源图的部分会裁去；零面积透明。先裁切、再缩放，九宫格边距以裁切后的图为准。翻转和乘色只影响本图片，不改变控件或子项布局。</p>
    <div className="ui-appearance-columns">{(Object.keys(uiImageCropFields) as (keyof typeof uiImageCropFields)[]).map(property => {
      const value = readUiDesignProperty(project, component, property), label = uiProperties[property].name + ' %';
      return <div key={property} className="ui-design-property" data-ui-design-field={property}><div className="ui-design-property-control"><Field label={label} uiProperty={property}>
        <NumberInput aria-label={label} min={0} max={100} step={.1} value={Number(value.value) * 100} onChange={event => edit(c => { applyUiDesignProperty(project, c, property, Number(event.target.value) / 100); })} />
      </Field>{value.canReset && !component.propertyControls?.[property] && <button type="button" className="ui-design-reset" aria-label={`恢复${label}`} onClick={() => edit(c => { if (!c.propertyControls?.[property]) resetUiDesignProperty(c, property); }, { separate: true })}><RotateCcw size={12} aria-hidden="true" /></button>}</div><small className="ui-design-source" data-ui-design-source={property}>{value.source}</small></div>;
    })}</div>
    <div className="ui-appearance-columns">{(['imageFlipX', 'imageFlipY'] as const).map(property => {
      const value = readUiDesignProperty(project, component, property);
      return <Field key={property} label={uiProperties[property].name} uiProperty={property}><input aria-label={uiProperties[property].name} type="checkbox" checked={Boolean(value.value)} onChange={event => edit(c => { applyUiDesignProperty(project, c, property, event.target.checked); })} /></Field>;
    })}</div>
    <UiDesignColorField property="imageTint" label={uiProperties.imageTint.name} value={String(tint.value)} source={tint.source} canReset={tint.canReset} onReset={() => edit(c => { if (!c.propertyControls?.imageTint) resetUiDesignProperty(c, 'imageTint'); }, { separate: true })} onChange={value => edit(c => { applyUiDesignProperty(project, c, 'imageTint', value); })} />
    <button type="button" className="text-button" disabled={!properties.some(property => !component.propertyControls?.[property] && readUiDesignProperty(project, component, property).canReset)} title={properties.some(property => component.propertyControls?.[property]) ? '只重置未关联项；已关联项的原设计默认值保留。' : undefined} onClick={() => edit(c => { for (const property of properties) if (!c.propertyControls?.[property]) resetUiDesignProperty(c, property); }, { separate: true })}>重置图片效果</button>
  </UiPropertyGroup>;
}
