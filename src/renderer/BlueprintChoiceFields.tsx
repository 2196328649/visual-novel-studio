import { useState } from 'react';
import { makeId, type BlueprintGraph, type BlueprintNode, type Project } from '../core/model';
import { blueprintChoiceDefault, blueprintChoiceDefaultCases, blueprintChoiceDefinition, blueprintChoiceKeyTypes, blueprintChoicePinId, blueprintChoiceValueTypes, maxBlueprintChoices, type BlueprintChoiceCase } from '../core/blueprint-choice';
import { BlueprintValueInput } from './BlueprintValueInput';
import './blueprint-choice.css';

export function BlueprintChoiceFields({ project, graph, node, edit, surface = 'card' }: { project: Project; graph: BlueprintGraph; node: BlueprintNode; edit: (change: (node: BlueprintNode) => void) => void; surface?: 'card' | 'inspector' }) {
  const definition = blueprintChoiceDefinition(node), rows = definition.cases;
  const [pending, setPending] = useState<{ nodeId: string; id: string }>();
  const confirmation = pending?.nodeId === node.id ? pending.id : undefined;
  const set = (key: string, value: string) => edit(target => { target.properties[key] = value; });
  const changeRows = (change: (rows: BlueprintChoiceCase[], target: BlueprintNode) => void) => edit(target => {
    const current = blueprintChoiceDefinition(target).cases; if (!current) return;
    change(current, target); target.properties.cases = JSON.stringify(current); target.properties.choiceVersion = 1;
  });
  const keyType = definition.keyType ?? 'string', valueType = definition.valueType ?? 'number';
  if (surface === 'card') return <small className="blueprint-choice-card-hint">匹配类型：{blueprintChoiceKeyTypes[keyType]}{node.type === 'selectByKey' ? ' · 结果：' + blueprintChoiceValueTypes[valueType] : ''} · 分支名称与顺序在“节点参数”编辑</small>;
  const restore = () => edit(target => {
    const { choiceRecovery: _recovery, ...properties } = target.properties;
    target.properties.choiceRecovery = JSON.stringify({ properties, pins: target.pins });
    for (const key of Object.keys(target.properties)) if (key.startsWith('case_')) delete target.properties[key];
    // Fresh IDs keep an unknown old mapping from attaching to a different row.
    const current = blueprintChoiceDefinition(target);
    target.properties.keyType = current.keyType ?? 'string'; target.properties.valueType = current.valueType ?? 'number'; target.properties.choiceVersion = 1;
    target.properties.cases = JSON.stringify(blueprintChoiceDefaultCases(current.keyType).map(row => ({ ...row, id: makeId('case') })));
  });
  const linksFor = (id?: string) => graph.links.filter(link => link.fromNodeId === node.id && (id ? link.fromPinId === blueprintChoicePinId(id) : link.fromPinId.startsWith('case_')) || link.toNodeId === node.id && (id ? link.toPinId === blueprintChoicePinId(id) : link.toPinId.startsWith('case_'))).length;
  const controls = (property: 'keyType' | 'valueType', name: string, options: Record<string, string>, fallback: string) => <label className="blueprint-choice-type"><span>{name}</span><select aria-label={node.name + ' · ' + name} value={String(node.properties[property] ?? fallback)} onChange={event => set(property, event.target.value)}>
    {!Object.hasOwn(options, String(node.properties[property] ?? fallback)) && <option value={String(node.properties[property])}>失效类型 · {String(node.properties[property])}</option>}
    {Object.entries(options).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
  </select></label>;
  return <section className="blueprint-choice-fields" aria-label="多路分支配置">
    {controls('keyType', '匹配类型', blueprintChoiceKeyTypes, 'string')}
    {node.type === 'selectByKey' && controls('valueType', '结果类型', blueprintChoiceValueTypes, 'number')}
    <p className="muted">修改类型不转换已有匹配值、输入常量或连线；需要时逐项修复。重命名与重排不改变连线身份。</p>
    {definition.problems.length > 0 && <div role="status" className="blueprint-choice-problems">{definition.problems.map((problem, index) => <p key={index}>{problem}</p>)}</div>}
    {rows?.map((row, index) => <fieldset className="blueprint-choice-row" key={row.id} data-choice-id={row.id}>
      <legend>分支 {index + 1}</legend>
      <label><span>名称</span><input aria-label={'分支 ' + (index + 1) + ' 名称'} maxLength={100} value={row.name} onChange={event => changeRows(current => { const item = current.find(item => item.id === row.id); if (item) item.name = event.target.value; })} /></label>
      <label><span>匹配值</span><BlueprintValueInput project={project} type={keyType} label={'分支 ' + (index + 1) + ' 匹配值'} value={row.key} onChange={value => { if (value !== undefined) changeRows(current => { const item = current.find(item => item.id === row.id); if (item) item.key = value; }); }} /></label>
      <div className="blueprint-choice-row-actions">
        <button type="button" className="small-button" aria-label={'上移分支 ' + (index + 1)} disabled={index === 0} onClick={() => changeRows(current => { const at = current.findIndex(item => item.id === row.id); if (at > 0) [current[at - 1], current[at]] = [current[at], current[at - 1]]; })}>上移</button>
        <button type="button" className="small-button" aria-label={'下移分支 ' + (index + 1)} disabled={index === rows.length - 1} onClick={() => changeRows(current => { const at = current.findIndex(item => item.id === row.id); if (at >= 0 && at < current.length - 1) [current[at], current[at + 1]] = [current[at + 1], current[at]]; })}>下移</button>
        <button type="button" className="small-button" aria-label={'删除分支 ' + (index + 1)} onClick={() => setPending({ nodeId: node.id, id: row.id })}>删除</button>
      </div>
    </fieldset>)}
    {rows && <button type="button" className="small-button" disabled={rows.length >= maxBlueprintChoices || keyType === 'boolean' && rows.some(row => row.key === false) && rows.some(row => row.key === true)} onClick={() => changeRows((current, target) => {
      let ordinal = current.length + 1;
      let key = keyType === 'boolean' ? !current.some(row => row.key === false) ? false : true : keyType === 'number' ? ordinal - 1 : '选项 ' + ordinal;
      while (keyType !== 'boolean' && current.some(row => row.key === key)) { ordinal++; key = keyType === 'number' ? ordinal - 1 : '选项 ' + ordinal; }
      const id = makeId('case'); current.push({ id, name: '选项 ' + ordinal, key });
      if (target.type === 'selectByKey') target.properties[blueprintChoicePinId(id)] = blueprintChoiceDefault(blueprintChoiceDefinition(target).valueType ?? 'number');
    })}>添加分支</button>}
    <button type="button" className="text-button" onClick={() => setPending({ nodeId: node.id, id: 'restore' })}>恢复默认分支</button>
    {confirmation && <div role="alertdialog" aria-label={confirmation === 'restore' ? '恢复分支定义' : '删除分支确认'} className="blueprint-choice-confirm">
      <p>{confirmation === 'restore' ? '恢复默认分支将替换当前枚举定义，旧配置会保留在工程恢复数据中。' : '删除“' + (rows?.find(row => row.id === confirmation)?.name || '未命名分支') + '”将同时移除其常量和连接点。'}将断开 {linksFor(confirmation === 'restore' ? undefined : confirmation)} 条关联连线，可一次撤销。</p>
      <button type="button" className="small-button" onClick={() => { if (confirmation === 'restore') restore(); else changeRows((current, target) => { const at = current.findIndex(row => row.id === confirmation); if (at >= 0) current.splice(at, 1); delete target.properties[blueprintChoicePinId(confirmation)]; }); setPending(undefined); }}>{confirmation === 'restore' ? '确认恢复分支' : '确认删除分支'}</button>
      <button type="button" className="small-button" onClick={() => setPending(undefined)}>保留当前分支</button>
    </div>}
    <p className="muted">{node.type === 'selectByKey' ? '只读取命中的候选值；未匹配时才读取默认值。' : '一次只执行命中的一条路线；未匹配走“其他情况”。'}最多 {maxBlueprintChoices} 项。</p>
  </section>;
}
