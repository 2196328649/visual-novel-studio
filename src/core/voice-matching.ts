export interface VoiceFile { key: string; name: string; text?: string; speaker?: string; lineId?: string }
export interface VoiceMatchCandidate { file: VoiceFile; score: number; exact: boolean; reason: string }
export const normalizedVoiceText = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function dice(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = (value: string) => new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
  const left = pairs(a), right = pairs(b);
  return 2 * [...left].filter(value => right.has(value)).length / (left.size + right.size);
}
export function voiceCandidates(line: { id: string; text: string; speaker?: string }, files: VoiceFile[], limit = 4): VoiceMatchCandidate[] {
  const text = normalizedVoiceText(line.text), speaker = normalizedVoiceText(line.speaker ?? '');
  if (!text) return [];
  return files.flatMap(file => {
    if (file.lineId && file.lineId !== line.id) return [];
    const stated = normalizedVoiceText(file.speaker ?? '');
    if (stated && speaker && stated !== speaker) return [];
    const name = normalizedVoiceText(file.name), transcript = file.text ? normalizedVoiceText(file.text) : undefined;
    const sameSpeaker = !!speaker && (stated === speaker || name.includes(speaker));
    const idToken = new RegExp('(^|[^a-z0-9])' + line.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^a-z0-9])', 'i');
    if ((file.lineId === line.id || idToken.test(file.name)) && (!transcript || transcript === text)) return [{ file, score: 1, exact: true, reason: '稳定台词标识一致' }];
    if (transcript === text && (text.length >= 4 || sameSpeaker)) return [{ file, score: 1, exact: true, reason: '配音文本一致' }];
    if (name.includes(text) && (text.length >= 4 || sameSpeaker)) return [{ file, score: .98, exact: true, reason: '文件名含完整台词' }];
    const content = transcript ?? name.replace(speaker, '').replace(/^\d+|\d+$/g, '');
    const score = dice(text, content) * .92 + (sameSpeaker ? .04 : 0);
    return score >= .42 ? [{ file, score: Math.min(.96, score), exact: false, reason: '文本相近，需结合上下文核对' }] : [];
  }).sort((a, b) => b.score - a.score || a.file.key.localeCompare(b.file.key, 'zh-CN', { numeric: true })).slice(0, limit);
}
