import { NumberInput } from './NumberInput';
import { ActorInstanceField, ActorLifetimeSelect } from './ActorInstanceFields';
import type { ShowActor } from '../core/actor-instance';
import { effectiveCharacter, type BlueprintGraph, type BlueprintPin, type Project, type VariableValue, type VisualObject } from '../core/model';
import { blueprintInputTarget, speakerExpression, rawSavedBlueprintAction } from '../core/blueprint-authoring';
import { visualInputFields } from '../core/visual-object';
import { UiAssetSelect } from './AssetPicker';
import type { AssetUrl } from './StageEditor';
import { browserBridge } from './browserBridge';
import { CharacterPresetSelect } from './CharacterPresets';
import { blueprintAssetFilter } from '../core/blueprint-assets';

export function BlueprintParameterValue({ project, graph, pin, value, onChange, assetUrl, speakerId, label = pin.name }: {
  project: Project; graph: BlueprintGraph; pin: BlueprintPin; value: VariableValue; onChange: (value: VariableValue) => void; assetUrl?: AssetUrl; speakerId?: string; label?: string;
}) {
  const target = blueprintInputTarget(graph, pin.id, project);
  const expression = target.pinId === 'expressionId';
  const characterId = target.node?.type === 'showCharacter' && !target.node.properties.characterId ? speakerId : String(target.node?.properties.characterId ?? '');
  const character = effectiveCharacter(project, characterId ?? '');
  if (target.pinId === 'characterId' && target.node?.type === 'showCharacter') return <select aria-label={label} value={String(value)} onChange={event => onChange(event.target.value)}><option value="">当前台词角色（自动）</option>{project.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>;
  if (target.pinId === 'lifetime') return <ActorLifetimeSelect value={(value || undefined) as ShowActor['lifetime']} label={label} onChange={value => onChange(value ?? '')} />;
  if (target.pinId === 'instanceId') return <ActorInstanceField project={project} characterId={characterId} value={String(value ?? '')} label={label} onChange={value => onChange(value ?? '')} />;
  if (target.pinId === 'presetId') return <CharacterPresetSelect project={project} characterId={characterId} value={String(value)} label={label} onChange={onChange} />;
  const url = assetUrl ?? (id => { const asset = project.assets.find(asset => asset.id === id); return asset ? (window.studio ?? browserBridge).assetUrl(asset.path) : undefined; });
  if (expression && character) {
    const expressions = character.expressions;
    const selected = speakerExpression(project, characterId, value);
    return <div className="blueprint-expression-value"><select aria-label={label} value={String(value)} onChange={event => onChange(event.target.value)}><option value="">角色默认表情</option>{expressions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{selected && <img alt={`表情预览：${selected.name}`} src={url(selected.assetId)} />}</div>;
  }
  const object = target.node && rawSavedBlueprintAction(target.node);
  const property = object?.kind === 'visual' ? visualInputFields(object).find(field => 'object_' + field.key === target.pinId)?.path.at(-1) : undefined;
  if (property === 'outlineColor' || property === 'shadowColor') return <input type="color" aria-label={label} value={String(value)} onChange={event => onChange(event.target.value)} />;
  if (property === 'outlineWidth' || property === 'shadowBlur' || property === 'outlineOpacity' || property === 'shadowOpacity') {
    const opacity = property === 'outlineOpacity' || property === 'shadowOpacity';
    return <NumberInput aria-label={label} min={0} max={opacity ? 1 : undefined} step={opacity ? .05 : 1} value={Number(value)} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value) && value >= 0 && (!opacity || value <= 1)) onChange(value); }} />;
  }
  if (property === 'textAlign' || property === 'textVerticalAlign') {
    const choices = property === 'textAlign' ? { left: '左对齐', center: '居中', right: '右对齐' } : { top: '顶部', center: '居中', bottom: '底部' };
    return <select aria-label={label} value={String(value || 'center')} onChange={event => onChange(event.target.value)}>{Object.entries(choices).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>;
  }
  if (pin.dataType === 'asset') {
    const { kind, category } = blueprintAssetFilter(project, graph, pin);
    return <UiAssetSelect project={project} kind={kind} category={category} allowEmpty={!pin.required} value={String(value) || undefined} onChange={value => onChange(value ?? '')} label={label} assetUrl={url} empty={kind === 'font' ? '使用对象原字体' : '无'} />;
  }
  if (pin.dataType === 'boolean') return <select aria-label={label} value={String(value)} onChange={event => onChange(event.target.value === 'true')}><option value="true">是</option><option value="false">否</option></select>;
  if (pin.dataType === 'number') return <NumberInput aria-label={label} type="number" step="any" value={Number(value)} onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber); }} />;
  if (pin.dataType === 'character' || pin.dataType === 'scene') return <select aria-label={label} value={String(value)} onChange={event => onChange(event.target.value)}><option value="">请选择</option>{(pin.dataType === 'character' ? project.characters : project.scenes).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>;
  if (target.pinId === 'effect' && target.node?.type === 'showChapter') return <select aria-label={label} value={String(value)} onChange={event => onChange(event.target.value)}><option value="">作品默认</option><option value="ink">笔触消散</option><option value="fade">淡入淡出</option><option value="none">无动画</option></select>;
  if (target.pinId === 'direction' && target.node?.type === 'shake') return <select aria-label={label} value={String(value)} onChange={event => onChange(event.target.value)}><option value="vertical">纵向</option><option value="horizontal">横向</option></select>;
  return <input aria-label={label} value={String(value)} placeholder={expression ? '留空使用角色默认表情' : undefined} onChange={event => onChange(event.target.value)} />;
}

export function BlueprintCallFields({ project, graph, inputs = {}, onChange, assetUrl, speakerId }: {
  project: Project; graph?: BlueprintGraph; inputs?: Record<string, VariableValue>; onChange: (inputs: Record<string, VariableValue> | undefined) => void; assetUrl?: AssetUrl; speakerId?: string;
}) {
  if (!graph?.exposedInputs.length) return null;
  const change = (id: string, value?: VariableValue) => { const next = { ...inputs }; if (value === undefined) delete next[id]; else next[id] = value; onChange(Object.keys(next).length ? next : undefined); };
  return <div className="blueprint-call-inputs">{graph.chapterVariant && <p className="chapter-variant-note">{graph.chapterVariant === 'image' ? '图片版 · 文字标题可选用“章节进入演出文字版”' : '文字版 · 两行小字、标题与右侧字可分别编辑'}</p>}{graph.exposedInputs.map(pin => {
    const fallback = pin.defaultValue ?? (pin.dataType === 'number' ? 0 : pin.dataType === 'boolean' ? false : '');
    const override = Object.hasOwn(inputs, pin.id);
    return <div key={pin.id} className="blueprint-call-parameter"><label className="blueprint-parameter-label"><input type="checkbox" aria-label={`单独设置${pin.name}`} checked={override} onChange={event => change(pin.id, event.target.checked ? fallback : undefined)} /><span>{pin.name}</span></label><fieldset disabled={!override}><BlueprintParameterValue project={project} graph={graph} pin={pin} value={inputs[pin.id] ?? fallback} onChange={value => change(pin.id, value)} assetUrl={assetUrl} speakerId={speakerId} /></fieldset></div>;
  })}</div>;
}
