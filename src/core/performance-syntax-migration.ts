import { projectGraphs } from './project-resources';
import type { Project } from './model';
import { resolveBlueprintCall } from './blueprint-names';
import { availablePerformanceBlueprints } from './builtin-performances';

/** Persist the formerly implicit boundaries once when an old file is loaded. */
export function migrateImplicitPerformances(project: Project): boolean {
  const script = project.scriptText;
  if (!script || script.performanceSyntax === 'explicit') return false;
  const graphs = availablePerformanceBlueprints(project);
  const output: string[] = [];
  let pending: string | undefined;
  const flush = () => { if (pending) output.push('@独立演出：' + pending); pending = undefined; };
  for (const row of script.content.split(/\r?\n/)) {
    const trimmed = row.trim();
    const command = trimmed.match(/^[@／/]\s*([^:：]+?)(?:\s*[:：](.*))?$/);
    if (command?.[1] === '独立演出') pending = undefined;
    else if (command) {
      const graph = resolveBlueprintCall(graphs, command[1]);
      const oldChapterPreset = graph?.chapterVariant && !projectGraphs(project).some(item => item.id === graph.id);
      if (graph && (graph.performanceKind === 'standalone' || oldChapterPreset)) { flush(); pending = graph.name; }
      else if (/^(?:节点标记|对白标记|开始|返回|选择|返回标题界面|返回标题|跳转|调用|设置|条件|实例|节点实例)$/.test(command[1])) flush();
    } else if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith(';')) flush();
    output.push(row);
  }
  flush();
  script.content = output.join(script.content.includes('\r\n') ? '\r\n' : '\n');
  script.performanceSyntax = 'explicit';
  return true;
}
