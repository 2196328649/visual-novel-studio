import { uiPageTheme } from '../core/ui-page-settings';
import { resolveDialogueUi } from '../core/dialogue-ui-preview';
import { uiPropertyControlSnapshot } from '../core/ui-property-control-snapshot';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TextPresentationStyle } from '../core/model';
import { defaultScreenPlacement, textRevealPlan, typeSoundTimes } from '../core/text-presentation';
import { ScreenTextBox, type TextPlacement } from './ScreenTextBox';
import type { TextMarks } from '../core/text-spans';
import { playerTextSpeed, StyledText, useTypeSoundPreview } from './StyledText';
import { effectiveUiComponents, type Project, type VariableValue } from '../core/model';
import { dialogueLayout } from '../core/ui';
import { uiFontFamily } from './UiAppearance';
import { ContinueIndicator, UiComponentContent, uiComponentPreviewStyle } from './UiComponentVisual';
import { hexOpacity, type AssetUrl } from './StageEditor';
import { AuthoredPreferencePreview } from './PlayerPreferences';

export function DialoguePreview({ project, assetUrl, speaker, text, values, revealing = false, look = {}, reveal, marks, onPlaceText, exit }: {
  project: Project; assetUrl: AssetUrl; speaker?: string; text: string; values?: Record<string, VariableValue>; revealing?: boolean;
  /** The line's text look; `reveal` is seconds since its words started, undefined when complete. */
  look?: TextPresentationStyle; reveal?: number; marks?: TextMarks; /** Seconds into the words' exit, once it has begun. */ exit?: number;
  /** Set when the author may drag screen text on the preview. */
  onPlaceText?: (placement: TextPlacement) => void;
}) {
  // App owns project font faces. Re-registering them when a preview mounts
  // invalidates font layout across the entire editor, including offscreen lines.
  const root = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [hoveredButton, setHoveredButton] = useState<string>();
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(entries => setScale(entries[0].contentRect.width / project.width));
    observer.observe(root.current); return () => observer.disconnect();
  }, [project.width]);
  const theme = useMemo(() => uiPageTheme(project, 'ui:say'), [project.ui]);
  const components = useMemo(() => effectiveUiComponents(project.ui).filter(c => c.page === 'say'), [project.ui]);
  const variables = useMemo(() => values ?? Object.fromEntries(project.variables.map(v => [v.id, v.initial])), [values, project.variables]);
  // Revealing words and editing their style do not alter the dialogue frame.
  // Layout still follows live variables, hover state and inherited UI changes.
  const snapshots = useMemo(() => components.map(component => uiPropertyControlSnapshot(project, component, variables)), [components, variables, project.variables, project.assets, project.playerDefaults, project.playerPreferenceSettings]);
  const { rows, tooltip, controlValues } = useMemo(() => resolveDialogueUi(project, snapshots, variables, hoveredButton), [snapshots, variables, hoveredButton, project.ui, project.width, project.height, project.playerDefaults?.dialogueOpacity]);
  useEffect(() => {
    if (hoveredButton && !rows.some(row => row.component.id === hoveredButton && row.visible && row.state !== 'disabled' && !row.geometry?.clippedOut)) setHoveredButton(undefined);
  }, [rows, hoveredButton]);
  // A linked text value intentionally replaces a system binding. Keep the
  // authored slots when deciding whether a native fallback must be added.
  const bindings = useMemo(() => new Set(components.map(c => c.binding)), [components]);
  const layout = useMemo(() => dialogueLayout(project.width, project.height, theme), [project.width, project.height, theme]);
  const plan = useMemo(() => textRevealPlan(look, text, playerTextSpeed(project), marks), [look, text, project.playerDefaults?.textSpeed, marks]);
  const soundTimes = useMemo(() => typeSoundTimes(look, text, plan), [look, text, plan]);
  useTypeSoundPreview(look.typeSoundId ? assetUrl(look.typeSoundId) : undefined, look.typeSoundVolume ?? 1, soundTimes, reveal, revealing);
  const words = text ? <StyledText style={look} text={text} reveal={reveal} scale={scale} plan={plan} marks={marks} exit={exit} /> : '';
  if (look.placement === 'screen' && text) {
    // The game hides the dialogue window and shows only these words on the screen.
    const place = { ...defaultScreenPlacement, ...Object.fromEntries((['x', 'y', 'width'] as const).flatMap(key => look[key] === undefined ? [] : [[key, look[key]]])) };
    return <div ref={root} className={`ui-dialogue-preview ${revealing ? 'is-revealing' : ''}`} aria-label="对话界面预览" style={{ color: theme.textColor, fontFamily: uiFontFamily(theme.fontAssetId) }}>
      <ScreenTextBox placement={place} fontSize={theme.fontSize * scale} align={look.align ?? 'center'} onPlace={onPlaceText}>{words}</ScreenTextBox>
      {layout.quickHeight > 0 && <div className="ui-dialogue-quick-menu" style={{ height: layout.quickHeight * scale, fontSize: Math.min(18, theme.fontSize) * scale, gap: 17 * scale }}>回退　历史　跳过　自动　存档　读档　设置</div>}
    </div>;
  }
  return <div ref={root} className={`ui-dialogue-preview ${revealing ? 'is-revealing' : ''}`} aria-label="对话界面预览" style={{ color: theme.textColor, fontFamily: uiFontFamily(theme.fontAssetId) }}>
    {theme.pages?.say?.layout !== 'custom' && <div className="ui-dialogue-native-window" style={{ top: layout.top * scale, height: layout.dialogueHeight * scale,
      background: bindings.has('speaker') && bindings.has('dialogue') ? undefined : hexOpacity(theme.background, theme.dialogueOpacity * Number(project.playerDefaults?.dialogueOpacity ?? 1)), padding: `${layout.paddingTop * scale}px ${layout.margin * scale}px`, gap: layout.spacing * scale }}>
      {speaker && !bindings.has('speaker') && <div style={{ fontSize: layout.speakerSize * scale, color: theme.accent }}>{speaker}</div>}
      {!bindings.has('dialogue') && <div style={{ fontSize: theme.fontSize * scale, lineHeight: `calc(1em + ${5 * scale}px)`, ...(look.align ? { textAlign: look.align } : {}) }}>{words}{text && <ContinueIndicator project={project} assetUrl={assetUrl} scale={scale} />}</div>}
    </div>}
    {rows.filter(row => row.visible).map(({ component: c, state, geometry }) => <div key={c.id} data-preview-component-id={c.id} className={`ui-component ${c.kind}`} style={{ ...uiComponentPreviewStyle(project, c, scale, state, c, geometry), pointerEvents: c.kind === 'button' && state !== 'disabled' && !geometry?.clippedOut ? 'auto' : 'none' }}
      onPointerEnter={() => { if (c.kind === 'button' && state !== 'disabled' && !geometry?.clippedOut) setHoveredButton(c.id); }} onPointerLeave={() => { if (c.kind === 'button') setHoveredButton(undefined); }}>
      {c.kind === 'preference' || c.kind === 'preferenceChoice' ? <AuthoredPreferencePreview project={project} component={c} assetUrl={assetUrl} scale={scale} state={state} value={controlValues.get(c.id)} />
        : <UiComponentContent project={project} component={c} assetUrl={assetUrl} scale={scale} state={state} bindings={{ speaker, dialogue: text, dialogueContent: words, dialogueAlign: look.align, tooltip }} />}
    </div>)}
    {layout.quickHeight > 0 && <div className="ui-dialogue-quick-menu" style={{ height: layout.quickHeight * scale, fontSize: Math.min(18, theme.fontSize) * scale, gap: 17 * scale }}>回退　历史　跳过　自动　存档　读档　设置</div>}
  </div>;
}
