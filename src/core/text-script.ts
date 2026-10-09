import { projectGraphs } from './project-resources';
import { characterDisplayPreset } from './character-presets';
import { isStandaloneNode, normalizeChapterPerformances, standaloneChapter } from './standalone-performance';
import { actionSchema, performancePlaybackSchema, characterFeatureActions, createProject, effectiveCharacter, targets, type Diagnostic, type EffectDefinition, type PerformancePlayback, type Project, type Scene, type SceneTransition, type StageAction, type StoryLine, type StoryNode } from './model';
import { actorLifetimes, parseActorInstance, parseActorLifetime } from './actor-instance';
import { endingPerformanceId, availablePerformanceBlueprints, createEndingPerformance, installPerformanceBlueprint } from './builtin-performances';
import { blueprintCallName, resolveBlueprintCall } from './blueprint-names';
import { commandSignature } from './command-parameters';
import { argumentTokens, bindArguments, argumentValue, argumentText } from './text-arguments';
import { parseTextCondition, textCondition } from './text-conditions';
import { textHeading } from './text-headings';
import { currentScriptText } from './script-text';
import { createMediaVisual, isSimpleMediaVisual, mediaLifetime, mediaLifetimeNames, parseMediaLifetime, parseVisualRule, parseVisualTransitions, visualTransitionText } from './media-command';
import { canonicalImageVisual, defaultImageTransform, imageTransform, imageTransformText, parseImageTransform } from './image-transform';

