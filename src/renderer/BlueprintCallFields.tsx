import { BlueprintValueInput } from './BlueprintValueInput';
import { ActorInstanceField, ActorLifetimeSelect } from './ActorInstanceFields';
import type { ShowActor } from '../core/actor-instance';
import { effectiveCharacter, type BlueprintGraph, type BlueprintPin, type Project, type VariableValue } from '../core/model';
import { blueprintActorInstanceTargets, blueprintInputTarget, speakerExpression, rawSavedBlueprintAction } from '../core/blueprint-authoring';
import { visualInputFields } from '../core/visual-object';
import { UiAssetSelect } from './AssetPicker';
import type { AssetUrl } from './StageEditor';
import { browserBridge } from './browserBridge';
import { CharacterPresetSelect } from './CharacterPresets';
import { blueprintAssetFilter } from '../core/blueprint-assets';

export function BlueprintParameterValue({ project, graph, pin, value, onChange, assetUrl, speakerId, label = pin.name, compact = false }: {
  project: Project; graph: BlueprintGraph; pin: BlueprintPin; value: VariableValue; onChange: (value: VariableValue) => void; assetUrl?: AssetUrl; speakerId?: string; label?: string; compact?: boolean;
}) {
  const target = blueprintInputTarget(graph, pin.id, project);
  const actorTargets = pin.dataType === 'string' ? blueprintActorInstanceTargets(graph, pin.id, project) : [];
  const common = (options: { min?: number; max?: number; step?: number } = {}) => <BlueprintValueInput compact={compact} project={project} type={pin.dataType} value={value} label={label} {...options} onChange={next => {
    // Clearing a reference means an explicit empty input. Only the override
    // checkbox restores the graph default; unfinished numeric text stays local.
    if (next === undefined) { if (['character', 'scene', 'ui', 'component', 'string'].includes(pin.dataType)) onChange(''); }
    else onChange(next);
  }} />;
  if (actorTargets.length && typeof value === 'string') {
    const actor = actorTargets.length === 1 ? actorTargets[0] : undefined;
    const characterId = actor?.type === 'showCharacter' && !actor.properties.characterId ? speakerId : typeof actor?.properties.characterId === 'string' ? actor.properties.characterId : undefined;
    return <ActorInstanceField project={project} characterId={characterId} value={String(value ?? '')} label={label} onChange={value => onChange(value ?? '1')} />;
  }
  const expression = pin.dataType === 'string' && target.pinId === 'expressionId';
  const characterId = target.node?.type === 'showCharacter' && !target.node.properties.characterId ? speakerId : String(target.node?.properties.characterId ?? '');
  const character = effectiveCharacter(project, characterId ?? '');
  if (pin.dataType === 'character' && typeof value === 'string' && target.pinId === 'characterId' && target.node?.type === 'showCharacter') return <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">当前台词角色（自动）</option>{value && !project.characters.some(c => c.id === value) && <option value={value}>原角色已不存在：{value}</option>}{project.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>;
  if (pin.dataType === 'string' && target.pinId === 'lifetime' && target.node?.type === 'showCharacter') {
    if (value !== '' && value !== 'line' && value !== 'persistent') return common();
    return <ActorLifetimeSelect value={(value || undefined) as ShowActor['lifetime']} label={label} onChange={value => onChange(value ?? '')} />;
  }
  if (pin.dataType === 'string' && typeof value === 'string' && target.pinId === 'presetId' && target.node?.type === 'showCharacter') return <CharacterPresetSelect project={project} characterId={characterId} value={value} label={label} onChange={onChange} />;
  const url = assetUrl ?? (id => { const asset = project.assets.find(asset => asset.id === id); return asset ? (window.studio ?? browserBridge).assetUrl(asset.path) : undefined; });
  if (expression && character && typeof value === 'string') {
    const expressions = character.expressions;
    const selected = speakerExpression(project, characterId, value);
    return <div className="blueprint-expression-value"><select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">角色默认表情</option>{value && !expressions.some(item => item.id === value) && <option value={value}>{selected ? `表情名称引用：${selected.name}` : `原表情已不存在：${value}`}</option>}{expressions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{selected && <img alt={`表情预览：${selected.name}`} src={url(selected.assetId)} />}</div>;
  }
  const object = target.node && rawSavedBlueprintAction(target.node);
  const property = object?.kind === 'visual' ? visualInputFields(object).find(field => 'object_' + field.key === target.pinId)?.path.at(-1) : undefined;
  if (pin.dataType === 'string' && (property === 'outlineColor' || property === 'shadowColor') && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return <input type="color" aria-label={label} value={value} onChange={event => onChange(event.target.value)} />;
  if (pin.dataType === 'number' && (property === 'outlineWidth' || property === 'shadowBlur' || property === 'outlineOpacity' || property === 'shadowOpacity')) {
    const opacity = property === 'outlineOpacity' || property === 'shadowOpacity';
    return common({ min: 0, max: opacity ? 1 : undefined, step: opacity ? .05 : 1 });
  }
  if (pin.dataType === 'string' && typeof value === 'string' && (property === 'textAlign' || property === 'textVerticalAlign')) {
    const choices = property === 'textAlign' ? { left: '左对齐', center: '居中', right: '右对齐' } : { top: '顶部', center: '居中', bottom: '底部' };
    return <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{!Object.hasOwn(choices, value) && <option value={value}>{value ? `原对齐值不可用：${value}` : '未设置'}</option>}{Object.entries(choices).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>;
  }
  if (pin.dataType === 'asset') {
    const { kind, category } = blueprintAssetFilter(project, graph, pin);
    return <UiAssetSelect buttonOnly={compact} project={project} kind={kind} category={category} allowEmpty={!pin.required} value={String(value) || undefined} onChange={value => onChange(value ?? '')} label={label} assetUrl={url} empty={kind === 'font' ? '使用对象原字体' : '无'} />;
  }
  if (pin.dataType === 'string' && typeof value === 'string' && target.pinId === 'effect' && target.node?.type === 'showChapter') return <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{!['', 'ink', 'fade', 'none'].includes(value) && <option value={value}>原效果已不存在：{value}</option>}<option value="">作品默认</option><option value="ink">笔触消散</option><option value="fade">淡入淡出</option><option value="none">无动画</option></select>;
  if (pin.dataType === 'string' && typeof value === 'string' && target.pinId === 'direction' && target.node?.type === 'shake') return <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{!['vertical', 'horizontal'].includes(value) && <option value={value}>原方向不可用：{value}</option>}<option value="vertical">纵向</option><option value="horizontal">横向</option></select>;
  if (expression && typeof value === 'string') return <input aria-label={label} value={value} placeholder="留空使用角色默认表情" onChange={event => onChange(event.target.value)} />;
  return common();
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
