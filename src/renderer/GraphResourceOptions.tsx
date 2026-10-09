import type { BlueprintGraph, Project } from '../core/model';
import { isTimelineResource } from '../core/project-resources';
import { blueprintGroup } from '../core/blueprint-authoring';

export function GraphResourceOptions({ project, graphs, prefix = '', paths = false }: { project: Project; graphs: BlueprintGraph[]; prefix?: string; paths?: boolean }) {
  return <>{([false, true] as const).map(timeline => {
    const choices = graphs.filter(graph => isTimelineResource(graph) === timeline);
    return choices.length ? <optgroup key={String(timeline)} label={timeline ? '时间轴预设' : '蓝图'}>{choices.map(graph => <option key={graph.id} value={prefix + graph.id}>{paths && blueprintGroup(project, graph.id) ? blueprintGroup(project, graph.id) + ' / ' : ''}{graph.name}</option>)}</optgroup> : null;
  })}</>;
}
