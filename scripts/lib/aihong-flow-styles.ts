import type { Project } from '../../src/core/model';
import { availableFlowStyleName } from '../../src/core/flow-style';

/** Make the existing template artwork available as named, editable presets. */
export function addAihongFlowStyles(project: Project): void {
  const flow = project.ui.components.find(c => c.id === 'ai_flowchart_items' && c.kind === 'flowchart');
  if (!flow) return;
  const styles = project.ui.flowStyles ??= [];
  for (const [id, name, skin] of [
    ['ai_flow_main', '主线框', flow.skin],
    ['ai_flow_memory', '回忆框', flow.list?.flowChapterSkin],
    ['ai_flow_ending', '结局框', flow.list?.flowEndSkin],
  ] as const) {
    if (styles.some(style => style.id === id) || !skin || styles.length >= 128) continue;
    styles.push({ id, name: availableFlowStyleName(styles, name), skin: structuredClone(skin), style: structuredClone(flow.style) });
  }
}
