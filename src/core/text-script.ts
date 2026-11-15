import { cloneData } from "./project-mutation";
import { projectGraphs } from './project-resources';
import { characterDisplayPreset } from './character-presets';
import { isStandaloneNode, normalizeChapterPerformances, standaloneChapter } from './standalone-performance';
import { actionSchema, performancePlaybackSchema, textPresentationSchema, characterFeatureActions, createProject, effectiveCharacter, targets, type Diagnostic, type VariableValue, type EffectDefinition, type PerformancePlayback, type Project, type Scene, type SceneTransition, type StageAction, type StoryLine, type StoryNode, type TextAnimation, type TextPresentation } from './model';
import { pruneStoryGroups } from './story-groups';
import { textPresets } from './text-presentation';
import { dialogueMarkupRows, readMarkedRow, writeLineMarks, type TextMarkupSyntax } from './text-spans';
import { actorInstanceNumber, actorLifetimes, parseActorInstance, parseActorLifetime } from './actor-instance-identity';
import { blueprintActorInstanceTargets } from './blueprint-authoring';
import { endingPerformanceId, availablePerformanceBlueprints, createEndingPerformance, installPerformanceBlueprint, sharePerformancePresets } from './builtin-performances';
import { blueprintCallName, resolveBlueprintCall } from './blueprint-names';
import { commandSignature, floatingTextStyleParameters } from './command-parameters';
import { argumentTokens, bindArguments, argumentValue, argumentText } from './text-arguments';
import { parseTextCondition, textCondition } from './text-conditions';
import { parameterAssetFromText, parameterAssetText, parameterReference, parameterTypeName } from './parameter-sets';
import { parameterAssignmentPattern, parameterConditionalAssignment } from './parameter-references';
import { textHeading } from './text-headings';
import { currentScriptText } from './script-text';
import { createMediaVisual, isSimpleMediaVisual, mediaLifetime, mediaLifetimeNames, parseMediaLifetime, parseVisualRule, parseVisualTransitions, visualTransitionText } from './media-command';
import { canonicalImageVisual, defaultImageTransform, imageTransform, imageTransformText, parseImageTransform } from './image-transform';
import { defaultFlowTransition, flowTransitionSchema, remapStoryTransitionPorts, setStoryTransition, storyTransitionPorts, type FlowTransition } from './flow-transitions';
import { playerFlowStoryIds, type PlayerFlowStoryIdentityKind } from './player-flow-story-identities';

