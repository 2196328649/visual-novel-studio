import { createProject } from '../../src/core/model';

export function aiUiPageSelectionFixture(){
 const project=createProject('当前界面页面 AI 验收');
 project.ui.pages={preferences:{layout:'custom',background:'#18212a'}};
 project.ui.instances=[{id:'parent',name:'同名方案',components:[]},{id:'child',name:'同名方案',baseUiId:'parent',components:[],pages:{preferences:{layout:'custom',background:'#28313a'}}}];
 project.ui.activeInstanceId='child';
 project.ui.customPages=[{id:'first',name:'同名页面',modal:true,background:'#102030',components:[]},{id:'second',name:'同名页面',modal:false,background:'#405060',components:[]}];
 return project;
}
