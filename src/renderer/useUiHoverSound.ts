import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Project, UiComponent } from '../core/model';
import type { UiPreviewClickFeedback } from '../core/ui-logic-preview';
import { declaredUiComponents } from '../core/model';
import { uiHoverSound } from '../core/ui-sound';
import type { AssetUrl } from './StageEditor';

/** Interaction preview only: editing/selecting a widget never plays UI feedback. */
export function useUiHoverSound(project: Project, assetUrl: AssetUrl, gain: number, components?: readonly UiComponent[], click?: UiPreviewClickFeedback) {
  const audio = useRef<HTMLAudioElement | null>(null), handledClick = useRef(0);
  const byId = useMemo(() => new Map((components ?? declaredUiComponents(project)).map(component => [component.id, component])), [components, project]);
  useEffect(() => () => { if (audio.current) { audio.current.pause(); audio.current.removeAttribute('src'); audio.current.load(); } }, []);
  useEffect(() => { if (audio.current) audio.current.volume = Math.max(0, Math.min(1, gain)); }, [gain]);
  const play = useCallback((assetId?: string) => {
    const url = assetId && assetUrl(assetId);
    if (!url || gain <= 0) return;
    const player = audio.current ?? (audio.current = new Audio());
    player.pause();
    if (player.getAttribute('src') !== url) player.src = url;
    player.currentTime = 0;
    player.volume = Math.max(0, Math.min(1, gain));
    void player.play().catch(() => { /* Asset diagnostics surface missing audio; a denied autoplay does not execute actions. */ });
  }, [assetUrl, gain]);
  useEffect(() => {
    if (!click) { handledClick.current = 0; return; }
    if (click.sequence <= handledClick.current) { handledClick.current = click.sequence; return; }
    handledClick.current = click.sequence;
    play(click.assetId);
  }, [click?.sequence, click?.assetId, click?.componentId, click?.pageInstance, play]);
  return (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || !(event.target instanceof Element)) return;
    const button = event.target.closest('button,[role="button"]');
    if (!button || !event.currentTarget.contains(button) || button.closest('[inert],[hidden],[aria-disabled="true"],:disabled')) return;
    if (event.relatedTarget instanceof Node && button.contains(event.relatedTarget)) return;
    const id = button.closest('[data-preview-component]')?.getAttribute('data-preview-component');
    play(uiHoverSound(project, id ? byId.get(id) : undefined, button.closest('[data-preview-page]')?.getAttribute('data-preview-page') ?? undefined));
  };
}
