import type { StoryFlowRect } from '../core/story-flow';
import { Field } from './components';
import { NumberInput } from './NumberInput';

export function UiFlowRectNumbers({ name, value, onChange }: { name: string; value: StoryFlowRect; onChange: (value: StoryFlowRect) => void }) {
  return <div className="ui-border-fields">{(['x', 'y', 'width', 'height'] as const).map(key => <Field key={key} label={`${name}${{ x: '横向', y: '纵向', width: '宽度', height: '高度' }[key]} %`}>
    <NumberInput type="number" step={.1} value={Number((value[key] * 100).toFixed(2))} onChange={event => {
      const next = event.target.valueAsNumber / 100;
      if (Number.isFinite(next) && (key === 'x' || key === 'y' || next >= 0)) onChange({ ...value, [key]: next });
    }} />
  </Field>)}</div>;
}

export function UiFlowRectFields({ name, value, automatic, onChange }: { name: string; value?: StoryFlowRect; automatic: StoryFlowRect; onChange: (value?: StoryFlowRect) => void }) {
  return <div className="ui-inner-rect">
    <Field label={`自定义${name}位置`}><input type="checkbox" checked={!!value} onChange={event => onChange(event.target.checked ? { ...automatic } : undefined)} /></Field>
    {value && <UiFlowRectNumbers name={name} value={value} onChange={onChange} />}
  </div>;
}
