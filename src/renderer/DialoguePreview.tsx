import { resolveUiHierarchy } from '../core/ui-hierarchy';
import { useEffect, useRef, useState } from 'react';
import { effectiveUiTheme, orderedUiComponents, type Condition, type Project, type VariableValue } from '../core/model';
import { dialogueLayout, uiTooltip } from '../core/ui';
import { UiFontFaces, uiFontFamily } from './UiAppearance';
import { ContinueIndicator, UiComponentContent, uiComponentPreviewStyle } from './UiComponentVisual';
import { hexOpacity, type AssetUrl } from './StageEditor';

function visible(condition: Condition | undefined, values: Record<string, VariableValue>): boolean {
  if (!condition) return true;
  if (condition.kind === 'all') return condition.conditions.every(c => visible(c, values));
  if (condition.kind === 'any') return condition.conditions.some(c => visible(c, values));
  if (condition.kind === 'not') return !visible(condition.condition, values);
  if (condition.kind !== 'compare') return true;
  const left = values[condition.variableId], right = condition.value;
  switch (condition.operator) {
    case 'eq': return left === right;
    case 'ne': return left !== right;
    case 'gt': return Number(left) > Number(right);
    case 'gte': return Number(left) >= Number(right);
    case 'lt': return Number(left) < Number(right);
    case 'lte': return Number(left) <= Number(right);
  }
}

export function DialoguePreview({ project, assetUrl, speaker, text, values, revealing = false }: {
  project: Project; assetUrl: AssetUrl; speaker?: string; text: string; values?: Record<string, VariableValue>; revealing?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [hoveredButton, setHoveredButton] = useState<string>();
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(entries => setScale(entries[0].contentRect.width / project.width));
    observer.observe(root.current); return () => observer.disconnect();
  }, [project.width]);
  const theme = effectiveUiTheme(project.ui);
  const components = orderedUiComponents(project.ui).filter(c => c.page === 'say');
  const variables = values ?? Object.fromEntries(project.variables.map(v => [v.id, v.initial]));
  const rows = resolveUiHierarchy(components, { visible: c => visible(c.visibleWhen, variables), state: c => c.disabled ? 'disabled' : hoveredButton === c.id ? 'hover' : 'idle', playerOpacity: Number(project.playerDefaults?.dialogueOpacity ?? 1) });
  const bindings = new Set(components.map(c => c.binding));
  const layout = dialogueLayout(project.width, project.height, theme);
  return <div ref={root} className={`ui-dialogue-preview ${revealing ? 'is-revealing' : ''}`} aria-label="对话界面预览" style={{ color: theme.textColor, fontFamily: uiFontFamily(theme.fontAssetId) }}>
    <UiFontFaces project={project} assetUrl={assetUrl} />
    {theme.pages?.say?.layout !== 'custom' && <div className="ui-dialogue-native-window" style={{ top: layout.top * scale, height: layout.dialogueHeight * scale,
      background: bindings.has('speaker') && bindings.has('dialogue') ? undefined : hexOpacity(theme.background, theme.dialogueOpacity * Number(project.playerDefaults?.dialogueOpacity ?? 1)), padding: `${layout.paddingTop * scale}px ${layout.margin * scale}px`, gap: layout.spacing * scale }}>
      {speaker && !bindings.has('speaker') && <div style={{ fontSize: layout.speakerSize * scale, color: theme.accent }}>{speaker}</div>}
      {!bindings.has('dialogue') && <div style={{ fontSize: theme.fontSize * scale, lineHeight: `calc(1em + ${5 * scale}px)` }}>{text}{text && <ContinueIndicator project={project} assetUrl={assetUrl} scale={scale} />}</div>}
    </div>}
    {rows.filter(row => row.visible).map(({ component: c, state }) => <div key={c.id} data-preview-component-id={c.id} className={`ui-component ${c.kind}`} style={{ ...uiComponentPreviewStyle(project, c, scale, state), pointerEvents: c.kind === 'button' ? 'auto' : 'none' }}
      onPointerEnter={() => { if (c.kind === 'button') setHoveredButton(c.id); }} onPointerLeave={() => { if (c.kind === 'button') setHoveredButton(undefined); }}>
      <UiComponentContent project={project} component={c} assetUrl={assetUrl} scale={scale} state={state} bindings={{ speaker, dialogue: text, tooltip: hoveredButton ? uiTooltip(components.find(item => item.id === hoveredButton) ?? c) : '' }} />
    </div>)}
    {layout.quickHeight > 0 && <div className="ui-dialogue-quick-menu" style={{ height: layout.quickHeight * scale, fontSize: Math.min(18, theme.fontSize) * scale, gap: 17 * scale }}>回退　历史　跳过　自动　存档　读档　设置</div>}
  </div>;
}
