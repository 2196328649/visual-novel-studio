import { createProject } from '../../src/core/model';
import { createUiEventGraph, ensureUiButtonEvent, ensureUiTextCommittedEvent } from '../../src/core/ui-logic';

export function uiEventSchemeFixture() {
 const project=createProject('继承界面事件隔离验收');project.ui.pages={preferences:{layout:'custom'}};
 project.variables.push({id:'level',name:'进度',type:'number',initial:.25,persistent:false},{id:'input_text',name:'输入内容',type:'string',initial:'原文',persistent:false});
 project.ui.components=[{id:'trigger',name:'控制按钮',kind:'button',page:'preferences',text:'按钮',x:.1,y:.1,width:.35,height:.1},
  {id:'slider',name:'进度滑块',kind:'preference',page:'preferences',text:'进度',parameterId:'level',x:.1,y:.3,width:.7,height:.12},
  {id:'input',name:'文字输入',kind:'preference',page:'preferences',text:'输入内容',parameterId:'input_text',x:.1,y:.5,width:.7,height:.1}];
 project.ui.instances=[{id:'parent',name:'父方案',components:[]},{id:'child',name:'子方案',baseUiId:'parent',components:[]},{id:'sibling',name:'兄弟方案',baseUiId:'parent',components:[]}];
 project.ui.activeInstanceId='parent';const parent=createUiEventGraph(project,'ui:preferences','父方案设置');
 ensureUiButtonEvent(project,parent,'trigger','ui:preferences','hover');ensureUiTextCommittedEvent(project,parent,'input','ui:preferences');
 project.ui.activeInstanceId='child';return {project,parent};
}
