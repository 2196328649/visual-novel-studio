import { uiTextOutlines } from './ui-text-effects';
import { lineMarks, renpyMarkedText, textCharacterMarks, type TextMarks } from './text-spans';
import { type Project, type StoryLine, type TextAnimation, type TextMotion, type TextPresentation, type TextPresentationStyle, type TextPreset } from './model';
import { animationFrame, animationSpec, applyEasing, entranceAnimations, exitAnimations, fullAnimation, orderPosition, type FullTextAnimation } from './text-animation';

export const textEntranceNames = { none: '普通（逐字出现）', fade: '逐字淡入', zoom: '逐字放大', slam: '逐字砸入', flip: '逐字翻转', drop: '逐字落下', rise: '逐字升起' } as const;
export const textExitNames = { none: '无退场', fade: '逐字淡出', zoom: '逐字缩小', slam: '逐字放大消失', flip: '逐字翻转', drop: '逐字落下', rise: '逐字飘起' } as const;
export const textLoopNames = { none: '无', shake: '抖动', wave: '波浪', pulse: '呼吸' } as const;
export const textSpeedNames = { player: '跟随玩家设置', duration: '按时长', cps: '按速度', instant: '瞬间显示' } as const;
export const textPlacementNames = { dialogue: '对话框内', screen: '画面上（隐藏对话框）' } as const;
export const textAlignNames = { left: '左对齐', center: '居中', right: '右对齐' } as const;

/** Seconds one character takes to finish its entrance. */
export const defaultEntranceTime: Record<Exclude<TextPresentationStyle['entrance'], undefined>, number> = { none: 0, fade: .25, zoom: .2, slam: .18, flip: .25, drop: .3, rise: .3 };
/** Shake and wave use pixels at game resolution; pulse uses percent of opacity. */
export const defaultLoopStrength: Record<Exclude<TextPresentationStyle['loop'], undefined>, number> = { none: 0, shake: 3, wave: 5, pulse: 40 };
export const defaultLoopSpeed: Record<Exclude<TextPresentationStyle['loop'], undefined>, number> = { none: 1, shake: 1, wave: 2, pulse: 1 };
export const defaultScreenPlacement = { x: .5, y: .5, width: .8 };
export const defaultTypeSoundEvery = 2;
/** Ren'Py's wave shader lays one wave across this many characters. */
export const waveLength = 20;
export const defaultExitTotal = .4;
export const defaultExitTime = .25;

export const builtinTextPresets: TextPreset[] = [
  { id: 'builtin_text_shout', name: '惊吓 / 大喊', style: { sizeScale: 1.35, color: '#ff5a4f', bold: true, speed: 'cps', cps: 40, entrance: 'slam', entranceTime: .18, loop: 'shake', loopStrength: 2 } },
  { id: 'builtin_text_whisper', name: '低语', style: { sizeScale: .85, color: '#b9c3d6', italic: true, speed: 'cps', cps: 12, entrance: 'fade', entranceTime: .4 } },
  { id: 'builtin_text_memory', name: '回忆', style: { color: '#e8d9b0', italic: true, entrance: 'fade', entranceTime: .5, loop: 'pulse', loopStrength: 25, loopSpeed: .5 } },
  { id: 'builtin_text_dream', name: '梦境', style: { color: '#d8c8ff', entrance: 'rise', entranceTime: .4, loop: 'wave', loopStrength: 4, loopSpeed: 1 } },
  { id: 'builtin_text_system', name: '系统提示', style: { color: '#9fe7ff', align: 'center', placement: 'screen', x: .5, y: .45, width: .7, speed: 'cps', cps: 30, textEffects: { outlineWidth: 2, outlineColor: '#00314a' } } },
  { id: 'builtin_text_title', name: '画面大字', style: { sizeScale: 1.8, bold: true, align: 'center', placement: 'screen', x: .5, y: .45, width: .8, speed: 'cps', cps: 8, entrance: 'drop', entranceTime: .35, textEffects: { outlineWidth: 3, outlineColor: '#000000' } } },
  { id: 'builtin_text_slow', name: '缓慢叙述', style: { speed: 'cps', cps: 10, entrance: 'fade', entranceTime: .3 } },
  { id: 'builtin_text_instant', name: '瞬间显示', style: { speed: 'instant' } },
  { id: 'builtin_text_bounce', name: '弹跳登场', style: { speed: 'cps', cps: 20, entrance: 'drop', entranceTime: .6, entranceAnimation: { y: -60, easing: 'bounce', opacity: 1 } } },
  { id: 'builtin_text_spin', name: '旋转飞入', style: { speed: 'cps', cps: 18, entrance: 'zoom', entranceTime: .5, entranceAnimation: { rotation: 180, easing: 'back' } } },
  { id: 'builtin_text_scatter', name: '散落聚拢', style: { speed: 'duration', duration: 1.2, entrance: 'fade', entranceTime: .45, entranceAnimation: { y: 24, order: 'random', easing: 'easeOut' }, exit: 'fade', exitTotal: .5, exitAnimation: { y: -24, order: 'random' } } },
  { id: 'builtin_text_ripple', name: '由中散开', style: { speed: 'duration', duration: 1, entrance: 'zoom', entranceTime: .35, entranceAnimation: { order: 'center', easing: 'back' }, exit: 'zoom', exitTotal: .35, exitAnimation: { order: 'edges' } } },
];

