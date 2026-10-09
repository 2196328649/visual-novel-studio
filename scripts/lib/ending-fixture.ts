import type { Project, StoryNode, StageAction } from '../../src/core/model';
import { expandPreviewActions, previewActionContext } from '../../src/core/preview-actions';

/** Inspect a normal ending performance for native route assertions. */
export function endingCaption(project: Project, node: StoryNode | string): string {
  const selected = typeof node === 'string' ? project.nodes.find(item => item.id === node) : node;
  const passage = selected?.kind === 'passage' ? selected : project.nodes.find(item => item.kind === 'passage' && item.next === selected?.id);
  if (passage?.kind !== 'passage') throw new Error('Ending fixture has no performance');
  const texts = (action: StageAction): string[] => action.kind === 'visual' ? [...(action.content === 'text' ? [action.text] : []), ...(action.children ?? []).flatMap(texts)] : [];
  return expandPreviewActions(project, passage.lines.flatMap(line => line.actions), previewActionContext(project)).flatMap(texts).join('\n');
}

/** The caption is a normal master-layer object; it has no dedicated screen. */
export function endingVisible(project: Project, node: StoryNode | string): string {
  const caption = JSON.stringify(endingCaption(project, node));
  return `${caption} in vns_test_ending_texts()`;
}

export const endingTestHelper = `init python:
    def vns_test_ending_texts():
        result = []
        displayable = renpy.game.context().scene_lists.get_displayable_by_tag("master", "vn_visual_ending_title")
        def collect(child):
            if isinstance(child, renpy.text.text.Text):
                result.append(child.get_all_text())
        if displayable is not None:
            displayable.visit_all(collect)
        return result
`;
