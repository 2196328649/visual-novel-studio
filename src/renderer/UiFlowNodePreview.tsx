import { useContext, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Project, UiButtonState, UiComponent } from '../core/model';
import { flowCaptionSlot, flowNodeAppearance } from '../core/flow-style';
import { storyFlowDefaults, storyFlowDirectoryLayout } from '../core/story-flow';
import { uiComponentTheme } from '../core/ui-page-settings';
import { uiPropertyControlDesignSnapshot } from '../core/ui-property-control-snapshot';
import { uiTextColor, uiStateColor } from '../core/ui';
import { uiTextShadow, UiSkinImage, uiFontFamily } from './UiAppearance';
import { UiFlowEditContext, type FlowPreviewVisual } from './UiFlowEditing';
import type { AssetUrl } from './StageEditor';

export type FlowCaptionNode = { id: string; name: string; parts?: string[]; kind?: string; styleId?: string };
type FlowCaptionSelection = { selectedPart?: number; onSelectPart?: (index: number) => void };

export function flowNodePreviewStyle(project: Project, look: UiComponent, scale: number, state: UiButtonState): CSSProperties {
  return { textAlign: look.style?.align ?? 'center', textShadow: 'none', fontSize: (look.style?.fontSize ?? project.ui.fontSize) * scale, fontFamily: uiFontFamily(look.style?.fontAssetId ?? project.ui.fontAssetId), letterSpacing: (look.style?.letterSpacing ?? 0) * scale, color: uiTextColor(look, project.ui, state), background: look.skin?.idle ? undefined : uiStateColor(look, state, project.ui.accent), border: look.style?.borderWidth ? `${look.style.borderWidth * scale}px solid ${look.style.borderColor ?? project.ui.accent}` : undefined, borderRadius: (look.style?.radius ?? 0) * scale, opacity: look.style?.opacity ?? 1, boxSizing: 'border-box' };
}

