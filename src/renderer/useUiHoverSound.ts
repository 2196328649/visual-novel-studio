import { useEffect, useRef } from 'react';
import type { Project } from '../core/model';
import { declaredUiComponents } from '../core/model';
import { uiHoverSound } from '../core/ui-sound';
import type { AssetUrl } from './StageEditor';

/** Interaction preview only: editing/selecting a widget does not play audio. */
export function useUiHoverSound(project: Project, assetUrl: AssetUrl, gain: number) {
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { if (audio.current) { audio.current.pause(); audio.current.removeAttribute('src'); audio.current.load(); } }, []);
  useEffect(() => { if (audio.current) audio.current.volume = Math.max(0, Math.min(1, gain)); }, [gain]);
  return (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || !(event.target instanceof Element)) return;
    const button = event.target.closest('button,[role="button"]');
    if (!button || !event.currentTarget.contains(button) || button.closest('[inert],[hidden],[aria-disabled="true"],:disabled')) return;
    if (event.relatedTarget instanceof Node && button.contains(event.relatedTarget)) return;
    const id = button.closest('[data-preview-component]')?.getAttribute('data-preview-component');
    const component = declaredUiComponents(project).find(c => c.id === id);
    const sound = uiHoverSound(project, component), url = sound && assetUrl(sound);
    if (!url || gain <= 0) return;
    const player = audio.current ?? (audio.current = new Audio());
    player.pause();
    if (player.getAttribute('src') !== url) player.src = url;
    player.currentTime = 0;
    player.volume = Math.max(0, Math.min(1, gain));
    void player.play().catch(() => { /* Audio loading errors are surfaced by asset validation. */ });
  };
}
