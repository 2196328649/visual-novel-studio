import type { FlowStyle, Project, UiComponent } from './model';
import { argumentTokens, argumentValue } from './text-arguments';
import { textHeading } from './text-headings';

export function flowNodeAppearance(project: Project, component: UiComponent, node: { kind?: string; styleId?: string }): UiComponent {
  const preset = project.ui.flowStyles?.find(s => s.id === node.styleId);
  const skin = preset?.skin ?? (node.kind === 'end' ? component.list?.flowEndSkin : node.kind === 'chapterTitle' ? component.list?.flowChapterSkin : undefined) ?? component.skin;
  return { ...component, skin, style: { ...component.style, ...preset?.style, opacity: preset?.style?.opacity ?? 1, playerOpacity: false } };
}

export function flowStyleUsages(project: Project, styleId: string) {
  return [...project.chapters, ...project.scenes, ...project.nodes].filter(item => item.flowchart?.styleId === styleId);
}

export function availableFlowStyleName(styles: FlowStyle[], base = '新样式') {
  let name = base, i = 2;
  while (styles.some(s => s.name === name)) name = `${base} ${i++}`;
  return name;
}

/** Rename references in headings, including manually typed names, without changing story prose. */
export function renameFlowStyleReferences(source: string, id: string, before: string, after: string): string {
  return source.split('\n').map(line => {
    const heading = textHeading(line, true), args = heading?.parameters;
    if (!args) return line;
    for (const token of argumentTokens(line.slice(args.start, args.end), true).reverse()) {
      if (token.name !== '样式') continue;
      let value: unknown; try { value = argumentValue(token.raw); } catch { continue; }
      if (typeof value !== 'string' || value !== before && !value.endsWith(`【${id}】`)) continue;
      line = line.slice(0, args.start + token.valueStart) + JSON.stringify(`${after}【${id}】`) + line.slice(args.start + token.end);
    }
    return line;
  }).join('\n');
}
