import { connectNode, targets, type Project } from '../../src/core/model';
import { editablePerformanceTarget } from '../../src/core/performance-workspace';
import { normalizeChapterPerformances, standaloneChapter } from '../../src/core/standalone-performance';
import { projectToText } from '../../src/core/text-script';
import { consolidateChapterPresets } from '../../src/core/chapter-preset-catalog';

/** Keep the generated example on the same authoring workflow as new stories. */
export function prepareAihongAuthoring(project: Project) {
  const progressId = 'ai_chapter_progress', progressSet = 'ai_progress_parameters';
  const endings = [
    { id: 'ai_ending_shelter', name: '灯火暂安', assetId: 'ai_story_shelter' },
    { id: 'ai_ending_dream', name: '惊梦未醒', assetId: 'ai_story_street' },
    { id: 'ai_ending_boat', name: '远舟', assetId: 'ai_story_boat' },
  ];
  project.parameterSets ??= [];
  if (!project.parameterSets.some(set => set.id === progressSet)) project.parameterSets.push({ id: progressSet, name: '剧情进度', kind: 'story' });
  if (!project.variables.some(variable => variable.id === progressId)) project.variables.push({ id: progressId, name: '章节进度', type: 'number', initial: 0, persistent: true, parameterSetId: progressSet });
  for (const ending of endings) if (!project.variables.some(variable => variable.id === ending.id + '_reached')) project.variables.push({
    id: ending.id + '_reached', name: ending.name + '达成', type: 'boolean', initial: false, persistent: true, parameterSetId: progressSet,
  });
  normalizeChapterPerformances(project);
  for (const nodeId of ['ai_title_one', 'ai_title_two']) {
    const node = project.nodes.find(node => node.id === nodeId);
    const chapter = standaloneChapter(node);
    if (chapter) { delete chapter.soundId; editablePerformanceTarget(project, { nodeId }); }
  }
  for (const [index, chapterId] of ['ai_title_one', 'ai_title_two'].entries()) {
    const chapter = project.nodes.find(node => node.id === chapterId);
    const recordId = chapterId + '_record_progress';
    if (chapter?.kind !== 'passage' || project.nodes.some(node => node.id === recordId)) continue;
    project.nodes.splice(project.nodes.indexOf(chapter) + 1, 0, {
      id: recordId, name: chapter.name + ' · 记录进度', sceneId: chapter.sceneId, x: chapter.x + 180, y: chapter.y, textHeading: false,
      kind: 'set', variableId: progressId, operation: 'set', value: index + 1,
      when: { kind: 'compare', variableId: progressId, operator: 'lt', value: index + 1 }, next: chapter.next,
    });
    chapter.next = recordId;
  }
  for (const ending of endings) {
    const performance = project.nodes.find(node => node.id === ending.id);
    if (performance?.kind !== 'passage') continue;
    const recordId = ending.id + '_record_reached';
    if (!project.nodes.some(node => node.id === recordId)) {
      // Every route records its own ending, so another ending cannot unlock it.
      project.nodes = project.nodes.map(node => targets(node).filter(port => port.target === performance.id).reduce((node, port) => connectNode(node, port.port, recordId), node));
      if (project.entryId === performance.id) project.entryId = recordId;
      project.nodes.splice(project.nodes.findIndex(node => node.id === performance.id), 0, {
        id: recordId, name: ending.name + ' · 记录达成', sceneId: performance.sceneId, x: performance.x - 180, y: performance.y, textHeading: false,
        kind: 'set', variableId: ending.id + '_reached', operation: 'set', value: true, next: performance.id,
      });
    }
    for (const line of performance.lines) line.actions = line.actions.filter(action => action.kind !== 'unlock' || action.assetId !== ending.assetId);
  }
  const groups = project.ui.components.find(component => component.id === 'ai_gallery_items')?.list?.galleryGroups ?? [];
  for (const group of groups) {
    if (group.id === 'cg_ee6637a978bd5e88' || group.id === 'cg_1affe40f5e7d6214') group.unlockWhen = {
      kind: 'compare', variableId: progressId, operator: 'gte', value: group.id === 'cg_ee6637a978bd5e88' ? 1 : 2,
    };
    if (group.id === 'cg_edbf046353cd230d' || group.id === 'cg_016793a38697e585') group.unlockWhen = {
      kind: 'compare', variableId: 'ai_ending_boat_reached', operator: 'eq', value: true,
    };
  }
  for (const node of project.nodes) if (node.kind === 'jump' && node.sceneTransition && node.target) {
    node.sceneTransition.fromSceneId = node.sceneId;
    node.sceneTransition.toSceneId = project.nodes.find(target => target.id === node.target)?.sceneId;
  }
  consolidateChapterPresets(project);
  project.scriptText = { ...project.scriptText, format: 'vns-text-1', standaloneSyntax: 'module-names', performanceSyntax: 'explicit', content: projectToText(project) };
}
