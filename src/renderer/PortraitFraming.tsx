import { useState } from 'react';
import { effectiveCharacter, type Character, type Project } from '../core/model';
import { defaultPortraitFraming, portraitGeometry, portraitPlacement } from '../core/portrait';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import type { AssetUrl } from './StageEditor';

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return <Field label={label}><NumberInput type="number" value={+value.toPrecision(12)} min={min} max={max} step={step} onChange={event => onChange(event.target.valueAsNumber)} /></Field>;
}

export function PortraitFraming({ project, character, assetUrl, onChange }: { project: Project; character: Character; assetUrl: AssetUrl; onChange: (value: Character['portraitFraming']) => void }) {
  const effective = effectiveCharacter(project, character.id)!;
  const [selected, setSelected] = useState('');
  const expression = effective.expressions.find(e => e.id === selected) ?? effective.expressions.find(e => e.id === effective.defaultExpressionId) ?? effective.expressions[0];
  const framing = { ...defaultPortraitFraming, ...effective.portraitFraming };
  const image = portraitGeometry(project.assets.find(a => a.id === expression?.assetId), project.width, project.height);
  const placement = expression && portraitPlacement(project, character.id, expression.id);
  return <section className="character-setting-card" aria-label="默认立绘构图"><h3>默认立绘构图</h3>
    <p className="muted">显示角色使用站位预设时生效。按可见内容计算，忽略图片的透明留白；单次演出可关闭默认构图并填写位置和缩放。</p>
    <div className="field-row"><button onClick={() => onChange({ ...defaultPortraitFraming })}>半身</button><button onClick={() => onChange({ x: .5, top: .06, visibleFraction: 1 })}>全身</button></div>
    <NumberField label="画面横向中心 %" value={framing.x * 100} step={1} onChange={value => onChange({ ...framing, x: value / 100 })} />
    <NumberField label="头顶位置 %" value={framing.top * 100} min={-100} max={90} step={1} onChange={value => onChange({ ...framing, top: Math.max(-1, Math.min(.9, value / 100)) })} />
    <NumberField label="显示立绘高度 %" value={framing.visibleFraction * 100} min={10} max={100} step={1} onChange={value => onChange({ ...framing, visibleFraction: Math.max(.1, Math.min(1, value / 100)) })} />
    <Field label="构图预览表情"><select aria-label="构图预览表情" value={expression?.id ?? ''} onChange={event => setSelected(event.target.value)}>{effective.expressions.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
    <div aria-label="角色默认构图预览" style={{ position: 'relative', aspectRatio: `${project.width}/${project.height}`, background: '#354146', overflow: 'hidden', borderRadius: 6 }}>
      {expression && placement && <img src={assetUrl(expression.assetId)} alt={effective.name} style={{ position: 'absolute', width: `${image.width * placement.scale / project.width * 100}%`, maxWidth: 'none', height: `${image.height * placement.scale / project.height * 100}%`, left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, transform: 'translate(-50%, -100%)' }} />}
      <div style={{ position: 'absolute', left: 0, right: 0, top: `${framing.top * 100}%`, borderTop: '1px dashed #cddadb66', pointerEvents: 'none' }} />
    </div>
  </section>;
}
