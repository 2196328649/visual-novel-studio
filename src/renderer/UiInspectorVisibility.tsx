import { RotateCcw } from 'lucide-react';
import type { Project, UiComponent } from '../core/model';
import { applyUiDesignProperty, readUiDesignProperty, resetUiDesignProperty } from '../core/ui-design-properties';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import './ui-common-appearance.css';

/** Opacity belongs to the whole control, independently of its content appearance. */
export function UiInspectorOpacity({ project, component, edit }: {
  project: Project;
  component: UiComponent;
  edit: (change: (component: UiComponent) => void, options?: { separate?: boolean }) => void;
}) {
  const opacity = readUiDesignProperty(project, component, 'opacity');
  const playerOpacity = component.style?.playerOpacity;
  return <div className="ui-inspector-opacity">
    {opacity.applies && <div className="ui-design-property" data-ui-design-field="opacity">
      <div className="ui-design-property-control">
        <Field label="控件不透明度 %" hint="同时影响整个控件的文字、图片和内部内容。" uiProperty="opacity">
          <NumberInput aria-label="控件不透明度 %" min={0} max={100} step={1} value={Number((Number(opacity.value) * 100).toFixed(2))}
            onChange={event => edit(c => { applyUiDesignProperty(project, c, 'opacity', Number(event.target.value) / 100); })} />
        </Field>
        {opacity.canReset && !component.propertyControls?.opacity && <button type="button" className="ui-design-reset" aria-label="恢复控件不透明度 %" title="恢复控件不透明度 %"
          onClick={() => edit(c => { if (!c.propertyControls?.opacity) resetUiDesignProperty(c, 'opacity'); }, { separate: true })}><RotateCcw size={12} aria-hidden="true" /></button>}
      </div>
      <small className="ui-design-source" data-ui-design-source="opacity">{opacity.source}</small>
    </div>}
    {component.page === 'say' && <div className="ui-design-property" data-ui-design-field="playerOpacity">
      <div className="ui-design-property-control">
        <Field label="跟随玩家对话框透明度" hint="在控件不透明度上叠加玩家的对话框透明度；用于对话底图或装饰，文字通常保持关闭。">
          <input aria-label="跟随玩家对话框透明度" type="checkbox" checked={playerOpacity ?? false}
            onChange={event => edit(c => { c.style = { ...c.style, playerOpacity: event.target.checked }; })} />
        </Field>
        {playerOpacity !== undefined && <button type="button" className="ui-design-reset" aria-label="恢复跟随玩家对话框透明度" title="恢复跟随玩家对话框透明度"
          onClick={() => edit(c => { if (c.style) delete c.style.playerOpacity; }, { separate: true })}><RotateCcw size={12} aria-hidden="true" /></button>}
      </div>
      <small className="ui-design-source" data-ui-design-source="playerOpacity">{playerOpacity === undefined ? '默认关闭' : '本控件'}</small>
    </div>}
  </div>;
}
