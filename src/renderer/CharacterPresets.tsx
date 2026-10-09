import { useState } from 'react';
import { effectiveCharacter, makeId, type Character, type CharacterDisplayPreset, type Project } from '../core/model';
import { builtinDisplayPresets, characterDisplayPresets, characterDisplayPreset, displayPresetPlacement, displayPresetLabel } from '../core/character-presets';
import { portraitGeometry } from '../core/portrait';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import type { AssetUrl } from './StageEditor';

export function CharacterPresetSelect({ project, characterId, value = '', onChange, label = '站位预设' }: {
  project: Project; characterId?: string; value?: string; onChange: (value: string) => void; label?: string;
}) {
  const presets = characterDisplayPresets(project, characterId ?? '');
  return <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
    <option value="default">{characterId ? displayPresetLabel(project, characterId, 'default') : '当前台词角色的默认站位'}</option>
    {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    <option value="">手动位置</option>
    {value && value !== 'default' && !presets.some(p => p.id === value) && <option value={value}>自定义预设：{value}</option>}
  </select>;
}

export function CharacterPresets({ project, character, assetUrl, onChange }: {
  project: Project; character: Character; assetUrl: AssetUrl;
  onChange: (patch: Pick<Character, 'displayPresets' | 'defaultDisplayPresetId'>) => void;
}) {
  const effective = effectiveCharacter(project, character.id)!;
  const presets = characterDisplayPresets(project, character.id);
  const [selectedId, setSelectedId] = useState('center'), [expressionId, setExpressionId] = useState('');
  const selected = presets.find(p => p.id === selectedId) ?? presets[0];
  const expression = effective.expressions.find(e => e.id === expressionId) ?? effective.expressions.find(e => e.id === effective.defaultExpressionId) ?? effective.expressions[0];
  const image = portraitGeometry(project.assets.find(a => a.id === expression?.assetId), project.width, project.height);
  const placement = expression && displayPresetPlacement(project, character.id, expression.id, selected.id);
  const update = (patch: Partial<CharacterDisplayPreset>) => {
    const next = { ...selected, ...patch };
    onChange({ displayPresets: [...(character.displayPresets ?? []).filter(p => p.id !== next.id), next] });
  };
  const number = (label: string, value: number, change: (value: number) => void) => <Field label={label}><NumberInput aria-label={label} type="number" step={1} value={+value.toPrecision(12)} onChange={event => { const n = event.target.valueAsNumber; if (Number.isFinite(n)) change(n); }} /></Field>;
  return <section className="character-setting-card" aria-label="角色站位预设"><h3>角色站位预设</h3>
    <p className="muted">显示角色时可关联左、中、右或自定义预设。修改这里会更新所有引用；选择“角色默认”的指令还会跟随默认项切换。</p>
    <Field label="默认站位预设"><select aria-label="默认站位预设" value={characterDisplayPreset(project, character.id)?.id ?? 'center'} onChange={event => onChange({ defaultDisplayPresetId: event.target.value })}>{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    <Field label="编辑站位预设"><select aria-label="编辑站位预设" value={selected.id} onChange={event => setSelectedId(event.target.value)}>{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    <div className="field-row"><button disabled={(character.displayPresets?.length ?? 0) >= 64} onClick={() => {
      const preset = { ...selected, id: makeId('pose'), name: `自定义站位 ${presets.length - 2}` };
      onChange({ displayPresets: [...(character.displayPresets ?? []), preset] }); setSelectedId(preset.id);
    }}>复制为新预设</button>{builtinDisplayPresets.some(p => p.id === selected.id) && <button onClick={() => update(builtinDisplayPresets.find(p => p.id === selected.id)!)}>恢复此站位</button>}</div>
    <Field label="预设名称"><input aria-label="预设名称" value={selected.name} maxLength={80} onChange={event => { if (event.target.value.trim()) update({ name: event.target.value }); }} /></Field>
    <label className="check-field"><input aria-label="预设使用默认构图" type="checkbox" checked={selected.useDefaultFraming} onChange={event => update({ useDefaultFraming: event.target.checked })} />按角色默认构图计算</label>
    <p className="muted">{selected.useDefaultFraming ? '50% 对应默认构图的横向中心，纵向偏移 0% 保持原位，缩放 100% 保持默认半身大小。' : '按原图定位：横向为图片中心，纵向为图片底部，缩放 100% 为原图大小。'}</p>
    {number('预设横向位置 %', selected.x * 100, x => update({ x: x / 100 }))}
    {number(selected.useDefaultFraming ? '预设纵向偏移 %' : '预设纵向位置 %', (selected.y - (selected.useDefaultFraming ? 1 : 0)) * 100, y => update({ y: y / 100 + (selected.useDefaultFraming ? 1 : 0) }))}
    {number('预设缩放 %', selected.scale * 100, scale => { if (scale > 0) update({ scale: scale / 100 }); })}
    <Field label="预设预览表情"><select aria-label="预设预览表情" value={expression?.id ?? ''} onChange={event => setExpressionId(event.target.value)}>{effective.expressions.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
    <div aria-label="角色站位预设预览" data-preset-id={selected.id} style={{ position: 'relative', aspectRatio: `${project.width}/${project.height}`, background: '#354146', overflow: 'hidden', borderRadius: 6 }}>
      {expression && placement && <img src={assetUrl(expression.assetId)} alt={effective.name} style={{ position: 'absolute', width: `${image.width * placement.scale / project.width * 100}%`, maxWidth: 'none', height: `${image.height * placement.scale / project.height * 100}%`, left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, transform: 'translate(-50%, -100%)' }} />}
    </div>
  </section>;
}
