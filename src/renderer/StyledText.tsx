import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Project, TextPresentationStyle, TextSpanStyle } from '../core/model';
import { textCharacterMarks, type TextMarks } from '../core/text-spans';
import { defaultLoopSpeed, defaultLoopStrength, textCharacterFrame, textExitFrame, textExitPlan, textRevealPlan, typeSoundTimes, waveLength, type TextRevealPlan } from '../core/text-presentation';
import { uiTextShadow } from '../core/ui-text-effects';
import { uiFontFamily } from './UiAppearance';
import './text-presentation.css';

/** Plays the typing sound as the reveal passes each sounding character; rewinding starts over. */
export function useTypeSoundPreview(url: string | undefined, volume: number, times: number[], reveal: number | undefined, enabled: boolean) {
  const played = useRef(0), last = useRef(0);
  const player = useRef<HTMLAudioElement | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !url) return;
    // Like the game's typing channel, reuse one voice rather than layering a
    // new, unowned media element over every sounding character.
    const audio = new Audio(url);
    player.current = audio;
    return () => {
      player.current = undefined;
      audio.pause(); audio.removeAttribute('src'); audio.load();
    };
  }, [url, enabled]);
  useEffect(() => {
    if (reveal === undefined || reveal < last.current) {
      player.current?.pause();
      played.current = 0;
    }
    if (reveal === undefined) { last.current = 0; return; }
    last.current = reveal;
    let reached = played.current;
    while (reached < times.length && times[reached] <= reveal) reached++;
    if (reached === played.current) return;
    played.current = reached;
    const audio = player.current;
    if (!enabled || !audio) return;
    audio.pause(); audio.currentTime = 0;
    audio.volume = Math.max(0, Math.min(1, volume));
    void audio.play().then(() => { if (player.current !== audio) audio.pause(); }).catch(() => undefined);
  }, [reveal, url, volume, times, enabled]);
}

const sampleHold = .6;

export const playerTextSpeed = (project: Project) => Number(project.playerDefaults?.textSpeed ?? 35);

/** CSS for a look's typeface and colour; size is relative to the surrounding text. */
export function styledTextCss(style: TextPresentationStyle, scale: number): CSSProperties {
  return {
    ...(style.fontAssetId ? { fontFamily: uiFontFamily(style.fontAssetId) } : {}),
    ...(style.sizeScale !== undefined ? { fontSize: `${style.sizeScale}em` } : {}),
    ...(style.color ? { color: style.color } : {}),
    ...(style.bold !== undefined ? { fontWeight: style.bold ? 700 : 400, '--text-bold-stroke': style.bold ? '.04em' : '0px' } : {}),
    ...(style.italic !== undefined ? { fontStyle: style.italic ? 'italic' : 'normal' } : {}),
    ...(style.textEffects ? { textShadow: uiTextShadow({ style: style.textEffects }, scale) } : {}),
  } as CSSProperties;
}

/** CSS for one part-line effect, layered over the line's look. */
function spanCss(style: TextSpanStyle | undefined): CSSProperties | undefined {
  if (!style) return undefined;
  return {
    ...(style.fontAssetId ? { fontFamily: uiFontFamily(style.fontAssetId) } : {}),
    ...(style.sizeScale !== undefined ? { fontSize: `${style.sizeScale}em` } : {}),
    ...(style.color ? { color: style.color } : {}),
    ...(style.bold ? { fontWeight: 700, '--text-bold-stroke': '.04em' } : {}),
    ...(style.italic ? { fontStyle: 'italic' } : {}),
  } as CSSProperties;
}

type Loop = { kind: Exclude<TextSpanStyle['loop'], 'none' | undefined>; strength: number; speed: number };
const loopOf = (style: { loop?: TextSpanStyle['loop']; loopStrength?: number; loopSpeed?: number } | undefined): Loop | undefined =>
  style?.loop && style.loop !== 'none' ? { kind: style.loop, strength: style.loopStrength ?? defaultLoopStrength[style.loop], speed: style.loopSpeed ?? defaultLoopSpeed[style.loop] } : undefined;
const loopVars = (loop: Loop, scale: number) => ({ '--text-loop-strength': `${loop.strength * scale}px`, '--text-loop-depth': String(Math.min(1, loop.strength / 100)), '--text-loop-duration': `${1 / loop.speed}s` }) as CSSProperties;

/** Dialogue words drawn one character at a time like the game's text shaders.
 * `reveal` is seconds since the words started; undefined shows them complete.
 * Part-line effects replace the line's loop on their own words, as in the game. */
