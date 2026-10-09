import { projectGraphs } from './project-resources';
import type { Project } from './model';
import { timelineForNode } from './timeline-component';

export interface TimelineVisit { graphId: string; callNodeId: string }

/** Keep only visits still reachable through the exact calls used to enter them. */
export function validTimelineVisits(project: Project, rootId: string | undefined, visits: TimelineVisit[]): TimelineVisit[] {
  let owner = projectGraphs(project).find(graph => graph.id === rootId);
  const seen = new Set([rootId]);
  const valid: TimelineVisit[] = [];
  for (const visit of visits) {
    const child = timelineForNode(project, owner?.nodes.find(node => node.id === visit.callNodeId));
    if (!child || child.id !== visit.graphId || seen.has(child.id)) break;
    valid.push(visit); seen.add(child.id); owner = child;
  }
  return valid;
}

/** Resolve an actual call path so selecting a nested component can stay in its UI draft. */
export function findTimelinePath(project:Project,rootId:string|undefined,targetId:string):TimelineVisit[]|undefined {
 const visited=new Set<string>();
 const visit=(id:string):TimelineVisit[]|undefined=>{
  const graph=projectGraphs(project).find(g=>g.id===id);if(!graph||visited.has(id))return;
  if(id===targetId)return [];visited.add(id);
  for(const node of graph.nodes){const child=timelineForNode(project,node);if(!child)continue;const tail=visit(child.id);if(tail)return [{graphId:child.id,callNodeId:node.id},...tail];}
 };
 return rootId?visit(rootId):undefined;
}
