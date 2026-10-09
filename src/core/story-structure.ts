import { makeId, type Project } from './model';
import { applyTextScript, projectToText, textReference, type TextParseResult } from './text-script';
import { textChapters } from './text-chapters';
import { textHeading } from './text-headings';

export function readStoryStructure(project: Project) {
  return applyTextScript(project, project.scriptText?.content ?? projectToText(project));
}

function headings(source: string, project: Project) {
  const result: { kind: '章节' | '小章节'; id?: string; start: number; end: number }[] = [];
  let chapterId: string | undefined = project.chapters[0]?.id;
  let definition = false;
  for (const match of source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    const row = match[0].replace(/[\r\n]+$/, '');
    if (/^\s*[@／/]?效果定义(?:\s*[:：]|\s)/.test(row)) definition = true;
    if (/^\s*[@／/]?效果结束\s*$/.test(row)) definition = false;
    const heading = !definition ? textHeading(row, true) : undefined;
    if (heading?.nameFrom === undefined || heading.kind === '段落') continue;
    const title = row.slice(heading.nameFrom), ref = title.trim().match(/^(.*?)【([a-z][a-z0-9_]{0,63})】$/);
    const name = (ref?.[1] ?? title).trim(), kind = heading.kind;
    const id = kind === '章节'
      ? project.chapters.find(item => ref ? item.id === ref[2] : item.name === name)?.id
      : project.scenes.find(item => ref ? item.id === ref[2] : item.name === name && item.chapterId === chapterId)?.id;
    if (kind === '章节') chapterId = id;
    result.push({ kind, id, start: match.index!, end: match.index! + row.length });
  }
  return result;
}

/** Edit source ranges so unrelated prose, comments and performance commands stay intact. */
export function deleteStorySection(project: Project, kind: 'chapter' | 'scene', id: string): TextParseResult {
  const parsed = readStoryStructure(project), before = parsed.project, source = before.scriptText!.content;
  const scenes = new Set(kind === 'chapter' ? before.scenes.filter(scene => scene.chapterId === id).map(scene => scene.id) : [id]);
  if (before.nodes.some(node => node.id === before.entryId && scenes.has(node.sceneId))) throw new Error('此目录包含故事入口，请先在作品设置中更换入口。');
  if ((kind === 'scene' && before.scenes.length <= 1) || (kind === 'chapter' && before.chapters.length <= 1)) throw new Error('请至少保留一个章节和小章节。');
  const all = headings(source, before), headingKind = kind === 'chapter' ? '章节' : '小章节';
  const ranges = all.flatMap((heading, index) => {
    if (heading.kind !== headingKind || heading.id !== id) return [];
    const boundary = all.slice(index + 1).find(next => kind === 'scene' || next.kind === '章节');
    return [{ start: heading.start, end: boundary?.start ?? source.length }];
  });
  if (!ranges.length) throw new Error('此目录没有独立的文本标题，请在文本编辑中删除对应内容。');
  let nextSource = source;
  for (const range of ranges.reverse()) nextSource = nextSource.slice(0, range.start) + nextSource.slice(range.end);
  // A text import can retain a visually authored scene referenced by a call.
  // Remove deleted objects from the parse base so a dangling call cannot bring
  // the deleted chapter back. Diagnostics retain the authored link for repair.
  before.nodes = before.nodes.filter(node => !scenes.has(node.sceneId));
  before.scenes = before.scenes.filter(scene => !scenes.has(scene.id));
  if (kind === 'chapter') before.chapters = before.chapters.filter(chapter => chapter.id !== id);
  return applyTextScript(before, nextSource);
}

export function addStorySection(project: Project, kind: 'chapter' | 'scene', name: string, ownerChapterId?: string) {
  const parsed = readStoryStructure(project), source = parsed.project.scriptText!.content;
  const chapterId = kind === 'chapter' ? makeId('chapter') : ownerChapterId ?? parsed.project.chapters[0]?.id;
  if (!chapterId) throw new Error('请先添加章节。');
  const sceneId = makeId('scene'), nodeId = makeId('passage'), lineId = makeId('line');
  const block = [
    ...(kind === 'chapter' ? [`# 章节：${textReference(name, chapterId)}`, ''] : []),
    `# 小章节：${textReference(kind === 'chapter' ? '开场' : name, sceneId)}`, '',
    `# 段落：${textReference('新段落', nodeId)}`, `@对白标记：${lineId}`, '旁白：', '@跳转：无', '',
  ].join('\n');
  const chapter = textChapters(source, parsed.project.chapters).filter(chapter => chapter.chapterId === chapterId).at(-1);
  const at = kind === 'chapter' ? source.length : chapter?.end ?? source.length;
  const result = applyTextScript(parsed.project, source.slice(0, at) + '\n\n' + block + '\n' + source.slice(at));
  return { ...result, sceneId, nodeId, lineId };
}