export function textPresets(project: Project): TextPreset[] { return [...builtinTextPresets, ...(project.textPresets ?? [])]; }
export function textPreset(project: Project, id?: string): TextPreset | undefined { return id ? textPresets(project).find(preset => preset.id === id) : undefined; }
export const isBuiltinTextPreset = (id?: string) => !!id && builtinTextPresets.some(preset => preset.id === id);

const styleKeys = ['fontAssetId', 'sizeScale', 'color', 'bold', 'italic', 'align', 'textEffects', 'speed', 'duration', 'cps', 'placement', 'x', 'y', 'width', 'entrance', 'entranceTime', 'entranceAnimation', 'loop', 'loopStrength', 'loopSpeed', 'exit', 'exitTotal', 'exitTime', 'exitAnimation', 'typeSoundId', 'typeSoundEvery', 'typeSoundVolume'] as const;

/** Later layers override earlier ones field by field; outline and shadow fields merge too. */
export function mergeTextStyles(...layers: (TextPresentationStyle | undefined)[]): TextPresentationStyle {
  const result: TextPresentationStyle = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const key of styleKeys) {
      const value = layer[key];
      if (value === undefined) continue;
      if (key === 'textEffects') result.textEffects = { ...result.textEffects, ...(value as TextPresentationStyle['textEffects']) };
      else if (key === 'entranceAnimation' || key === 'exitAnimation') result[key] = { ...result[key], ...(value as TextAnimation) };
      else (result as Record<string, unknown>)[key] = value;
      // Choosing a different effect starts over: adjustments made to the earlier one do not carry across.
      if (key === 'entrance') delete result.entranceAnimation;
      if (key === 'exit') delete result.exitAnimation;
    }
  }
  return result;
}

export type TextTypeSoundMode = 'inherit' | 'mute' | 'sound';
const typeSoundKeys = ['typeSoundId', 'typeSoundEvery', 'typeSoundVolume'] as const;

/** Source selection is separate from the effective sound: old ID + volume 0 is still muted. */
export function textTypeSoundMode(own?: TextPresentationStyle, effective: TextPresentationStyle = own ?? {}): TextTypeSoundMode {
  if (!typeSoundKeys.some(key => own?.[key] !== undefined)) return 'inherit';
  return effective.typeSoundVolume === 0 ? 'mute' : 'sound';
}

/** Keep the existing format. Silence overrides inherited sound with volume 0;
 * restoring the source removes the whole local sound override atomically. */
export function editTextTypeSound(own: TextPresentation, base: TextPresentationStyle | undefined, mode: TextTypeSoundMode, assetId?: string): TextPresentation {
  const next = { ...own };
  if (mode === 'inherit') {
    for (const key of typeSoundKeys) delete next[key];
  } else if (mode === 'mute') next.typeSoundVolume = 0;
  else {
    const effective = mergeTextStyles(base, own);
    if (assetId !== undefined) next.typeSoundId = assetId;
    next.typeSoundVolume = effective.typeSoundVolume !== undefined && effective.typeSoundVolume > 0 ? effective.typeSoundVolume
      : base?.typeSoundVolume !== undefined && base.typeSoundVolume > 0 ? base.typeSoundVolume : 1;
  }
  return next;
}

/** Expand a look's preset: the preset gives the base, the look's own fields win. */
export function resolveTextStyle(project: Project, look?: TextPresentation): TextPresentationStyle {
  if (!look) return {};
  const { presetId, ...own } = look;
  return mergeTextStyles(textPreset(project, presetId)?.style, own);
}

