import { validateProject } from '../src/core/validate';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { aiDraftProjectSchema } from '../src/core/ai-draft-schema';
import { prepareAiChanges, applyAiChanges } from '../src/core/ai';
const fixture=()=>{const p=createProject();p.ui.components.push({id:'unfinished',kind:'button',page:'main',text:'按钮',action:'blueprint',x:0,y:0,width:.2,height:.1});return p;};
test('AI can inspect incomplete UI fields but structural constraints remain enforced',()=>{
 const p=fixture();assert.equal(projectSchema.safeParse(p).success,false);assert.deepEqual(aiDraftProjectSchema.parse(p),p);
 const invalid=structuredClone(p);(invalid.ui.components[0] as any).width='wide';assert.equal(aiDraftProjectSchema.safeParse(invalid).success,false);
 p.ui.instances=[{id:'instance',name:'方案',components:structuredClone(p.ui.components)}];p.ui.customPages=[{id:'page',name:'自定义',components:structuredClone(p.ui.components),modal:true}];assert.equal(aiDraftProjectSchema.safeParse(p).success,true);
});
test('AI repairs incomplete UI through checked edits and rejects stale or still-invalid results',()=>{
 const p=fixture(),before=structuredClone(p);const changes=prepareAiChanges(p,[{kind:'editProject',path:['ui','components',{id:'unfinished'},'action'],action:'set',value:'start'}],[]);
 const repaired=applyAiChanges(p,changes);assert.equal(projectSchema.safeParse(repaired).success,true);assert.equal(repaired.ui.components[0].action,'start');assert.deepEqual(p,before);
 assert.throws(()=>prepareAiChanges(p,[{kind:'editProject',path:['name'],action:'set',value:'未修复'}],[]));
 p.ui.components[0].text='手动新值';assert.throws(()=>applyAiChanges(p,changes),/发生变化/);
});
test('empty AI replies can explain and offer checks without trying to validate an unchanged incomplete draft',()=>{
 const p=fixture();assert.deepEqual(prepareAiChanges(p,[],[]),[]);assert.equal(p.ui.components[0].action,'blueprint');
});

test('incomplete parameter UI reports cross-field diagnostics with component location',()=>{
 const p=createProject();p.ui.components.push({id:'missing_setting',kind:'preference',page:'preferences',text:'设置',x:0,y:0,width:.2,height:.1});
 const issue=validateProject(p).find(i=>i.message==='请选择玩家设置或参数。');assert.ok(issue);assert.equal(issue.ui?.componentId,'missing_setting');assert.equal(issue.ui?.page,'preferences');
 p.ui.components[0].preference='musicVolume';assert.equal(validateProject(p).some(i=>i.message==='请选择玩家设置或参数。'),false);
 const button=fixture();assert.equal(validateProject(button).filter(i=>i.message==='界面按钮调用的蓝图不存在。').length,1);
});