export function StyledText({ style, text, reveal, scale, plan, marks, exit }: { style: TextPresentationStyle; text: string; reveal?: number; scale: number; plan: TextRevealPlan; marks?: TextMarks; /** Seconds into the exit, once it has begun. */ exit?: number }) {
  const lineLoop = loopOf(style);
  const leaving = useMemo(() => exit === undefined ? undefined : textExitPlan(style, text), [exit === undefined, style, text]);
  const slots = useMemo(() => textCharacterMarks(text, marks).characters, [text, marks]);
  let index = 0;
  const parts = Array.from(text).map((character, position) => {
    if (character === '\n') return <br key={position} />;
    const i = index++, span = slots[i]?.style, loop = span?.loop !== undefined ? loopOf(span) : lineLoop;
    const frame = leaving ? textExitFrame(leaving, i, exit!, scale) : textCharacterFrame(style, plan, i, reveal, scale);
    const wave = loop?.kind === 'wave' ? { animationDuration: `${1 / loop.speed}s`, animationDelay: `${-(i / waveLength) / loop.speed}s` } : undefined;
    return <span key={position} className="styled-char-loop" data-text-loop={loop?.kind} data-text-span={span ? '' : undefined} style={{ ...(loop ? loopVars(loop, scale) : {}), ...wave, ...spanCss(span) }}><span className="styled-char" style={{ opacity: frame.opacity, transform: frame.transform }}>{character}</span></span>;
  });
  return <span className="styled-text" data-text-loop={lineLoop?.kind} style={styledTextCss(style, scale)}>{parts}</span>;
}

/** Replays on a content change; an inactive sample keeps its position without
 * scheduling frames, including when it has already finished. */
export function useRevealClock(key: unknown, running: boolean, until: number, active = true) {
  const [elapsed, setElapsed] = useState<number | undefined>(running ? 0 : undefined);
  const progress = useRef(0);
  useEffect(() => {
    progress.current = 0;
    setElapsed(running && until > 0 ? 0 : undefined);
  }, [key, running, until]);
  useEffect(() => {
    if (!running || !active || progress.current >= until) return;
    const started = performance.now() - progress.current * 1000;
    let frame = requestAnimationFrame(function tick() {
      const seconds = (performance.now() - started) / 1000;
      progress.current = seconds;
      // Keep the final frame: returning undefined would draw exited words in
      // their complete, visible state again after the clock stops.
      setElapsed(Math.min(seconds, until));
      if (seconds < until) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [key, running, until, active]);
  return elapsed;
}

/** Observe the sticky preview itself so it keeps playing while pinned above
 * its fields, and pauses only after leaving the clipped scrolling viewport. */
function useSampleVisibility() {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const sample = element.current;
    if (!sample) return;
    let intersects = false;
    const update = () => setVisible(intersects && document.visibilityState === 'visible');
    const observer = new IntersectionObserver(([entry]) => {
      intersects = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0;
      update();
    });
    observer.observe(sample);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  return { element, visible };
}

/** A small live sample of a look, replayed whenever the look changes. */
export function TextLookSample({ project, style, text, fontSize, fontAssetId, textColor, align = 'left', marks, assetUrl }: { project: Project; style: TextPresentationStyle; text: string; fontSize: number; fontAssetId?: string; textColor: string; align?: TextPresentationStyle['align']; marks?: TextMarks; assetUrl?: (id: string) => string | undefined }) {
  const sample = text.trim() || '这是一句示例台词，用来预览文字演出。';
  const sampleMarks = text.trim() ? marks : undefined;
  const plan = useMemo(() => textRevealPlan(style, sample, playerTextSpeed(project), sampleMarks), [style, sample, project.playerDefaults?.textSpeed, sampleMarks]);
  const [replay, setReplay] = useState(0);
  const contentKey = useMemo(() => JSON.stringify([style, sample, sampleMarks]), [style, sample, sampleMarks]);
  const key = contentKey + ':' + replay;
  const { element, visible } = useSampleVisibility();
  const leaving = useMemo(() => textExitPlan(style, sample), [style, sample]);
  // The sample holds the finished words for a moment before they leave, as a player would read them.
  const clock = useRevealClock(key, plan.cps > 0 || !!leaving, plan.seconds + (leaving ? sampleHold + leaving.total : .05), visible);
  const reveal = clock !== undefined && clock < plan.seconds ? clock : undefined;
  const exit = leaving && clock !== undefined && clock >= plan.seconds + sampleHold ? clock - plan.seconds - sampleHold : undefined;
  const scale = Math.min(1, 26 / Math.max(1, fontSize));
  // Only the replay button sounds: edits restart the sample often, and would chatter.
  const [soundingKey, setSoundingKey] = useState<string>();
  const soundTimes = useMemo(() => typeSoundTimes(style, sample, plan), [style, sample, plan]);
  useTypeSoundPreview(style.typeSoundId ? assetUrl?.(style.typeSoundId) : undefined, style.typeSoundVolume ?? 1, soundTimes, reveal, soundingKey === key && visible);
  return <div ref={element} className="text-look-sample" data-preview-active={visible} aria-label="文字演出效果预览">
    <div className="text-look-sample-stage" style={{ fontSize: fontSize * scale, color: textColor, fontFamily: uiFontFamily(fontAssetId), textAlign: style.align ?? (style.placement === 'screen' ? 'center' : align) }}>
      <StyledText style={style} text={sample} reveal={reveal} scale={scale} plan={plan} marks={sampleMarks} exit={exit} />
    </div>
    <div className="text-look-sample-footer">
      <span className="muted">{plan.cps ? `${plan.count} 字 · 约 ${plan.seconds.toFixed(1)} 秒显示完${plan.extended ? '（停顿已顺延）' : plan.followsPlayer ? '（按玩家默认速度）' : ''}` : '整句立即显示'}</span>
      <button type="button" className="small-button" onClick={() => { setSoundingKey(contentKey + ':' + (replay + 1)); setReplay(value => value + 1); }}>重播</button>
    </div>
  </div>;
}
