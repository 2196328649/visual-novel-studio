import type { Project, UiComponent } from './model';
import { storyVoiceLogEntries, voiceVisitKey } from './story-menu';
import { toggleVoiceFavorite, type VoicePreviewState } from './voice-preview';

export interface HistoryPreviewSource { nodeId?: string; empty?: boolean }
export type HistoryPreviewAction = { action: 'play' | 'favorite'; lineId: string };

/** Authoring samples, not a simulated player route or a real save's history. */
export function historyPreviewEntries(project: Project, source: HistoryPreviewSource = {}) {
 if (source.empty) return [];
 const nodes = project.nodes.filter(n => n.kind === 'passage' && (!source.nodeId || n.id === source.nodeId));
 return nodes.flatMap(node => node.kind === 'passage' ? node.lines.filter(line => !line.silent).map(line => ({ ...line, nodeId: node.id })) : []).slice(source.nodeId ? -250 : -20);
}

export function historyPreviewView(project: Project, state: VoicePreviewState, source: HistoryPreviewSource = {}, unlocks?: readonly string[]) {
 const voices = storyVoiceLogEntries(project);
 return historyPreviewEntries(project, source).map(line => {
  const voiceKey = voiceVisitKey(line.nodeId, line.id), voice = voices.find(v => v.id === voiceKey), speaker = project.characters.find(c => c.id === line.speakerId);
  return { ...line, speaker: speaker?.name ?? '', speakerColor: speaker?.color, voiceId: line.voiceId, voiceKey, available: !!voice && (!unlocks || unlocks.includes(voice.assetId)), favorite: !!voice && state.favorites.includes(voiceKey), playing: !!voice && state.playback?.entryId === voiceKey };
 });
}

export function historyPreviewAction(project: Project, component: UiComponent, state: VoicePreviewState, source: HistoryPreviewSource, action: HistoryPreviewAction, unlocks?: readonly string[], characterGain = 1): VoicePreviewState {
 if (component.kind !== 'historyList') return state;
 const entry = historyPreviewView(project, state, source, unlocks).find(line => line.id === action.lineId);
 if (!entry?.available || !entry.voiceId) return state;
 if (action.action === 'play') return { ...state, serial: state.serial + 1, playback: { assetId: entry.voiceId, entryId: entry.voiceKey, requestId: state.serial + 1, characterGain } };
 const log = storyVoiceLogEntries(project).find(log => log.id === entry.voiceKey)!;
 return toggleVoiceFavorite(state, log);
}
