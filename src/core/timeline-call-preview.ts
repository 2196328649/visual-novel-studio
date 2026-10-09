import { projectGraphs, withProjectGraphs } from './project-resources';
import type { Project, VariableValue } from './model';
import { expandPreviewActions, previewActionContext } from './preview-actions';

export interface TimelinePreviewParent { graphId: string; callNodeId?: string }

/** Preview a child with the selected caller's values without changing its reusable defaults. */
export function timelineCallPreviewProject(project: Project, graphId: string, parents: TimelinePreviewParent[], rootInputs: Record<string, VariableValue> = {}) {
  let inputs = rootInputs;
  let variables = previewActionContext(project).variables;
  for (const [index, parent] of parents.entries()) {
    const targetId = parents[index + 1]?.graphId ?? graphId;
    const call = projectGraphs(project).find(graph => graph.id === parent.graphId)?.nodes.find(node => node.id === parent.callNodeId);
    if (!call || call.properties.graphId !== targetId) { inputs = {}; continue; }
    const context = previewActionContext(project);
    context.variables = { ...variables };
    context.captureBlueprintCall = { graphId: parent.graphId, nodeId: call.id };
    expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: parent.graphId, inputs }], context);
    inputs = context.captureBlueprintCall.inputs ?? {};
    variables = context.variables;
  }
  if (!Object.keys(inputs).length && project.variables.every(variable => variable.initial === variables[variable.id])) return project;
  return withProjectGraphs({ ...project, variables: project.variables.map(variable => ({ ...variable, initial: variables[variable.id] ?? variable.initial })) }, projectGraphs(project).map(graph => graph.id === graphId ? { ...graph,
      exposedInputs: graph.exposedInputs.map(pin => inputs[pin.id] === undefined ? pin : { ...pin, defaultValue: inputs[pin.id] }),
    } : graph));
}