/** The speaker's default look, before the line's own settings. */
export function speakerTextStyle(project: Project, speakerId?: string): TextPresentationStyle {
  const layers: TextPresentationStyle[] = [], seen = new Set<string>();
  let id = speakerId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const character = project.characters.find(item => item.id === id);
    if (!character) break;
    // Expand each character's preset before merging: merging raw preset IDs
    // first drops the base preset and lets base overrides defeat a child's preset.
    layers.unshift(resolveTextStyle(project, character.textPresentation));
    id = character.baseCharacterId;
  }
  return mergeTextStyles(...layers);
}

export function effectiveTextStyle(project: Project, line: Pick<StoryLine, 'speakerId' | 'textPresentation'>): TextPresentationStyle {
  return mergeTextStyles(speakerTextStyle(project, line.speakerId), resolveTextStyle(project, line.textPresentation));
}

export const hasTextStyle = (style?: TextPresentationStyle) => !!style && styleKeys.some(key => style[key] !== undefined && !(key === 'textEffects' && !Object.values(style.textEffects ?? {}).some(value => value !== undefined)));

/** Ren'Py lays out every glyph except line breaks. */
export function visibleCharacterCount(text: string) { return Array.from(text).filter(character => character !== '\n').length; }

/** Pauses fit inside the target unless they already consume it. In that case
 * the original target remains available for the words, after those pauses. */
function textDurationBudget(duration: number, waits: number) { return waits >= duration ? duration : duration - waits; }

/** Keep the established half-budget entrance cap, including when pauses
 * require the whole line to extend beyond its requested duration. */
function entranceTimeCap(style: TextPresentationStyle | undefined, text: string, marks: TextMarks) {
  if (style?.speed !== 'duration' || !style.duration) return Infinity;
  const { characters, trailing } = textCharacterMarks(text, marks);
  return textDurationBudget(style.duration, characters.reduce((sum, character) => sum + character.pause, trailing)) / 2;
}

export interface TextRevealPlan {
  /** Characters per second before part-line speed changes; zero shows the whole line at once. */
  cps: number;
  /** The reveal follows the player's text speed preference. */
  followsPlayer: boolean;
  count: number;
  /** Seconds each character takes to finish its entrance. */
  entranceTime: number;
  /** Seconds from the first character until the whole line is shown. */
  seconds: number;
  /** When each visible character starts to appear, as the game times its glyphs. */
  times: number[];
  /** The same starts after the chosen entrance order has been applied. */
  starts: number[];
  /** Each visible character's own entrance and its seconds, after part-line effects. */
  animations: (FullTextAnimation | undefined)[];
  entranceTimes: number[];
  /** Authored pauses, including a pause after the last visible character. */
  pauseSeconds: number;
  /** A whole-line target extended because its explicit pauses already fill it. */
  extended: boolean;
}

/** Ren'Py gives each glyph 1 / cps seconds, a part-line speed multiplies that cps, and a
 * pause is a blank glyph lasting its seconds. "按时长" solves the base cps so the whole
 * line, pauses and the latest actual entrance included, ends on time. */
