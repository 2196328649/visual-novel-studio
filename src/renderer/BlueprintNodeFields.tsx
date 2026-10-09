import { projectGraphs } from '../core/project-resources';
import { uiAnimationPlayModes } from '../core/ui-animation-clips';
import { uiControlValueType, uiTextInput } from '../core/ui-control-events';
import { uiButtonEvents } from '../core/ui-button-events';
import { standardUiEventPages, uiPageComponents } from '../core/ui-logic';
import { uiPageNames } from './UiNames';
import { isTimelineComponent } from '../core/timeline-component';
import type { ReactNode } from 'react';
import { allUiComponents, effectiveCharacter, type BlueprintGraph, type BlueprintNode, type BlueprintPin, type Project, type VariableValue } from '../core/model';
import { blueprintInputValue, blueprintKeyNames, blueprintTypeNames, defaultBlueprintValue, type BlueprintDataType } from '../core/blueprint';
import { uiProperties, uiPropertyApplies, type UiProperty } from '../core/ui';
import { playerPreferences } from '../core/preferences';
import { BlueprintValueInput } from './BlueprintValueInput';
import { ActorTransitionFields } from './ActorTransitionFields';
import { actorTransitionDefaults, parseActorTransitions, graphShowsActors } from '../core/actor-transitions';
import { BlueprintParameterValue } from './BlueprintCallFields';
import { uiAnimationEasings, uiAnimationPropertyNames } from '../core/ui-animation';
import { NumberInput } from './NumberInput';
import { CharacterPresetSelect } from './CharacterPresets';
import { ActorInstanceField, ActorLifetimeSelect } from './ActorInstanceFields';
import type { ShowActor } from '../core/actor-instance';
import { blueprintNodeAssetFilter } from '../core/blueprint-assets';

export interface BlueprintFieldProps { project: Project; graph: BlueprintGraph; node: BlueprintNode; edit: (edit: (node: BlueprintNode) => void) => void }
const transitionOptions = { none: '无', dissolve: '溶解', fade: '淡入淡出', move: '移动' };
function InlineField({ label, children }: { label: string; children: ReactNode }) { return <label className="blueprint-inline-field"><span>{label}</span>{children}</label>; }

