import type { Project, StageAction } from './model';
import { expandPreviewActions, previewActionContext } from './preview-actions';

export interface StorySearchEntry {
  key: string;
  sceneId: string;
  nodeId?: string;
  lineId?: string;
  label: string;
  context: string;
  kind: '小章节' | '段落' | '对白' | '选择' | '演出文字';
  searchText: string;
}

/** Build once per story revision, rather than walking every line on each key. */
export function storySearchIndex(project: Project): StorySearchEntry[] {
  const visualTexts = (action: StageAction): string[] => action.kind === 'visual'
    ? [...(action.content === 'text' && action.text.trim() ? [action.text] : []), ...(action.children ?? []).flatMap(visualTexts)] : [];
  const chapters = new Map(project.chapters.map(chapter => [chapter.id, chapter.name]));
  const speakers = new Map(project.characters.map(character => [character.id, character.name]));
  const nodes = new Map<string, Project['nodes']>();
  for (const node of project.nodes) {
    const group = nodes.get(node.sceneId) ?? [];
    group.push(node); nodes.set(node.sceneId, group);
  }
  const entries: StorySearchEntry[] = [];
  const add = (entry: Omit<StorySearchEntry, 'searchText'>, extra = '') => entries.push({ ...entry,
    searchText: `${entry.context} ${entry.label} ${extra}`.normalize('NFKC').toLocaleLowerCase() });
  for (const scene of project.scenes) {
    const context = [chapters.get(scene.chapterId), scene.name].filter(Boolean).join(' / ');
    add({ key: `scene:${scene.id}`, sceneId: scene.id, label: scene.name, context, kind: '小章节' });
    for (const node of nodes.get(scene.id) ?? []) {
      const location = { sceneId: scene.id, nodeId: node.id, context };
      const heading = node.textHeading === false ? '' : node.name;
      if (heading) add({ ...location, key: `node:${node.id}`, label: heading, kind: '段落' });
      if (node.kind === 'passage') for (const line of node.lines) {
        if (line.silent && line.actions.some(action => action.kind === 'visual' || action.kind === 'blueprint')) {
          const text = [...new Set(expandPreviewActions(project, line.actions, previewActionContext(project)).flatMap(visualTexts))].join('\n');
          if (text) add({ ...location, key: `performance:${line.id}`, lineId: line.id, label: text, kind: '演出文字' }, heading);
        }
        if (line.silent || !line.text.trim()) continue;
        const speaker = line.speakerId ? speakers.get(line.speakerId) ?? '' : '旁白';
        add({ ...location, key: `line:${line.id}`, lineId: line.id, label: `${speaker ? speaker + '：' : ''}${line.text}`, kind: '对白' }, heading);
      }
      if (node.kind === 'choice') add({ ...location, key: `choice:${node.id}`,
        label: [node.prompt, ...node.choices.map(choice => choice.text)].filter(Boolean).join(' / '), kind: '选择' }, heading);
    }
  }
  return entries;
}

export function searchStory(index: StorySearchEntry[], query: string, limit = 100) {
  const words = query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { entries: [], total: 0 };
  const entries: StorySearchEntry[] = [];
  let total = 0;
  for (const entry of index) if (words.every(word => entry.searchText.includes(word))) {
    total++;
    if (entries.length < limit) entries.push(entry);
  }
  return { entries, total };
}
