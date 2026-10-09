import { projectGraphs, addProjectGraphs } from './project-resources';
import { actionSchema, makeId, type Project, type StageAction } from './model';
import { argumentText, argumentTokens, bindArguments } from './text-arguments';
import { parameter } from './command-parameters';
import { availableBlueprintName, blueprintCallName } from './blueprint-names';
import { chapterBlueprintPair, createChapterPerformance } from './chapter-performances';

type Chapter = Extract<StageAction, { kind: 'chapter' }>;
const oldParameters = [parameter('标题', 'text', ''), parameter('副标题', 'text', ''), parameter('时长', 'number', '', undefined, ['秒数'])];
/** Only the file migration accepts the retired syntax. The authoring parser does not. */
function readTitle(text: string): Chapter {
  const positional = /[|｜]/.test(text) && !argumentTokens(text, true).some(token => token.name !== undefined);
  const raw = positional ? text.split(/[|｜]/).map(value => value.trim()) : bindArguments(text, oldParameters).values;
  const values = raw.map(value => positional ? (value ?? '').replace(/^["“「]|["”」]$/g, '') : argumentText(value));
  const duration = !values[2] ? 2.5 : Number(values[2]);
  if (!Number.isFinite(duration) || duration < 0) throw new Error('旧章节时长无效，原工程已保留。');
  return { kind: 'chapter', title: values[0] ?? '', subtitle: values[1] ?? '', duration };
}

export function migrateLegacyChapters(project: Project): boolean {
  let changed = false;
  const graphs = new Map<string, string>();
  const convert = (chapter: Chapter) => {
    const key = JSON.stringify(chapter);
    let id = graphs.get(key);
    if (!id) {
      const source = createChapterPerformance(project, chapter.titleImageId ? 'image' : 'text', chapter);
      source.id = makeId('chapter'); source.name = availableBlueprintName(project, '章节进入演出'); delete source.callName;
      const pair = chapterBlueprintPair(source, projectGraphs(project).map(graph => graph.id));
      addProjectGraphs(project, ...pair); id = pair[0].id; graphs.set(key, id);
    }
    changed = true;
    return { kind: 'blueprint' as const, blueprintId: id };
  };
  // normalizeChapterPerformances has already retained node and line identities.
  for (const node of project.nodes) if (node.kind === 'passage') for (const line of node.lines) {
    line.actions = line.actions.map(action => action.kind === 'chapter' ? convert(action) : action);
  }
  const script = project.scriptText;
  if (!script || !/^\s*[@／/]\s*章节(?:标题|背景|题图|配乐|动效|演出)\s*[:：]/m.test(script.content)) return changed;
  const rows = script.content.split(/\r?\n/), output: string[] = [];
  const command = (row: string) => row.match(/^(\s*)[@／/]\s*(章节标题|章节背景|章节题图|章节音效|章节动效|独立演出|演出设置|演出转场)\s*(?:[:：]\s*(.*))?$/);
  for (let index = 0; index < rows.length; index++) {
    const encoded = rows[index].match(/^(\s*)[@／/]\s*章节演出\s*[:：]\s*(.*)$/);
    if (encoded) {
      const chapter = actionSchema.parse(JSON.parse(encoded[2]));
      if (chapter.kind !== 'chapter') throw new Error('旧章节演出数据无效，原工程已保留。');
      const action = convert(chapter), graph = projectGraphs(project).find(graph => graph.id === action.blueprintId)!;
      output.push(`${encoded[1]}@${blueprintCallName(graph)}【${graph.id}】`); continue;
    }
    const match = command(rows[index]);
    if (!match || match[2] !== '章节标题') { output.push(rows[index]); continue; }
    const chapter = readTitle(match[3] ?? ''), trailing: string[] = [];
    let declaration: string | undefined;
    for (; index + 1 < rows.length; index++) {
      const next = rows[index + 1], part = command(next);
      if (!next.trim() || /^\s*\/\//.test(next)) { trailing.push(next); continue; }
      if (!part || part[2] === '章节标题') break;
      if (part[2] === '独立演出') { declaration = next; index++; break; }
      if (part[2] === '演出设置' || part[2] === '演出转场') { trailing.push(next); continue; }
      const value = argumentText(argumentTokens(part[3] ?? '', true)[0]?.raw ?? part[3] ?? '');
      if (part[2] === '章节动效') {
        const effects: Record<string, Chapter['effect']> = { 默认: undefined, 无: 'none', 淡入淡出: 'fade', 笔触消散: 'ink', none: 'none', fade: 'fade', ink: 'ink' };
        if (!(value in effects)) throw new Error('旧章节动效无效，原工程已保留。');
        chapter.effect = effects[value];
      } else {
        const ref = value.match(/^(.*?)【([a-z][a-z0-9_]{0,63})】$/);
        const asset = project.assets.find(asset => ref ? asset.id === ref[2] : asset.name === value || asset.id === value);
        if (value && value !== '无' && !asset) throw new Error(`旧章节素材不存在：${value}。原工程已保留。`);
        chapter[part[2] === '章节背景' ? 'backgroundId' : part[2] === '章节题图' ? 'titleImageId' : 'soundId'] = asset?.id;
      }
    }
    const action = convert(chapter), graph = projectGraphs(project).find(graph => graph.id === action.blueprintId)!;
    output.push(`${match[1]}@${blueprintCallName(graph)}【${graph.id}】`, ...trailing, declaration ?? `${match[1]}@独立演出：${chapter.title.replace(/[\r\n]/g, ' ').slice(0, 120) || '章节进入演出'}`);
  }
  script.content = output.join(script.content.includes('\r\n') ? '\r\n' : '\n');
  return true;
}
