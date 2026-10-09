import { graphResourceKey, isTimelineResource, projectGraphs, withProjectGraphs } from './project-resources';
import { characterDisplayPresets } from './character-presets';
import { actorInstanceIds, actorLifetimes } from './actor-instance';
import { pinyin } from 'pinyin-pro';
import { effectiveCharacter, type Project, type Asset, type AssetCategory } from './model';
import { categoryAssets, assetCategories } from './asset-library';
import { textReference, serializeParameterValue } from './text-script';
import { blueprintGroup, blueprintInputTarget } from './blueprint-authoring';
import { availablePerformanceBlueprints, commandPerformanceBlueprints } from './builtin-performances';
import { blueprintCallName, resolveBlueprintCall } from './blueprint-names';
import { blueprintAssetFilter } from './blueprint-assets';
import { textHeading, type TextHeading } from './text-headings';

import { commandSignatures, parameter, type CommandSignature } from './command-parameters';
import { argumentTokens, argumentText, argumentName, bindArguments } from './text-arguments';
export { commandSignatures, type CommandSignature, type CommandParameter } from './command-parameters';

const searchCache = new Map<string, string[]>();
function searchForms(value: string) {
  let forms = searchCache.get(value);
  if (!forms) {
    const syllables = pinyin(value, { toneType: 'none', type: 'array', nonZh: 'consecutive' });
    forms = [value.toLocaleLowerCase(), syllables.join('').toLocaleLowerCase(), syllables.map(part => /^[a-z]+$/i.test(part) ? part[0] : part).join('').toLocaleLowerCase()];
    if (searchCache.size > 10000) searchCache.clear();
    searchCache.set(value, forms);
  }
  return forms;
}
export function completionScore(label: string, query: string, aliases: string[] = []) {
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase();
  if (!needle) return 1;
  let score = 0;
  for (const [index, form] of [label, ...aliases].flatMap(searchForms).entries()) {
    if (form === needle) score = Math.max(score, index === 0 ? 100 : 85);
    else if (form.startsWith(needle)) score = Math.max(score, index === 0 ? 80 : 65);
    else if (form.includes(needle)) score = Math.max(score, index === 0 ? 50 : 35);
  }
  return score;
}
export interface TextCompletion { id: string; label: string; detail: string; insertText: string; kind: string; assetId?: string; aliases?: string[]; group?: string; replaceStart?: number; replaceEnd?: number; caretOffset?: number; openParameters?: boolean }
export interface CompletionResource { kind: Asset['kind'] | 'all'; category: AssetCategory | 'all' }
export const commandGroup = (_name: string) => '基础';
export interface TextAssistance { start: number; end: number; query: string; items: TextCompletion[]; signature?: CommandSignature; syntax?: 'heading'; parameterIndex?: number; parameterEdits?: TextCompletion[]; resource?: CompletionResource }

/** Directory destinations share the same references in pickers and completion. */
export function storyTargetItems(project: Project): TextCompletion[] {
  const chapterName = (id: string) => project.chapters.find(chapter => chapter.id === id)?.name ?? '';
  const scenePath = (id: string) => {
    const scene = project.scenes.find(scene => scene.id === id);
    return scene ? `${chapterName(scene.chapterId)} / ${scene.name}` : '';
  };
  return [
    ...project.chapters.map(chapter => ({ id: chapter.id, label: chapter.name, detail: '章节入口', kind: '章节', insertText: textReference(chapter.name, chapter.id) })),
    ...project.scenes.map(scene => ({ id: scene.id, label: scene.name, detail: `${chapterName(scene.chapterId)} / ${scene.name}`, aliases: [`${chapterName(scene.chapterId)}/${scene.name}`], kind: '小章节', insertText: textReference(scene.name, scene.id) })),
    ...project.nodes.filter(node => node.textHeading !== false).map(node => ({ id: node.id, label: node.name, detail: `${scenePath(node.sceneId)} / ${node.name}`, aliases: [`${scenePath(node.sceneId).replaceAll(' / ', '/')}/${node.name}`], kind: '段落', insertText: textReference(node.name, node.id) })),
  ];
}