export function BlueprintInlineValue({ project, graph, node, pin, edit }: BlueprintFieldProps & { pin: BlueprintPin }) {
  const key = pin.id === 'first_index' ? 'firstIndex' : pin.id === 'last_index' ? 'lastIndex' : pin.id;
  const value = blueprintInputValue(node, pin.id), label = `${node.name} · ${pin.name}`;
  const change = (value: VariableValue | undefined) => edit(target => { if (value === undefined) delete target.properties[key]; else target.properties[key] = value; if (key === 'characterId') target.properties.expressionId = ''; });
  const called = ['callFunction', 'callMacro'].includes(node.type) ? projectGraphs(project).find(graph => graph.id === node.properties.graphId) : undefined;
  const argument = called?.exposedInputs.find(input => `arg_${input.id}` === pin.id);
  if (called && argument && isTimelineComponent(called) && pin.dataType === 'asset') return <div className="timeline-default-asset"><BlueprintParameterValue project={project} graph={called} pin={argument} label={label} value={value ?? argument.defaultValue ?? ''} onChange={change} /><button type="button" className="text-button" title="未传入时沿用时间轴内的默认素材" aria-label={label + ' · 使用默认素材'} disabled={!Object.hasOwn(node.properties, key)} onClick={() => change(undefined)}>默认</button></div>;
  if (called && argument) return <BlueprintParameterValue project={project} graph={called} pin={argument} label={label} value={value ?? defaultBlueprintValue(pin.dataType)} onChange={change} />;
  const options = pin.id === 'direction' && node.type === 'shake' ? { horizontal: '横向', vertical: '纵向' }
    : pin.id === 'effect' && node.type === 'showChapter' ? { '': '作品默认', ink: '笔触消散', fade: '淡入淡出', none: '无' } : undefined;
  if (options) return <select aria-label={label} value={String(value ?? '')} onChange={event => change(event.target.value)}>{Object.entries(options).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>;
  if (pin.id === 'pageId') return <select aria-label={label} value={String(value ?? '')} onChange={event => change(event.target.value)}><option value="">选择自定义界面</option>{project.ui.customPages.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}</select>;
  const character = effectiveCharacter(project, String(node.properties.characterId ?? ''));
  if (pin.id === 'characterId' && node.type === 'showCharacter') return <select aria-label={label} value={String(value ?? '')} onChange={event => change(event.target.value)}><option value="">当前台词角色（自动）</option>{project.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>;
  if (pin.id === 'lifetime') return <ActorLifetimeSelect value={(value || undefined) as ShowActor['lifetime']} label={label} onChange={value => change(value ?? '')} />;
  if (pin.id === 'instanceId') return <ActorInstanceField project={project} characterId={character?.id} value={String(value ?? '')} label={label} onChange={value => change(value ?? '')} />;
  if (pin.id === 'presetId') return <CharacterPresetSelect project={project} characterId={character?.id} value={String(value ?? '')} label={label} onChange={change} />;
  if (pin.id === 'expressionId' && character && !graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'characterId')) return <select aria-label={label} value={String(value ?? '')} onChange={event => change(event.target.value)}><option value="">默认表情</option>{character.expressions.map(expression => <option key={expression.id} value={expression.id}>{expression.name}</option>)}</select>;
  const filter = pin.dataType === 'asset' ? blueprintNodeAssetFilter(node, pin.id) : undefined;
  return <BlueprintValueInput componentIds={graph.uiPageId?uiPageComponents(project,graph.uiPageId).map(c=>c.id):undefined} project={project} label={label} type={pin.dataType} value={value} onChange={change} assetKind={filter?.kind} assetCategory={filter?.category} componentKind={['playSpine', 'pauseSpine', 'setSpineSpeed'].includes(node.type) ? 'spine' : undefined} />;
}

/** Property-only settings sit beside the data pins, so ordinary edits need no inspector. */
export function BlueprintNodeFields({ project, graph, node, edit }: BlueprintFieldProps) {
  const set = (key: string, value: VariableValue) => edit(target => {
    target.properties[key] = value;
    if (key === 'variableId' && target.type === 'setVariable') target.properties.value = project.variables.find(variable => variable.id === value)?.initial ?? 0;
    if (key === 'property' && target.type === 'setUiProperty') target.properties.value = uiProperties[value as UiProperty]?.initial ?? true;
    if (key === 'preference' && target.type === 'setPlayerPreference') target.properties.value = playerPreferences[value as keyof typeof playerPreferences]?.initial ?? 1;
  });
  const select = (key: string, label: string, choices: Record<string, string>, fallback = '') => <InlineField key={key} label={label}><select aria-label={`${node.name} · ${label}`} value={String(node.properties[key] ?? fallback)} onChange={event => set(key, event.target.value)}><option value="">请选择</option>{Object.entries(choices).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></InlineField>;
  const list = (items: { id: string; name: string }[]) => Object.fromEntries(items.map(item => [item.id, item.name]));
  const fields: ReactNode[] = [];
  if (['callFunction', 'callMacro'].includes(node.type) && graphShowsActors(project, String(node.properties.graphId))) fields.push(<ActorTransitionFields key="actorTransitions" label="本次角色过渡" inheritLabel="蓝图与角色设置" value={parseActorTransitions(node.properties.actorTransitions)} onChange={value => set('actorTransitions', value ? JSON.stringify(value) : '')} />);
  if (['showCharacter'].includes(node.type)) fields.push(<ActorTransitionFields inheritLabel="角色与默认时长" key="actorTransitions" value={parseActorTransitions(node.properties.actorTransitions)} defaults={actorTransitionDefaults((node.properties.transition ?? 'dissolve') as 'none' | 'dissolve' | 'fade' | 'move', Number(node.properties.duration ?? .5))} onChange={value => set('actorTransitions', value ? JSON.stringify(value) : '')} />);
  else if (['showBackground', 'hideCharacter', 'switchScene'].includes(node.type)) fields.push(select(node.type === 'switchScene' ? 'mode' : 'transition', '过渡', transitionOptions, 'none'));
  if (node.type === 'camera') fields.push(select('easing', '缓动', { linear: '匀速', ease: '缓入缓出', easein: '缓入', easeout: '缓出' }, 'ease'));
  if (node.type === 'math') fields.push(select('operation', '运算', { add: '相加', subtract: '相减', multiply: '相乘', divide: '相除', modulo: '取余', min: '较小值', max: '较大值' }, 'add'));
  if (node.type === 'compare' || node.type === 'literal' || node.type === 'getMinigameValue') {
    const pin = node.pins.find(pin => pin.dataType !== 'exec'), actual = pin?.dataType ?? 'string';
    fields.push(<InlineField key="type" label="类型"><select aria-label={`${node.name} · 类型`} value={actual} onChange={event => edit(target => { const type = event.target.value as BlueprintDataType; for (const pin of target.pins) if (target.type !== 'compare' || ['a', 'b'].includes(pin.id)) { pin.dataType = type; pin.defaultValue = defaultBlueprintValue(type); delete target.properties[pin.id]; } if (target.type === 'literal') target.properties.value = defaultBlueprintValue(type); if (target.type === 'getMinigameValue') target.properties.defaultValue = defaultBlueprintValue(type); })}>{(node.type === 'literal' ? ['number', 'string', 'boolean', 'asset', 'scene', 'character', 'ui', 'component'] : ['number', 'string', 'boolean']).map(type => <option key={type} value={type}>{blueprintTypeNames[type as BlueprintDataType]}</option>)}</select></InlineField>);
    if (node.type !== 'compare') fields.push(<InlineField key="value" label={node.type === 'literal' ? '值' : '默认值'}><BlueprintValueInput project={project} type={actual} label={`${node.name} · 值`} value={node.properties[node.type === 'literal' ? 'value' : 'defaultValue']} onChange={value => set(node.type === 'literal' ? 'value' : 'defaultValue', value ?? '')} /></InlineField>);
  }
  if (node.type === 'compare') fields.push(select('operator', '比较', { eq: '等于', ne: '不等于', gt: '大于', gte: '大于或等于', lt: '小于', lte: '小于或等于' }, 'eq'));
  if (['getVariable', 'setVariable'].includes(node.type)) fields.push(select('variableId', '作品状态', list(project.variables)));
  if (node.type === 'getInput') fields.push(select('inputId', '输入参数', list(graph.exposedInputs)));
  if (node.type === 'setOutput') fields.push(select('outputId', '输出参数', list(graph.exposedOutputs)));
  if (['callFunction', 'callMacro'].includes(node.type)) { const called = projectGraphs(project).find(item => item.id === node.properties.graphId); fields.push(select('graphId', isTimelineComponent(called) ? '时间轴预设' : '调用蓝图', list(projectGraphs(project).filter(item => item.id !== graph.id && (isTimelineComponent(called) === isTimelineComponent(item)))))); }
  if (node.type === 'effect') fields.push(select('effectId', '演出效果', list(project.effects)));
  if (['getUiProperty', 'setUiProperty'].includes(node.type)) {
    const component = allUiComponents(project).find(component => component.id === node.properties.componentId);
    fields.push(select('property', '组件属性', Object.fromEntries(Object.entries(uiProperties).filter(([key]) => !component || uiPropertyApplies(component, key as UiProperty)).map(([key, value]) => [key, value.name])), 'visible'));
  }
  if(['playUiAnimation','stopUiAnimationPlayback'].includes(node.type))fields.push(select('animationId','界面动画',list((project.ui.animations??[]).map(a=>({...a,name:a.name+' / '+(a.pageId.startsWith('ui:')?uiPageNames[a.pageId.slice(3) as keyof typeof uiPageNames]:project.ui.customPages.find(p=>p.id===a.pageId)?.name??'缺失页面')+(a.uiInstanceId&&a.uiInstanceId!=='base'?' / '+(project.ui.instances?.find(i=>i.id===a.uiInstanceId)?.name??'缺失方案'): '')})))));
  if(node.type==='playUiAnimation')fields.push(select('playMode','播放方向',uiAnimationPlayModes,'forward'));
  if(node.type==='animateUiProperty'||node.type==='stopUiAnimation'){
    const component=allUiComponents(project).find(c=>c.id===node.properties.componentId);
    const choices=Object.fromEntries(Object.entries(uiAnimationPropertyNames).filter(([key])=>!component||uiPropertyApplies(component,key as UiProperty)));
    fields.push(select('property','动画属性',node.type==='stopUiAnimation'?{all:'全部属性',...choices}:choices,node.type==='stopUiAnimation'?'all':'opacity'));
    if(node.type==='animateUiProperty')fields.push(select('easing','缓动',uiAnimationEasings,'ease'));
  }
  if (['getPlayerPreference', 'setPlayerPreference'].includes(node.type)) fields.push(select('preference', '玩家选项', Object.fromEntries(Object.entries(playerPreferences).map(([key, value]) => [key, value.name])), 'musicVolume'));
  if (['playSound', 'stopMusic'].includes(node.type)) fields.push(select('channel', '通道', { ...(node.type === 'stopMusic' ? { music: '背景音乐' } : {}), sound: '音效', ambient: '环境音' }, node.type === 'stopMusic' ? 'music' : 'sound'));
  if (['eventClick','eventButton'].includes(node.type)) fields.push(select('componentId', '按钮', list((graph.uiPageId?uiPageComponents(project,graph.uiPageId):allUiComponents(project)).filter(component => component.kind === 'button').map(component => ({ id: component.id, name: component.name || component.text || component.id })))));
  if(node.type==='eventTextCommitted')fields.push(select('componentId','输入控件',list((graph.uiPageId?uiPageComponents(project,graph.uiPageId):allUiComponents(project)).filter(c=>uiTextInput(project,c)).map(c=>({id:c.id,name:c.name||c.text||c.id})))));
  if(node.type==='eventValueChanged')fields.push(select('componentId','控件',list((graph.uiPageId?uiPageComponents(project,graph.uiPageId):allUiComponents(project)).filter(c=>uiControlValueType(project,c)).map(c=>({id:c.id,name:c.name||c.text||c.id})))));
  if(node.type==='eventButton')fields.push(select('trigger','触发时机',Object.fromEntries(Object.entries(uiButtonEvents).map(([id,e])=>[id,e.name+' · '+e.unreal])),'hover'));
  if (!graph.uiPageId&&(node.type === 'eventKey' || node.type === 'eventTimer')) fields.push(select('pageId', '界面', list([...project.ui.customPages, ...standardUiEventPages.filter(page => !project.ui.disabledPages?.includes(page.name)).map(page => ({...page,name:uiPageNames[page.name as keyof typeof uiPageNames]}))])));
  if (!graph.uiPageId&&['eventKey','eventTimer'].includes(node.type) && String(node.properties.pageId ?? '').startsWith('ui:')) fields.push(select('uiInstanceId', '作用方案', {'':'所有方案',base:'默认界面',...Object.fromEntries((project.ui.instances??[]).map(instance=>[instance.id,instance.name]))}));
  if (node.type === 'eventKey') fields.push(select('key', '按键', blueprintKeyNames, 'K_SPACE'));
  if (node.type === 'eventTimer') {
    fields.push(<InlineField key="interval" label="间隔秒数"><NumberInput aria-label={`${node.name} · 间隔秒数`} value={Number(node.properties.interval ?? 1)} onChange={event => set('interval', event.target.valueAsNumber)} /></InlineField>);
    fields.push(<InlineField key="repeat" label="循环"><input type="checkbox" aria-label={`${node.name} · 循环`} checked={node.properties.repeat !== false} onChange={event => set('repeat', event.target.checked)} /></InlineField>);
  }
  if (node.type === 'finishMinigame') fields.push(select('result', '结果', { success: '成功', failure: '失败', cancel: '取消' }, 'success'));
  if (['setMinigameValue', 'getMinigameValue', 'sceneAction', 'comment'].includes(node.type)) {
    const key = node.type === 'comment' ? 'text' : node.type === 'sceneAction' ? 'command' : 'key';
    fields.push(<InlineField key={key} label={key === 'key' ? '状态名称' : '内容'}><input aria-label={`${node.name} · 内容`} value={String(node.properties[key] ?? '')} onChange={event => set(key, event.target.value)} /></InlineField>);
  }
  return <>{fields}</>;
}
