import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { createBlueprintGraph, blueprintNodeDefaults, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { mutateProject } from '../src/core/project-mutation';
import { BlueprintDiagnosticCache } from '../src/renderer/blueprint-diagnostics';

test('layout changes reuse diagnostics; semantic edits still match complete validation', () => {
  const project = createProject(), graph = createBlueprintGraph('function','诊断缓存');
  const variable=blueprintNodeDefaults('getVariable');variable.properties.variableId='missing';graph.nodes.push(variable);project.blueprints.push(graph);synchronizeBlueprintSignatures(project);
  const cache = new BlueprintDiagnosticCache({assumeImmutable:true});
  const initial=cache.update(project);assert.deepEqual(initial,validateBlueprints(project));assert.ok(initial.length);
  const moved=mutateProject(project,draft=>{draft.blueprints[0].nodes[1].x+=150;});
  assert.equal(cache.update(moved),initial);
  const fixed=mutateProject(moved,draft=>{draft.variables.push({id:'missing',name:'新增状态',type:'number',initial:0,persistent:false});synchronizeBlueprintSignatures(draft);});
  assert.deepEqual(cache.update(fixed),validateBlueprints(fixed));assert.notEqual(cache.update(fixed),initial);
  const broken=mutateProject(fixed,draft=>{draft.blueprints[0].nodes[1].properties.variableId='another_missing';});
  assert.deepEqual(cache.update(broken),validateBlueprints(broken));
});

test('default diagnostic caching notices mutable input edits and graph removal', () => {
  const project=createProject(),graph=createBlueprintGraph('function','可变导入');project.blueprints.push(graph);
  const cache=new BlueprintDiagnosticCache();const before=cache.update(project);
  graph.nodes.push(blueprintNodeDefaults('getInput'));assert.deepEqual(cache.update(project),validateBlueprints(project));assert.notEqual(cache.update(project),before);
  project.blueprints=[];assert.deepEqual(cache.update(project),validateBlueprints(project));
});
