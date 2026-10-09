import type { CSSProperties } from 'react';
import { effectiveUiTheme, type Project, type UiButtonState, type UiComponent } from '../core/model';
import { uiComponentBounds, uiComponentFontSize, uiSkinAsset, uiTextColor } from '../core/ui';
import { UiSkinImage, uiFontFamily, uiStateColor, uiTextShadow } from './UiAppearance';
import { SpinePreview } from './SpinePreview';
import type { AssetUrl } from './StageEditor';

export function uiComponentPreviewStyle(project: Project, component: UiComponent, scale: number, state: UiButtonState = 'idle', point: { x: number; y: number } = component): CSSProperties {
  const theme = effectiveUiTheme(project.ui);
  const b = uiComponentBounds({ ...component, x: point.x, y: point.y }, project.width, project.height);
  const skin = uiSkinAsset(component.skin, state);
  const backgroundKey = state === 'idle' ? 'background' : `${state}Background` as const;
  const childBackground = component.parentId ? component.style?.[backgroundKey] ?? component.style?.background : component.style?.background;
  return {
    left: b.x * scale, top: b.y * scale, width: b.width * scale, height: b.height * scale,
    overflow: component.kind === 'historyList' && component.list?.historyScrollbar ? 'visible' : undefined,
    color: uiTextColor(component, theme, state),
    opacity: (component.style?.opacity ?? 1) * (component.style?.playerOpacity ? Number(project.playerDefaults?.dialogueOpacity ?? 1) : 1),
    fontSize: uiComponentFontSize(component, theme, project.width, project.height) * scale,
    lineHeight: 'normal', textShadow: uiTextShadow(component, scale), fontFamily: uiFontFamily(component.style?.fontAssetId ?? theme.fontAssetId),
    textAlign: component.style?.align ?? (component.kind === 'text' ? 'left' : 'center'),
    justifyContent: component.style?.align === 'left' ? 'flex-start' : component.style?.align === 'right' ? 'flex-end' : component.kind === 'text' && !component.style?.align ? 'flex-start' : 'center',
    backgroundColor: ['choiceList', 'saveSlots'].includes(component.kind) || component.kind === 'button' && skin ? undefined : component.kind === 'button' ? uiStateColor(component, state) : childBackground,
    padding: component.kind === 'button' ? component.skin?.hideText ? 0 : `${4 * scale}px ${8 * scale}px` : 0,
    '--component-surface': component.style?.background ?? '#283133',
  } as CSSProperties;
}

export interface UiPreviewBindings { speaker?: string; dialogue?: string; tooltip?: string; chapterTitle?: string; chapterSubtitle?: string; chapterTitleImageId?: string }

export function ContinueIndicator({ project, assetUrl, scale }: { project: Project; assetUrl: AssetUrl; scale: number }) {
  const theme = effectiveUiTheme(project.ui);
  const asset = project.assets.find(a => a.id === theme.continueIndicatorId && a.kind === 'image');
  if (!asset) return null;
  const width = Math.round(theme.continueIndicatorWidth ?? asset.width ?? 32);
  return <img className="ui-continue-indicator" src={assetUrl(asset.id)} alt="" style={{ width: width * scale, height: Math.max(1, Math.round(width * (asset.height ?? 32) / (asset.width ?? 32))) * scale }} />;
}

/** Authored primitives shared by the UI canvas and dialogue preview. */
export function UiComponentContent({ project, component, assetUrl, scale, state = 'idle', bindings = {} }: {
  project: Project; component: UiComponent; assetUrl: AssetUrl; scale: number; state?: UiButtonState; bindings?: UiPreviewBindings;
}) {
  if (component.binding === 'tooltip') return bindings.tooltip ? <><UiSkinImage skin={component.skin} state="idle" assetUrl={assetUrl} scale={scale} /><span className="ui-text-content">{bindings.tooltip}</span></> : null;
  if (component.kind === 'spine') return <SpinePreview asset={project.assets.find(a => a.id === component.assetId)} settings={component.spine} width={Math.round(component.width * project.width)} height={Math.round(component.height * project.height)} />;
  if (component.kind === 'video') return <video className="ui-video" src={assetUrl(component.assetId)} poster={assetUrl(component.posterId)} autoPlay muted loop={component.loop ?? true} playsInline />;
  if (component.kind === 'image') return <UiSkinImage skin={{ ...component.skin, idle: component.assetId, fit: component.style?.imageFit ?? 'contain' }} state={component.parentId ? state : 'idle'} assetUrl={assetUrl} scale={scale} />;
  if (component.kind === 'panel') return null;
  if (component.kind === 'progress') return <div className="ui-progress-preview"><span style={{ width: `${(component.value ?? 0) * 100}%`, background: component.style?.selectedBackground ?? project.ui.accent }} /></div>;
  if (component.kind === 'chapterTitle') {
    const bounds = uiComponentBounds(component, project.width, project.height);
    const fontSize = uiComponentFontSize(component, effectiveUiTheme(project.ui), project.width, project.height);
    // Lay out at project resolution, then scale the result. Scaling the font
    // first rounds its metrics and accumulates drift over long paragraphs.
    return <div className="ui-chapter-text" style={{ position: 'absolute', left: 0, top: 0, width: bounds.width, height: bounds.height, gap: 12, fontSize, textShadow: uiTextShadow(component, 1), transform: `scale(${scale})`, transformOrigin: 'top left' }}>
    {bindings.chapterTitleImageId ? <img src={assetUrl(bindings.chapterTitleImageId)} alt={bindings.chapterTitle ?? ''} style={{ width: '100%', height: '100%' }} /> : <span>{bindings.chapterTitle ?? '第一章'}</span>}
    {!bindings.chapterTitleImageId && bindings.chapterSubtitle && <span style={{ fontSize: Math.min(fontSize, 32) }}>{bindings.chapterSubtitle}</span>}
  </div>;
  }
  const text = component.binding === 'title' ? project.name : component.binding === 'speaker' ? bindings.speaker : component.binding === 'dialogue' ? bindings.dialogue : component.binding === 'confirmation' ? '确定要继续吗？' : component.binding === 'minigameTitle' ? '小游戏标题' : component.binding === 'minigamePrompt' ? '请完成当前互动' : component.binding === 'minigameStatus' ? '等待玩家操作' : component.text;
  return <>{component.kind === 'button' && <UiSkinImage skin={component.skin} state={state} assetUrl={assetUrl} scale={scale} />}
    {!(component.kind === 'button' && component.skin?.hideText) && <span className="ui-text-content">{text}{component.binding === 'dialogue' && text && <ContinueIndicator project={project} assetUrl={assetUrl} scale={scale} />}</span>}
  </>;
}
