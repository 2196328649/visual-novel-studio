import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiConfirmPreviewFixture } from './ui-confirm-preview-fixture';

export function createUiVoicePreviewFixture(){
 const setup=createUiConfirmPreviewFixture(),{project}=setup;project.name='语音收藏预演验收';project.width=1920;project.height=1080;
 project.characters=[{id:'actor',name:'角色',color:'#ffffff',expressions:[]}];project.playerDefaults={masterVolume:.8,voiceVolume:.5,characterVolume:.6};
 const passage=project.nodes.find(node=>node.kind==='passage')!;
 passage.lines=Array.from({length:13},(_,index)=>({id:'voice_line_'+index,speakerId:'actor',text:index===0?'[name] {b} 长句 '.repeat(20):`第 ${index+1} 条语音`,voiceId:'voice_'+index,actions:[]}));
 project.assets=passage.lines.map((line,index)=>({id:line.voiceId!,kind:'audio' as const,category:'voice' as const,name:'测试语音 '+(index+1),path:'assets/voice_'+index+'.wav'}));
 project.ui.components.push({id:'open_voices',kind:'button',page:'main',text:'打开语音收藏',action:'voiceCollection',x:.55,y:.2,width:.4,height:.12,style:{fontSize:36}},
  {id:'voice_list',kind:'voiceCollection',page:'voiceCollection',text:'',x:.05,y:.05,width:.9,height:.84,style:{fontSize:32,textColor:'#ffffff',background:'#283133'},list:{columns:2,rows:6,gapX:30,gapY:8,itemHeight:100,voiceCaptionMode:'text',voiceSingleLine:true,voiceButtonSize:64,caption:{x:.02,y:0,width:.83,height:1},voiceFavoriteRect:{x:.88,y:.18,width:.1,height:.64},navigationRect:{x:.36,y:.91,width:.3,height:.075},favoritesOnly:true,showVoiceControls:true}},
  {id:'voices_back',kind:'button',page:'voiceCollection',text:'返回标题',action:'return',x:.72,y:.91,width:.25,height:.07,style:{fontSize:32}},
  {id:'voice_confirm',kind:'button',page:'voiceCollection',text:'试听中确认',action:'blueprint',blueprintId:setup.graph.id,x:.08,y:.91,width:.3,height:.07,style:{fontSize:32}});
 project.ui.pages!.voiceCollection={layout:'custom',background:'#162b30'};
 return setup;
}

export async function writeUiVoicePreviewAudio(directory:string){
 await fs.mkdir(path.join(directory,'assets'),{recursive:true});
 const samples=8000*12,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i/8000*Math.PI*440*2)*500),44+i*2);
 for(let index=0;index<13;index++)await fs.writeFile(path.join(directory,'assets','voice_'+index+'.wav'),wav);
}