/** Canvas and inspector samples use the same text fitting, skins and caption slots. */
export function UiFlowNodeFace({ node, look, component, width, height, scale, state, locked = false, current = false, suffix = '', assetUrl, selectedPart, onSelectPart }: { node: FlowCaptionNode; look: UiComponent; component: UiComponent; width: number; height: number; scale: number; state: UiButtonState; locked?: boolean; current?: boolean; suffix?: string; assetUrl: AssetUrl } & FlowCaptionSelection) {
  const marker = component.list?.layout === 'flow' ? component.list.flowCurrentMarker : undefined;
  const hidden = look.skin?.hideText || locked && look.skin?.disabled;
  const align = look.style?.align ?? 'center';
  // As in Ren'Py, an unreached caption is one part and uses the last style slot.
  const texts = locked ? [component.list?.flowLockedCaption ?? '未到达'] : [...(node.parts ?? [node.name])];
  if (!locked && texts.length) texts[texts.length - 1] += suffix;
  const pieces = useMemo(() => texts.map((text, index) => {
    const slot = flowCaptionSlot(look.style?.captionParts, texts.length, index);
    // Apply resolved spacing on the glyph spans: the editor's global text reset
    // overrides CSS inheritance. The face and its shadow share these pieces.
    return { text, style: { fontSize: slot?.fontSize ? slot.fontSize * scale : undefined, fontFamily: slot?.fontAssetId ? uiFontFamily(slot.fontAssetId) : undefined, letterSpacing: (slot?.letterSpacing ?? look.style?.letterSpacing ?? 0) * scale, color: slot?.color, marginRight: index < texts.length - 1 ? (slot?.gap ?? 16) * scale : undefined } as CSSProperties };
  }), [JSON.stringify(texts), look.style?.captionParts, look.style?.letterSpacing, scale]);
  const paddingX = Math.min(36, Math.max(0, (width - 1) / 2)), paddingY = Math.min(8, Math.max(0, (height - 1) / 2));
  return <>
    {current && marker && <img data-flow-current-marker alt="" draggable={false} src={assetUrl(marker.assetId)} style={{ position: 'absolute', left: marker.rect.x * width * scale, top: marker.rect.y * height * scale, width: marker.rect.width * width * scale, height: marker.rect.height * height * scale, pointerEvents: 'none' }} />}
    <UiSkinImage skin={look.skin} state={state} assetUrl={assetUrl} scale={scale} />
    {!hidden && <div data-flow-caption-area style={{ position: 'absolute', inset: `${paddingY * scale}px ${paddingX * scale}px`, display: 'flex', alignItems: 'center', justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', pointerEvents: 'none' }}>
      <FlowCaption parts={pieces} width={Math.max(1, width - 72) * scale} height={Math.max(1, height - 16) * scale} align={align} look={look} scale={scale} selectedPart={selectedPart} onSelectPart={locked ? undefined : onSelectPart} />
    </div>}
  </>;
}

function FlowCaption({ parts, width, height, align, look, scale, selectedPart, onSelectPart }: { parts: { text: string; style: CSSProperties }[]; width: number; height: number; align: 'left' | 'center' | 'right'; look: UiComponent; scale: number } & FlowCaptionSelection) {
  const ref = useRef<HTMLSpanElement>(null);
  const style = look.style;
  const outline = { outlineWidth: style?.outlineWidth, outlineColor: style?.outlineColor, outlineOpacity: style?.outlineOpacity };
  useLayoutEffect(() => {
    const text = ref.current!;
    const fit = () => {
      const ratio = Math.max(.0001, Math.min(1, width / Math.max(1, text.offsetWidth), height / Math.max(1, text.offsetHeight)));
      text.style.transform = `scale(${ratio})`;
      // Fitting a long caption changes its glyph sizes, not authored effect
      // lengths. Both the canvas zoom and the game scale those lengths once.
      text.style.setProperty('--flow-caption-fit', String(ratio));
      text.style.textShadow = uiTextShadow({ style: outline }, scale / ratio) ?? 'none';
    };
    const observer = new ResizeObserver(fit); observer.observe(text); fit();
    return () => observer.disconnect();
  }, [parts, width, height, style, scale]);
  const color = style?.shadowColor ?? '#000000', opacity = (style?.shadowOpacity ?? .7) * (color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1);
  const shadow = opacity > 0 && !!(style?.shadowBlur || style?.shadowSpread || style?.shadowX || style?.shadowY);
  const length = (value = 0) => `calc(${value * scale}px / var(--flow-caption-fit, 1))`;
  return <span data-flow-caption ref={ref} style={{ display: 'block', position: 'relative', whiteSpace: 'nowrap', width: 'max-content', flexShrink: 0, transformOrigin: `${align} center`, textShadow: uiTextShadow({ style: outline }, scale) ?? 'none' }}>
    {shadow && <span aria-hidden="true" data-flow-caption-shadow style={{ position: 'absolute', inset: 0, pointerEvents: 'none', color: color.slice(0, 7), textShadow: 'none', WebkitTextStroke: `${length((style?.shadowSpread ?? 0) * 2)} ${color.slice(0, 7)}`, filter: style?.shadowBlur ? `blur(${length(style.shadowBlur / 2)})` : undefined, opacity, transform: `translate(${length(style?.shadowX)}, ${length(style?.shadowY)})` }}>
      {parts.map((part, index) => <span key={index} style={{ ...part.style, color: 'inherit' }}>{part.text}</span>)}
    </span>}
    <span style={{ position: 'relative' }}>{parts.map((part, index) => <span key={index} data-flow-part={index} data-flow-part-selected={onSelectPart && selectedPart === index ? '' : undefined}
      role={onSelectPart ? 'button' : undefined} tabIndex={onSelectPart ? 0 : undefined} aria-pressed={onSelectPart ? selectedPart === index : undefined} aria-label={onSelectPart ? `编辑第 ${index + 1} 段文字样式：${part.text}` : undefined}
      onPointerDown={onSelectPart ? event => event.stopPropagation() : undefined}
      onClick={onSelectPart ? event => { event.preventDefault(); event.stopPropagation(); onSelectPart(index); } : undefined}
      onKeyDown={onSelectPart ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelectPart(index); } } : undefined}
      style={{ ...part.style, ...(onSelectPart ? { cursor: 'pointer', pointerEvents: 'auto', outline: selectedPart === index ? '1px solid #71bbdf' : undefined, outlineOffset: 2, borderRadius: 1 } : {}) }}>{part.text}</span>)}</span>
  </span>;
}

