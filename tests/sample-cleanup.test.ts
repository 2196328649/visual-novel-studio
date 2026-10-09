import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { simplifySample } from '../src/core/sample-cleanup';
import { ensureAssetAssignments, resourceFolderTrail } from '../src/core/asset-library';
import { availableUiPages } from '../src/core/ui-names';
import { createScreens } from '../src/runtime/screens';

test('sample cleanup preserves story and nested blueprint image references, removes unrelated gallery art and pages', () => {
  const project = createProject();
  project.ui.disabledPages = ['voiceCollection'];
  project.assets = ['story', 'nested', 'unused'].map(id => ({id, kind: 'image', name: id, path: 'assets/' + id + '.png'}));
  project.scenes[0].entryActions = [{kind:'background', assetId:'story', transition:'none'}];
  project.ui.components = [{id:'ai_gallery_items',page:'gallery',kind:'galleryGrid',text:'',x:0,y:0,width:1,height:1,list:{galleryGroups:[{id:'old',name:'Unrelated',assetIds:['unused']}]}},
    {id:'chapter_button',page:'main',kind:'button',action:'chapterSelect',text:'章节',x:0,y:0,width:1,height:1}];
  project.blueprints.push({id:'nested_graph',name:'nested',kind:'effect',nodes:[{id:'node',type:'comment',name:'',x:0,y:0,pins:[],properties:{json:'{"assetId":"nested"}'},collapsed:false}],links:[],exposedInputs:[],exposedOutputs:[]});
  const story = structuredClone(project.nodes);
  const result = simplifySample(project);
  assert.deepEqual(result.removedAssets.map(a=>a.id), ['unused']);
  assert.deepEqual(project.nodes, story);
  assert.deepEqual(project.ui.components[0].list?.galleryGroups?.[0].assetIds, ['story']);
  assert.equal(project.ui.components.some(c=>c.action==='chapterSelect'), false);
  assert.equal(availableUiPages(project.ui).some(([id])=>id==='chapterSelect'), false);
  const source = createScreens(project);
  assert.doesNotMatch(source, /^screen (?:chapter_select|voice_settings|staff_roll|vn_components_chapterSelect)\(/m);
  assert.equal(availableUiPages(project.ui).some(([id]) => id === 'voiceCollection'), true);
  assert.match(source, /^screen voice_collection\(/m);
  assert.match(source, /^screen main_menu\(/m);
  assert.match(source, /^screen confirm\(/m);
  assert.deepEqual(simplifySample(project).removedAssets, []);
});

test('missing asset assignments follow current disk directories rather than old import paths', () => {
  const project = createProject();
  project.assets = [{id:'asset',kind:'image',name:'背景',path:'assets/场景/雨天/街道.png',sourcePath:'original/mess/街道.png'}];
  ensureAssetAssignments(project);
  const trail = resourceFolderTrail(project,project.contentBrowser?.assignments['asset:asset']);
  assert.deepEqual(trail.map(f=>f.name), ['场景','雨天']);
  const before = structuredClone(project.contentBrowser);
  ensureAssetAssignments(project);
  assert.deepEqual(project.contentBrowser,before);
});
