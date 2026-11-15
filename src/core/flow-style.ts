import type { FlowStyle, Project, UiComponent } from './model';
import { argumentTokens, argumentValue } from './text-arguments';
import { textHeading } from './text-headings';

export function flowNodeAppearance(project: Project, component: UiComponent, node: { kind?: string; styleId?: string }): UiComponent {
  const preset = project.ui.flowStyles?.find(s => s.id === node.styleId);
  const skin = preset?.skin ?? (node.kind === 'end' ? component.list?.flowEndSkin : node.kind === 'chapterTitle' ? component.list?.flowChapterSkin : undefined) ?? component.skin;
  // In-memory resets and JSON round-trips must inherit identically. Caption slots
  // remain one whole override; merging them by index changes existing projects.
  const base = Object.fromEntries(Object.entries(component.style ?? {}).filter(([, value]) => value !== undefined));
  const overrides = Object.fromEntries(Object.entries(preset?.style ?? {}).filter(([, value]) => value !== undefined));
  return { ...component, skin, style: { ...base, ...overrides, opacity: preset?.style?.opacity ?? 1, playerOpacity: false } };
}

export function flowCaptionSlot(parts: NonNullable<UiComponent['style']>['captionParts'], count: number, index: number) {
  return parts?.[Math.min(Math.max(0, parts.length - count + index), parts.length - 1)];
}

export function flowStyleUsages(project: Project, styleId: string) {
  const metadata = [...project.chapters, ...project.scenes, ...project.nodes].filter(item => item.flowchart?.styleId === styleId);
  const containers = [
    { kind: 'theme' as const, id: project.id, name: '基础方案', components: project.ui.components },
    ...(project.ui.instances ?? []).map(instance => ({ kind: 'instance' as const, id: instance.id, name: instance.name, components: instance.components })),
    ...(project.ui.customPages ?? []).map(page => ({ kind: 'customPage' as const, id: page.id, name: page.name, components: page.components })),
  ];
  const customEntries = containers.flatMap(container => container.components.flatMap(component => component.kind === 'flowchart'
    ? (component.list?.flowContent?.custom?.entries ?? []).filter(entry => entry.styleId === styleId).map(entry => {
      const owner = entry.owner;
      const ownerTitle = owner
        ? (owner.kind === 'chapter' ? project.chapters : owner.kind === 'scene' ? project.scenes : project.nodes).find(item => item.id === owner.id)?.name
        : project.nodes.find(item => item.id === entry.nodeId)?.name;
      return {
        id: `${container.kind}:${container.id}:${component.id}:${entry.nodeId}`,
        name: `${container.name} · ${component.name?.trim() || component.id} · ${entry.name?.trim() || ownerTitle || entry.nodeId}`,
        componentId: component.id,
        nodeId: entry.nodeId,
        container: { kind: container.kind, id: container.id },
        ...(owner ? { owner: { ...owner } } : {}),
      };
    })
    : []));
  return [...metadata, ...customEntries];
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