export function textRevealPlan(style: TextPresentationStyle | undefined, text: string, playerCps: number, marks: TextMarks = {}): TextRevealPlan {
  const count = visibleCharacterCount(text);
  const lineEntrance = style?.entrance && style.entrance !== 'none' ? style.entrance : undefined;
  const wanted = lineEntrance ? style?.entranceTime ?? defaultEntranceTime[lineEntrance] : 0;
  const speed = style?.speed === 'duration' && !style.duration || style?.speed === 'cps' && !style.cps ? 'player' : style?.speed ?? 'player';
  if (speed === 'instant' || speed === 'player' && !(playerCps > 0)) return { cps: 0, followsPlayer: speed === 'player', count, entranceTime: 0, seconds: 0, times: new Array(count).fill(0), starts: new Array(count).fill(0), animations: new Array(count).fill(undefined), entranceTimes: new Array(count).fill(0), pauseSeconds: 0, extended: false };
  const { characters, trailing } = textCharacterMarks(text, marks);
  const weight = characters.reduce((sum, character) => sum + 1 / (character.style?.speed ?? 1), 0);
  const waits = characters.reduce((sum, character) => sum + character.pause, trailing);
  if (!count) {
    // Empty paragraphs have no words to allocate a duration to, but an explicit
    // pause still waits. A positive base cps keeps that native pause active.
    const cps = waits > 0 ? speed === 'cps' ? style!.cps! : speed === 'player' ? playerCps : 1 : 0;
    return { cps, followsPlayer: speed === 'player', count, entranceTime: 0, seconds: waits, times: [], starts: [], animations: [], entranceTimes: [], pauseSeconds: waits, extended: speed === 'duration' && waits > style!.duration! };
  }
  const named = characters.map(character => { const own = character.style?.entrance ?? lineEntrance; return own && own !== 'none' ? own : undefined; });
  const animations = named.map((own, index) => own ? fullAnimation(entranceAnimations, own, characters[index].style?.entrance ? undefined : style?.entranceAnimation) : undefined);
  const budget = speed === 'duration' ? textDurationBudget(style!.duration!, waits) : undefined;
  const cap = budget === undefined ? Infinity : budget / 2;
  const entranceTimes = characters.map((character, index) => {
    const own = named[index];
    if (!own) return 0;
    const seconds = character.style?.entranceTime ?? (character.style?.entrance ? defaultEntranceTime[own] : style?.entranceTime ?? defaultEntranceTime[own]);
    return Math.min(seconds, cap);
  });
  const entranceTime = Math.min(wanted, cap);
  // Each raw glyph time is pause + weight / cps. Every order is piecewise
  // linear in 1/cps, so constrain that unit once per character; no iterative
  // search is needed while the author types or scrubs the preview.
  let pause = 0, weighted = 0;
  const positions = characters.map(character => {
    pause += character.pause; weighted += 1 / (character.style?.speed ?? 1);
    return { pause, weight: weighted };
  });
  const revealWaits = waits - trailing;
  let cps: number;
  if (budget !== undefined) {
    const target = waits + budget;
    let unit = budget / weight;
    const limit = (left: number, start: number, rate: number) => rate > 0 ? (left - start) / rate : start <= left ? Infinity : 0;
    positions.forEach((position, index) => {
      const animation = animations[index];
      if (!animation) return;
      const left = target - entranceTimes[index], before = position.pause, part = position.weight;
      const after = revealWaits - before, rest = weight - part;
      let allowed: number;
      switch (animation.order) {
        case 'reverse': allowed = limit(left, after, rest); break;
        case 'center': {
          const start = before - after, rate = part - rest;
          allowed = rate < 0 ? limit(left, -start, -rate) : limit(left, start, rate);
          break;
        }
        case 'edges': allowed = Math.max(limit(left / 2, before, part), limit(left / 2, after, rest)); break;
        case 'random': {
          const position = orderPosition('random', 0, characters[index].glyphIndex);
          allowed = limit(left, position * revealWaits, position * weight);
          break;
        }
        default: allowed = limit(left, before, part);
      }
      unit = Math.min(unit, allowed);
    });
    cps = Math.min(Number.MAX_VALUE, 1 / Math.max(Number.MIN_VALUE, unit));
  } else cps = speed === 'cps' ? style!.cps! : playerCps;
  // Rounded so sums of many small steps compare as the author expects.
  const round = (value: number) => Math.round(value * 1e9) / 1e9;
  const times = positions.map(position => round(position.pause + position.weight / cps));
  const total = times.at(-1) ?? 0;
  const starts = times.map((time, index) => animations[index] ? round(orderPosition(animations[index]!.order, total > 0 ? time / total : 0, characters[index].glyphIndex) * total) : time);
  const seconds = round(starts.reduce((end, start, index) => Math.max(end, start + entranceTimes[index]), total + trailing));
  return { cps, followsPlayer: speed === 'player', count, entranceTime, seconds, times, starts, animations, entranceTimes, pauseSeconds: waits, extended: budget !== undefined && waits >= style!.duration! };
}

