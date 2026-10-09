import { addProjectGraphs, projectGraphs, setProjectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph } from '../src/core/blueprint';
import { createUiEventGraph } from '../src/core/ui-logic';
import { addTimelineComponent } from '../src/core/timeline-component';
import { findTimelinePath, validTimelineVisits } from '../src/core/timeline-navigation';

function fixture() {
  const project = createProject(), root = createUiEventGraph(project, 'ui:main', '标题页');
  const { timeline, node } = addTimelineComponent(project, root.id);
  const child = createBlueprintGraph('effect', '内部时间轴'); child.timelineComponent = true;
  const call = blueprintNodeDefaults('callFunction'); call.properties.graphId = child.id;
  timeline.nodes.push(call); addProjectGraphs(project, child);
  const visits = [{ graphId: timeline.id, callNodeId: node.id }, { graphId: child.id, callNodeId: call.id }];
  return { project, root, timeline, node, call, child, visits };
}

test('UI timeline navigation retains exact call identity and truncates removed or retargeted calls', () => {
  const { project, root, node, call, child, visits } = fixture();
  assert.deepEqual(validTimelineVisits(project, root.id, visits), visits);
  const duplicate = structuredClone(call); duplicate.id += '_second';
  projectGraphs(project).find(g => g.id === visits[0].graphId)!.nodes.push(duplicate);
  call.properties.graphId = 'missing';
  assert.deepEqual(validTimelineVisits(project, root.id, visits), visits.slice(0, 1));
  call.properties.graphId = child.id;
  root.nodes = root.nodes.filter(n => n.id !== node.id);
  assert.deepEqual(validTimelineVisits(project, root.id, visits), []);
  assert.deepEqual(validTimelineVisits(project, undefined, visits), []);
});

test('UI timeline navigation unwinds deleted components and prevents recursive navigation', () => {
  const { project, root, timeline, child, visits } = fixture();
  const back = blueprintNodeDefaults('callFunction'); back.properties.graphId = timeline.id; child.nodes.push(back);
  assert.deepEqual(validTimelineVisits(project, root.id, [...visits, { graphId: timeline.id, callNodeId: back.id }]), visits);
  child.timelineComponent = false;
  assert.deepEqual(validTimelineVisits(project, root.id, visits), visits.slice(0, 1));
  setProjectGraphs(project, projectGraphs(project).filter(g => g.id !== timeline.id));
  assert.deepEqual(validTimelineVisits(project, root.id, visits), []);
});


test('nested selection follows real timeline calls, tolerates cycles and never invents a path',()=>{
 const {project,root,timeline,child,call,visits}=fixture(),before=structuredClone(project);
 assert.deepEqual(findTimelinePath(project,root.id,child.id),visits);assert.deepEqual(project,before);
 assert.deepEqual(findTimelinePath(project,root.id,root.id),[]);assert.equal(findTimelinePath(project,'missing',child.id),undefined);
 const back=blueprintNodeDefaults('callFunction');back.properties.graphId=timeline.id;child.nodes.push(back);
 assert.equal(findTimelinePath(project,root.id,'missing'),undefined);
 call.properties.graphId='missing';assert.equal(findTimelinePath(project,root.id,child.id),undefined);
 call.properties.graphId=child.id;child.timelineComponent=false;assert.equal(findTimelinePath(project,root.id,child.id),undefined);
});