export interface TextIssue extends Diagnostic { sourceLine: number }
export interface TextSourceLocation { sourceLine: number; nodeId: string; lineId: string; actionCount?: number; reference?: boolean; playback?: boolean }
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
  const match = text.match(/^[@／/]?\s*([^:：]+?)\s*[:：]\s*(.*)$/) ?? text.match(/^[@／/]?\s*([^\s:：]+)\s+(.*)$/);
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
  if (transition && (transition.mode !== 'none' || transition.duration !== 0 || transition.color !== '#000000' || Object.keys(transition.parameters ?? {}).length)) {
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
    const values = bindArguments(command!.value, signature?.parameters ?? []).values.map(argumentText);
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
      return createMediaVisual(content, content === 'text' ? values[0] ?? '' : selected!.id, { ...parseVisualTransitions(values.slice(content === 'video' ? 12 : 11)), instanceId: values[1], x: numberOr(values[2], .5), y: numberOr(values[3], .5), width: numberOr(values[4], content === 'text' ? .8 : 1), height: numberOr(values[5], content === 'text' ? .2 : 1), duration: numberOr(values[6], 0), layer: numberOr(values[7], 20), wait: /^(是|true)$/i.test(values[8] ?? ''),
        ...(content === 'text' ? { fontSize: numberOr(values[9], 60), color: values[10] || '#ffffff' } : { fit: fit[values[9] as keyof typeof fit] ?? 'contain' }),
        ...(content === 'video' ? { loop: /^(是|true)$/i.test(values[10] ?? ''), volume: numberOr(values[11], 1) } : {}) });
    }
    case '隐藏对象': return actionSchema.parse({ kind: 'hideVisual', ...(args()[1] || args()[2] ? { exitTransition: parseVisualRule(args()[1], args()[2]) } : {}), ...(args()[3] ? { wait: /^(是|true)$/i.test(args()[3]) } : {}), instanceId: args()[0] || (requestedCommand === '隐藏视频' ? 'video' : requestedCommand === '隐藏文字' ? 'text' : 'image') });
    case '隐藏界面': return { kind: 'hideInterface' };
    case '显示界面': return { kind: 'showInterface' };
    case '播放台词演出': return { kind: 'startDialogue' };
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
      const parameters = parameterSource.trim().startsWith('{') ? Object.entries(parseParameters(parameterSource)).map(([name, raw]) => ({ pin: named(graph.exposedInputs, name), raw, name })) : bindArguments(parameterSource, graph.exposedInputs).bindings.filter(({ token }) => token.raw !== '').map(({ token, index }) => ({ pin: graph.exposedInputs[index], raw: argumentValue(token.raw), name: token.name ?? String(index + 1) }));
      for (const { pin, raw, name } of parameters) {
        if (!pin) throw new Error(`蓝图“${graph.name}”没有输入“${name}”。`);
        let argument = raw;
        if (typeof raw === 'string') {
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
  const project = structuredClone(input);
  const content = normalize(source);
  const issues: TextIssue[] = [];
  const issue = (message: string, sourceLine: number, nodeId?: string) => issues.push({ severity: 'error', message, sourceLine, nodeId });
  const lines = content.split('\n');
  const effects: EffectDefinition[] = [];
  let definition: EffectDefinition | undefined;
  for (const [index, raw] of lines.entries()) {
    if (raw.trimStart().startsWith('//')) continue;
    const command = commandParts(raw);
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
  let chapter: Project['chapters'][number] = project.chapters[0] ?? { id: key('chapter', project.id), name: '第一章' };
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
  let pendingLineId: string | undefined;
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
  const sceneBases: { sceneId: string; value: string; sourceLine: number }[] = [];
  let entryReference: { value: string; sourceLine: number } | undefined;
  const explicit = new Set<string>();
  const instances = new Set<string>();
  const usedIds = new Set<string>();
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
    chapter = existing ?? { id: ref.id ?? old?.id ?? key('chapter', `${project.id}/${ref.name}`), name: ref.name || old?.name || '第一章' };
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
    scene = existing ?? { ...structuredClone(old ?? {}), id: ref.id ?? old?.id ?? key('scene', `${chapter.id}/${ref.name}`), name: ref.name || old?.name || '开场', chapterId: chapter.id };
    if (!existing) project.scenes.push(scene);
    current = undefined;
    declaredPassageId = undefined;
  };
  const begin = (kind: StoryNode['kind'], value: string, original?: StoryNode, preserveOriginal = false, duplicate = false) => {
    declaredPassageId = undefined;
    if (!scene.id) startScene('开场');
    const identity = pendingNodeReference ?? value;
    pendingNodeReference = undefined;
    const ref = reference(identity);
    const name = ref.name || original?.name || value;
    const old = original ?? previousNode(identity, kind);
    let id = duplicate ? key('instance', `${scene.id}/${old?.id}/${project.nodes.length}`) : old && !usedIds.has(old.id) ? old.id : ref.id ?? key('node', `${scene.id}/${kind}/${name}`);
    if (usedIds.has(id)) id = key('node', `${id}/${project.nodes.length}`);
    usedIds.add(id);
    nodeSourceLines.set(id, sourceLineNumber);
    const base = { id, name, sceneId: scene.id, x: old?.x ?? 80 + (project.nodes.length % 3) * 290, y: old?.y ?? 80 + Math.floor(project.nodes.length / 3) * 190, textHeading: false as const };
    // An instance is an explicit reference to an existing node. Clone the
    // full authored node so animation, interaction and minigame fields do not
    // disappear when the text editor rebuilds the graph.
    if (preserveOriginal && old?.kind === kind) {
      current = { ...structuredClone(old), ...base };
      if (current.id !== old.id) {
        if (current.kind === 'passage') current.lines.forEach(line => { line.id = key('line', `${current!.id}/${line.id}`); });
        if (current.kind === 'choice') current.choices.forEach(choice => { choice.id = key('option', `${current!.id}/${choice.id}`); });
        if (current.kind === 'interaction') current.hotspots.forEach(hotspot => { hotspot.id = key('hotspot', `${current!.id}/${hotspot.id}`); });
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
      default: current = old ? { ...structuredClone(old), ...base } : { ...base, kind: 'passage', lines: [] };
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
      if (label.flowchart) node.flowchart = label.flowchart;
      nodeSourceLines.set(node.id, labelSourceLine);
      return node;
    }
    return begin(kind, value, original, preserveOriginal);
  };
  const passage = () => current?.kind === 'passage' && current.id !== completedStandalone ? current : begin('passage', `段落 ${++passageNumber}`) as Extract<StoryNode, { kind: 'passage' }>;
  const addDialogue = (speaker: string, text: string, continuation = false, recordSource = true, silent = false) => {
    const node = passage();
    // Leading actions belong to the new passage too, including after a
    // standalone performance whose closing declaration starts a new boundary.
    const firstActionLine = pendingLocations[0]?.sourceLine;
    if (!node.lines.length && firstActionLine) nodeSourceLines.set(node.id, Math.min(nodeSourceLines.get(node.id)!, firstActionLine));
    declaredPassageId = undefined;
    if (continuation && node.lines.length && !pendingActions.length && !pendingVoiceId && !pendingLineId) {
      const line = node.lines[node.lines.length - 1];
      line.text += text;
      locations.push({ sourceLine: sourceLineNumber, nodeId: node.id, line });
      return;
    }
    let speakerId: string | undefined;
    if (speaker && !['旁白', '叙述', 'narrator'].includes(speaker.toLowerCase())) {
      let character = named(project.characters, speaker);
      if (!character) { character = { id: key('character', speaker), name: reference(speaker).name, color: palette[project.characters.length % palette.length], expressions: [] }; project.characters.push(character); }
      speakerId = character.id;
    }
    const line: StoryLine = { id: pendingLineId && !usedLineIds.has(pendingLineId) ? pendingLineId : key('line', `${node.id}/${node.lines.length}`), ...(speakerId ? { speakerId } : {}), text, actions: pendingActions, ...(pendingVoiceId ? { voiceId: pendingVoiceId } : {}) };
    if (silent) line.silent = true;
    if (pendingPlayback) line.playback = pendingPlayback;
    if (pendingLineId && !usedLineIds.has(pendingLineId)) { pinnedLines.add(line); usedLineIds.add(pendingLineId); }
    node.lines.push(line);
    locations.push(...pendingLocations.map(location => ({ ...location, nodeId: node.id, line })));
    if (recordSource) locations.push({ sourceLine: sourceLineNumber, nodeId: node.id, line });
    pendingLocations = [];
    pendingActions = [];
    pendingVoiceId = undefined;
    pendingLineId = undefined;
    pendingPlayback = undefined;
  };
  for (const [index, raw] of lines.entries()) {
    sourceLineNumber = index + 1;
    const trimmed = raw.trim();
    if (!trimmed) { wasBlank = true; continue; }
    if (trimmed.startsWith('//')) continue;
    if (definitionOpen && !/^[@／/]?效果结束\s*$/.test(trimmed)) continue;
    const bare = trimmed.match(/^[@／/]\s*(开始|返回|选择|独立演出)\s*$/);
    const command = commandParts(trimmed) ?? (bare ? { name: bare[1], value: '' } : undefined);
    if (command?.name === '效果定义') { definitionOpen = true; continue; }
    if (/^[@／/]?效果结束\s*$/.test(trimmed)) { definitionOpen = false; continue; }
    if (definitionOpen) continue;
    const heading = textHeading(trimmed);
    if (heading) {
      if (pendingActions.length || pendingVoiceId || pendingLineId) addDialogue('旁白', '', false, false);
      const { kind } = heading, name = trimmed.slice(heading.nameFrom!);
      const rawOptions = heading.parameters && trimmed.slice(heading.parameters.start, heading.parameters.end);
      let flowchart: StoryNode['flowchart'];
      try {
        const options = parseParameters(rawOptions ?? '');
        for (const key of Object.keys(options)) if (!['流程图', '显示名称', '样式'].includes(key)) throw new Error('目录参数只支持“流程图”、“显示名称”和“样式”。');
        if (options['流程图'] !== undefined && typeof options['流程图'] !== 'boolean') throw new Error('流程图请填写“是”或“否”。');
        if (options['显示名称'] !== undefined && (typeof options['显示名称'] !== 'string' || options['显示名称'].length > 120)) throw new Error('显示名称需要不超过 120 个字的文字。');
        const style = options['样式'] === undefined ? undefined : typeof options['样式'] === 'string' ? named(project.ui.flowStyles ?? [], options['样式']) : undefined;
        if (options['样式'] !== undefined && !style) throw new Error('流程图样式不存在，请在“界面 → 流程图 → 框样式”中创建后选择。');
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
    if (/^[-—…\.·]{3,}$/.test(trimmed)) { if (pendingActions.length || pendingVoiceId || pendingLineId) addDialogue('旁白', '', false, false); current = undefined; wasBlank = true; continue; }
    if (command && (/^[@／/]/.test(trimmed) || command.name === '效果')) {
      const { name } = command;
      let value = command.value;
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
        if (original?.kind !== 'passage' && (pendingActions.length || pendingVoiceId || pendingLineId)) addDialogue('旁白', '', false, false);
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
        if (pendingActions.length || pendingVoiceId || pendingLineId) addDialogue('旁白', '', false, false);
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
      if (name === '对白标记') {
        const id = reference(value).id ?? (referenceId.test(value) ? value : undefined);
        if (pendingLineId && pendingLineId !== id && (pendingActions.length || pendingVoiceId)) addDialogue('旁白', '', false, false);
        if (id) pendingLineId = id;
        else issue('对白标记需要有效的行引用。', index + 1, current?.id);
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
        line.text += `\n${value}`;
        locations.push({ sourceLine: index + 1, nodeId: current.id, line });
        continue;
      }
      if (name === '演出实例') {
        const snapshotReference = value.match(/^(.*?)\s+使用【([a-z][a-z0-9_]{0,63})】$/);
        const ref = reference(snapshotReference?.[1] ?? value);
        const sourceLine = oldLines.get(ref.id ?? ref.name);
        const snapshotId = snapshotReference?.[2] ?? key('performance', ref.id ?? ref.name);
        let snapshot = project.effects.find(effect => effect.id === snapshotId);
        if (!snapshot && sourceLine) {
          snapshot = { id: snapshotId, name: `${(ref.name || '对白').slice(0, 118)}演出`, commands: [], actions: structuredClone(sourceLine.actions) };
          project.effects.push(snapshot);
        }
        if (!snapshot) { issue(`找不到演出实例：${ref.name}`, index + 1, current?.id); continue; }
        pendingActions.push(...structuredClone(snapshot.actions ?? []), ...snapshot.commands.flatMap(text => { const action = textCommandAction(project, text); return action ? [action] : []; }));
        pendingLocations.push({ sourceLine: index + 1, actionCount: pendingActions.length });
        if (sourceLine && !pendingLineId) pendingLineId = sourceLine.id;
        if (!snapshotReference && sourceLine?.voiceId) pendingVoiceId = sourceLine.voiceId;
        continue;
      }
      if (['实例', '复用节点', '节点实例', '互动实例', '小游戏实例'].includes(name)) {
        if (pendingActions.length || pendingVoiceId || pendingLineId) addDialogue('旁白', '', false, false);
        const ref = reference(value);
        const allowedKind = name === '互动实例' ? 'interaction' : name === '小游戏实例' ? 'minigame' : undefined;
        const candidates = input.nodes.filter(node => (ref.id ? node.id === ref.id : node.name === ref.name || node.id === ref.name) && (!allowedKind || node.kind === allowedKind));
        const local = candidates.filter(node => node.sceneId === scene.id);
        const originals = local.length ? local : candidates;
        if (originals.length !== 1) { issue(originals.length ? `可复用节点名称有歧义：${value}` : `找不到可复用节点：${value}`, index + 1); continue; }
        const original = originals[0];
        if (name === '实例') beginOperation(original.kind, original.name, original, true);
        else begin(original.kind, original.name, original, true, true);
        explicit.add(`${current!.id}/next`); instances.add(current!.id);
        continue;
      }
      if (name === '跳转' || name === '调用') {
        if (pendingActions.length || pendingVoiceId || pendingLineId) addDialogue('旁白', '', false, false);
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
        if (current?.kind !== 'choice' && (pendingActions.length || pendingVoiceId || pendingLineId)) addDialogue('旁白', '', false, false);
        if (current?.kind !== 'choice') beginOperation('choice', `选择 ${project.nodes.length + 1}`);
        const choice = current as Extract<StoryNode, { kind: 'choice' }>;
        const parts = value.split(/\s*(?:->|→|前往)\s*/);
        const original = input.nodes.find(node => node.id === choice.id);
        const oldChoice = original?.kind === 'choice' ? original.choices.find(item => item.text === parts[0] && !choice.choices.some(option => option.id === item.id)) ?? original.choices[choice.choices.length] : undefined;
        const optionId = oldChoice && !choice.choices.some(option => option.id === oldChoice.id) ? oldChoice.id : key('option', `${choice.id}/${choice.choices.length}`);
        choice.choices.push({ id: optionId, text: parts[0] });
        if (parts[1] && parts[1] !== '无') links.push({ nodeId: choice.id, port: optionId, name: parts[1], sourceLine: index + 1 });
        else if (parts[1] === '无') continue;
        else issue('选项需要指定前往的章节、小章节或段落。', index + 1, choice.id);
        continue;
      }
      if (name === '条件') {
        if (pendingActions.length || pendingVoiceId || pendingLineId) addDialogue('旁白', '', false, false);
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
        if (pendingActions.length || pendingVoiceId || pendingLineId) addDialogue('旁白', '', false, false);
        let when: import('./model').Condition | undefined;
        if (name === '如果' || /^如果\s*/.test(value)) {
          try {
            const conditional = value.replace(/^如果\s*/, '').match(/^(.+)\s*[，,]\s*([^，,]+(?:\+=|=|设为|增加).+)$/);
            if (!conditional) throw new Error('条件赋值格式为：@设置：如果 章节进度 < 2，章节进度 = 2');
            when = parseTextCondition(project, conditional[1]); value = conditional[2];
          } catch (error) { issue(error instanceof Error ? error.message : '条件赋值无效。', index + 1); continue; }
        }
        const match = value.match(/^(.+?)\s*(\+=|=|设为|增加)\s*(.+)$/);
        if (!match) { issue('状态格式为：@设置：好感度 += 1', index + 1); continue; }
        beginOperation('set', `修改 ${match[1].trim()} ${project.nodes.length + 1}`);
        const node = current as Extract<StoryNode, { kind: 'set' }>;
        if (when) node.when = when;
        const valueText = stripQuotes(match[3]);
        const parsedValue = /^(是|true)$/i.test(valueText) ? true : /^(否|false)$/i.test(valueText) ? false : valueText !== '' && Number.isFinite(Number(valueText)) ? Number(valueText) : valueText;
        const variableReference = reference(match[1].trim());
        let variable = named(project.variables, match[1].trim());
        if (!variable && (variableReference.id || project.variables.filter(item => item.name === variableReference.name).length > 1)) { issue(`状态引用不存在或名称有歧义：${match[1].trim()}`, index + 1, node.id); continue; }
        if (!variable) { variable = { id: key('variable', match[1].trim()), name: match[1].trim(), type: typeof parsedValue as 'number' | 'boolean' | 'string', initial: typeof parsedValue === 'number' ? 0 : typeof parsedValue === 'boolean' ? false : '', persistent: false }; project.variables.push(variable); }
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
    if (!project.nodes.length && /^[^:：]{0,100}第[零〇一二三四五六七八九十百千万两\d]+[回章节篇部卷]/.test(trimmed) && trimmed.length <= 200) { project.name = trimmed; continue; }
    const dialogue = trimmed.match(/^([^:：]{1,40})\s*[:：]\s*(.*)$/);
    addDialogue(dialogue?.[1].trim() ?? '旁白', dialogue?.[2] ?? trimmed, !dialogue && !wasBlank);
    wasBlank = false;
  }
  if (pendingActions.length || pendingVoiceId || pendingLineId || pendingPlayback) addDialogue('旁白', '', false, false);
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
      if (!project.scenes.some(item => item.id === current!.id)) project.scenes.push(structuredClone(current));
      const chapter = oldChapters.find(item => item.id === current!.chapterId);
      if (chapter && !project.chapters.some(item => item.id === chapter.id)) project.chapters.push(structuredClone(chapter));
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
    project.nodes.unshift({ id: key('start', project.id), kind: 'start', name: '开始', sceneId: first.sceneId, x: 20, y: 80, next: first.id, textHeading: false });
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
      if (!project.scenes.some(item => item.id === sceneId)) project.scenes.push(structuredClone(owner));
      const chapter = input.chapters.find(item => item.id === owner.chapterId);
      if (chapter && !project.chapters.some(item => item.id === chapter.id)) project.chapters.push(structuredClone(chapter));
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
      project.nodes.push(structuredClone(original));
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
  sourceMap.sort((a, b) => a.sourceLine - b.sourceLine);
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
    case 'startDialogue': return '@播放台词演出';
    case 'pause': return `@等待：${action.seconds}`;
    case 'hide': return `@隐藏角色：${character(action.characterId)}${action.transition !== 'dissolve' ? '，转场=' + ({ none: '无', fade: '淡入淡出', move: '移动', dissolve: '溶解' }[action.transition]) : ''}${action.duration !== undefined ? '，时长=' + action.duration : ''}${action.wait !== undefined ? '，等待完成=' + (action.wait ? '是' : '否') : ''}${action.instanceId ? '，实例ID=' + action.instanceId : ''}`;
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
      if (action.instanceId) add('实例ID', action.instanceId);
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
      const pose = action.keyframes[0], text = `@显示${{ image: '图片', video: '视频', text: '文字', solid: '', group: '', particles: '' }[action.content]}：${serializeParameterValue(action.content === 'text' ? action.text : asset(action.assetId!))}`;
      const fields = [`对象ID=${action.instanceId}`, `横向位置=${pose.x}`, `纵向位置=${pose.y}`, `宽度=${action.width}`, `高度=${action.height}`, `时长=${action.duration}`, `图层=${action.layer}`, `等待完成=${action.wait ? '是' : '否'}`];
      if (action.content === 'text') fields.push(`字号=${action.fontSize}`, `颜色=${action.color}`);
      else fields.push(`适应方式=${{ contain: '容纳', cover: '填满', stretch: '拉伸' }[action.imageFit ?? 'stretch']}`);
      if (action.content === 'video') fields.push(`循环=${action.loop ? '是' : '否'}`, `音量=${action.volume ?? 1}`);
      fields.push(...visualTransitionText(action));
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

function flowchartHeadingOptions(project: Project, options?: StoryNode['flowchart']): string {
  const fields = [options?.visible === undefined ? '' : '流程图=' + (options.visible ? '是' : '否'), options?.name ? '显示名称=' + JSON.stringify(options.name) : '', options?.styleId ? '样式=' + JSON.stringify(textReference(project.ui.flowStyles?.find(s => s.id === options.styleId)?.name ?? '缺失样式', options.styleId)) : ''].filter(Boolean);
  return fields.length ? '(' + fields.join('，') + ')' : '';
}
export function projectToText(project: Project): string {
  const output: string[] = [];
  const name = (id?: string) => id ? textReference(project.nodes.find(node => node.id === id)?.name ?? '缺失节点', id) : '无';
  const ordered = project.chapters.flatMap(chapter => project.scenes.filter(scene => scene.chapterId === chapter.id).flatMap(scene => project.nodes.filter(node => node.sceneId === scene.id)));
  const following = new Map(ordered.map((node, index) => [node.id, ordered[index + 1]]));
  const nextLines = (node: StoryNode, target?: string) => target && following.get(node.id)?.id === target && following.get(node.id)?.textHeading === false ? [] : [`@跳转：${name(target)}`];
  output.push(`@入口：${name(project.entryId)}`, '');
  if (project.ui.activeInstanceId) output.push(`@界面实例：${textReference(project.ui.instances?.find(instance => instance.id === project.ui.activeInstanceId)?.name ?? '界面实例', project.ui.activeInstanceId)}`, '');
  for (const effect of project.effects.filter(item => !item.id.startsWith('txt_performance_'))) output.push(`@效果定义：${textReference(effect.name, effect.id)}`, ...effect.commands.map(command => `@动作：${command}`), '@效果结束', '');
  for (const chapter of project.chapters) {
    output.push(`# 章节${flowchartHeadingOptions(project, chapter.flowchart)}：${textReference(chapter.name, chapter.id)}`, '');
    for (const scene of project.scenes.filter(item => item.chapterId === chapter.id)) {
      output.push(`# 小章节${flowchartHeadingOptions(project, scene.flowchart)}：${textReference(scene.name, scene.id)}`, '');
      if (scene.baseSceneId) output.push(`@场景基础：${textReference(project.scenes.find(item => item.id === scene.baseSceneId)?.name ?? '基础场景', scene.baseSceneId)}`);
      if (scene.parameters && Object.keys(scene.parameters).length) output.push(`@场景参数：${JSON.stringify(scene.parameters)}`);
      if (scene.blueprintId) output.push(`@场景蓝图：${textReference(projectGraphs(project)?.find(graph => graph.id === scene.blueprintId)?.name ?? '场景蓝图', scene.blueprintId)}`);
      if (scene.baseSceneId || scene.blueprintId || (scene.parameters && Object.keys(scene.parameters).length)) output.push('');
      for (const node of project.nodes.filter(node => node.sceneId === scene.id)) {
        const nodeReference = textReference(node.name, node.id);
        output.push(node.textHeading === false || isStandaloneNode(node) ? `@节点标记：${nodeReference}` : `# 段落${flowchartHeadingOptions(project, node.flowchart)}：${nodeReference}`);
        if (node.kind === 'passage') {
          for (const line of node.lines) {
            output.push(`@对白标记：${line.id}`);
            output.push(...linePerformanceText(project, node, line));
            if (!line.silent) output.push(...playbackText(line.playback));
            if (line.voiceId) output.push(`@配音：${textReference(project.assets.find(asset => asset.id === line.voiceId)?.name ?? '配音', line.voiceId)}`);
            const speaker = project.characters.find(character => character.id === line.speakerId)?.name ?? '旁白';
            if (!line.silent) output.push(...line.text.split('\n').map((text, lineIndex) => lineIndex === 0 ? `${speaker}：${text}` : `@续行：${text}`));
            else output.push(standaloneText(isStandaloneNode(node) ? node.name : undefined, line.playback));
          }
          output.push(...nextLines(node, node.next));
        } else if (node.kind === 'start') output.push('@开始', ...nextLines(node, node.next));
        else if (node.kind === 'chapterTitle') {
          output.push(...chapterPerformanceText(project, node));
          output.push(standaloneText(node.name, node.playback));
          output.push(...nextLines(node, node.next));
        }
        else if (node.kind === 'choice' && !/[\r\n]/.test(node.prompt) && !node.choices.some(choice => choice.condition || /[\r\n]|->|→/.test(choice.text))) output.push(`@选择：${node.prompt}`, ...node.choices.map(choice => `@选项：${choice.text} -> ${name(choice.target)}`));
        else if (node.kind === 'condition') output.push(`@条件：${textCondition(project, node.condition)}`, `@满足：${name(node.yes)}`, `@不满足：${name(node.no)}`);
        else if (node.kind === 'set') output.push(`@设置：${node.when ? '如果 ' + textCondition(project, node.when) + '，' : ''}${project.variables.find(variable => variable.id === node.variableId)?.name ?? node.variableId} ${node.operation === 'add' ? '+=' : '='} ${typeof node.value === 'string' ? JSON.stringify(node.value) : node.value}`, ...nextLines(node, node.next));
        else if (node.kind === 'jump' || node.kind === 'call') {
          if (node.kind === 'jump' && node.sceneTransition) {
            output.push(jumpCommandText(name(node.target), node.sceneTransition));
          } else output.push(`@${node.kind === 'call' ? '调用' : '跳转'}：${name(node.target)}`);
          if (node.kind === 'call') output.push(...nextLines(node, node.next));
        }
        else if (node.kind === 'end') output.push('@返回标题界面');
        else if (node.kind === 'return') output.push('@返回');
        else output.push(`@实例：${nodeReference}`);
        output.push('');
      }
    }
  }
  return output.join('\n');
}

export function importedTextProject(text: string, name: string): TextParseResult {
  return applyTextScript(createProject(name.replace(/\.[^.]+$/, '').slice(0, 200) || '导入作品'), text, name);
}
