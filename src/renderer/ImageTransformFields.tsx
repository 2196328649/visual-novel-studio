import { defaultImageTransform, type ImageTransform } from '../core/image-transform';
import { NumberInput } from './NumberInput';

export function ImageTransformFields({ value, onChange, label = '图片变换' }: { value: ImageTransform; onChange: (value: ImageTransform) => void; label?: string }) {
  const number = (name: string, axis: string, key: keyof ImageTransform, multiplier = 1, min?: number, max?: number) => <label>{axis}<NumberInput aria-label={name} type="number" value={Number((value[key] * multiplier).toFixed(5))} min={min} max={max} step={1} onChange={event => {
    const amount = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, event.target.valueAsNumber));
    onChange({ ...value, [key]: amount / multiplier });
  }} /></label>;
  return <details open className="ui-property-group image-transform" aria-label={label}><summary>{label}</summary>
    <div className="transform-row"><span>位置 %</span>{number('图片位置 X', 'X', 'x', 100)}{number('图片位置 Y', 'Y', 'y', 100)}</div>
    <div className="transform-row"><span>旋转 °</span>{number('图片旋转 Z', 'Z', 'rotation')}</div>
    <div className="transform-row"><span>缩放 %</span>{number('图片缩放 X', 'X', 'scaleX', 100)}{number('图片缩放 Y', 'Y', 'scaleY', 100)}</div>
    <p className="muted">100% 以适配后的图片为基准；X 调整宽，Y 调整高。</p>
    <div className="transform-row"><span>不透明</span>{number('图片不透明度', '%', 'opacity', 100, 0, 100)}</div>
    <button type="button" className="small-button" onClick={() => onChange({ ...defaultImageTransform })}>重置变换</button>
  </details>;
}
