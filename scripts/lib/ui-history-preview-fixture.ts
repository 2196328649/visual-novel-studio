import { createUiVoicePreviewFixture } from './ui-voice-preview-fixture';
import { createUiEventGraph } from '../../src/core/ui-logic';
export { writeUiVoicePreviewAudio as writeUiHistoryAudio } from './ui-voice-preview-fixture';

export function createUiHistoryFixture(native = false) {
 const {project,graph}=createUiVoicePreviewFixture();project.name=native?'标准历史交互验收':'历史与收藏交互验收';project.width=1280;project.height=720;
 project.blueprints=[graph];project.ui.customPages=[];createUiEventGraph(project,'ui:main','标题');
 const passage=project.nodes.find(n=>n.kind==='passage')!;passage.name='测试对白段落';
 passage.lines.push({id:'unvoiced',text:'没有语音的旁白，不应出现试听按钮。',actions:[]},{id:'duplicate_voice',text:'同一语音的另一条记录',voiceId:'voice_0',actions:[]},{id:'silent_line',text:'静默标记不进入历史',silent:true,voiceId:'voice_1',actions:[]});
 project.ui.components=project.ui.components.filter(c=>c.page==='messageBox'||c.page==='voiceCollection');
 project.ui.components.push({id:'open_history',kind:'button',page:'main',text:'打开对话历史',action:'history',x:.2,y:.2,width:.6,height:.15},
  {id:'history_favorites',kind:'button',page:'history',text:'打开语音收藏',action:'voiceCollection',x:native?.62:.35,y:.025,width:.2,height:.065},
  {id:'history_confirm',kind:'button',page:'history',text:'历史内确认',action:'blueprint',blueprintId:graph.id,x:.04,y:native?.035:.91,width:.2,height:.065},
  {id:'favorites_history',kind:'button',page:'voiceCollection',text:'返回历史',action:'history',x:.62,y:.025,width:.2,height:.065});
 if(native){project.ui.pages!.history={layout:'native'};project.ui.pages!.voiceCollection={layout:'native'};project.ui.components=project.ui.components.filter(c=>c.page!=='voiceCollection'||c.id==='favorites_history');}
 else{
  project.ui.pages!.history={layout:'custom',background:'#15252f'};
  project.ui.components.push({id:'history_list',kind:'historyList',page:'history',text:'',x:.04,y:.12,width:.92,height:.75,style:{fontSize:28,textColor:'#eeeeee'},list:{historyLayout:'columns',historyNameWidth:140,voiceButtonSize:64,gapX:12,gapY:12}},
   {id:'history_back',kind:'button',page:'history',text:'返回标题',action:'return',x:.72,y:.91,width:.24,height:.065});
  const list=project.ui.components.find(c=>c.id==='voice_list')!;list.y=.13;list.height=.72;list.list!.rows=3;list.list!.itemHeight=120;list.list!.caption={x:.02,y:0,width:.75,height:1};
 }
 return project;
}
