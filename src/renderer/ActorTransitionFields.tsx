import { RotateCcw } from 'lucide-react';
import { actorTransitionDefaults, actorTransitionModes, actorTransitionPhases, actorTransitionSeconds, parseActorTransitions } from '../core/actor-transitions';
import { blueprintInputValue } from '../core/blueprint';
import { effectiveCharacter, type ActorTransitions, type ActorTransitionRule, type BlueprintGraph, type BlueprintNode, type Project } from '../core/model';
import { IconButton } from './components';
import { NumberInput } from './NumberInput';

type Phase = keyof ActorTransitions;
type TransitionSource = { label: string; unresolved?: boolean };
type TransitionSources = Record<Phase, TransitionSource>;
const describeRule = (rule: ActorTransitionRule) => rule.mode === 'none' ? '立即' : `${actorTransitionModes[rule.mode]}，${rule.duration} 秒`;

/** Omit sources in the character library: display effective values without
 * materializing missing overrides just because the editor was opened. */
export function ActorTransitionFields({ value, defaults = actorTransitionDefaults(), onChange, label = '角色过渡', sources }: {
  value?: ActorTransitions; defaults?: Required<ActorTransitions>;
  onChange: (value: ActorTransitions | undefined) => void; label?: string;
  sources?: TransitionSource | TransitionSources;
}) {
  const sourceFor = (phase: Phase) => sources && ('label' in sources ? sources : sources[phase]);
  const reset = (phase: Phase) => {
    const next = { ...value }; delete next[phase];
    onChange(Object.keys(next).length ? next : undefined);
  };
  return <fieldset className="actor-transition-fields" aria-label={label}><legend>{label}</legend>
    {Object.entries(actorTransitionPhases).map(([id, name]) => {
      const phase = id as Phase, rule = value?.[phase] ?? defaults[phase], source = sourceFor(phase);
      const unresolved = !!source?.unresolved && !value?.[phase];
      const sourceText = source && (source.unresolved ? `跟随${source.label}` : `${describeRule(defaults[phase])}（${source.label}）`);
      return <div className={'field-row' + (source ? '' : ' actor-transition-direct')} key={phase}>
        <label className="field">{name}<select aria-label={label + ' · ' + name} title={value?.[phase] || !source ? describeRule(rule) : sourceText} value={source ? value?.[phase]?.mode ?? '' : rule.mode} onChange={event => {
          if (!event.target.value) reset(phase);
          else onChange({ ...value, [phase]: { mode: event.target.value as typeof rule.mode, duration: rule.duration ?? .5 } });
        }}>{source && <option value="">{sourceText}</option>}{Object.entries(actorTransitionModes).map(([mode, text]) => <option key={mode} value={mode}>{text}</option>)}</select></label>
        <label className="field">时长（秒）<NumberInput aria-label={label + ' · ' + name + '时长'} type="number" min={0} step={.1} disabled={unresolved || rule.mode === 'none'} placeholder={unresolved ? '运行时确定' : undefined} title={unresolved ? sourceText : undefined} value={unresolved ? '' : actorTransitionSeconds(rule)} onChange={event => onChange({ ...value, [phase]: { ...rule, duration: Math.max(0, Number(event.target.value) || 0) } })} /></label>
        {!source && <IconButton className="actor-transition-reset" title={`还原${name}：${describeRule(defaults[phase])}`} disabled={!value?.[phase]} onClick={() => reset(phase)}><RotateCcw size={13} /></IconButton>}
      </div>;
    })}
    {Object.keys(actorTransitionPhases).some(phase => sourceFor(phase as Phase)?.unresolved && !value?.[phase as Phase]) && <p className="muted">未单独设置的过渡在执行时，按实际角色和演出设置确定。</p>}
    <p className="muted">换人时离场与入场同时进行；相同角色、表情和站位保持不变。自动离场沿用显示时的设置；手动隐藏按隐藏指令设置。</p>
  </fieldset>;
}

export function actorTransitionSources(project: Project, characterId: string, fallbackLabel: string): TransitionSources {
  const character = effectiveCharacter(project, characterId);
  const source = (phase: Phase): TransitionSource => ({ label: character?.actorTransitions?.[phase] ? `角色“${character.name}”` : fallbackLabel });
  return { enter: source('enter'), exit: source('exit'), expression: source('expression') };
}

/** The same node fields appear on the card and in the right-hand inspector. */
export function BlueprintActorTransitionFields({ project, graph, node, onChange }: {
  project: Project; graph: BlueprintGraph; node: BlueprintNode; onChange: (value: ActorTransitions | undefined) => void;
}) {
  const linked = (pinId: string) => graph.links.some(link => link.toNodeId === node.id && link.toPinId === pinId);
  const characterId = String(blueprintInputValue(node, 'characterId') ?? '');
  const dynamicCharacter = linked('characterId') || !characterId;
  const character = dynamicCharacter ? undefined : effectiveCharacter(project, characterId);
  const mode = (node.properties.transition ?? 'dissolve') as ActorTransitionRule['mode'];
  const defaults = { ...actorTransitionDefaults(mode, Number(blueprintInputValue(node, 'duration') ?? (mode === 'fade' ? 1 : .5))), ...character?.actorTransitions };
  const sources = actorTransitionSources(project, dynamicCharacter ? '' : characterId, '节点设置');
  for (const phase of Object.keys(actorTransitionPhases) as Phase[]) {
    if (dynamicCharacter) sources[phase] = { label: '实际角色与节点设置', unresolved: true };
    else if (phase !== 'exit' && mode !== 'none' && linked('duration') && !character?.actorTransitions?.[phase]) sources[phase] = { label: '节点时长输入', unresolved: true };
  }
  return <><ActorTransitionFields value={parseActorTransitions(node.properties.actorTransitions)} defaults={defaults} sources={sources} onChange={onChange} />
    <p className="muted">蓝图调用单独设置的过渡优先于这里的角色和节点设置。</p></>;
}