function argumentItems(project: Project, spec: CommandSignature, index: number, values: string[], speakerId?: string): TextCompletion[] {
  const field = spec.parameters[index];
  if (!field) return [];
  const item = (id: string, name: string, detail: string, reference = true): TextCompletion => ({ id, label: name, detail, kind: field.name, insertText: serializeParameterValue(reference ? textReference(name, id) : name) });
  const selectedCharacter = effectiveCharacter(project, project.characters.find(c => c.name === argumentName(values[0] ?? '') || c.id === values[0]?.trim() || values[0]?.endsWith('【' + c.id + '】'))?.id ?? (spec.name === '显示角色' && !values[0] ? speakerId : '') ?? '');
  if (field.name === '实例ID') return actorInstanceIds(project, selectedCharacter?.id).map(id => item(id, id, '已命名的角色实例', false));
  switch (field.kind) {
    case 'character': return project.characters.map(c => ({ ...item(c.id, c.name, ''), assetId: effectiveCharacter(project, c.id)?.expressions[0]?.assetId }));
    case 'preset': return [item('default', '角色默认', '跟随角色默认预设', false), ...characterDisplayPresets(project, selectedCharacter?.id ?? '').map(p => item(p.id, p.name, '关联站位预设', true)), item('manual', '手动', '本次使用坐标和缩放', false)];
    case 'expression': return (selectedCharacter?.expressions ?? []).map(e => ({ ...item(e.id, e.name, selectedCharacter!.name, false), assetId: e.assetId }));
    case 'feature': return (selectedCharacter?.features ?? []).map(f => item(f.id, f.name, `${selectedCharacter!.name}的功能`, false));
    case 'target': return storyTargetItems(project).map(item => ({ ...item, insertText: serializeParameterValue(item.insertText) }));
    case 'node': return project.nodes.filter(n => spec.name !== '互动实例' || n.kind === 'interaction').filter(n => spec.name !== '小游戏实例' || n.kind === 'minigame').map(n => item(n.id, n.name, project.scenes.find(s => s.id === n.sceneId)?.name ?? '剧情节点'));
    case 'effect': return [...project.effects.map(e => item(e.id, e.name, '工程效果')), ...['纵向震动', '横向震动', '镜头推进', '镜头复位'].map(name => item(name, name, '内置效果', false))];
    case 'blueprint': return projectGraphs(project).filter(b => b.kind !== 'ui').map(b => ({ ...item(b.id, b.name, blueprintGroup(project, b.id) || (isTimelineResource(b) ? '时间轴预设' : '蓝图')), aliases: [blueprintGroup(project, b.id)] }));
    case 'variable': return project.variables.map(v => item(v.id, v.name, `初始值：${v.initial}`));
    case 'image': case 'asset': return project.assets.filter(asset => field.kind === 'asset' || asset.kind === 'image').map(asset => ({ ...item(asset.id, asset.name, asset.path), assetId: asset.kind === 'image' ? asset.id : undefined }));
    case 'video': return project.assets.filter(asset => asset.kind === 'video').map(asset => item(asset.id, asset.name, asset.path));
    case 'visualId': return [...new Set(['image', 'video', 'text', ...project.nodes.flatMap(node => node.kind === 'passage' ? node.lines.flatMap(line => line.actions.flatMap(action => action.kind === 'visual' || action.kind === 'hideVisual' ? [action.instanceId] : [])) : [])])].map(id => item(id, id, '', false));
    case 'sceneAsset': case 'bgm': case 'sound': case 'voice': return categoryAssets(project, field.kind === 'sceneAsset' ? 'image' : 'audio', field.kind === 'sceneAsset' ? 'scene' : field.kind).map(a => ({ ...item(a.id, a.name, a.sourcePath ?? a.path), assetId: a.kind === 'image' ? a.id : undefined, aliases: [a.path, a.sourcePath ?? ''] }));
    default: return (field.values ?? []).map(value => ({ ...item(value, value, field.detail, false), insertText: value }));
  }
}