/** Compiled settings read by the game's dialogue text. Undefined leaves the line unchanged. */
export function textRuntimeLook(project: Project, style: TextPresentationStyle, text: string, marks: TextMarks = {}): Record<string, unknown> | undefined {
  const partEntrance = marks.spans?.some(span => span.style.entrance && span.style.entrance !== 'none');
  if (!hasTextStyle(style) && !partEntrance) return undefined;
  const look: Record<string, unknown> = {};
  const font = project.assets.find(asset => asset.id === style.fontAssetId && asset.kind === 'font');
  if (font) look.font = font.path.replaceAll('\\', '/');
  if (style.sizeScale !== undefined) look.scale = style.sizeScale;
  if (style.color) look.color = style.color;
  if (style.bold !== undefined) look.bold = style.bold;
  if (style.italic !== undefined) look.italic = style.italic;
  const align = style.align ?? (style.placement === 'screen' ? 'center' : undefined);
  if (align) look.align = { left: 0, center: .5, right: 1 }[align];
  if (style.textEffects && Object.values(style.textEffects).some(value => value !== undefined)) look.outlines = uiTextOutlines({ style: style.textEffects });
  const plan = textRevealPlan(style, text, 0, marks);
  if (style.speed && style.speed !== 'player' && !plan.followsPlayer) look.cps = plan.cps;
  if (style.entrance && style.entrance !== 'none') look.anim = animationSpec(fullAnimation(entranceAnimations, style.entrance, style.entranceAnimation), plan.followsPlayer ? style.entranceTime ?? defaultEntranceTime[style.entrance] : plan.entranceTime);
  if (look.anim || partEntrance) look.reveal = revealWeights(text, marks);
  const leaving = textExitPlan(style, text);
  if (leaving) look.exit = { anim: animationSpec(leaving.animation, leaving.time), total: leaving.total, count: leaving.count };
  if (style.loop && style.loop !== 'none') { look.loop = style.loop; look.loopStrength = style.loopStrength ?? defaultLoopStrength[style.loop]; look.loopSpeed = style.loopSpeed ?? defaultLoopSpeed[style.loop]; }
  const sound = project.assets.find(asset => asset.id === style.typeSoundId && asset.kind === 'audio');
  if (sound && style.typeSoundVolume !== 0 && style.speed !== 'instant') look.typeSound = { path: sound.path.replaceAll('\\', '/'), volume: style.typeSoundVolume ?? 1, marks: typeSoundMarks(text, marks, style.typeSoundEvery ?? defaultTypeSoundEvery) };
  if (style.placement === 'screen') look.place = { x: style.x ?? defaultScreenPlacement.x, y: style.y ?? defaultScreenPlacement.y, width: style.width ?? defaultScreenPlacement.width };
  return look;
}

/** The last character's start as [seconds of pauses, seconds per unit of cps]; the game divides by its actual cps. */
function revealWeights(text: string, marks: TextMarks) {
  const { characters } = textCharacterMarks(text, marks);
  return [+characters.reduce((sum, character) => sum + character.pause, 0).toFixed(4), +characters.reduce((sum, character) => sum + 1 / (character.style?.speed ?? 1), 0).toFixed(4)];
}

export interface TextExitPlan { animation: FullTextAnimation; time: number; total: number; spread: number; count: number; glyphIndexes: number[] }

/** How a line's or clip's words leave: every character takes `time`, their starts spread over the rest of `total`. */
export function textExitPlan(style: Pick<TextMotion, 'exit' | 'exitTotal' | 'exitTime' | 'exitAnimation'> | undefined, text: string): TextExitPlan | undefined {
  const count = visibleCharacterCount(text);
  if (!style?.exit || style.exit === 'none' || !count) return undefined;
  const total = style.exitTotal ?? defaultExitTotal, time = Math.min(style.exitTime ?? defaultExitTime, total);
  return { animation: fullAnimation(exitAnimations, style.exit, style.exitAnimation), time, total, spread: total - time, count, glyphIndexes: textCharacterMarks(text).characters.map(character => character.glyphIndex) };
}

const silentCharacter = /[\s\p{P}\p{S}]/u;

/** The characters that make a sound: every Nth one that isn't space or punctuation, as indexes among visible characters. */
export function typeSoundIndexes(text: string, every: number) {
  const indexes: number[] = [];
  let sounding = 0;
  Array.from(text).filter(character => character !== '\n').forEach((character, index) => {
    if (silentCharacter.test(character)) return;
    if (sounding++ % every === 0) indexes.push(index);
  });
  return indexes;
}

/** When each sound plays, as [seconds of pauses, seconds per unit of cps]; the game divides by its actual cps. */
function typeSoundMarks(text: string, marks: TextMarks, every: number) {
  const { characters } = textCharacterMarks(text, marks), wanted = new Set(typeSoundIndexes(text, every));
  let waited = 0, weight = 0;
  return characters.flatMap((character, index) => {
    waited += character.pause; weight += 1 / (character.style?.speed ?? 1);
    return wanted.has(index) ? [[+waited.toFixed(4), +weight.toFixed(4)]] : [];
  });
}