export function UiFlowAffectedOutline() {
  return <span aria-hidden="true" data-flow-impact-outline style={{ position: 'absolute', inset: 3, border: '2px dashed #e9b96d', borderRadius: 'inherit', pointerEvents: 'none', zIndex: 2 }} />;
}

export function UiFlowNodeSample({ project, component, previewComponent, node, assetUrl, state = 'idle', preview, selectedPart, onSelectPart }: { project: Project; component: UiComponent; previewComponent?: UiComponent; node: FlowCaptionNode; assetUrl: AssetUrl; state?: UiButtonState; preview?: Pick<FlowPreviewVisual, 'state' | 'locked' | 'current' | 'suffix'> } & FlowCaptionSelection) {
  const editing = useContext(UiFlowEditContext);
  state = preview?.state ?? state;
  const locked = preview?.locked ?? state === 'disabled', current = preview?.current ?? state === 'selected', suffix = preview?.suffix ?? '';
  const container = useRef<HTMLDivElement>(null), [available, setAvailable] = useState(280);
  useLayoutEffect(() => { const el = container.current!; const observer = new ResizeObserver(() => setAvailable(el.clientWidth)); observer.observe(el); return () => observer.disconnect(); }, []);
  // Use the canvas snapshot without writing its resolved values back to authoring data.
  const resolved = useMemo(() => previewComponent?.id === component.id ? previewComponent : uiPropertyControlDesignSnapshot(project, component).component, [project, component, previewComponent]);
  const themed = { ...project, ui: uiComponentTheme(project, resolved) }, look = flowNodeAppearance(themed, resolved, node);
  const groupHeaderHeight = editing?.componentId === component.id && editing.groupId ? Math.min(44, Math.max(32, Math.floor(resolved.height * project.height * .1))) : 0;
  const directory = resolved.list?.layout !== 'flow' ? storyFlowDirectoryLayout(themed, resolved, themed.ui.fontSize, groupHeaderHeight) : undefined;
  const width = directory?.cellWidth ?? resolved.list?.itemWidth ?? storyFlowDefaults.itemWidth, height = directory?.cellHeight ?? resolved.list?.itemHeight ?? storyFlowDefaults.itemHeight;
  // The canvas applies whole-map opacity on its wrapper; the isolated sample has no such wrapper.
  const opacity = (resolved.style?.opacity ?? 1) * (look.style?.opacity ?? 1);
  const scale = Math.max(.001, Math.min(1, available / Math.max(1, width), 120 / Math.max(1, height)));
  const note = look.skin?.hideText ? '当前底图已含文字，文字设置不会显示。' : state === 'disabled' ? look.skin?.disabled ? '未到达底图会隐藏文字；切换到普通预览可选择文字段。' : '当前显示未到达提示；切换到普通预览可选择实际文字段。' : undefined;
  return <>
    <div className="flow-node-sample" ref={container} aria-label="节点实际样式预览" data-flow-sample-state={state} data-flow-sample-current={current ? '' : undefined} data-flow-sample-suffix={suffix} data-flow-sample-width={width} data-flow-sample-height={height}><div style={{ position: 'relative', width: width * scale, height: height * scale, ...flowNodePreviewStyle(themed, look, scale, state), opacity }}><UiFlowNodeFace node={node} look={look} component={resolved} width={width} height={height} scale={scale} state={state} locked={locked} current={current} suffix={suffix} assetUrl={assetUrl} selectedPart={selectedPart} onSelectPart={onSelectPart} /></div></div>
    {onSelectPart && note && <small className="flow-edit-scope" role="note">{note}</small>}
  </>;
}