function headingParameterAssistance(project: Project, heading: TextHeading, line: string, lineStart: number, column: number, explicit: boolean): TextAssistance {
  const parameters = heading.parameters!;
  const signature: CommandSignature = { name: heading.kind, detail: '目录参数写在括号内；省略时使用默认设置。', parameters: [
    parameter('流程图', 'keyword', `是否在游戏流程图中显示此${heading.kind}；默认${heading.kind === '章节' ? '是' : '否'}。`, ['是', '否']),
    parameter('显示名称', 'text', '游戏流程图中的名称；省略时使用目录标题。最多 120 个字，包含逗号时用引号包住。'),
    parameter('样式', 'text', '选择“界面 → 流程图 → 框样式”中的可复用样式；省略时使用默认外观。'),
  ] };
  const args = line.slice(parameters.start, parameters.end), base = lineStart + parameters.start;
  const binding = bindArguments(args, signature.parameters, true), relativeCaret = column - parameters.start;
  const current = binding.bindings.find(item => relativeCaret <= item.token.end) ?? binding.bindings.at(-1)!;
  const { token, index: parameterIndex } = current;
  const naming = token.name === undefined || relativeCaret < token.valueStart;
  const from = naming ? token.start : token.valueStart;
  const to = naming && token.name !== undefined ? token.valueStart : token.end;
  const query = args.slice(from, Math.max(from, relativeCaret)).trim().replace(/^["']/, '').replace(/["']$/, '');
  const used = new Set(binding.bindings.filter(item => item !== current && item.token.name !== undefined).map(item => item.index));
  const field = signature.parameters[parameterIndex];
  const items: TextCompletion[] = naming ? signature.parameters.flatMap((field, index) => used.has(index) ? [] : [{
    id: 'name:' + index, label: field.name, detail: field.detail, insertText: field.name + '=', kind: '参数名', openParameters: true,
  }]) : field?.name === '样式' ? (project.ui.flowStyles ?? []).map(style => ({ id: style.id, label: style.name, detail: '流程图框样式', insertText: serializeParameterValue(textReference(style.name, style.id)), kind: '样式', assetId: style.skin?.idle })) : (field?.values ?? []).map(value => ({ id: value, label: value, detail: field.detail, insertText: value, kind: field.name }));
  const edits = signature.parameters.map((field, index): TextCompletion => {
    const existing = binding.bindings.find(item => item.index === index && item.token.name !== undefined);
    const partial = naming && token.name === undefined && completionScore(field.name, query) > 0 ? token : undefined;
    const target = existing?.token ?? partial;
    if (target) return {
      id: 'parameter:' + index, label: field.name, detail: field.detail, kind: '参数',
      insertText: field.name + '=' + (existing ? target.raw : ''), replaceStart: base + target.start, replaceEnd: base + target.end,
      caretOffset: field.name.length + 1, openParameters: true,
    };
    const prefix = args.trim() && !/[，,;；]\s*$/.test(args) ? '，' : '';
    return { id: 'parameter:' + index, label: field.name, detail: field.detail, kind: '参数', insertText: prefix + field.name + '=', replaceStart: lineStart + parameters.end, replaceEnd: lineStart + parameters.end, openParameters: true };
  });
  return { start: base + from, end: base + to, query, items: !explicit && !naming && items.some(item => item.label === query) ? [] : rank(items, query), signature, syntax: 'heading', parameterIndex, parameterEdits: edits };
}

/** Completion edits are offsets in the visible document, never its hidden IDs. */
export function textAssistance(project: Project, source: string, offset: number, explicit = false): TextAssistance | undefined {
  const caret = Math.max(0, Math.min(offset, source.length));
  const lineStart = caret === 0 ? 0 : source.lastIndexOf('\n', caret - 1) + 1;
  const lineEnd = source.indexOf('\n', caret);
  const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
  const column = caret - lineStart;
  const before = line.slice(0, column);
  const colon = line.search(/[:：]/);
  const heading = line.match(/^\s*#{1,3}\s*/);
  if (heading) {
    const declaration = textHeading(line, true), parameters = declaration?.parameters;
    if (parameters && column >= parameters.start) {
      if (column > parameters.end) return;
      return headingParameterAssistance(project, declaration, line, lineStart, column, explicit);
    }
    if (colon >= 0 && column > colon) return;
    const query = before.slice(heading[0].length).trim();
    const items = ['章节', '小章节', '段落'].map(name => ({ id: `heading:${name}`, label: name, detail: '整理剧情目录，不触发演出或跳转。', insertText: `# ${name}${parameters ? '' : '：'}`, kind: '目录' }));
    return { start: lineStart + (line.match(/^\s*/)?.[0].length ?? 0), end: lineStart + (parameters ? parameters.start - 1 : colon < 0 ? line.length : colon + 1), query, items: rank(items, query) };
  }
  const prefix = line.match(/^\s*[@/／]?/u)![0];
  const marked = /[@/／]/.test(prefix);
  const nameStart = prefix.length;
  if (!before.trim() && !explicit) return;
  if (colon < 0 || column <= colon) {
    const typed = before.slice(nameStart).trim();
    if ((!typed && !marked && !explicit) || !/^[\p{Letter}\p{Number}_\s-]*$/u.test(typed)) return;
    const choices: TextCompletion[] = commandSignatures.filter(spec => !spec.legacy && (spec.name !== '角色功能' || project.characters.some(c => effectiveCharacter(project, c.id)?.features?.length))).map(spec => ({ id: `command:${spec.name}`, label: spec.name, detail: spec.detail, aliases: spec.aliases, insertText: `@${spec.name}${spec.parameters.length ? '：' : ''}`, kind: '指令', group: commandGroup(spec.name) }));
    choices.push(...commandPerformanceBlueprints(project).map(graph => ({ id: graphResourceKey(graph), label: blueprintCallName(graph), detail: `${graph.exposedInputs.length} 个参数`, aliases: [graph.name, blueprintGroup(project, graph.id)], insertText: `@${textReference(blueprintCallName(graph), graph.id)}${graph.exposedInputs.length ? '：' : ''}`, kind: isTimelineResource(graph) ? '时间轴预设' : '蓝图', group: blueprintGroup(project, graph.id) || (projectGraphs(project).some(item => item.id === graph.id) ? '项目演出' : '内置演出') })));
    if (!marked) choices.push(...[{ id: '', name: '旁白' }, ...project.characters].map(c => ({ id: `speaker:${c.id}`, label: c.name, detail: '填写这位角色的台词', insertText: `${c.name}：`, kind: '说话人' })));
    return { start: lineStart + (line.match(/^\s*/)?.[0].length ?? 0), end: lineStart + (colon < 0 ? line.length : colon + 1), query: typed, items: rank(choices, typed) };
  }
  if (!marked) return;
  const name = line.slice(nameStart, colon).trim().toLocaleLowerCase();
  const directGraph = resolveBlueprintCall(availablePerformanceBlueprints(project), name);
  let signature: CommandSignature | undefined = directGraph ? { name: blueprintCallName(directGraph), detail: '调用演出；可按顺序或参数名填写，省略项使用默认值。', parameters: [] } : commandSignatures.find(spec => spec.name.toLocaleLowerCase() === name || spec.aliases?.some(alias => alias.toLocaleLowerCase() === name));
  if (!signature) return;
  const args = line.slice(colon + 1);
  const graph = directGraph ?? (signature.name === '蓝图' ? resolveBlueprintCall(availablePerformanceBlueprints(project), argumentText(argumentTokens(args, true)[0]?.raw)) : undefined);
  const parameterOffset = directGraph ? 0 : 1;
  if (graph) signature = { ...signature, parameters: [...(directGraph ? [] : [signature.parameters[0]]), ...graph.exposedInputs.map(pin => ({ ...parameter(pin.name, pin.dataType === 'number' ? 'number' : pin.dataType === 'boolean' ? 'keyword' : pin.dataType === 'character' ? 'character' : pin.dataType === 'asset' ? 'asset' : 'text', '默认：' + String(pin.defaultValue ?? '未设置')), id: pin.id }))] };
  if (signature.name === '选项') {
    const arrow = args.match(/(?:->|→|前往)\s*/);
    if (arrow) {
      const from = colon + 1 + arrow.index! + arrow[0].length;
      const query = line.slice(from, column).trim();
      return { start: lineStart + from, end: lineStart + line.trimEnd().length, query, items: rank(storyTargetItems(project), query), signature, parameterIndex: 0 };
    }
  }
  const binding = bindArguments(args, signature.parameters, true);
  const relativeCaret = column - colon - 1;
  const current = [...binding.bindings].reverse().find(item => item.token.start <= relativeCaret) ?? binding.bindings[0];
  const token = current.token;
  const parameterIndex = current.index;
  const naming = token.name !== undefined && relativeCaret < token.valueStart;
  const from = naming ? token.start : token.valueStart;
  const to = naming ? token.valueStart : token.end;
  const rawQuery = args.slice(from, Math.max(from, relativeCaret)).trim();
  const query = rawQuery.replace(/^["']/, '').replace(/["']$/, '');
  const field = signature.parameters[parameterIndex];
  const values = binding.values.map(value => { try { return argumentText(value); } catch { return value ?? ''; } });
  const edits = signature.parameters.map((field, index): TextCompletion => {
    const existing = binding.bindings.find(item => item.index === index);
    const label = argumentName(field.name);
    if (existing) {
      const value = existing.token.raw;
      return { id: 'parameter:' + index, label, detail: field.detail, kind: '参数', insertText: label + '=' + value, replaceStart: lineStart + colon + 1 + existing.token.start, replaceEnd: lineStart + colon + 1 + existing.token.end, caretOffset: label.length + 1, openParameters: true };
    }
    const trailing = args.match(/[，,]\s*$/);
    const prefix = args.trim() && !trailing ? '，' : '';
    return { id: 'parameter:' + index, label, detail: field.detail, kind: '参数', insertText: prefix + label + '=', replaceStart: lineStart + line.length, replaceEnd: lineStart + line.length, openParameters: true };
  });
  const nextSpeaker = source.slice(source.indexOf('\n', caret) < 0 ? source.length : source.indexOf('\n', caret) + 1).split('\n').map(line => line.trim()).find(line => line && !line.startsWith('@') && !line.startsWith('//'));
  const speakerId = project.characters.find(c => c.name === nextSpeaker?.split(/[：:]/)[0].trim())?.id;
  let items = field ? argumentItems(project, signature, parameterIndex, values, speakerId) : [];
  let resource: CompletionResource | undefined;
  const resourceItem = (item: { id: string; name: string }, kind: string, assetId?: string): TextCompletion => ({ id: item.id, label: item.name, insertText: serializeParameterValue(textReference(item.name, item.id)), kind, detail: kind, assetId });
  if (graph && parameterIndex >= parameterOffset) {
    const pin = graph.exposedInputs[parameterIndex - parameterOffset];
    if (pin) {
      const target = blueprintInputTarget(graph, pin.id, { blueprints: availablePerformanceBlueprints(project) });
      if (target.pinId === 'lifetime') items = Object.entries(actorLifetimes).map(([id, name]) => ({ id, label: name, insertText: id, detail: name, kind: '显示范围' }));
      else if (target.pinId === 'instanceId') items = actorInstanceIds(project).map(id => ({ id, label: id, insertText: id, detail: '角色实例 ID', kind: '实例' }));
      else if (pin.dataType === 'asset') {
        resource = blueprintAssetFilter(withProjectGraphs({ ...project }, availablePerformanceBlueprints(project)), graph, pin);
        const categories = resource.category === 'all' ? undefined : assetCategories(project);
        items = project.assets.filter(asset => (resource!.kind === 'all' || asset.kind === resource!.kind) && (!categories || categories.get(asset.id) === resource!.category)).map(asset => ({ ...resourceItem(asset, pin.name, asset.kind === 'image' ? asset.id : undefined), aliases: [asset.path, asset.sourcePath ?? ''] }));
        if (!pin.required) items.unshift({ id: 'none', label: '无', insertText: '无', detail: '不使用此素材，覆盖默认值', kind: pin.name });
      } else if (pin.dataType === 'scene') items = project.scenes.map(scene => resourceItem(scene, '小章节'));
      else if (target.pinId === 'expressionId') {
        const nextDialogue = source.slice(lineEnd < 0 ? source.length : lineEnd + 1).split('\n').find(line => /^\s*[^@#\s][^：:]*[：:]/.test(line));
        const characterInput = graph.exposedInputs.findIndex(input => input.dataType === 'character');
        const specified = characterInput >= 0 ? values[characterInput + parameterOffset] || String(graph.exposedInputs[characterInput].defaultValue ?? '') : String(target.node?.properties.characterId ?? '');
        const speaker = target.node?.type === 'showCharacter' && !specified ? project.characters.find(character => character.name === nextDialogue?.split(/[：:]/)[0].trim())?.id : project.characters.find(character => character.id === specified || character.name === argumentName(specified))?.id;
        items = (effectiveCharacter(project, speaker ?? '')?.expressions ?? []).map(expression => resourceItem(expression, '表情', expression.assetId));
      } else if (pin.dataType === 'number' || pin.dataType === 'boolean') items = (pin.dataType === 'boolean' ? [true, false] : [...new Set([pin.defaultValue ?? 0, 0, .5, 1])]).map(value => ({ id: String(value), label: serializeParameterValue(value), insertText: serializeParameterValue(value), detail: '参数值', kind: pin.name }));
    }
  } else if (field && ['sceneAsset', 'image', 'video', 'asset', 'bgm', 'sound', 'voice'].includes(field.kind)) {
    resource = { kind: field.kind === 'asset' ? 'all' : field.kind === 'video' ? 'video' : ['sceneAsset', 'image'].includes(field.kind) ? 'image' : 'audio', category: field.kind === 'sceneAsset' ? 'scene' : field.kind === 'image' || field.kind === 'asset' ? 'all' : field.kind as 'video' | 'bgm' | 'sound' | 'voice' };
  }
  const used = new Set(binding.bindings.filter(item => item !== current && item.token.raw).map(item => item.index));
  if (naming || token.name === undefined) {
    const names = signature.parameters.flatMap((parameter, index) => used.has(index) ? [] : [{ id: 'name:' + index, label: argumentName(parameter.name), detail: parameter.detail, aliases: [argumentName(parameter.name)], insertText: argumentName(parameter.name) + '=', kind: '参数名', openParameters: true }]);
    items = naming ? names : [...items, ...names];
  }
  return { start: lineStart + colon + 1 + from, end: lineStart + colon + 1 + to, query, items: !explicit && !naming && items.some(item => item.label === query) ? [] : rank(items, query), signature, parameterIndex, parameterEdits: edits, resource: naming ? undefined : resource };
}
function rank(items: TextCompletion[], query: string) {
  return items.map(item => ({ item, score: completionScore(item.label, query, item.aliases) })).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 60).map(entry => entry.item);
}