/** Seconds into the reveal when the preview plays its typing sound. */
export function typeSoundTimes(style: TextPresentationStyle, text: string, plan: TextRevealPlan) {
  if (!style.typeSoundId || style.typeSoundVolume === 0 || !plan.cps) return [];
  return typeSoundIndexes(text, style.typeSoundEvery ?? defaultTypeSoundEvery).map(index => plan.times[index]);
}

export interface TextCharacterFrame { opacity: number; transform?: string }

/** One character's entrance at `elapsed` seconds into the reveal, matching the game's text shaders. */
export function textCharacterFrame(style: TextPresentationStyle | undefined, plan: TextRevealPlan, index: number, elapsed: number | undefined, scale: number): TextCharacterFrame {
  if (elapsed === undefined || !plan.cps) return { opacity: 1 };
  const time = plan.times[index] ?? (index + 1) / plan.cps, animation = plan.animations[index], seconds = plan.entranceTimes[index] ?? 0;
  if (!animation) return { opacity: elapsed >= time ? 1 : 0 };
  const start = plan.starts[index] ?? time;
  if (elapsed < start) return { opacity: 0 };
  const done = seconds > 0 ? Math.min(1, (elapsed - start) / seconds) : 1;
  if (done >= 1) return { opacity: 1 };
  return animationFrame(animation, applyEasing(animation.easing, done), scale);
}

/** One character `elapsed` seconds into the exit: it holds until its start, then moves to the exit state and disappears. */
export function textExitFrame(leaving: TextExitPlan, index: number, elapsed: number, scale: number): TextCharacterFrame {
  const start = orderPosition(leaving.animation.order, (index + 1) / leaving.count, leaving.glyphIndexes[index] ?? index) * leaving.spread;
  if (elapsed < start) return { opacity: 1 };
  const done = leaving.time > 0 ? (elapsed - start) / leaving.time : 1;
  if (done >= 1) return { opacity: 0 };
  return animationFrame(leaving.animation, 1 - applyEasing(leaving.animation.easing, done), scale);
}

/** A short label for chips and lists. */
export function textStyleSummary(project: Project, look?: TextPresentation): string {
  if (!look) return '默认';
  const parts: string[] = [];
  const preset = textPreset(project, look.presetId);
  if (preset) parts.push(preset.name);
  const own = Object.keys(look).filter(key => key !== 'presetId' && look[key as keyof TextPresentation] !== undefined).length;
  if (own) parts.push(preset ? '已调整' : '自定义');
  if (look.speed === 'duration' && look.duration) parts.push(`${+look.duration.toFixed(2)} 秒`);
  if (look.typeSoundId) parts.push('打字音');
  return parts.join(' · ') || '默认';
}

/** Problems an author should fix; the game falls back to the default look. */
export function textPresentationProblems(project: Project, look?: TextPresentation): string[] {
  if (!look) return [];
  const problems: string[] = [];
  if (look.presetId && !textPreset(project, look.presetId)) problems.push('文字演出预设已不存在，将按未使用预设显示。');
  const style = resolveTextStyle(project, look);
  if (style.fontAssetId && !project.assets.some(asset => asset.id === style.fontAssetId && asset.kind === 'font')) problems.push('文字演出字体已不存在，将使用默认字体。');
  if (style.typeSoundId && !project.assets.some(asset => asset.id === style.typeSoundId && asset.kind === 'audio')) problems.push('文字演出的打字音已不存在，这句不会发声。');
  return problems;
}

/** A line's words for the game: part-line effects become Ren'Py tags around escaped text. */
export function compiledDialogueText(project: Project, line: Pick<StoryLine, 'speakerId' | 'textPresentation' | 'text' | 'textSpans' | 'textPauses'>) {
  const marks = lineMarks(line);
  const style = effectiveTextStyle(project, line);
  // Instant lines show at once in the game, so their waits and speed changes are left out.
  const instant = style.speed === 'instant';
  const defaults = { strength: defaultLoopStrength, speed: defaultLoopSpeed, entrance: defaultEntranceTime, entranceCap: entranceTimeCap(style, line.text, marks), lineStyle: style };
  return renpyMarkedText(project, line.text, instant ? { spans: marks.spans?.map(span => ({ ...span, style: { ...span.style, speed: undefined, entrance: undefined, entranceTime: undefined } })) } : marks, defaults);
}