export interface TextIssue extends Diagnostic { sourceLine: number }
export interface TextSourceLocation { sourceLine: number; nodeId: string; lineId: string; actionCount?: number; reference?: boolean; playback?: boolean; markupSyntax?: TextMarkupSyntax }
export interface TextNodeLocation { sourceLine: number; nodeId: string }
export interface TextParseResult { project: Project; issues: TextIssue[]; sourceMap: TextSourceLocation[]; nodeLocations: TextNodeLocation[] }
const palette = ['#72bba6', '#dba776', '#8eaade', '#c88cab', '#8eb777', '#b59ade'];
const normalize = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const key = (prefix: string, text: string) => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `txt_${prefix}_${(hash >>> 0).toString(36)}`;
};
const commandParts = (line: string) => {
  const text = line.trim();
  // "@独立演出 1【id】" calls a graph whose name starts like a command; an
  // explicit 【reference】 is never split into "command + value" at a space.
  const match = text.match(/^[@／/]?\s*([^:：]+?)\s*[:：]\s*(.*)$/) ?? (/【[^】]+】\s*$/.test(text) ? null : text.match(/^[@／/]?\s*([^\s:：]+)\s+(.*)$/));
  if (match) return { name: match[1].trim().toLowerCase(), value: match[2].trim() };
  return /^[@／/]/.test(text) ? { name: text.slice(1).trim().toLowerCase(), value: '' } : undefined;
};
const sceneTransitionMode = (value: string): SceneTransition['mode'] | undefined => {
  const normalized = value.trim().toLowerCase();
  if (/^(淡入淡出|淡出|fade)$/.test(normalized)) return 'fade';
  if (/^(溶解|dissolve)$/.test(normalized)) return 'dissolve';
  return /^(无|none)$/.test(normalized) ? 'none' : undefined;
};
/** Read saved completion options without exposing them in new command signatures. */
export function standaloneArguments(raw: string): (string | undefined)[] {
  const parameters = commandSignature('独立演出')!.parameters;
  const tokens = argumentTokens(raw);
  const oldPositions = tokens.every(token => token.name === undefined) && (
    ['继续剧情', '返回标题', 'next', 'title'].includes(argumentText(tokens[2]?.raw))
    || tokens.length > parameters.length
    || tokens[2]?.raw === '' && ['无', '溶解', '纯色', 'none', 'dissolve', 'color'].includes(argumentText(tokens[3]?.raw))
  );
  const legacy = oldPositions || tokens.some(token => token.name === '结束后');
  const specs = legacy ? [...parameters.slice(0, 2), { name: '结束后' }, ...parameters.slice(2)] : parameters;
  const values = bindArguments(raw, specs).values;
  return legacy ? values : [...values.slice(0, 2), undefined, ...values.slice(2)];
}
function inlinePlayback(raw: (string | undefined)[], previous?: PerformancePlayback): PerformancePlayback | undefined {
  const values = raw.map(value => value === undefined || value === '' ? undefined : argumentValue(value));
  if (!values.some(value => value !== undefined)) return previous;
  const [clickSkip, complete, transition, outDuration, hold, inDuration, color] = values;
  if (clickSkip !== undefined && typeof clickSkip !== 'boolean') throw new Error('允许点击跳过请选择是或否。');
  if (complete !== undefined && !['继续剧情', '返回标题', 'next', 'title'].includes(String(complete))) throw new Error('结束后请选择继续剧情或返回标题。');
  const result: Record<string, unknown> = { ...previous, ...(clickSkip === undefined ? {} : { clickSkip }), ...(complete === undefined ? {} : { onComplete: ['返回标题', 'title'].includes(String(complete)) ? 'title' : 'next' }) };
  if (values.slice(2).some(value => value !== undefined)) {
    const mode = ({ 直接切换: 'none', 无: 'none', 溶解: 'dissolve', 纯色: 'color', none: 'none', dissolve: 'dissolve', color: 'color' } as Record<string, string>)[String(transition ?? previous?.transition?.mode ?? '纯色')];
    if (!mode) throw new Error('结束转场请选择无、溶解或纯色。');
    result.transition = { mode, outDuration: outDuration ?? previous?.transition?.outDuration ?? .5, hold: hold ?? previous?.transition?.hold ?? 0, inDuration: inDuration ?? previous?.transition?.inDuration ?? .5, color: color ?? previous?.transition?.color ?? '#000000' };
  }
  return performancePlaybackSchema.parse(result);
}
export function parseParameters(text: string): Record<string, string | number | boolean> {
  if (!text.trim()) return {};
  if (text.trim().startsWith('{')) {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key, item]) => !key.trim() || !['string', 'boolean', 'number'].includes(typeof item) || (typeof item === 'number' && !Number.isFinite(item)))) throw new Error('参数需要文字、数值或开关。');
    return value as Record<string, string | number | boolean>;
  }
  // Split only at top-level separators so quoted Chinese text may contain commas.
  const tokens: string[] = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (/[，,;；]/.test(character)) {
      tokens.push(text.slice(start, index));
      start = index + 1;
    }
  }
  if (quote) throw new Error('参数中的引号没有闭合。');
  tokens.push(text.slice(start));
  return Object.fromEntries(tokens.filter(token => token.trim()).map(token => {
    const match = token.trim().match(/^([^=：:]+)\s*[=：:]\s*(.+)$/);
    if (!match) throw new Error('参数格式为：名称=值。');
    const value = match[2].trim();
    let parsed: string | number | boolean = value;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      parsed = value.startsWith('"') ? JSON.parse(value) : value.slice(1, -1).replace(/\\(['\\])/g, '$1');
    } else if (/^(是|true)$/i.test(value)) parsed = true;
    else if (/^(否|false)$/i.test(value)) parsed = false;
    else if (Number.isFinite(Number(value)) && !/^0\d+/.test(value)) parsed = Number(value);
    return [match[1].trim(), parsed];
  }));
}
export function serializeParameterValue(value: string | number | boolean): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (!value || /[，,;；=：:]|^(是|否|true|false)$/i.test(value) || Number.isFinite(Number(value))) return JSON.stringify(value);
  return value;
}
function parseJumpTransition(text: string): { target: string; transition: SceneTransition } | undefined {
  let raw = text.trim();
  if (!/(?:^|[-，,\s])(?:切换方式|参数)\s*[:：-]/.test(raw)) {
    const parsed = bindArguments(raw, commandSignature('跳转')!.parameters, false, true);
    const [target, modeValue, durationValue, colorValue] = parsed.values.map(argumentText);
    if (!target) throw new Error('请选择跳转到的章节、小章节或段落。');
    if (parsed.bindings.length === 1 && parsed.bindings[0].token.name === undefined) return;
    const mode = sceneTransitionMode(modeValue || '无');
    if (!mode) throw new Error('切换方式只支持无、溶解或淡入淡出。');
    const duration = durationValue ? Number(durationValue) : mode === 'none' ? 0 : .5;
    if (!Number.isFinite(duration) || duration < 0) throw new Error('转场时长需要非负秒数。');
    const color = colorValue || '#000000';
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('转场颜色需要六位十六进制颜色。');
    const parameters = Object.fromEntries(Object.entries(parsed.extras).map(([name, value]) => [name, argumentValue(value)]));
    return { target, transition: { mode, duration, color, ...(Object.keys(parameters).length ? { parameters } : {}) } };
  }
  const parameterMatch = raw.match(/(?:^|[-，,\s])参数\s*[:：-]?\s*(.*)$/);
  if (parameterMatch) raw = raw.slice(0, parameterMatch.index).replace(/[-，,\s]+$/, '');
  const modeMatch = raw.match(/(?:^|[-，,\s])切换方式\s*[:：-]?\s*(.+)$/i);
  const target = (modeMatch ? raw.slice(0, modeMatch.index).replace(/[-，,\s]+$/, '') : raw).trim();
  if (!target) throw new Error('请选择跳转到的章节、小章节或段落。');
  const mode = sceneTransitionMode(modeMatch?.[1] ?? '无');
  if (!mode) throw new Error('切换方式只支持无、溶解或淡入淡出。');
  const parameters = parseParameters(parameterMatch?.[1] ?? '');
  const durationValue = parameters['时长'] ?? parameters['duration'];
  if (durationValue !== undefined && (typeof durationValue !== 'number' || !Number.isFinite(durationValue) || durationValue < 0)) throw new Error('转场时长需要非负秒数。');
  const duration = durationValue ?? (mode === 'none' ? 0 : 0.5);
  const color = parameters['颜色'] ?? parameters['color'] ?? '#000000';
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('转场颜色需要六位十六进制颜色。');
  for (const key of ['时长', 'duration', '颜色', 'color']) delete parameters[key];
  return { target, transition: { mode, duration, color, parameters: Object.keys(parameters).length ? parameters : undefined } };
}
const stripQuotes = (text: string) => text.trim().replace(/^["“「]|["”」]$/g, '');
const numberOr = (text: string | undefined, fallback: number) => text?.trim() && Number.isFinite(Number(text)) ? Number(text) : fallback;
const referenceId = /^[a-z][a-z0-9_]{0,63}$/;
export const textReference = (name: string, id: string) => `${name}【${id}】`;
function reference(value: string) {
  const text = value.trim();
  const match = text.match(/^(.*?)【([a-z][a-z0-9_]{0,63})】$/);
  return { name: match ? match[1].trim() : text, id: match?.[2] };
}
function named<T extends { id: string; name: string }>(items: T[], value: string): T | undefined {
  const ref = reference(value);
  const identified = items.find(item => item.id === (ref.id ?? ref.name));
  if (identified || ref.id) return identified;
  const candidates = items.filter(item => item.name === ref.name);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function parseFlowTransition(text: string): { owner: string; port: string; transition: FlowTransition } {
  const [owner, port, modeValue, duration, outDuration, hold, inDuration, color] = bindArguments(text, commandSignature('连线过渡')!.parameters).values.map(raw => raw === undefined || raw === '' ? undefined : argumentValue(raw));
  if (typeof owner !== 'string' || !owner.trim()) throw new Error('连线过渡需要指定来源模块。');
  if (typeof port !== 'string' || !port.trim()) throw new Error('连线过渡需要指定出口。');
  const modes: Record<string, FlowTransition['mode']> = { 无: 'none', 直接切换: 'none', 叠化: 'dissolve', 溶解: 'dissolve', 纯色: 'color', none: 'none', dissolve: 'dissolve', color: 'color' };
  const modeText = String(modeValue ?? ''), mode = Object.hasOwn(modes, modeText) ? modes[modeText] : undefined;
  if (!mode) throw new Error('连线过渡方式请选择直接切换、叠化或纯色。');
  if (mode !== 'color' && [outDuration, hold, inDuration, color].some(value => value !== undefined)) throw new Error('淡出、停留、淡入和颜色只用于纯色过渡。');
  if (mode !== 'dissolve' && duration !== undefined) throw new Error('时长只用于叠化；纯色过渡请分别填写淡出、停留和淡入。');
  const result = flowTransitionSchema.safeParse({ ...defaultFlowTransition(mode), ...(duration === undefined ? {} : { duration }), ...(outDuration === undefined ? {} : { outDuration }), ...(hold === undefined ? {} : { hold }), ...(inDuration === undefined ? {} : { inDuration }), ...(color === undefined ? {} : { color }) });
  if (!result.success) throw new Error('连线过渡无效：时长必须是不小于 0 的有限数值，纯色必须使用六位颜色。');
  return { owner, port, transition: result.data };
}

/** Keep connection settings visible and removable, separate from node snapshots. */
function nodeFlowTransitionText(node: StoryNode): string[] {
  const branchName = (port: string) => node.kind === 'choice' ? node.choices.find(option => option.id === port)?.text : node.kind === 'interaction' ? node.hotspots.find(hotspot => hotspot.id === port)?.name : undefined;
  const value = (text: string) => /[\r\n"'\\]/.test(text) ? JSON.stringify(text) : serializeParameterValue(text);
  return Object.entries(node.transitions ?? {}).map(([port, transition]) => {
    const label = branchName(port);
    const prefix = `@连线过渡：模块=${value(textReference(node.name, node.id))}，出口=${value(label ? textReference(label, port) : port)}`;
    if (transition.mode === 'none') return `${prefix}，方式=直接切换`;
    if (transition.mode === 'dissolve') return `${prefix}，方式=叠化，时长=${transition.duration}`;
    return `${prefix}，方式=纯色，淡出=${transition.outDuration}，停留=${transition.hold}，淡入=${transition.inDuration}，颜色=${transition.color}`;
  });
}

function preserveLineIds(previous: StoryLine[], lines: StoryLine[], nodeId: string, pinned = new Set<StoryLine>()) {
  const contentKey = (line: StoryLine) => JSON.stringify([line.speakerId ?? '', line.text]);
  const matching = new Map<string, { ids: string[]; used: number }>();
  for (const line of previous) {
    const content = contentKey(line);
    const queue = matching.get(content);
    if (queue) queue.ids.push(line.id);
    else matching.set(content, { ids: [line.id], used: 0 });
  }
  const assigned = new Set<StoryLine>(lines.filter(line => pinned.has(line)));
  const used = new Set([...pinned].map(line => line.id));
  for (const line of lines) {
    if (assigned.has(line)) continue;
    const queue = matching.get(contentKey(line));
    while (queue && used.has(queue.ids[queue.used])) queue.used += 1;
    const id = queue?.ids[queue.used++];
    if (id) { line.id = id; used.add(id); assigned.add(line); }
  }
  // Unchanged lines are anchors; only unmatched lines can reuse the IDs of
  // unmatched old lines. This preserves edits without letting an insertion
  // take the identity of a later, unchanged line.
  const remaining = previous.filter(line => !used.has(line.id));
  let nextPrevious = 0;
  const reserved = new Set(previous.map(line => line.id));
  for (const [index, line] of lines.entries()) {
    if (assigned.has(line)) continue;
    const old = remaining[nextPrevious++];
    if (old) { line.id = old.id; used.add(old.id); continue; }
    let id = key('line', `${nodeId}/${index}`);
    let suffix = 0;
    while (reserved.has(id) || used.has(id)) id = key('line', `${nodeId}/${index}/${++suffix}`);
    line.id = id;
    used.add(id);
  }
}

export function textCommandAction(project: Project, text: string, strict = false): StageAction | undefined {
  try { return parseTextCommandAction(project, text); }
  catch (error) { if (strict) throw error; return undefined; }
}
export function jumpCommandText(target: string, transition?: SceneTransition) {
  const args = [serializeParameterValue(target)];
  // An explicit immediate/zero setting is different from having no setting:
  // keep it through text editing so enabling another mode does not invent .5s.
  if (transition) {
    args.push({ none: '无', dissolve: '溶解', fade: '淡入淡出' }[transition.mode], String(transition.duration), transition.color);
    args.push(...Object.entries(transition.parameters ?? {}).map(([name, value]) => name + '=' + serializeParameterValue(value)));
  }
  return '@跳转：' + args.join('，');
}
/** Update old visible syntax without rewriting dialogue, comments or hidden references. */
export function replaceLegacyJumpCommands(source: string) {
  return source.replace(/^([ \t]*)@跳转[:：]([^\r\n]*)/gm, (line, space: string, value: string) => {
    if (!/[-，,\s](切换方式|参数)\s*[:：-]/.test(value)) return line;
    try { const parsed = parseJumpTransition(value); return parsed ? space + jumpCommandText(parsed.target, parsed.transition) : line; } catch { return line; }
  });
}
function parseTextCommandAction(project: Project, text: string): StageAction | undefined {
  let command = commandParts(text);
  const bareGraph = /^[@／/]/.test(text.trim()) && !/[:：]/.test(text) ? resolveBlueprintCall(availablePerformanceBlueprints(project), text.trim().slice(1)) : undefined;
  if (bareGraph) command = { name: textReference(blueprintCallName(bareGraph), bareGraph.id), value: '' };
  if (!command) return;
  const direct = resolveBlueprintCall(availablePerformanceBlueprints(project), command.name);
  if (direct) command = { name: '蓝图', value: `${textReference(direct.name, direct.id)}${command.value ? `，${command.value}` : ''}` };
  const requestedCommand = command.name;
  const signature = commandSignature(command.name);
  if (signature) command.name = signature.name.toLowerCase();
  const args = () => {
    const values = bindArguments(command!.value, signature?.parameters ?? []).values.map((raw, index) =>
      // Preserve the number's spelling so 0, 1.5, 01 and 1e2 cannot silently
      // become another actor. Quoted legacy names still use normal decoding.
      signature?.parameters[index]?.name === '第几个' && raw && !/^["']/.test(raw.trim()) ? raw.trim() : argumentText(raw));
    values.forEach((value, index) => {
      if (!value) return;
      const parameter = signature?.parameters[index];
      if (parameter?.kind === 'number' && !Number.isFinite(Number(value))) throw new Error(`参数“${parameter.name}”需要填写数值。`);
      if (parameter?.kind === 'number' && /^(时长|秒数|淡入|淡入秒数|淡出秒数)$/.test(parameter.name) && Number(value) < 0) throw new Error(`参数“${parameter.name}”需要填写非负秒数。`);
      if (parameter?.name === '等待完成' && !/^(是|否|true|false)$/i.test(value)) throw new Error('参数“等待完成”需要填写是或否。');
    });
    return values;
  };
  const value = stripQuotes(command.value);
  const asset = (kind: 'image' | 'audio' | 'video', name = value) => named(project.assets.filter(item => item.kind === kind), name);
  switch (command.name) {
    case '解锁素材': {
      const resource = named(project.assets, args()[0]);
      return resource ? { kind: 'unlock', assetId: resource.id } : undefined;
    }
    case '背景': case '切换背景': {
      const [name, mode, duration, wait] = args();
      const image = asset('image', name);
      const transition = sceneTransitionMode(mode || '溶解');
      if (!transition) throw new Error('背景转场支持无、溶解或淡入淡出。');
      if (duration && (!Number.isFinite(Number(duration)) || Number(duration) < 0)) throw new Error('转场时长需要非负秒数。');
      return image ? { kind: 'background', assetId: image.id, transition, ...(duration ? { duration: Number(duration) } : {}), ...(wait ? { wait: !/^(否|false)$/i.test(wait) } : {}) } : undefined;
    }
    case '背景音乐': case '音乐': case '播放音乐': {
      const values = args();
      const name = (values[0] || '').replace(/\s+(循环|不循环)$/, '');
      const audio = asset('audio', name);
      if (values[2] && !Number.isFinite(Number(values[2]))) throw new Error('音乐淡入需要填写秒数。');
      return audio ? { kind: 'music', assetId: audio.id, loop: values[1] ? !/^(否|false|不循环)$/i.test(values[1]) : !(values[0] ?? '').endsWith('不循环'), fade: numberOr(values[2], .5) } : undefined;
    }
    case '音效': case '播放音效': {
      const audio = asset('audio', args()[0]);
      return audio ? { kind: 'sound', assetId: audio.id } : undefined;
    }
    case '停止音乐': return { kind: 'stopMusic', fade: numberOr(args()[0], 0.5) };
    case '显示图片': {
      const values = args(), selected = asset('image', values[0]);
      if (!selected) return;
      const fits = { 容纳: 'contain', 填满: 'cover', 拉伸: 'stretch' } as const;
      if (values[7] && !(values[7] in fits)) throw new Error('适应方式为容纳、填满或拉伸。');
      return createMediaVisual('image', selected.id, { instanceId: values[1], ...parseImageTransform(values[2]), lifetime: parseMediaLifetime(values[3]), duration: numberOr(values[4], 0), layer: numberOr(values[5], 20), wait: /^(是|true)$/i.test(values[6] ?? ''), fit: fits[values[7] as keyof typeof fits] ?? 'contain', ...parseVisualTransitions(values.slice(8)) });
    }
    case '显示视频': case '显示文字': {
      const values = args(), content = command.name === '显示视频' ? 'video' : 'text';
      const selected = content === 'text' ? undefined : asset(content, values[0]);
      if (content !== 'text' && !selected) return;
      const fit = { 容纳: 'contain', 填满: 'cover', 拉伸: 'stretch' } as const;
      if (content !== 'text' && values[9] && !(values[9] in fit)) throw new Error('适应方式为容纳、填满或拉伸。');
      if (content === 'video' && values[10] && !/^(是|否|true|false)$/i.test(values[10])) throw new Error('循环需要填写是或否。');
      // Keep raw values here: decoding and re-quoting would turn boolean flags
      // into strings and lose the distinction between literal text and keywords.
      const raw = content === 'text' ? bindArguments(command.value, signature!.parameters).values : [];
      const look = content === 'text' ? parseTextPresentation(project, floatingTextStyleParameters.flatMap((field, index) => raw[18 + index] ? [`${field.name === '逐字时长' ? '时长' : field.name}=${raw[18 + index]}`] : []).join('，')) : undefined;
      const { fontAssetId, italic: textItalic, align: textAlign, textEffects, ...textMotion } = look ?? {};
      return createMediaVisual(content, content === 'text' ? values[0] ?? '' : selected!.id, { ...parseVisualTransitions(values.slice(content === 'video' ? 12 : 11)), instanceId: values[1], x: numberOr(values[2], .5), y: numberOr(values[3], .5), width: numberOr(values[4], content === 'text' ? .8 : 1), height: numberOr(values[5], content === 'text' ? .2 : 1), duration: numberOr(values[6], 0), layer: numberOr(values[7], 20), wait: /^(是|true)$/i.test(values[8] ?? ''),
        ...(look ? { fontAssetId, textItalic, textAlign, textEffects, ...(Object.keys(textMotion).length ? { textMotion } : {}) } : {}),
        ...(content === 'text' ? { fontSize: numberOr(values[9], 60), color: values[10] || '#ffffff' } : { fit: fit[values[9] as keyof typeof fit] ?? 'contain' }),
        ...(content === 'video' ? { loop: /^(是|true)$/i.test(values[10] ?? ''), volume: numberOr(values[11], 1) } : {}) });
    }
    case '隐藏对象': return actionSchema.parse({ kind: 'hideVisual', ...(args()[1] || args()[2] ? { exitTransition: parseVisualRule(args()[1], args()[2]) } : {}), ...(args()[3] ? { wait: /^(是|true)$/i.test(args()[3]) } : {}), instanceId: args()[0] || (requestedCommand === '隐藏视频' ? 'video' : requestedCommand === '隐藏文字' ? 'text' : 'image') });
    case '隐藏界面': return { kind: 'hideInterface' };
    case '显示界面': return { kind: 'showInterface' };
    case '开始台词演出': case '播放台词演出': return { kind: 'startDialogue' };
    case '等待': case '暂停': {
      const seconds = args()[0];
      if (seconds && !Number.isFinite(Number(seconds))) throw new Error('等待时长需要填写秒数，例如 @等待：0.5。');
      return { kind: 'pause', seconds: numberOr(seconds, 0) };
    }
    case '震动': {
      const values = args();
      const direction = /横|水平|horizontal/.test(values[0]) ? 'horizontal' as const : 'vertical' as const;
      if (values.length === 1) return { kind: 'shake', direction };
      if (values.length > 4 || values.slice(1, 3).some(value => value && !Number.isFinite(Number(value))) || values[3] && !/^(是|否|true|false)$/i.test(values[3])) throw new Error('震动参数为：方向，时长，幅度，等待完成（是/否）。');
      return { kind: 'shake', direction, duration: numberOr(values[1], 0.6), amplitude: numberOr(values[2], 20), wait: !/^(否|false)$/i.test(values[3] ?? '') };
    }
    case '镜头': {
      const values = args();
      const easings = { 匀速: 'linear', 缓入缓出: 'ease', 缓入: 'easein', 缓出: 'easeout', linear: 'linear', ease: 'ease', easein: 'easein', easeout: 'easeout' } as const;
      if (values.length > 7 || values.slice(0, 5).some(value => value && !Number.isFinite(Number(value))) || values[5] && !(values[5] in easings) || values[6] && !/^(是|否|true|false)$/i.test(values[6])) throw new Error('镜头参数为：横移，纵移，缩放，时长，旋转，缓动，等待完成（是/否）。');
      return { kind: 'camera', x: numberOr(values[0], 0), y: numberOr(values[1], 0), zoom: numberOr(values[2], 1), rotation: numberOr(values[4], 0), duration: numberOr(values[3], 0.5), easing: easings[values[5] as keyof typeof easings] ?? 'ease', wait: !/^(否|false)$/i.test(values[6] ?? '') };
    }
    case '隐藏': case '隐藏角色': {
      const [name, mode, duration, wait, instance] = args();
      const instanceId = parseActorInstance(instance);
      const character = named(project.characters, name ?? '');
      const transition = sceneTransitionMode(mode || '溶解');
      if (!transition) throw new Error('角色转场支持无、溶解或淡入淡出。');
      return character ? { kind: 'hide', characterId: character.id, ...(instanceId ? { instanceId } : {}), transition, ...(duration ? { duration: Number(duration) } : {}), ...(wait ? { wait: !/^(否|false)$/i.test(wait) } : {}) } : undefined;
    }
    case '显示角色': {
      const values = args();
      const character = effectiveCharacter(project, named(project.characters, values[0] ?? '')?.id ?? '');
      if (values[0] && !character) return;
      const expression = values[1] ? named(character?.expressions ?? [], values[1]) : character?.expressions.find(item => item.id === character.defaultExpressionId) ?? character?.expressions[0];
      if (values.length > 16 || values.slice(2, 6).some(item => item && !Number.isFinite(Number(item)))) return;
      const lifetime = parseActorLifetime(values[8]) ?? (!values[0] && !values[8] ? 'line' : undefined), instanceId = parseActorInstance(values[9]);
      const presetValue = values[7] || (!values.slice(2, 5).some(Boolean) ? 'default' : '');
      const presetRef = reference(presetValue).id ?? presetValue;
      const manual = !presetRef || /^(手动|手动位置|manual)$/i.test(presetRef);
      const preset = character && !manual ? characterDisplayPreset(project, character.id, presetRef) : undefined;
      if (character && !manual && !preset) throw new Error(`找不到角色站位预设：${presetValue}`);
      const presetId = /^(default|默认|角色默认)$/.test(presetRef) ? 'default' : preset?.id ?? presetRef;
      const actorTransitions: NonNullable<Extract<StageAction, { kind: 'show' }>['actorTransitions']> = {};
      for (const [index, phase] of (['enter', 'exit', 'expression'] as const).entries()) {
        const rule = parseVisualRule(values[10 + index * 2] || undefined, values[11 + index * 2]);
        if (rule) actorTransitions[phase] = rule;
      }
      return !character || expression ? { kind: 'show', characterId: character?.id ?? '', expressionId: character ? values[1] ? expression!.id : '' : reference(values[1] ?? '').id ?? values[1] ?? '', ...(lifetime ? { lifetime } : {}), ...(instanceId ? { instanceId } : {}), ...(manual ? {} : { presetId }), x: numberOr(values[2], 0.5), y: numberOr(values[4], 1), scale: numberOr(values[3], 1), layer: Math.round(numberOr(values[5], 10)), transition: 'dissolve', ...(values[6] ? { wait: !/^(否|false)$/i.test(values[6]) } : {}), ...(Object.keys(actorTransitions).length ? { actorTransitions } : {}) } : undefined;
    }
    case '效果': {
      const value = args()[0];
      if (value === '震动' || value === '纵向震动') return { kind: 'shake', direction: 'vertical' };
      if (value === '横向震动') return { kind: 'shake', direction: 'horizontal' };
      if (value === '镜头推进') return { kind: 'camera', x: 0, y: 0, zoom: 1.15, rotation: 0, duration: 0.8, easing: 'ease', wait: true };
      if (value === '镜头复位') return { kind: 'camera', x: 0, y: 0, zoom: 1, rotation: 0, duration: 0.5, easing: 'ease', wait: true };
      const effect = named(project.effects, value);
      return effect ? { kind: 'effect', effectId: effect.id } : undefined;
    }
    case '蓝图': case '通用蓝图': {
      const split = command.value.search(/[，,]/);
      const graph = resolveBlueprintCall(availablePerformanceBlueprints(project), split < 0 ? command.value : command.value.slice(0, split));
      if (!graph) return;
      const input: Record<string, string | number | boolean> = {};
      const parameterSource = split < 0 ? '' : command.value.slice(split + 1);
      const parameters = parameterSource.trim().startsWith('{') ? Object.entries(parseParameters(parameterSource)).map(([name, raw]) => ({ pin: named(graph.exposedInputs, name), raw, name, source: undefined as string | undefined })) : bindArguments(parameterSource, graph.exposedInputs).bindings.filter(({ token }) => token.raw !== '').map(({ token, index }) => ({ pin: graph.exposedInputs[index], raw: argumentValue(token.raw), name: token.name ?? String(index + 1), source: token.raw }));
      for (const { pin, raw, name, source } of parameters) {
        if (!pin) throw new Error(`蓝图“${graph.name}”没有输入“${name}”。`);
        let argument = raw;
        if (blueprintActorInstanceTargets(graph, pin.id, { blueprints: availablePerformanceBlueprints(project) }).length) {
          const token = source !== undefined && !/^["']/.test(source.trim()) ? source.trim() : typeof raw === 'number' ? String(raw) : raw;
          if (typeof token !== 'string') throw new Error('第几个需要填写从 1 开始的整数。');
          parseActorInstance(token);
          argument = token;
        } else if (typeof raw === 'string') {
          if (pin.dataType === 'asset' && raw) argument = raw === '无' || raw.toLowerCase() === 'none' ? '' : named(project.assets, raw)?.id ?? raw;
          else if (pin.dataType === 'character' && raw) argument = named(project.characters, raw)?.id ?? raw;
          else if (pin.dataType === 'scene' && raw) argument = named(project.scenes, raw)?.id ?? raw;
          else argument = reference(raw).id ?? raw;
        }
        if (['number', 'boolean', 'string'].includes(pin.dataType) && typeof argument !== pin.dataType) throw new Error(`蓝图参数“${pin.name}”需要${pin.dataType === 'number' ? '数值' : pin.dataType === 'boolean' ? '是或否' : '文字（数字文字请加引号）'}。`);
        input[pin.id] = argument;
      }
      return { kind: 'blueprint', blueprintId: graph.id, ...(Object.keys(input).length ? { inputs: input } : {}) };
    }
    case '角色功能': case '角色-功能': {
      const values = args();
      const character = effectiveCharacter(project, named(project.characters, values[0])?.id ?? '');
      const feature = named(character?.features ?? [], values[1] ?? '');
      return character && feature ? { kind: 'characterFeature', characterId: character.id, featureId: feature.id } : undefined;
    }
  }
}

export function expandEffect(project: Project, effectId: string, seen = new Set<string>()): StageAction[] {
  if (seen.has(effectId)) return [];
  const effect = project.effects.find(item => item.id === effectId);
  if (!effect) return [];
  const next = new Set(seen).add(effectId);
  return [...(effect.actions ?? []), ...effect.commands.map(command => textCommandAction(project, command))].flatMap(action => {
    return action?.kind === 'effect' ? expandEffect(project, action.effectId, next) : action ? [action] : [];
  });
}

/** Expand effects and character features for editor previews and compilation. */
export function expandStageAction(project: Project, action: StageAction, seen = new Set<string>()): StageAction[] {
  if (action.kind === 'effect') {
    const key = `effect:${action.effectId}`;
    if (seen.has(key)) return [];
    const effect = project.effects.find(item => item.id === action.effectId);
    if (!effect) return [];
    const next = new Set(seen).add(key);
    return [...(effect.actions ?? []), ...effect.commands.map(command => textCommandAction(project, command)).filter((item): item is StageAction => !!item)].flatMap(item => expandStageAction(project, item, next));
  }
  if (action.kind === 'characterFeature') {
    const key = `feature:${action.characterId}:${action.featureId}`;
    if (seen.has(key)) return [];
    const feature = effectiveCharacter(project, action.characterId)?.features?.find(item => item.id === action.featureId);
    if (!feature) return [];
    const next = new Set(seen).add(key);
    return characterFeatureActions(project, action.characterId, action.featureId).flatMap(item => expandStageAction(project, item, next));
  }
  return [action];
}

export function applyTextScript(input: Project, source: string, sourceName?: string): TextParseResult {
  const project = cloneData(input);
  const occupiedStoryIds = playerFlowStoryIds(input);
  for (const chapter of input.chapters) occupiedStoryIds.chapter.add(chapter.id);
  for (const scene of input.scenes) occupiedStoryIds.scene.add(scene.id);
  for (const node of input.nodes) occupiedStoryIds.node.add(node.id);
  const storyKey = (kind: PlayerFlowStoryIdentityKind, seed: string, prefix: string = kind) => {
    const base = key(prefix, seed);
    let id = base, suffix = 2;
    // New identities cannot revive missing map entries or capture a live object
    // that appears later in the source. Explicit IDs and old matches bypass this.
    while (occupiedStoryIds[kind].has(id)) id = `${base}_${suffix++}`;
    return id;
  };
  sharePerformancePresets(input, project);
  const content = normalize(source);
  const issues: TextIssue[] = [];
  const issue = (message: string, sourceLine: number, nodeId?: string) => issues.push({ severity: 'error', message, sourceLine, nodeId });
  const lines = content.split('\n');
  const effects: EffectDefinition[] = [];
  // A later explicit declaration owns its ID before any implicit copy is matched.
  const explicitNodeIds = new Set<string>();
  let scanningEffectBody = false;
  let definition: EffectDefinition | undefined;
  for (const [index, raw] of lines.entries()) {
    if (raw.trimStart().startsWith('//')) continue;
    const command = commandParts(raw);
    if (command?.name === '效果定义') scanningEffectBody = true;
    else if (/^\s*[@／/]?效果结束\s*$/.test(raw)) scanningEffectBody = false;
    else if (!scanningEffectBody) {
      const heading = textHeading(raw);
      const identity = heading ? reference(raw.slice(heading.nameFrom!)).id
        : /^\s*[@／/]/.test(raw) && (command?.name === '节点标记' || command?.name === '实例')
          ? reference(command.value).id ?? (command.name === '实例' && referenceId.test(command.value.trim()) && input.nodes.some(node => node.id === command.value.trim()) ? command.value.trim() : undefined)
          : undefined;
      if (identity) {
        const kind = heading?.kind === '章节' ? 'chapter' : heading?.kind === '小章节' ? 'scene' : 'node';
        occupiedStoryIds[kind].add(identity);
        if (kind === 'node') explicitNodeIds.add(identity);
      }
    }
    if (command?.name === '效果定义') {
      const ref = reference(command.value);
      const existing = named(project.effects, command.value);
      if (!ref.id && project.effects.filter(item => item.name === ref.name).length > 1) { issue(`效果定义名称有歧义：${ref.name}`, index + 1); definition = undefined; continue; }
      definition = { id: ref.id ?? existing?.id ?? key('effect', ref.name), name: ref.name, commands: [], ...(existing?.actions ? { actions: existing.actions } : {}) };
      if (effects.some(effect => effect.id === definition!.id)) issue(`效果定义重复：${ref.name}`, index + 1);
      effects.push(definition);
    } else if (/^\s*[@／/]?效果结束\s*$/.test(raw)) definition = undefined;
    else if (definition && raw.trim()) definition.commands.push(raw.trim().replace(/^[@／/]?动作\s*[:：]?\s*/, ''));
  }
  project.effects = [...project.effects.filter(item => !effects.some(effect => effect.id === item.id)), ...effects];
  let chapter: Project['chapters'][number] = project.chapters[0] ?? { id: storyKey('chapter', project.id), name: '第一章' };
  const oldNodes = new Map<string, StoryNode[]>();
  for (const node of project.nodes) oldNodes.set(node.name, [...(oldNodes.get(node.name) ?? []), node]);
  const oldScenes = project.scenes;
  const oldChapters = project.chapters;
  const oldLines = new Map(input.nodes.flatMap(node => node.kind === 'passage' ? node.lines.map(line => [line.id, line] as const) : []));
  project.chapters = [];
  project.scenes = [];
  project.nodes = [];
  project.scriptText = currentScriptText(content, sourceName ?? input.scriptText?.sourceName);
  let scene: Scene = { id: '', name: '', chapterId: chapter.id };
  let current: StoryNode | undefined;
  let completedStandalone: string | undefined;
  let declaredPassageId: string | undefined;
  let pendingActions: StageAction[] = [];
  let pendingVoiceId: string | undefined;
  let pendingTextPresentation: TextPresentation | undefined;
  let pendingLineId: string | undefined;
  let pendingMarkupDeclaration: { sourceLine: number } | undefined;
  const quotedDialogueRows = new WeakMap<StoryLine, number>();
  let pendingChoiceId: { id: string; nodeId: string; sourceLine: number } | undefined;
  let pendingPlayback: PerformancePlayback | undefined;
  let pendingNodeReference: string | undefined;
  let sourceLineNumber = 1;
  let pendingLocations: { sourceLine: number; actionCount: number; playback?: boolean }[] = [];
  const locations: (Omit<TextSourceLocation, 'lineId'> & { line: StoryLine })[] = [];
  const nodeSourceLines = new Map<string, number>();
  const pinnedLines = new Set<StoryLine>();
  const usedLineIds = new Set<string>();
  let definitionOpen = false;
  let passageNumber = 0;
  let wasBlank = true;
  const links: { nodeId: string; port: string; name: string; sourceLine: number; transition?: SceneTransition }[] = [];
  const flowTransitions: (ReturnType<typeof parseFlowTransition> & { sourceLine: number })[] = [];
  const sceneBases: { sceneId: string; value: string; sourceLine: number }[] = [];
  let entryReference: { value: string; sourceLine: number } | undefined;
  const explicit = new Set<string>();
  const instances = new Set<string>();
  const usedIds = new Set<string>();
  const generatedNodeKey = (prefix: 'start' | 'instance', seed: string, kind: StoryNode['kind']) => {
    const base = key(prefix, seed);
    // These implicit nodes are reconstructed without a heading on each parse.
    // Match their prior generated identity before allocating a new one, including
    // a collision suffix whose original missing reference was later removed.
    const old = input.nodes.find(node => node.kind === kind && !usedIds.has(node.id) && !explicitNodeIds.has(node.id)
      && (node.id === base || node.id.startsWith(base + '_') && /^\d+$/.test(node.id.slice(base.length + 1))));
    return old?.id ?? storyKey('node', seed, prefix);
  };
  let chapterDeclared = false;
  const previousNode = (value: string, kind?: StoryNode['kind']) => {
    const ref = reference(value);
    const identified = input.nodes.find(node => node.id === (ref.id ?? ref.name));
    const candidates = (identified ? [identified] : ref.id ? [] : oldNodes.get(ref.name) ?? []).filter(node => !usedIds.has(node.id) && (!kind || node.kind === kind || kind === 'chapterTitle' && !!standaloneChapter(node)));
    return candidates.find(node => node.sceneId === scene.id) ?? candidates[0];
  };
  const startChapter = (value: string) => {
    chapterDeclared = true;
    const ref = reference(value);
    const old = oldChapters.find(item => ref.id ? item.id === ref.id : item.name === ref.name);
    const existing = project.chapters.find(item => ref.id ? item.id === ref.id : item.name === ref.name);
    chapter = existing ?? { id: ref.id ?? old?.id ?? storyKey('chapter', `${project.id}/${ref.name}`), name: ref.name || old?.name || '第一章' };
    if (!existing) project.chapters.push(chapter);
    scene = { id: '', name: '', chapterId: chapter.id };
    current = undefined;
    declaredPassageId = undefined;
  };
  const startScene = (value: string) => {
    const ref = reference(value);
    const old = oldScenes.find(item => ref.id ? item.id === ref.id : item.name === ref.name && item.chapterId === chapter.id);
    if (!chapterDeclared && ref.id && old && old.chapterId !== chapter.id) chapter = project.chapters.find(item => item.id === old.chapterId) ?? oldChapters.find(item => item.id === old.chapterId) ?? chapter;
    if (!project.chapters.some(item => item.id === chapter.id)) project.chapters.push(chapter);
    const existing = project.scenes.find(item => ref.id ? item.id === ref.id : item.name === ref.name && item.chapterId === chapter.id);
    scene = existing ?? { ...cloneData(old ?? {}), id: ref.id ?? old?.id ?? storyKey('scene', `${chapter.id}/${ref.name}`), name: ref.name || old?.name || '开场', chapterId: chapter.id };
    if (!existing) project.scenes.push(scene);
    current = undefined;
    declaredPassageId = undefined;
  };
  const begin = (kind: StoryNode['kind'], value: string, original?: StoryNode, preserveOriginal = false, duplicate = false) => {
    declaredPassageId = undefined;
    if (!scene.id) startScene('开场');
    const hasNodeMarker = pendingNodeReference !== undefined;
    const identity = pendingNodeReference ?? value;
    pendingNodeReference = undefined;
    const ref = reference(identity);
    const name = ref.name || original?.name || value;
    const old = original ?? previousNode(identity, kind);
    let id = duplicate
      ? (hasNodeMarker ? ref.id : undefined) ?? generatedNodeKey('instance', `${scene.id}/${old?.id}/${project.nodes.length}`, kind)
      : old && !usedIds.has(old.id) ? old.id : ref.id ?? storyKey('node', `${scene.id}/${kind}/${name}`);
    if (usedIds.has(id)) id = storyKey('node', `${id}/${project.nodes.length}`);
    usedIds.add(id);
    nodeSourceLines.set(id, sourceLineNumber);
    // Internal/standalone markers have no heading options. Keep legacy metadata
    // attached to their stable identity when another heading is edited.
    const legacyFlowchart = old && (old.textHeading === false || isStandaloneNode(old)) ? old.flowchart : undefined;
    const base = { id, name, sceneId: scene.id, x: old?.x ?? 80 + (project.nodes.length % 3) * 290, y: old?.y ?? 80 + Math.floor(project.nodes.length / 3) * 190, textHeading: false as const, ...(legacyFlowchart ? { flowchart: cloneData(legacyFlowchart) } : {}) };
    // An instance is an explicit reference to an existing node. Clone the
    // full authored node so animation, interaction and minigame fields do not
    // disappear when the text editor rebuilds the graph.
    if (preserveOriginal && old?.kind === kind) {
      current = { ...cloneData(old), ...base };
      if (current.id !== old.id) {
        const ports = new Map<string, string>();
        if (current.kind === 'passage') current.lines.forEach(line => { line.id = key('line', `${current!.id}/${line.id}`); });
        if (current.kind === 'choice') current.choices.forEach(choice => { const id = key('option', `${current!.id}/${choice.id}`); ports.set(choice.id, id); choice.id = id; });
        if (current.kind === 'interaction') current.hotspots.forEach(hotspot => { const id = key('hotspot', `${current!.id}/${hotspot.id}`); ports.set(hotspot.id, id); hotspot.id = id; });
        remapStoryTransitionPorts(current, ports);
      }
      project.nodes.push(current);
      return current;
    }
    switch (kind) {
      case 'passage': current = { ...base, kind, lines: [] }; break;
      case 'start': current = { ...base, kind }; break;
      case 'choice': current = { ...base, kind, prompt: '', choices: [] }; break;
      case 'condition': current = { ...base, kind, condition: { kind: 'all', conditions: [] } }; break;
      case 'set': current = { ...base, kind, variableId: project.variables[0]?.id ?? 'missing', operation: 'set', value: 0 }; break;
      case 'jump': current = { ...base, kind }; break;
      case 'call': current = { ...base, kind }; break;
      case 'return': current = { ...base, kind }; break;
      case 'end': current = { ...base, kind }; break;
      case 'chapterTitle': current = { ...base, kind, title: name, subtitle: '', duration: 2.5,
        ...(old?.kind === 'chapterTitle' && old.effect !== undefined ? { effect: old.effect } : {}),
        ...(old?.kind === 'chapterTitle' && old.backgroundId !== undefined ? { backgroundId: old.backgroundId } : {}),
        ...(old?.kind === 'chapterTitle' && old.titleImageId !== undefined ? { titleImageId: old.titleImageId } : {}),
        ...(old?.kind === 'chapterTitle' && old.soundId !== undefined ? { soundId: old.soundId } : {}) }; break;
      default: current = old ? { ...cloneData(old), ...base } : { ...base, kind: 'passage', lines: [] };
    }
    if (current.kind === 'chapterTitle' && old?.kind === 'passage') Object.assign(current, { ...standaloneChapter(old), kind: 'chapterTitle' });
    project.nodes.push(current);
    return current;
  };
  // A paragraph is a named directory entry. Its first content determines the
  // runtime node type; an operation must not leave an empty dialogue before it.
  const beginOperation = (kind: StoryNode['kind'], value: string, original?: StoryNode, preserveOriginal = false) => {
    const label = current?.kind === 'passage' && current.id === declaredPassageId && !current.lines.length ? current : undefined;
    if (label) {
      const labelSourceLine = nodeSourceLines.get(label.id)!;
      project.nodes.splice(project.nodes.indexOf(label), 1);
      usedIds.delete(label.id);
      const node = begin(kind, textReference(label.name, label.id), original ?? input.nodes.find(node => node.id === label.id) ?? label, preserveOriginal);
      delete node.textHeading;
      if (label.flowchart) node.flowchart = label.flowchart; else delete node.flowchart;
      nodeSourceLines.set(node.id, labelSourceLine);
      return node;
    }
    return begin(kind, value, original, preserveOriginal);
  };
  const passage = () => current?.kind === 'passage' && current.id !== completedStandalone ? current : begin('passage', `段落 ${++passageNumber}`) as Extract<StoryNode, { kind: 'passage' }>;
  // Dialogue rows may carry part-line effects: 〖词｜效果〗 and 〖停顿=秒〗.
  const appendMarked = (line: StoryLine, row: string, separator = '', syntax: TextMarkupSyntax = 'legacy') => {
    let read: ReturnType<typeof readMarkedRow>;
    let valid = true;
    try { read = readMarkedRow(project, row, Array.from(line.text + separator).length, syntax); }
    // An unreadable mark stays as written, so prose that happens to use 〖〗 never blocks a project.
    // Explicit quoted syntax is never silently reduced to a style-free line:
    // keep its draft and report an error so saving/playing cannot accept loss.
    catch (error) { valid = false; issues.push({ severity: syntax === 'quoted' ? 'error' : 'warning', message: `${error instanceof Error ? error.message : '文字效果标记无效。'} 这段文字按原样显示。`, sourceLine: sourceLineNumber, nodeId: current?.id }); read = { text: row, spans: [], pauses: [] }; }
    line.text += separator + read.text;
    if (read.spans.length || read.pauses.length) writeLineMarks(line, { spans: [...(line.textSpans ?? []), ...read.spans], pauses: [...(line.textPauses ?? []), ...read.pauses] }, line.text);
    if (syntax === 'quoted' && valid && (row || separator === '\n')) quotedDialogueRows.set(line, sourceLineNumber); else quotedDialogueRows.delete(line);
  };
  const addDialogue = (speaker: string, text: string, continuation = false, recordSource = true, silent = false) => {
    const syntax: TextMarkupSyntax = pendingMarkupDeclaration ? 'quoted' : 'legacy';
    if (pendingMarkupDeclaration) continuation = false;
    pendingMarkupDeclaration = undefined;
    const node = passage();
    // Leading actions belong to the new passage too, including after a
    // standalone performance whose closing declaration starts a new boundary.
    const firstActionLine = pendingLocations[0]?.sourceLine;
    if (!node.lines.length && firstActionLine) nodeSourceLines.set(node.id, Math.min(nodeSourceLines.get(node.id)!, firstActionLine));
    declaredPassageId = undefined;
    if (continuation && node.lines.length && !pendingActions.length && !pendingVoiceId && !pendingTextPresentation && !pendingLineId) {
      const line = node.lines[node.lines.length - 1];
      appendMarked(line, text, '', quotedDialogueRows.get(line) === sourceLineNumber - 1 ? 'quoted' : syntax);
      locations.push({ sourceLine: sourceLineNumber, nodeId: node.id, line, ...(quotedDialogueRows.has(line) ? { markupSyntax: 'quoted' as const } : {}) });
      return;
    }
    let speakerId: string | undefined;
    if (speaker && !['旁白', '叙述', 'narrator'].includes(speaker.toLowerCase())) {
      let character = named(project.characters, speaker);
      if (!character) { character = { id: key('character', speaker), name: reference(speaker).name, color: palette[project.characters.length % palette.length], expressions: [] }; project.characters.push(character); }
      speakerId = character.id;
    }
    const line: StoryLine = { id: pendingLineId && !usedLineIds.has(pendingLineId) ? pendingLineId : key('line', `${node.id}/${node.lines.length}`), ...(speakerId ? { speakerId } : {}), text: '', actions: pendingActions, ...(pendingVoiceId ? { voiceId: pendingVoiceId } : {}) };
    appendMarked(line, text, '', syntax);
    if (silent) line.silent = true;
    if (pendingPlayback) line.playback = pendingPlayback;
    if (pendingTextPresentation) line.textPresentation = pendingTextPresentation;
    if (pendingLineId && !usedLineIds.has(pendingLineId)) { pinnedLines.add(line); usedLineIds.add(pendingLineId); }
    node.lines.push(line);
    locations.push(...pendingLocations.map(location => ({ ...location, nodeId: node.id, line })));
    if (recordSource) locations.push({ sourceLine: sourceLineNumber, nodeId: node.id, line, ...(syntax === 'quoted' ? { markupSyntax: syntax } : {}) });
    pendingLocations = [];
    pendingActions = [];
    pendingVoiceId = undefined;
    pendingTextPresentation = undefined;
    pendingLineId = undefined;
    pendingPlayback = undefined;
  };
  for (const [index, raw] of lines.entries()) {
    sourceLineNumber = index + 1;
    const trimmed = raw.trim();
    // Hidden dialogue identities may be reinserted between the visible
    // declaration and its owner by textDocument edits. They are the sole
    // structural row allowed between the declaration and dialogue.
    if (pendingMarkupDeclaration && (!trimmed || /^(?:[@／/#]|;)/.test(trimmed) && !/^[@／/]\s*对白标记\s*[:：]/.test(trimmed) || /^[-—…\.·]{3,}$/.test(trimmed))) {
      issue('局部文字语法声明必须紧接下一句台词；本次声明未应用。', pendingMarkupDeclaration.sourceLine, current?.id);
      pendingMarkupDeclaration = undefined;
    }
    if (!trimmed) { wasBlank = true; continue; }
    if (trimmed.startsWith('//')) continue;
    if (definitionOpen && !/^[@／/]?效果结束\s*$/.test(trimmed)) continue;
    const bare = trimmed.match(/^[@／/]\s*(开始|返回|选择|独立演出)\s*$/);
    const command = commandParts(trimmed) ?? (bare ? { name: bare[1], value: '' } : undefined);
    if (pendingChoiceId && command?.name !== '选项') {
      issue('选项标记需要紧接一条 @选项。', pendingChoiceId.sourceLine, pendingChoiceId.nodeId);
      pendingChoiceId = undefined;
    }
    if (command?.name === '效果定义') { definitionOpen = true; continue; }
    if (/^[@／/]?效果结束\s*$/.test(trimmed)) { definitionOpen = false; continue; }
    if (definitionOpen) continue;
    const heading = textHeading(trimmed);
    if (heading) {
      if (pendingActions.length || pendingVoiceId || pendingTextPresentation || pendingLineId) addDialogue('旁白', '', false, false);
      const { kind } = heading, name = trimmed.slice(heading.nameFrom!);
      const rawOptions = heading.parameters && trimmed.slice(heading.parameters.start, heading.parameters.end);
      let flowchart: StoryNode['flowchart'];
      try {
        const options = parseParameters(rawOptions ?? '');
        for (const key of Object.keys(options)) if (!['流程图', '显示名称', '样式'].includes(key)) throw new Error('目录参数只支持“流程图”、“显示名称”和“样式”。');
        if (options['流程图'] !== undefined && typeof options['流程图'] !== 'boolean') throw new Error('流程图请填写“是”或“否”。');
        if (options['显示名称'] !== undefined && (typeof options['显示名称'] !== 'string' || options['显示名称'].length > 120)) throw new Error('显示名称需要不超过 120 个字的文字。');
        const style = options['样式'] === undefined ? undefined : typeof options['样式'] === 'string' ? named(project.ui.flowStyles ?? [], options['样式']) : undefined;
        if (options['样式'] !== undefined && !style) throw new Error('节点外观预设不存在，请选中“界面”中的玩家剧情图，在“节点样式 → 节点外观预设”中创建后选择。');
        if (Object.keys(options).length) flowchart = { visible: options['流程图'] as boolean | undefined, name: options['显示名称'] as string | undefined, ...(style ? { styleId: style.id } : {}) };
      } catch (error) { issue(error instanceof Error ? error.message : '目录参数无效。', index + 1); continue; }
      if (kind === '章节') startChapter(name);
      else if (kind === '小章节') startScene(name);
      else {
        begin('passage', name, previousNode(name));
        delete current!.textHeading;
        declaredPassageId = current!.id;
      }
      const owner = kind === '章节' ? chapter : kind === '小章节' ? scene : current!;
      if (flowchart) owner.flowchart = flowchart;
      else delete owner.flowchart;
      wasBlank = true;
      continue;
    }
    if (trimmed.startsWith('#')) { issue('目录只支持 #章节：名称、#小章节：名称、#段落：名称；演出和流程操作请使用 @ 指令。', index + 1); continue; }
    if (/^[-—…\.·]{3,}$/.test(trimmed)) { if (pendingActions.length || pendingVoiceId || pendingTextPresentation || pendingLineId) addDialogue('旁白', '', false, false); current = undefined; wasBlank = true; continue; }
    if (command && (/^[@／/]/.test(trimmed) || command.name === '效果')) {
      const { name } = command;
      let value = command.value;
      if (name === '连线过渡') {
        try { flowTransitions.push({ ...parseFlowTransition(value), sourceLine: index + 1 }); }
        catch (error) { issue(error instanceof Error ? error.message : '连线过渡无效。', index + 1, current?.id); }
        continue;
      }
      if (['入口', '调用', '配音'].includes(name)) {
        try { value = argumentText(bindArguments(value, commandSignature(name)!.parameters).values[0]); }
        catch (error) { issue(error instanceof Error ? error.message : '参数无效。', index + 1, current?.id); continue; }
      }
      if (name === '节点标记') {
        const ref = reference(value);
        if (!ref.id) { issue('节点引用无效，请重新选择对应的段落。', index + 1); continue; }
        // The editor hides identity markers. A command inserted immediately
        // before a passage's first visible line may precede its marker; keep
        // it with that passage instead of manufacturing an empty dialogue.
        const original = input.nodes.find(node => node.id === ref.id);
        if (original?.kind !== 'passage' && (pendingActions.length || pendingVoiceId || pendingTextPresentation || pendingLineId)) addDialogue('旁白', '', false, false);
        if (current?.kind === 'passage' && current.id === declaredPassageId && !current.lines.length) {
          const previousId = current.id, line = nodeSourceLines.get(previousId)!;
          usedIds.delete(previousId); nodeSourceLines.delete(previousId);
          current.id = ref.id; declaredPassageId = ref.id; usedIds.add(ref.id); nodeSourceLines.set(ref.id, line);
          if (original) { current.x = original.x; current.y = original.y; }
        } else {
          current = undefined; declaredPassageId = undefined; pendingNodeReference = value;
        }
        continue;
      }
      if (name === '演出设置' || name === '演出转场') {
        try {
          const previousPlayback = current?.kind === 'chapterTitle' ? current.playback : pendingPlayback;
          const values = bindArguments(value, commandSignature(name)!.parameters).values.map(raw => raw === undefined ? undefined : argumentValue(raw));
          if (name === '演出设置') {
            if (values[0] !== undefined && typeof values[0] !== 'boolean') throw new Error('允许点击跳过请选择是或否。');
            if (values[1] !== undefined && !['继续剧情', '返回标题', 'next', 'title'].includes(String(values[1]))) throw new Error('结束后请选择继续剧情或返回标题。');
            pendingPlayback = performancePlaybackSchema.parse({ ...previousPlayback, ...(values[0] === undefined ? {} : { clickSkip: values[0] }), ...(values[1] === undefined ? {} : { onComplete: ['返回标题', 'title'].includes(String(values[1])) ? 'title' : 'next' }) });
          } else {
            const mode = ({ 直接切换: 'none', 无: 'none', 溶解: 'dissolve', 纯色: 'color', none: 'none', dissolve: 'dissolve', color: 'color' } as Record<string, string>)[String(values[0] ?? '无')];
            if (!mode) throw new Error('演出转场请选择无、溶解或纯色。');
            pendingPlayback = performancePlaybackSchema.parse({ ...previousPlayback, transition: { mode, outDuration: values[1] ?? .5, hold: values[2] ?? 0, inDuration: values[3] ?? .5, color: values[4] ?? '#000000' } });
          }
          if (current?.kind === 'chapterTitle') { current.playback = pendingPlayback; pendingPlayback = undefined; }
          else pendingLocations.push({ sourceLine: index + 1, actionCount: pendingActions.length, playback: true });
        } catch (error) { issue(error instanceof Error ? error.message : '演出设置无效。', index + 1, current?.id); }
        continue;
      }
      if (name === '开始' || name === '返回' || name === '选择' || name === '返回标题' || name === '返回标题界面') {
        if (pendingActions.length || pendingVoiceId || pendingTextPresentation || pendingLineId) addDialogue('旁白', '', false, false);
        const kind = ({ 开始: 'start', 返回: 'return', 选择: 'choice', 返回标题: 'end', 返回标题界面: 'end' } as const)[name];
        const node = beginOperation(kind, `${name} ${project.nodes.length + 1}`);
        if (node.kind === 'choice') node.prompt = value;
        continue;
      }
      if (name === '独立演出') {
        try {
          // Old declarations allowed unquoted punctuation in the entire name.
          // Match saved names before interpreting newly supported parameters.
          const legacyName = input.scriptText?.playbackSyntax !== 'inline' && input.nodes.some(node => isStandaloneNode(node) && node.name === reference(value).name);
          const values = legacyName ? [serializeParameterValue(value)] : standaloneArguments(value);
          const moduleReference = argumentText(values[0]), playback = inlinePlayback(values.slice(1), pendingPlayback);
          if (moduleReference.trim()) {
            const moduleName = reference(moduleReference).name.trim();
            if (moduleName.length > 120) throw new Error('独立演出名称最多 120 个字。');
            const firstSourceLine = pendingLocations[0]?.sourceLine;
            const node = beginOperation('passage', moduleReference);
            node.name = moduleName;
            const original = input.nodes.find(item => item.id === node.id);
            if (isStandaloneNode(original) && original.textHeading !== false) delete node.textHeading;
            if (firstSourceLine) nodeSourceLines.set(node.id, Math.min(nodeSourceLines.get(node.id)!, firstSourceLine));
          }
          pendingPlayback = playback;
          pendingLocations.push({ sourceLine: index + 1, actionCount: pendingActions.length });
          if (!moduleReference.trim() && current?.kind === 'passage' && current.lines.length) beginOperation('passage', `独立演出 ${++passageNumber}`);
          addDialogue('旁白', '', false, false, true);
          completedStandalone = current?.id;
          wasBlank = true;
        } catch (error) { issue(error instanceof Error ? error.message : '独立演出参数无效。', index + 1, current?.id); }
        continue;
      }
      if (name === '场景基础' || name === '场景模板') {
        if (!scene.id) startScene('开场');
        if (value === '无') scene.baseSceneId = undefined;
        else sceneBases.push({ sceneId: scene.id, value, sourceLine: index + 1 });
        continue;
      }
      if (name === '场景参数') {
        if (!scene.id) startScene('开场');
        try { scene.parameters = parseParameters(value); }
        catch (error) { issue(error instanceof Error ? error.message : '场景参数无效。', index + 1); }
        continue;
      }
      if (name === '场景蓝图') {
        if (!scene.id) startScene('开场');
        const graph = named(projectGraphs(project) ?? [], value);
        if (graph) scene.blueprintId = graph.id;
        else if (value === '无') scene.blueprintId = undefined;
        else issue(`找不到场景蓝图：${value}`, index + 1);
        continue;
      }
      if (name === '界面实例' || name === 'UI实例') {
        if (value === '默认' || value === '无') { project.ui.activeInstanceId = undefined; continue; }
        const instance = named(project.ui.instances ?? [], value);
        if (!instance) issue(`界面实例不存在或名称有歧义：${value}`, index + 1);
        else project.ui.activeInstanceId = instance.id;
        continue;
      }
      if (name === '入口') { entryReference = { value, sourceLine: index + 1 }; continue; }
      if (name === '局部文字语法') {
        if (value !== '带引号') issue('局部文字语法只支持“带引号”；声明未应用。', index + 1, current?.id);
        else pendingMarkupDeclaration = { sourceLine: index + 1 };
        continue;
      }
      if (name === '对白标记') {
        const id = reference(value).id ?? (referenceId.test(value) ? value : undefined);
        if (pendingLineId && pendingLineId !== id && (pendingActions.length || pendingVoiceId || pendingTextPresentation)) addDialogue('旁白', '', false, false);
        if (id) pendingLineId = id;
        else { issue('对白标记需要有效的行引用。', index + 1, current?.id); pendingMarkupDeclaration = undefined; }
        continue;
      }
      if (name === '选项标记') {
        const id = reference(value).id ?? (referenceId.test(value) ? value : undefined);
        if (current?.kind !== 'choice') issue('选项标记需要写在 @选择 后、@选项 前。', index + 1, current?.id);
        else if (!id) issue('选项标记需要有效的选项引用。', index + 1, current.id);
        else pendingChoiceId = { id, nodeId: current.id, sourceLine: index + 1 };
        continue;
      }
      if (name === '文字演出' || name === '文字样式') {
        try { pendingTextPresentation = parseTextPresentation(project, value); }
        catch (error) { issue(error instanceof Error ? error.message : '文字演出设置无效。', index + 1, current?.id); }
        continue;
      }
      if (name === '配音') {
        const audio = named(project.assets.filter(asset => asset.kind === 'audio'), value);
        if (audio) pendingVoiceId = audio.id;
        else if (value === '无') pendingVoiceId = undefined;
        else issue(`找不到配音素材：${value}`, index + 1, current?.id);
        continue;
      }
      if (name === '续行' && current?.kind === 'passage' && current.lines.length) {
        const line = current.lines[current.lines.length - 1];
        appendMarked(line, value, '\n', quotedDialogueRows.get(line) === sourceLineNumber - 1 ? 'quoted' : 'legacy');
        locations.push({ sourceLine: index + 1, nodeId: current.id, line, ...(quotedDialogueRows.has(line) ? { markupSyntax: 'quoted' as const } : {}) });
        continue;
      }
      if (name === '演出实例') {
        const snapshotReference = value.match(/^(.*?)\s+使用【([a-z][a-z0-9_]{0,63})】$/);
        const ref = reference(snapshotReference?.[1] ?? value);
        const sourceLine = oldLines.get(ref.id ?? ref.name);
        const snapshotId = snapshotReference?.[2] ?? key('performance', ref.id ?? ref.name);
        let snapshot = project.effects.find(effect => effect.id === snapshotId);
        if (!snapshot && sourceLine) {
          snapshot = { id: snapshotId, name: `${(ref.name || '对白').slice(0, 118)}演出`, commands: [], actions: cloneData(sourceLine.actions) };
          project.effects.push(snapshot);
        }
        if (!snapshot) { issue(`找不到演出实例：${ref.name}`, index + 1, current?.id); continue; }
        pendingActions.push(...cloneData(snapshot.actions ?? []), ...snapshot.commands.flatMap(text => { const action = textCommandAction(project, text); return action ? [action] : []; }));
        pendingLocations.push({ sourceLine: index + 1, actionCount: pendingActions.length });
        if (sourceLine && !pendingLineId) pendingLineId = sourceLine.id;
        if (!snapshotReference && sourceLine?.voiceId) pendingVoiceId = sourceLine.voiceId;
        continue;
      }
      if (['实例', '复用节点', '节点实例', '互动实例', '小游戏实例'].includes(name)) {
        if (pendingActions.length || pendingVoiceId || pendingTextPresentation || pendingLineId) addDialogue('旁白', '', false, false);
        const ref = reference(value);
        const allowedKind = name === '互动实例' ? 'interaction' : name === '小游戏实例' ? 'minigame' : undefined;
        const candidates = input.nodes.filter(node => (ref.id ? node.id === ref.id : node.name === ref.name || node.id === ref.name) && (!allowedKind || node.kind === allowedKind));
        const local = candidates.filter(node => node.sceneId === scene.id);
        const originals = local.length ? local : candidates;
        if (originals.length !== 1) { issue(originals.length ? `可复用节点名称有歧义：${value}` : `找不到可复用节点：${value}`, index + 1); continue; }
        const original = originals[0];
        if (name === '实例') {
          beginOperation(original.kind, original.name, original, true);
          // Serialized instances carry editable transition declarations below.
          // Removing a declaration must not restore its old hidden setting.
          delete current!.transitions;
        }
        else begin(original.kind, original.name, original, true, true);
        explicit.add(`${current!.id}/next`); instances.add(current!.id);
        continue;
      }
      if (name === '跳转' || name === '调用') {
        if (pendingActions.length || pendingVoiceId || pendingTextPresentation || pendingLineId) addDialogue('旁白', '', false, false);
        let transition: ReturnType<typeof parseJumpTransition>;
        try { if (name === '跳转') transition = parseJumpTransition(value); }
        catch (error) { issue(error instanceof Error ? error.message : '跳转转场格式无效。', index + 1); continue; }
        if (transition) {
          const node = beginOperation('jump', `跳转 ${reference(transition.target).name}`);
          links.push({ nodeId: node.id, port: 'target', name: transition.target, sourceLine: index + 1, transition: transition.transition });
          current = undefined; declaredPassageId = undefined;
          continue;
        }
        if (name === '调用') beginOperation('call', `调用 ${reference(value).name}`);
        else if (!current || declaredPassageId || !['start', 'passage', 'set', 'call', 'chapterTitle'].includes(current.kind)) beginOperation('jump', `跳转 ${reference(value).name}`);
        const port = name === '调用' || current!.kind === 'jump' ? 'target' : 'next';
        if (value && value !== '无') links.push({ nodeId: current!.id, port, name: value, sourceLine: index + 1 });
        explicit.add(`${current!.id}/${port}`);
        if (name === '跳转') { current = undefined; declaredPassageId = undefined; }
        continue;
      }
      if (name === '选项') {
        if (current?.kind !== 'choice' && (pendingActions.length || pendingVoiceId || pendingTextPresentation || pendingLineId)) addDialogue('旁白', '', false, false);
        if (current?.kind !== 'choice') beginOperation('choice', `选择 ${project.nodes.length + 1}`);
        const choice = current as Extract<StoryNode, { kind: 'choice' }>;
        const parts = value.split(/\s*(?:->|→|前往)\s*/);
        const original = input.nodes.find(node => node.id === choice.id);
        const oldChoice = original?.kind === 'choice' ? original.choices.find(item => item.text === parts[0] && !choice.choices.some(option => option.id === item.id)) ?? original.choices[choice.choices.length] : undefined;
        const marked = pendingChoiceId?.nodeId === choice.id ? pendingChoiceId.id : undefined;
        pendingChoiceId = undefined;
        if (marked && choice.choices.some(option => option.id === marked)) { issue(`选项标记重复：${marked}`, index + 1, choice.id); continue; }
        const optionId = marked ?? (oldChoice && !choice.choices.some(option => option.id === oldChoice.id) ? oldChoice.id : key('option', `${choice.id}/${choice.choices.length}`));
        choice.choices.push({ id: optionId, text: parts[0] });
        if (parts[1] && parts[1] !== '无') links.push({ nodeId: choice.id, port: optionId, name: parts[1], sourceLine: index + 1 });
        else if (parts[1] === '无') continue;
        else issue('选项需要指定前往的章节、小章节或段落。', index + 1, choice.id);
        continue;
      }
      if (name === '条件') {
        if (pendingActions.length || pendingVoiceId || pendingTextPresentation || pendingLineId) addDialogue('旁白', '', false, false);
        try {
          const condition = parseTextCondition(project, value);
          const node = beginOperation('condition', `条件 ${project.nodes.length + 1}`);
          if (node.kind === 'condition') node.condition = condition;
        } catch (error) { issue(error instanceof Error ? error.message : '条件无效。', index + 1, current?.id); }
        continue;
      }
      if (name === '满足' || name === '不满足') {
        if (current?.kind !== 'condition') { issue(`${name}需要写在 @条件 后面。`, index + 1, current?.id); continue; }
        const port = name === '满足' ? 'yes' : 'no';
        const target = value.startsWith('"') ? argumentText(value) : value;
        if (target && target !== '无') links.push({ nodeId: current.id, port, name: target, sourceLine: index + 1 });
        explicit.add(`${current.id}/${port}`);
        continue;
      }
      if (name === '设置' || name === '变量' || name === '如果') {
        if (pendingActions.length || pendingVoiceId || pendingTextPresentation || pendingLineId) addDialogue('旁白', '', false, false);
        let when: import('./model').Condition | undefined;
        if (name === '如果' || /^如果\s*/.test(value)) {
          try {
            const conditional = parameterConditionalAssignment(value.replace(/^如果\s*/, ''));
            if (!conditional) throw new Error('条件赋值格式为：@设置：如果 章节进度 < 2，章节进度 = 2');
            when = parseTextCondition(project, conditional.condition); value = conditional.assignment;
          } catch (error) { issue(error instanceof Error ? error.message : '条件赋值无效。', index + 1); continue; }
        }
        const match = value.match(parameterAssignmentPattern);
        if (!match) { issue('状态格式为：@设置：好感度 += 1', index + 1); continue; }
        beginOperation('set', `修改 ${match[1].trim()} ${project.nodes.length + 1}`);
        const node = current as Extract<StoryNode, { kind: 'set' }>;
        if (when) node.when = when;
        const valueText = stripQuotes(match[3]);
        let parsedValue: VariableValue;
        try { parsedValue = argumentValue(match[3]); }
        catch { issue('赋值内容的引号或文字格式无效。', index + 1, node.id); continue; }
        const variableReference = reference(match[1].trim());
        let variable = named(project.variables, match[1].trim());
        if (!variable && (variableReference.id || project.variables.filter(item => item.name === variableReference.name).length > 1)) { issue(`状态引用不存在或名称有歧义：${match[1].trim()}`, index + 1, node.id); continue; }
        if (variable?.type === 'asset') {
          // Asset parameters are written by asset name; keep unknown text so the author can fix it.
          if (match[2] === '+=' || match[2] === '增加') { issue(`“${variable.name}”是${parameterTypeName(variable)}参数，只能用 = 设为某个素材。`, index + 1, node.id); continue; }
          const assetId = parameterAssetFromText(project, variable, match[3]);
          if (assetId === undefined) issue(`未找到${parameterTypeName(variable)}素材：${valueText}`, index + 1, node.id);
          parsedValue = assetId ?? valueText;
        }
        if (!variable) { variable = { id: key('variable', match[1].trim()), name: match[1].trim(), type: typeof parsedValue as 'number' | 'boolean' | 'string', initial: typeof parsedValue === 'number' ? 0 : typeof parsedValue === 'boolean' ? false : '', persistent: false, resetWithSettings: false }; project.variables.push(variable); }
        node.variableId = variable.id; node.operation = match[2] === '+=' || match[2] === '增加' ? 'add' : 'set'; node.value = parsedValue;
        continue;
      }
      let action: StageAction | undefined;
      try { action = textCommandAction(project, trimmed, true); }
      catch (error) { issue(error instanceof Error ? error.message : '演出参数无效。', index + 1, current?.id); continue; }
      if (action) {
        pendingActions.push(action); pendingLocations.push({ sourceLine: index + 1, actionCount: pendingActions.length });
        continue;
      }
      issue(`未找到指令或资源：${trimmed}`, index + 1, current?.id);
      continue;
    }
    if (/^[@／/]/.test(trimmed)) { issue(`未找到指令：${trimmed}`, index + 1, current?.id); continue; }
    // Chapter-like titles in imported prose often contain a colon, for
    // example “琼.第一回：归（崇祯五年）”. Detect them before the dialogue
    // pattern so they do not become a character named after the title.
    if (!project.nodes.length && /^[^:：]{0,100}第[零〇一二三四五六七八九十百千万两\d]+[回章节篇部卷]/.test(trimmed) && trimmed.length <= 200) {
      if (pendingMarkupDeclaration) { issue('局部文字语法声明后需要台词，不能用于作品标题。', pendingMarkupDeclaration.sourceLine); pendingMarkupDeclaration = undefined; }
      project.name = trimmed; continue;
    }
    const dialogue = trimmed.match(/^([^:：]{1,40})\s*[:：]\s*(.*)$/);
    addDialogue(dialogue?.[1].trim() ?? '旁白', dialogue?.[2] ?? trimmed, !dialogue && !wasBlank);
    wasBlank = false;
  }
  if (pendingChoiceId) issue('选项标记后缺少 @选项。', pendingChoiceId.sourceLine, pendingChoiceId.nodeId);
  if (pendingMarkupDeclaration) { issue('局部文字语法声明后缺少台词；声明未应用。', pendingMarkupDeclaration.sourceLine, current?.id); pendingMarkupDeclaration = undefined; }
  if (pendingActions.length || pendingVoiceId || pendingTextPresentation || pendingLineId || pendingPlayback) addDialogue('旁白', '', false, false);
  if (!project.nodes.length) addDialogue('旁白', '', false, false);
  for (const link of sceneBases) {
    const allScenes = [...new Map([...oldScenes, ...project.scenes].map(item => [item.id, item])).values()];
    const base = named(allScenes, link.value);
    const child = project.scenes.find(item => item.id === link.sceneId)!;
    if (!base) { issue(`找不到基础场景或名称有歧义：${link.value}`, link.sourceLine); continue; }
    if (base.id === child.id) { issue('场景不能继承自己。', link.sourceLine); continue; }
    child.baseSceneId = base.id;
    let current: Scene | undefined = base;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (!project.scenes.some(item => item.id === current!.id)) project.scenes.push(cloneData(current));
      const chapter = oldChapters.find(item => item.id === current!.chapterId);
      if (chapter && !project.chapters.some(item => item.id === chapter.id)) project.chapters.push(cloneData(chapter));
      current = allScenes.find(item => item.id === current?.baseSceneId);
    }
  }
  for (const node of project.nodes) {
    if (node.kind !== 'passage' || instances.has(node.id)) continue;
    const original = input.nodes.find(previous => previous.id === node.id);
    preserveLineIds(original?.kind === 'passage' ? original.lines : [], node.lines, node.id, pinnedLines);
  }
  if (!project.nodes.some(node => node.kind === 'start') && !entryReference) {
    const first = project.nodes[0];
    project.nodes.unshift({ id: generatedNodeKey('start', project.id, 'start'), kind: 'start', name: '开始', sceneId: first.sceneId, x: 20, y: 80, next: first.id, textHeading: false });
  }
  // An explicit entry also marks the graph's authored structure. Generated
  // text must preserve a deliberately disconnected or return-only graph;
  // adding an ending here makes a module edit look like a new text draft.
  if (!entryReference && !project.nodes.some(node => node.kind === 'end')) {
    const ending = begin('end', '故事结束');
    nodeSourceLines.delete(ending.id);
  }
  project.entryId = project.nodes.find(node => node.id === input.entryId)?.id ?? project.nodes[0].id;
  for (const [index, node] of project.nodes.entries()) {
    if (!explicit.has(`${node.id}/next`) && ['start', 'passage', 'set', 'call', 'chapterTitle'].includes(node.kind)) Object.assign(node, { next: project.nodes[index + 1]?.id });
  }
  const retainedEntries = new Map<string, string>();
  const retainSceneEntry = (targetScene: Project['scenes'][number]) => {
    const originalMembers = input.nodes.filter(item => item.sceneId === targetScene.id);
    const start = originalMembers.find(item => item.kind === 'start');
    const entry = start?.kind === 'start' && start.next ? input.nodes.find(item => item.id === start.next) : originalMembers.find(item => item.kind !== 'start');
    if (!entry) return;
    const keepScene = (sceneId: string) => {
      const owner = input.scenes.find(item => item.id === sceneId);
      if (!owner) return;
      if (!project.scenes.some(item => item.id === sceneId)) project.scenes.push(cloneData(owner));
      const chapter = input.chapters.find(item => item.id === owner.chapterId);
      if (chapter && !project.chapters.some(item => item.id === chapter.id)) project.chapters.push(cloneData(chapter));
    };
    keepScene(targetScene.id);
    // Imported prose may explicitly call a scene that is authored visually.
    // Retain only that entry's reachable dependencies, with their original IDs.
    const pending = [entry.id];
    const kept = new Set(project.nodes.map(node => node.id));
    const originals = new Map(input.nodes.map(node => [node.id, node]));
    while (pending.length) {
      const id = pending.pop()!;
      if (kept.has(id)) continue;
      const original = originals.get(id);
      if (!original) continue;
      kept.add(id);
      project.nodes.push(cloneData(original));
      keepScene(original.sceneId);
      for (const edge of targets(original)) if (edge.target) pending.push(edge.target);
    }
    retainedEntries.set(targetScene.id, entry.id);
  };
  const sceneEntry = (targetScene: Scene | undefined, resolving = new Set<string>()): StoryNode | undefined => {
    if (!targetScene) return;
    if (resolving.has(targetScene.id)) return;
    const nextResolving = new Set(resolving).add(targetScene.id);
    if (!project.scenes.some(scene => scene.id === targetScene.id)) retainSceneEntry(targetScene);
    const members = project.nodes.filter(node => node.sceneId === targetScene.id);
    const start = members.find(node => node.kind === 'start');
    const retained = retainedEntries.get(targetScene.id);
    if (retained) return project.nodes.find(node => node.id === retained);
    if (start) {
      // A caller may appear before the destination's start command. Resolve
      // its authored link first instead of choosing an unrelated first block.
      const entryLink = links.find(link => link.nodeId === start.id && link.port === 'next');
      if (entryLink) return resolveTarget(entryLink.name, start, nextResolving).target;
      if (start.next) return project.nodes.find(node => node.id === start.next);
      if (explicit.has(`${start.id}/next`)) return;
    }
    return members.find(node => node.kind !== 'start');
  };
  const resolveTarget = (value: string, sourceNode?: StoryNode, resolving = new Set<string>()): { target?: StoryNode; ambiguous?: boolean } => {
    const ref = reference(value);
    const scenes = [...new Map([...input.scenes, ...project.scenes].map(scene => [scene.id, scene])).values()];
    const chapters = [...new Map([...input.chapters, ...project.chapters].map(chapter => [chapter.id, chapter])).values()];
    const identified = project.nodes.find(node => node.id === (ref.id ?? ref.name));
    if (identified) return { target: identified };
    const chapterEntry = (id: string) => sceneEntry(project.scenes.find(scene => scene.chapterId === id) ?? scenes.find(scene => scene.chapterId === id), resolving);
    const chapter = chapters.find(chapter => chapter.id === (ref.id ?? ref.name));
    const scene = scenes.find(scene => scene.id === (ref.id ?? ref.name));
    if (ref.id || chapter || scene) return { target: chapter ? chapterEntry(chapter.id) : sceneEntry(scene, resolving) };
    const candidates = project.nodes.filter(node => {
      const owner = project.scenes.find(scene => scene.id === node.sceneId);
      const chapter = chapters.find(chapter => chapter.id === owner?.chapterId);
      return node.name === ref.name || `${owner?.name}/${node.name}` === ref.name || `${chapter?.name}/${owner?.name}/${node.name}` === ref.name;
    });
    const local = candidates.filter(node => node.sceneId === sourceNode?.sceneId);
    const nodes = local.length ? local : candidates;
    if (nodes.length) return nodes.length === 1 ? { target: nodes[0] } : { ambiguous: true };
    const matches = scenes.filter(scene => scene.name === ref.name || `${chapters.find(chapter => chapter.id === scene.chapterId)?.name}/${scene.name}` === ref.name);
    const owner = project.scenes.find(scene => scene.id === sourceNode?.sceneId);
    const localScenes = matches.filter(scene => scene.chapterId === owner?.chapterId);
    const destinations = localScenes.length ? localScenes : matches;
    if (destinations.length) return destinations.length === 1 ? { target: sceneEntry(destinations[0], resolving) } : { ambiguous: true };
    const matchingChapters = chapters.filter(chapter => chapter.name === ref.name);
    return matchingChapters.length > 1 ? { ambiguous: true } : { target: matchingChapters[0] ? chapterEntry(matchingChapters[0].id) : undefined };
  };
  for (const link of links) {
    const node = project.nodes.find(node => node.id === link.nodeId)!;
    const { target, ambiguous } = resolveTarget(link.name, node);
    if (!target) { issue(ambiguous ? `跳转目标名称有歧义，请选择具体目录项：${link.name}` : `找不到跳转目标或目标没有可执行入口：${link.name}`, link.sourceLine, node.id); continue; }
    if (node.kind === 'choice') node.choices.find(option => option.id === link.port)!.target = target.id;
    else Object.assign(node, { [link.port]: target.id });
    if (link.transition && node.kind === 'jump') node.sceneTransition = { ...link.transition, fromSceneId: node.sceneId, toSceneId: target.sceneId };
    if (node.kind !== 'choice' && target.kind === 'passage' && target.lines[0]) locations.push({ sourceLine: link.sourceLine, nodeId: target.id, line: target.lines[0], reference: true });
  }
  for (const link of links) {
    const node = project.nodes.find(node => node.id === link.nodeId)!;
    if (!['jump', 'start', 'passage', 'set'].includes(node.kind)) continue;
    const firstTarget = node.kind === 'jump' ? node.target : 'next' in node ? node.next : undefined;
    if (!firstTarget) continue;
    const seen = new Set<string>([node.id]);
    let target = project.nodes.find(item => item.id === firstTarget);
    while (target) {
      if (target.kind === 'passage' && target.lines.some(line => line.text.trim() || line.actions.flatMap(action => action.kind === 'effect' ? expandEffect(project, action.effectId) : [action]).some(action => action.kind === 'pause' && action.seconds > 0 || 'wait' in action && action.wait))) break;
      if (seen.has(target.id)) { issue(`跳转会形成没有对白或等待的空循环：${link.name}`, link.sourceLine, node.id); break; }
      seen.add(target.id);
      const next = target.kind === 'jump' ? target.target : target.kind === 'start' || target.kind === 'passage' || target.kind === 'set' ? target.next : undefined;
      if (!next) break;
      target = project.nodes.find(item => item.id === next);
    }
  }
  if (entryReference) {
    const { target, ambiguous } = resolveTarget(entryReference.value);
    if (target) project.entryId = target.id;
    else issue(ambiguous ? `故事入口名称有歧义：${entryReference.value}` : `找不到故事入口：${entryReference.value}`, entryReference.sourceLine);
  }
  const sourceMap = locations.map(({ line, ...location }) => ({ ...location, lineId: line.id })).sort((a, b) => a.sourceLine - b.sourceLine);
  const nodeLocations = [...nodeSourceLines].map(([nodeId, sourceLine]) => ({ nodeId, sourceLine })).sort((a, b) => a.sourceLine - b.sourceLine);
  const calledGraphs = new Set(project.nodes.flatMap(node => node.kind === 'passage' ? node.lines.flatMap(line => line.actions.flatMap(action => action.kind === 'blueprint' ? [action.blueprintId] : [])) : []));
  for (const graph of availablePerformanceBlueprints(project)) if (calledGraphs.has(graph.id)) installPerformanceBlueprint(project, graph);
  for (const converted of normalizeChapterPerformances(project, input)) {
    const at = nodeLocations.findIndex(location => location.nodeId === converted.nodeId);
    const start = nodeLocations[at]?.sourceLine ?? 1, end = nodeLocations[at + 1]?.sourceLine ?? lines.length + 1;
    for (let sourceLine = start; sourceLine < end; sourceLine++) {
      const name = commandParts(lines[sourceLine - 1])?.name;
      if (name === '演出设置' || name === '演出转场') sourceMap.push({ ...converted, sourceLine, actionCount: 1, playback: true });
      else if (/^\s*[@／/]\s*(?:章节(?:标题|动效|背景|题图|配乐)|独立演出)\s*(?:[:：]|$)/.test(lines[sourceLine - 1])) sourceMap.push({ ...converted, sourceLine, actionCount: 1 });
    }
  }
  const appliedTransitions = new Set<string>();
  for (const declaration of flowTransitions) {
    const node = named(project.nodes, declaration.owner);
    if (!node) { issue(`连线过渡的来源模块不存在或名称有歧义：${declaration.owner}`, declaration.sourceLine); continue; }
    const ref = reference(declaration.port), markedPort = declaration.port.match(/【([a-z][a-z0-9_]{0,63})】$/)?.[1];
    const aliases: Record<string, string> = { 继续: 'next', 下一步: 'next', 满足: 'yes', 不满足: 'no', 跳转: 'target', 调用: 'target', 返回后: 'next', 成功: 'success', 失败: 'failure', 取消: 'cancel', 超时: 'timeout' };
    const branch = node.kind === 'choice' ? node.choices.filter(item => item.text === ref.name).map(item => item.id) : node.kind === 'interaction' ? node.hotspots.filter(item => item.name === ref.name).map(item => item.id) : [];
    const port = markedPort ?? (storyTransitionPorts(node).some(item => item.port === ref.name) ? ref.name : branch.length === 1 ? branch[0] : branch.length > 1 ? undefined : Object.hasOwn(aliases, ref.name) ? aliases[ref.name] : referenceId.test(ref.name) ? ref.name : undefined);
    if (!port) { issue(`连线过渡出口不存在或名称有歧义：${declaration.port}`, declaration.sourceLine, node.id); continue; }
    const identity = `${node.id}/${port}`;
    if (appliedTransitions.has(identity)) { issue('同一模块出口不能重复设置连线过渡。', declaration.sourceLine, node.id); continue; }
    appliedTransitions.add(identity);
    if (storyTransitionPorts(node, project).some(item => item.port === port)) setStoryTransition(project, node.id, port, declaration.transition);
    else {
      // Preserve explicitly saved but inactive ports so authors can locate and
      // repair them; parsing must never silently discard a saved setting.
      node.transitions = { ...node.transitions, [port]: declaration.transition };
      issues.push({ severity: 'warning', message: `连线过渡的出口已不存在或当前不适用：${declaration.port}。设置已保留，可删除此指令恢复。`, sourceLine: declaration.sourceLine, nodeId: node.id });
    }
  }
  sourceMap.sort((a, b) => a.sourceLine - b.sourceLine);
  pruneStoryGroups(project);
  return { project, issues, sourceMap, nodeLocations };
}

export function actionText(project: Project, action: StageAction): string {
  const asset = (id: string) => {
    const item=project.assets.find(item=>item.id===id);
    return !item?id:named(project.assets.filter(a=>a.kind===item.kind),item.name)?.id===id?item.name:textReference(item.name,id);
  };
  const character = (id: string) => project.characters.find(item => item.id === id)?.name ?? id;
  switch (action.kind) {
    case 'background': return `@背景：${serializeParameterValue(asset(action.assetId))}${action.transition !== 'dissolve' ? '，转场=' + ({ none: '无', fade: '淡入淡出', move: '移动', dissolve: '溶解' }[action.transition]) : ''}${action.duration !== undefined ? '，时长=' + action.duration : ''}${action.wait !== undefined ? '，等待完成=' + (action.wait ? '是' : '否') : ''}`;
    case 'music': return `@背景音乐：${serializeParameterValue(asset(action.assetId) + (action.loop ? ' 循环' : ' 不循环'))}${action.fade !== .5 ? '，淡入=' + action.fade : ''}`;
    case 'sound': return `@音效：${serializeParameterValue(asset(action.assetId))}`;
    case 'unlock': return `@解锁素材：${serializeParameterValue(asset(action.assetId))}`;
    case 'stopMusic': return `@停止音乐：${action.fade}`;
    case 'hideInterface': return '@隐藏界面';
    case 'showInterface': return '@显示界面';
    case 'startDialogue': return '@开始台词演出';
    case 'pause': return `@等待：${action.seconds}`;
    case 'hide': return `@隐藏角色：${character(action.characterId)}${action.transition !== 'dissolve' ? '，转场=' + ({ none: '无', fade: '淡入淡出', move: '移动', dissolve: '溶解' }[action.transition]) : ''}${action.duration !== undefined ? '，时长=' + action.duration : ''}${action.wait !== undefined ? '，等待完成=' + (action.wait ? '是' : '否') : ''}${actorInstanceNumber(action.instanceId) === 1 ? '' : action.instanceId ? '，' + (actorInstanceNumber(action.instanceId) === undefined ? '实例ID=' : '第几个=') + action.instanceId : ''}`;
    case 'show': {
      const fields: string[] = [];
      const add = (name: string, value: string | number) => fields.push(name + '=' + serializeParameterValue(value));
      if (action.characterId) add('角色', textReference(character(action.characterId), action.characterId));
      if (action.expressionId) {
        const expressions = action.characterId ? effectiveCharacter(project, action.characterId)?.expressions ?? [] : project.characters.flatMap(item => effectiveCharacter(project, item.id)?.expressions ?? []);
        const expression = expressions.find(item => item.id === action.expressionId);
        add('表情', expression ? textReference(expression.name, expression.id) : action.expressionId);
      }
      const geometry = action.x !== .5 || action.y !== 1 || action.scale !== 1;
      if (action.x !== .5) add('横向位置', action.x);
      if (action.scale !== 1) add('缩放', action.scale);
      if (action.y !== 1) add('纵向位置', action.y);
      if (action.layer !== 10) add('图层', action.layer);
      if (action.wait === false) add('等待完成', '否');
      if (action.presetId && (action.presetId !== 'default' || geometry)) add('站位预设', action.presetId === 'default' ? '角色默认' : textReference(characterDisplayPreset(project, action.characterId, action.presetId)?.name ?? '缺失预设', action.presetId));
      else if (!action.presetId && !geometry) add('站位预设', '手动');
      if (action.lifetime && (action.characterId || action.lifetime !== 'line')) add('显示范围', actorLifetimes[action.lifetime]);
      const number = actorInstanceNumber(action.instanceId);
      if (number !== undefined && number > 1) add('第几个', number);
      else if (number === undefined && action.instanceId) add('实例ID', action.instanceId);
      for (const [phase, label] of [['enter', '入场'], ['exit', '离场'], ['expression', '表情切换']] as const) {
        const rule = action.actorTransitions?.[phase];
        if (rule) {
          add(label + '过渡', { none: '立即', dissolve: '渐变', fade: '先淡出再淡入', move: '移动' }[rule.mode]);
          add(label + '秒数', rule.duration);
        }
      }
      return '@显示角色' + (fields.length ? '：' + fields.join('，') : '');
    }
    case 'shake': return `@震动：${action.direction === 'horizontal' ? '横向' : '纵向'}${action.duration !== undefined || action.amplitude !== undefined || action.wait !== undefined ? `，${action.duration ?? 0.6}，${action.amplitude ?? 20}，${action.wait === false ? '否' : '是'}` : ''}`;
    case 'camera': return action.curves ? '' : `@镜头：${action.x}，${action.y}，${action.zoom}，${action.duration}，${action.rotation}，${{ linear: '匀速', ease: '缓入缓出', easein: '缓入', easeout: '缓出' }[action.easing]}，${action.wait ? '是' : '否'}`;
    case 'effect': return `@效果：${textReference(project.effects.find(item => item.id === action.effectId)?.name ?? '效果', action.effectId)}`;
    case 'blueprint': {
      const graph = availablePerformanceBlueprints(project).find(item => item.id === action.blueprintId);
      const parameters = Object.entries(action.inputs ?? {}).map(([id, value]) => {
        const pin = graph?.exposedInputs.find(pin => pin.id === id);
        if (typeof value === 'string' && graph && blueprintActorInstanceTargets(graph, id, { blueprints: availablePerformanceBlueprints(project) }).length) {
          return `${textReference(pin?.name ?? id, id)}=${serializeParameterValue(value === '' ? '' : actorInstanceNumber(value) ?? value)}`;
        }
        const resource = typeof value === 'string' ? (pin?.dataType === 'asset' ? project.assets : pin?.dataType === 'character' ? project.characters : pin?.dataType === 'scene' ? project.scenes : project.characters.flatMap(c => effectiveCharacter(project, c.id)?.expressions ?? [])).find(item => item.id === value) : undefined;
        return `${textReference(pin?.name ?? id, id)}=${serializeParameterValue(resource ? textReference(resource.name, resource.id) : value)}`;
      });
      return `@${textReference(graph ? blueprintCallName(graph) : '缺失蓝图', action.blueprintId)}${parameters.length ? '：' + parameters.join('，') : ''}`;
    }
    case 'chapter': return chapterPerformanceText(project, action)[0];
    case 'characterFeature': return `@角色功能：${textReference(character(action.characterId), action.characterId)}，${textReference(effectiveCharacter(project, action.characterId)?.features?.find(item => item.id === action.featureId)?.name ?? '功能', action.featureId)}`;
    case 'hideVisual': return `@隐藏对象：${action.instanceId}${action.exitTransition ? `，离场过渡=${{ none: '立即', dissolve: '渐变', fade: '先淡出再淡入', move: '移动' }[action.exitTransition.mode]}，离场秒数=${action.exitTransition.duration}` : ''}${action.wait !== undefined ? `，等待完成=${action.wait ? '是' : '否'}` : ''}`;
    case 'visual': {
      if (!isSimpleMediaVisual(action)) return '';
      if (action.content === 'image') {
        const canonical = canonicalImageVisual(project, action);
        if (!canonical) return '';
        const fields = [serializeParameterValue(asset(action.assetId!))];
        if (action.instanceId !== 'image') fields.push('对象ID=' + action.instanceId);
        const transform = imageTransform(canonical);
        if (JSON.stringify(transform) !== JSON.stringify(defaultImageTransform)) fields.push('变换=' + imageTransformText(transform));
        const lifetime = mediaLifetime(action);
        if (lifetime !== 'line') fields.push('显示范围=' + mediaLifetimeNames[lifetime]);
        if (lifetime === 'duration') fields.push('时长=' + action.duration);
        if (action.layer !== 20) fields.push('图层=' + action.layer);
        if (action.wait) fields.push('等待完成=是');
        if (action.imageFit !== 'contain') fields.push('适应方式=' + { contain: '容纳', cover: '填满', stretch: '拉伸' }[action.imageFit ?? 'stretch']);
        fields.push(...visualTransitionText(action));
        return '@显示图片：' + fields.join('，');
      }
      const pose = action.keyframes[0], text = `@${action.content === 'text' ? '显示文字' : '显示视频'}：${serializeParameterValue(action.content === 'text' ? action.text : asset(action.assetId!))}`;
      const fields = [`对象ID=${action.instanceId}`, `横向位置=${pose.x}`, `纵向位置=${pose.y}`, `宽度=${action.width}`, `高度=${action.height}`, `时长=${action.duration}`, `图层=${action.layer}`, `等待完成=${action.wait ? '是' : '否'}`];
      if (action.content === 'text') fields.push(`字号=${action.fontSize}`, `颜色=${action.color}`);
      else fields.push(`适应方式=${{ contain: '容纳', cover: '填满', stretch: '拉伸' }[action.imageFit ?? 'stretch']}`);
      if (action.content === 'video') fields.push(`循环=${action.loop ? '是' : '否'}`, `音量=${action.volume ?? 1}`);
      fields.push(...visualTransitionText(action));
      if (action.content === 'text') fields.push(...textPresentationText(project, { fontAssetId: action.fontAssetId, italic: action.textItalic, align: action.textAlign, textEffects: action.textEffects, ...action.textMotion }, '逐字时长').map(row => row.slice('@文字演出：'.length)));
      return text + '，' + fields.join('，');
    }
    case 'audioClip': case 'animate': return '';
  }
}

function actionRoundTrips(project: Project, action: StageAction): boolean {
  const parsed = textCommandAction(project, actionText(project, action));
  if (!parsed) return false;
  // Explicit default timing and following-speaker lifetime have the same runtime
  // behavior as omitted fields; do not turn concise commands into snapshots.
  const comparable = (value: StageAction): Record<string, unknown> => value.kind === 'show' ? { ...value, duration: value.duration ?? (value.transition === 'fade' ? 1 : .5), wait: value.wait ?? true, lifetime: value.lifetime ?? (!value.characterId ? 'line' : undefined) } : value.kind === 'visual' && value.content === 'image' && isSimpleMediaVisual(value) ? { ...(canonicalImageVisual(project, value) ?? value) } : { ...value };
  const originalFields = comparable(action);
  const parsedFields = comparable(parsed);
  return [...new Set([...Object.keys(originalFields), ...Object.keys(parsedFields)])].every(field => JSON.stringify(originalFields[field]) === JSON.stringify(parsedFields[field]));
}

export function linePerformanceText(project: Project, node: Extract<StoryNode, { kind: 'passage' }>, line: StoryLine): string[] {
  if (line.actions.some(action => !actionRoundTrips(project, action))) {
    const snapshotId = key('performance', `${line.id}/${JSON.stringify(line.actions)}`);
    return [`@演出实例：${textReference(`${node.name} 第${node.lines.indexOf(line) + 1}行`, line.id)} 使用【${snapshotId}】`];
  }
  return line.actions.map(action => actionText(project, action)).filter(Boolean);
}

export function chapterPerformanceText(project: Project, chapter: Pick<Extract<StoryNode, { kind: 'chapterTitle' }>, 'title' | 'subtitle' | 'duration' | 'effect' | 'backgroundId' | 'titleImageId' | 'soundId'>): string[] {
  const graph = availablePerformanceBlueprints(project).find(item => item.id === (chapter.titleImageId ? 'builtin_chapter_image' : 'builtin_chapter_text'))!;
  const inputs = { ...(chapter.titleImageId ? { title_image: chapter.titleImageId } : { title: chapter.title, right_text: chapter.subtitle }), duration: chapter.duration, background: chapter.backgroundId ?? '', sound: chapter.soundId ?? '' };
  return [actionText(project, { kind: 'blueprint', blueprintId: graph.id, inputs })];
}

const textAlignWords = { left: '左对齐', center: '居中', right: '右对齐' } as const;
const textSpeedWords = { player: '跟随玩家设置', duration: '按时长', cps: '按速度', instant: '瞬间显示' } as const;
const textPlacementWords = { dialogue: '对话框', screen: '画面' } as const;
const textEntranceWords = { none: '普通', fade: '逐字淡入', zoom: '逐字放大', slam: '逐字砸入', flip: '逐字翻转', drop: '逐字落下', rise: '逐字升起' } as const;
const textLoopWords = { none: '无', shake: '抖动', wave: '波浪', pulse: '呼吸' } as const;
const textExitWords = { none: '无退场', fade: '逐字淡出', zoom: '逐字缩小', slam: '逐字放大消失', flip: '逐字翻转', drop: '逐字落下', rise: '逐字飘起' } as const;
const textEasingWords = { linear: '匀速', easeOut: '先快后慢', easeIn: '先慢后快', easeInOut: '缓入缓出', back: '回弹', bounce: '弹跳', elastic: '弹簧' } as const;
const textOrderWords = { forward: '从左到右', reverse: '从右到左', center: '从中间向两边', edges: '从两边向中间', random: '随机' } as const;
const textEffectWords = [['outlineWidth', '描边宽度'], ['outlineColor', '描边颜色'], ['outlineOpacity', '描边不透明度'], ['shadowX', '阴影横向'], ['shadowY', '阴影纵向'], ['shadowBlur', '阴影柔化'], ['shadowColor', '阴影颜色'], ['shadowOpacity', '阴影不透明度']] as const;

/** One `@文字演出` row listing only the fields the line sets. */
export function textPresentationText(project: Project, look?: TextPresentation, durationParameter = '时长'): string[] {
  if (!look) return [];
  const values: string[] = [];
  const add = (name: string, value: string | number | boolean | undefined) => { if (value !== undefined) values.push(`${name}=${serializeParameterValue(value)}`); };
  if (look.presetId) add('预设', textReference(textPresets(project).find(item => item.id === look.presetId)?.name ?? '预设', look.presetId));
  if (look.fontAssetId) add('字体', textReference(project.assets.find(asset => asset.id === look.fontAssetId)?.name ?? '字体', look.fontAssetId));
  add('大小', look.sizeScale === undefined ? undefined : +(look.sizeScale * 100).toFixed(4));
  add('颜色', look.color); add('粗体', look.bold); add('斜体', look.italic);
  add('对齐', look.align && textAlignWords[look.align]);
  for (const [key, name] of textEffectWords) add(name, look.textEffects?.[key]);
  add('速度', look.speed && textSpeedWords[look.speed]); add(durationParameter, look.duration); add('每秒字数', look.cps);
  add('位置', look.placement && textPlacementWords[look.placement]); add('横向位置', look.x); add('纵向位置', look.y); add('宽度', look.width);
  const motion = (phase: string, animation?: TextAnimation) => {
    add(phase + '横移', animation?.x); add(phase + '纵移', animation?.y); add(phase + '缩放', animation?.scale === undefined ? undefined : +(animation.scale * 100).toFixed(4)); add(phase + '翻转', animation?.flip); add(phase + '旋转', animation?.rotation);
    add(phase + '透明度', animation?.opacity === undefined ? undefined : +(animation.opacity * 100).toFixed(4)); add(phase + '曲线', animation?.easing && textEasingWords[animation.easing]); add(phase + '顺序', animation?.order && textOrderWords[animation.order]);
  };
  add('入场', look.entrance && textEntranceWords[look.entrance]); add('入场时间', look.entranceTime); motion('入场', look.entranceAnimation);
  add('持续效果', look.loop && textLoopWords[look.loop]); add('幅度', look.loopStrength); add('频率', look.loopSpeed);
  add('退场', look.exit && textExitWords[look.exit]); add('退场总时长', look.exitTotal); add('退场时间', look.exitTime); motion('退场', look.exitAnimation);
  if (look.typeSoundId) add('打字音', textReference(project.assets.find(asset => asset.id === look.typeSoundId)?.name ?? '打字音', look.typeSoundId));
  add('打字音间隔', look.typeSoundEvery); add('打字音音量', look.typeSoundVolume);
  return values.length ? [`@文字演出：${values.join('，')}`] : [];
}

function parseTextPresentation(project: Project, value: string): TextPresentation | undefined {
  const parameters = commandSignature('文字演出')!.parameters;
  const raw = bindArguments(value, parameters).values;
  const field = (name: string) => { const text = raw[parameters.findIndex(item => item.name === name)]; return text === undefined ? undefined : argumentValue(text); };
  const present = (name: string) => { const text = field(name); return text === undefined || text === '' ? undefined : text; };
  const word = <T extends string>(name: string, words: Record<T, string>, aliases: Record<string, T> = {}): T | undefined => {
    const text = present(name);
    if (text === undefined) return undefined;
    const found = (Object.entries(words) as [T, string][]).find(([, label]) => label === String(text))?.[0] ?? aliases[String(text)];
    if (!found) throw new Error(`${name}只支持：${Object.values<string>(words).join('、')}。`);
    return found;
  };
  const number = (name: string, check: (value: number) => boolean, rule: string) => {
    const text = present(name);
    if (text === undefined) return undefined;
    const parsed = typeof text === 'number' ? text : Number(String(text).replace(/[%％]$/, ''));
    if (!Number.isFinite(parsed) || !check(parsed)) throw new Error(`${name}${rule}`);
    return parsed;
  };
  const colorValue = (name: string) => {
    const text = present(name);
    if (text === undefined) return undefined;
    if (!/^#[0-9a-fA-F]{6}$/.test(String(text))) throw new Error(`${name}请填写六位颜色，例如 #ffffff。`);
    return String(text);
  };
  const flag = (name: string) => {
    const text = present(name);
    if (text === undefined) return undefined;
    if (typeof text !== 'boolean') throw new Error(`${name}请选择是或否。`);
    return text;
  };
  const look: TextPresentation = {};
  const presetText = present('预设');
  if (presetText !== undefined) {
    const id = named(textPresets(project), String(presetText))?.id ?? reference(String(presetText)).id;
    if (!id) throw new Error(`找不到文字演出预设：${presetText}`);
    look.presetId = id;
  }
  const fontText = present('字体');
  if (fontText !== undefined && fontText !== '默认') {
    const id = named(project.assets.filter(asset => asset.kind === 'font'), String(fontText))?.id ?? reference(String(fontText)).id;
    if (!id) throw new Error(`找不到字体素材：${fontText}`);
    look.fontAssetId = id;
  }
  const size = number('大小', value => value > 0, '需大于 0。');
  if (size !== undefined) look.sizeScale = size / 100;
  look.color = colorValue('颜色'); look.bold = flag('粗体'); look.italic = flag('斜体');
  look.align = word('对齐', textAlignWords, { 左: 'left', 中: 'center', 右: 'right' });
  const effects: Record<string, string | number> = {};
  for (const [key, name] of textEffectWords) {
    const offset = key === 'shadowX' || key === 'shadowY', opacity = key.endsWith('Opacity');
    const result = key.endsWith('Color') ? colorValue(name) : number(name, value => offset || value >= 0 && (!opacity || value <= 1), opacity ? '需在 0～1 之间。' : offset ? '需为数字。' : '不能小于 0。');
    if (result !== undefined) effects[key] = result;
  }
  if (Object.keys(effects).length) look.textEffects = effects;
  look.duration = number('时长', value => value > 0, '需大于 0 秒。');
  look.cps = number('每秒字数', value => value > 0, '需大于 0。');
  look.speed = word('速度', textSpeedWords, { 跟随玩家: 'player', 时长: 'duration', 速度: 'cps', 瞬间: 'instant' }) ?? (look.duration !== undefined ? 'duration' : look.cps !== undefined ? 'cps' : undefined);
  look.placement = word('位置', textPlacementWords, { 对话框内: 'dialogue', 画面上: 'screen', 屏幕: 'screen' });
  look.x = number('横向位置', () => true, '需为数字。');
  look.y = number('纵向位置', () => true, '需为数字。');
  look.width = number('宽度', value => value > 0, '需大于 0。');
  look.entrance = word('入场', textEntranceWords, { 无: 'none', 淡入: 'fade', 放大: 'zoom', 砸入: 'slam', 翻转: 'flip', 落下: 'drop', 升起: 'rise' });
  look.entranceTime = number('入场时间', value => value >= 0, '不能小于 0。');
  const motion = (phase: string): TextAnimation | undefined => {
    const scale = number(phase + '缩放', () => true, '需为数字。'), opacity = number(phase + '透明度', value => value >= 0 && value <= 100, '需在 0～100 之间。');
    const animation: TextAnimation = { x: number(phase + '横移', () => true, '需为数字。'), y: number(phase + '纵移', () => true, '需为数字。'), scale: scale === undefined ? undefined : scale / 100, flip: flag(phase + '翻转'), rotation: number(phase + '旋转', () => true, '需为数字。'), opacity: opacity === undefined ? undefined : opacity / 100, easing: word(phase + '曲线', textEasingWords), order: word(phase + '顺序', textOrderWords) };
    for (const key of Object.keys(animation) as (keyof TextAnimation)[]) if (animation[key] === undefined) delete animation[key];
    return Object.keys(animation).length ? animation : undefined;
  };
  look.entranceAnimation = motion('入场');
  look.loop = word('持续效果', textLoopWords, { 普通: 'none' });
  look.loopStrength = number('幅度', value => value >= 0, '不能小于 0。');
  look.loopSpeed = number('频率', value => value > 0, '需大于 0。');
  look.exit = word('退场', textExitWords, { 无: 'none', 淡出: 'fade', 缩小: 'zoom', 翻转: 'flip', 落下: 'drop', 飘起: 'rise' });
  look.exitTotal = number('退场总时长', value => value > 0, '需大于 0 秒。');
  look.exitTime = number('退场时间', value => value >= 0, '不能小于 0。');
  look.exitAnimation = motion('退场');
  const soundText = present('打字音');
  if (soundText !== undefined && soundText !== '无') {
    const id = named(project.assets.filter(asset => asset.kind === 'audio'), String(soundText))?.id ?? reference(String(soundText)).id;
    if (!id) throw new Error(`找不到打字音素材：${soundText}`);
    look.typeSoundId = id;
  }
  look.typeSoundEvery = number('打字音间隔', value => Number.isInteger(value) && value > 0, '需为大于 0 的整数。');
  look.typeSoundVolume = number('打字音音量', value => value >= 0 && value <= 1, '需在 0～1 之间。');
  for (const key of Object.keys(look) as (keyof TextPresentation)[]) if (look[key] === undefined) delete look[key];
  return Object.keys(look).length ? textPresentationSchema.parse(look) : undefined;
}

export function playbackText(playback?: PerformancePlayback): string[] {
  if (!playback) return [];
  const lines: string[] = [];
  const settings = [playback.clickSkip === undefined ? '' : `允许点击跳过=${playback.clickSkip ? '是' : '否'}`, playback.onComplete === undefined ? '' : `结束后=${playback.onComplete === 'title' ? '返回标题' : '继续剧情'}`].filter(Boolean);
  if (settings.length) lines.push(`@演出设置：${settings.join('，')}`);
  const t = playback.transition;
  if (t) lines.push(`@演出转场：方式=${{ none: '无', dissolve: '溶解', color: '纯色' }[t.mode]}，淡出=${t.outDuration}，停留=${t.hold}，淡入=${t.inDuration}，颜色=${t.color}`);
  return lines;
}

export function standaloneText(name?: string, playback?: PerformancePlayback): string {
  const values = name ? [serializeParameterValue(name)] : [];
  if (playback?.clickSkip !== undefined) values.push('允许点击跳过=' + (playback.clickSkip ? '是' : '否'));
  if (playback?.onComplete !== undefined) values.push('结束后=' + (playback.onComplete === 'title' ? '返回标题' : '继续剧情'));
  const transition = playback?.transition;
  if (transition) values.push('结束转场=' + { none: '无', dissolve: '溶解', color: '纯色' }[transition.mode], `淡出=${transition.outDuration}`, `停留=${transition.hold}`, `淡入=${transition.inDuration}`, `颜色=${transition.color}`);
  return '@独立演出' + (values.length ? '：' + values.join('，') : '');
}

function firstById<T extends { id: string }>(items: readonly T[] | undefined): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items ?? []) if (!result.has(item.id)) result.set(item.id, item);
  return result;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const groupKey = key(item), group = result.get(groupKey);
    if (group) group.push(item);
    else result.set(groupKey, [item]);
  }
  return result;
}

function flowchartHeadingOptions(options: StoryNode['flowchart'], flowStylesById: ReadonlyMap<string, { name: string }>): string {
  const fields = [options?.visible === undefined ? '' : '流程图=' + (options.visible ? '是' : '否'), options?.name ? '显示名称=' + JSON.stringify(options.name) : '', options?.styleId ? '样式=' + JSON.stringify(textReference(flowStylesById.get(options.styleId)?.name ?? '缺失样式', options.styleId)) : ''].filter(Boolean);
  return fields.length ? '(' + fields.join('，') + ')' : '';
}
export function projectToText(project: Project): string {
  const output: string[] = [];
  const scenesByChapter = groupBy(project.scenes, scene => scene.chapterId);
  const nodesByScene = groupBy(project.nodes, node => node.sceneId);
  const nodesById = firstById(project.nodes);
  const scenesById = firstById(project.scenes);
  const charactersById = firstById(project.characters);
  const assetsById = firstById(project.assets);
  const variablesById = firstById(project.variables);
  const instancesById = firstById(project.ui.instances);
  const flowStylesById = firstById(project.ui.flowStyles);
  const graphsById = firstById(projectGraphs(project));
  const name = (id?: string) => id ? textReference(nodesById.get(id)?.name ?? '缺失节点', id) : '无';
  const ordered = project.chapters.flatMap(chapter => (scenesByChapter.get(chapter.id) ?? []).flatMap(scene => nodesByScene.get(scene.id) ?? []));
  const following = new Map(ordered.map((node, index) => [node.id, ordered[index + 1]]));
  const nextLines = (node: StoryNode, target?: string) => target && following.get(node.id)?.id === target && following.get(node.id)?.textHeading === false ? [] : [`@跳转：${name(target)}`];
  output.push(`@入口：${name(project.entryId)}`, '');
  if (project.ui.activeInstanceId) output.push(`@界面实例：${textReference(instancesById.get(project.ui.activeInstanceId)?.name ?? '界面实例', project.ui.activeInstanceId)}`, '');
  for (const effect of project.effects.filter(item => !item.id.startsWith('txt_performance_'))) output.push(`@效果定义：${textReference(effect.name, effect.id)}`, ...effect.commands.map(command => `@动作：${command}`), '@效果结束', '');
  for (const chapter of project.chapters) {
    output.push(`# 章节${flowchartHeadingOptions(chapter.flowchart, flowStylesById)}：${textReference(chapter.name, chapter.id)}`, '');
    for (const scene of scenesByChapter.get(chapter.id) ?? []) {
      output.push(`# 小章节${flowchartHeadingOptions(scene.flowchart, flowStylesById)}：${textReference(scene.name, scene.id)}`, '');
      if (scene.baseSceneId) output.push(`@场景基础：${textReference(scenesById.get(scene.baseSceneId)?.name ?? '基础场景', scene.baseSceneId)}`);
      if (scene.parameters && Object.keys(scene.parameters).length) output.push(`@场景参数：${JSON.stringify(scene.parameters)}`);
      if (scene.blueprintId) output.push(`@场景蓝图：${textReference(graphsById.get(scene.blueprintId)?.name ?? '场景蓝图', scene.blueprintId)}`);
      if (scene.baseSceneId || scene.blueprintId || (scene.parameters && Object.keys(scene.parameters).length)) output.push('');
      for (const node of nodesByScene.get(scene.id) ?? []) {
        const nodeReference = textReference(node.name, node.id);
        output.push(node.textHeading === false || isStandaloneNode(node) ? `@节点标记：${nodeReference}` : `# 段落${flowchartHeadingOptions(node.flowchart, flowStylesById)}：${nodeReference}`);
        if (node.kind === 'passage') {
          for (const line of node.lines) {
            output.push(`@对白标记：${line.id}`);
            output.push(...linePerformanceText(project, node, line));
            if (!line.silent) output.push(...playbackText(line.playback));
            if (line.voiceId) output.push(`@配音：${textReference(assetsById.get(line.voiceId)?.name ?? '配音', line.voiceId)}`);
            if (!line.silent) output.push(...textPresentationText(project, line.textPresentation));
            const speaker = charactersById.get(line.speakerId ?? '')?.name ?? '旁白';
            if (!line.silent) output.push(...dialogueMarkupRows(project, line, `${speaker}：`));
            else output.push(standaloneText(isStandaloneNode(node) ? node.name : undefined, line.playback));
          }
          output.push(...nextLines(node, node.next));
        } else if (node.kind === 'start') output.push('@开始', ...nextLines(node, node.next));
        else if (node.kind === 'chapterTitle') {
          output.push(...chapterPerformanceText(project, node));
          output.push(standaloneText(node.name, node.playback));
          output.push(...nextLines(node, node.next));
        }
        else if (node.kind === 'choice' && !/[\r\n]/.test(node.prompt) && !node.choices.some(choice => choice.condition || /[\r\n]|->|→/.test(choice.text))) output.push(`@选择：${node.prompt}`, ...node.choices.flatMap(choice => [...(node.transitions && Object.keys(node.transitions).length ? [`@选项标记：${choice.id}`] : []), `@选项：${choice.text} -> ${name(choice.target)}`]));
        else if (node.kind === 'condition') output.push(`@条件：${textCondition(project, node.condition)}`, `@满足：${name(node.yes)}`, `@不满足：${name(node.no)}`);
        else if (node.kind === 'set') output.push(`@设置：${node.when ? '如果 ' + textCondition(project, node.when) + '，' : ''}${parameterReference(variablesById.get(node.variableId) ?? { id: node.variableId, name: '已删除参数' })} ${node.operation === 'add' ? '+=' : '='} ${(() => { const variable = variablesById.get(node.variableId); return variable?.type === 'asset' ? JSON.stringify(parameterAssetText(project, variable, node.value)) : typeof node.value === 'string' ? JSON.stringify(node.value) : node.value; })()}`, ...nextLines(node, node.next));
        else if (node.kind === 'jump' || node.kind === 'call') {
          if (node.kind === 'jump' && node.sceneTransition) {
            output.push(jumpCommandText(name(node.target), node.sceneTransition));
          } else output.push(`@${node.kind === 'call' ? '调用' : '跳转'}：${name(node.target)}`);
          if (node.kind === 'call') output.push(...nextLines(node, node.next));
        }
        else if (node.kind === 'end') output.push('@返回标题界面');
        else if (node.kind === 'return') output.push('@返回');
        else output.push(`@实例：${nodeReference}`);
        output.push(...nodeFlowTransitionText(node));
        output.push('');
      }
    }
  }
  return output.join('\n');
}

export function importedTextProject(text: string, name: string): TextParseResult {
  return applyTextScript(createProject(name.replace(/\.[^.]+$/, '').slice(0, 200) || '导入作品'), text, name);
}
