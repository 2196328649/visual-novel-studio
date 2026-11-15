import { allUiComponents, type Project } from './model';

export interface StoryMenuEntry { id: string; name: string; nodeId?: string; styleId?: string; parts?: string[]; owner?: { kind: 'chapter' | 'scene' | 'node'; id: string }; title?: string; action?: 'replay' | 'inspect'; groupId?: string; memberIds?: string[]; callId?: string; targetId?: string; viewId?: string; sourceEntryId?: string }

/** Node text split by ｜ into parts that can each have their own font and size. */
export const flowCaptionParts = (text: string) => text.split('｜').map(part => part.trim()).filter(Boolean);

export function storyMenuEntries(project: Project, kind: 'chapterList' | 'flowchart'): StoryMenuEntry[] {
  if (kind === 'flowchart') {
    const entries = new Map<string, StoryMenuEntry>();
    const add = (nodeId: string | undefined, kind: 'chapter' | 'scene' | 'node', owner: { id: string; name: string; flowchart?: { name?: string; styleId?: string } }) => {
      if (!nodeId) return;
      const parts = flowCaptionParts(owner.flowchart?.name?.trim() || owner.name);
      entries.set(nodeId, { id: nodeId, nodeId, name: parts.join(' ') || owner.name, title: owner.name, owner: { kind, id: owner.id }, ...(parts.length > 1 ? { parts } : {}), ...(owner.flowchart?.styleId ? { styleId: owner.flowchart.styleId } : {}) });
    };
    const sceneEntry = (sceneId: string) => project.nodes.find(node => node.sceneId === sceneId && node.kind === 'start') ?? project.nodes.find(node => node.sceneId === sceneId);
    for (const chapter of project.chapters) if (chapter.flowchart?.visible !== false) {
      const scene = project.scenes.find(scene => scene.chapterId === chapter.id && sceneEntry(scene.id));
      add(scene && sceneEntry(scene.id)?.id, 'chapter', chapter);
    }
    for (const scene of project.scenes) if (scene.flowchart?.visible === true) add(sceneEntry(scene.id)?.id, 'scene', scene);
    for (const node of project.nodes) if (node.flowchart?.visible === true) add(node.id, 'node', node);
    return project.nodes.flatMap(node => entries.has(node.id) ? [entries.get(node.id)!] : []);
  }
  return project.chapters.map(chapter => {
    const scenes = project.scenes.filter(scene => scene.chapterId === chapter.id);
    const scene = scenes.find(scene => project.nodes.some(node => node.sceneId === scene.id));
    const start = project.nodes.find(node => node.sceneId === scene?.id && node.kind === 'start');
    const nodeId = start?.id ?? project.nodes.find(node => node.sceneId === scene?.id)?.id;
    return { id: chapter.id, name: chapter.name, nodeId };
  });
}

export function storyVoiceEntries(project: Project) {
  const lines = project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);
  const ids = new Set([...lines.flatMap(line => line.voiceId ? [line.voiceId] : []), ...allUiComponents(project).filter(component => component.kind === 'voiceCollection').flatMap(component => component.list?.assetIds ?? [])]);
  return project.assets.filter(asset => asset.kind === 'audio' && ids.has(asset.id)).map(asset => {
    const line = lines.find(line => line.voiceId === asset.id);
    const character = project.characters.find(character => character.id === line?.speakerId);
    return { ...asset, assetId: asset.id, text: line?.text ?? asset.name, caption: line ? `${character?.name ?? '旁白'}：${line.text.slice(0, 38)}` : asset.name, speakerId: character?.id ?? '' };
  });
}

export const voiceVisitKey = (nodeId: string, lineId: string) => `line:${nodeId}:${lineId}`;
export interface VoiceLogEntry { id: string; assetId: string; path: string; name: string; text: string; caption: string; speakerId: string }

/** A dialogue identity survives repeat visits and is independent of its audio file. */
export function storyVoiceLogEntries(project: Project): VoiceLogEntry[] {
  const assets = new Map(project.assets.filter(a => a.kind === 'audio').map(a => [a.id, a]));
  return project.nodes.flatMap(node => node.kind === 'passage' ? node.lines.flatMap(line => {
    const asset = line.voiceId && assets.get(line.voiceId);
    if (!asset || line.silent) return [];
    const speaker = project.characters.find(c => c.id === line.speakerId);
    return [{ id: voiceVisitKey(node.id, line.id), assetId: asset.id, path: asset.path, name: asset.name,
      text: line.text, caption: `${speaker?.name ?? '旁白'}：${line.text.slice(0, 38)}`, speakerId: speaker?.id ?? '' }];
  }) : []);
}
