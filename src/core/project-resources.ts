import type { BlueprintGraph, Project } from './model';

/** Both resource types share the execution graph format, but have separate libraries. */
export const isTimelineResource = (graph?: BlueprintGraph) => !!graph && (!!graph.timeline || graph.timelineComponent === true);
type GraphLibrary = Pick<Project, 'blueprints'> & Partial<Pick<Project, 'timelinePresets'>>;

export function projectGraphs(project?: GraphLibrary): BlueprintGraph[] {
  if (!project) return [];
  return project.timelinePresets?.length ? [...project.blueprints, ...project.timelinePresets] : project.blueprints;
}

export const blueprintResources = (project: GraphLibrary) => project.blueprints.filter(graph => !isTimelineResource(graph));
export const timelineResources = (project: GraphLibrary) => projectGraphs(project).filter(isTimelineResource);
export const graphResourceKey = (graph: BlueprintGraph) => `${isTimelineResource(graph) ? 'timeline' : 'blueprint'}:${graph.id}`;

export function setProjectGraphs(project: Project, graphs: BlueprintGraph[]) {
  project.blueprints = graphs.filter(graph => !isTimelineResource(graph));
  project.timelinePresets = graphs.filter(isTimelineResource);
  const state = project.contentBrowser;
  if (!state) return;
  const replacements = new Map(graphs.map(graph => [`${isTimelineResource(graph) ? 'blueprint' : 'timeline'}:${graph.id}`, graphResourceKey(graph)]));
  if (!Object.keys(state.assignments).some(key => replacements.has(key)) && !state.favorites.some(key => replacements.has(key))) return;
  project.contentBrowser = { ...state, assignments: { ...state.assignments }, favorites: [...new Set(state.favorites.map(key => replacements.get(key) ?? key))] };
  for (const [before, after] of replacements) if (state.assignments[before]) {
    project.contentBrowser.assignments[after] ??= state.assignments[before];
    delete project.contentBrowser.assignments[before];
  }
}

export function addProjectGraphs(project: Project, ...graphs: BlueprintGraph[]) {
  setProjectGraphs(project, [...projectGraphs(project), ...graphs]);
}

/** Keep preview overrides in the resource's original library. */
export function withProjectGraphs<T extends Project>(project: T, graphs: BlueprintGraph[]): T {
  const result = { ...project };
  setProjectGraphs(result, graphs);
  return result;
}

export function normalizeProjectResources(project: Project) {
  const changed = project.blueprints.some(isTimelineResource) || !project.timelinePresets || project.timelinePresets.some(graph => !isTimelineResource(graph));
  if (changed) setProjectGraphs(project, projectGraphs(project));
  return changed;
}
