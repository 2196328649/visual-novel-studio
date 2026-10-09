import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent } from '../../src/core/ui-logic';
import { addTimelineComponent } from '../../src/core/timeline-component';
import { insertTimelineAction } from '../../src/core/performance-timeline';
import { createVisualObject } from '../../src/core/visual-object';
import { createAudioClip } from '../../src/core/audio-clip';

export function uiStageFixture(){
 const project=createProject('界面事件与演出协同');project.ui.pages={main:{layout:'custom',backgroundOpacity:0}};
 project.assets=[{id:'card',name:'图片片段',kind:'image',path:'card.svg',width:320,height:240},{id:'tone',name:'音频片段',kind:'audio',path:'tone.wav'}];
 project.ui.components=[{id:'play',kind:'button',page:'main',text:'播放演出',x:.05,y:.05,width:.22,height:.1},{id:'label',kind:'text',page:'main',text:'尚未播放',x:.05,y:.8,width:.5,height:.1}];
 const graph=createUiEventGraph(project,'ui:main','标题页');
 const click=ensureUiClickEvent(project,graph,'play','ui:main');
 const {timeline,node:call}=addTimelineComponent(project,graph.id,click.id);
 timeline.timeline!.tracks=[{id:'track_picture',name:'图片'},{id:'track_audio',name:'声音'}];
 const image=createVisualObject('image');Object.assign(image,{assetId:'card',name:'测试图片',duration:1.5,x:.5,y:.5,width:.35,height:.45,wait:false});
 const audio=createAudioClip('tone','测试音频',3);Object.assign(audio,{duration:1.5,offset:.5,fadeIn:.2,fadeOut:.3,volume:.6});
 insertTimelineAction(project,timeline,image,.25,'track_picture');insertTimelineAction(project,timeline,audio,.25,'track_audio');
 const node=(type:Parameters<typeof blueprintNodeDefaults>[0],properties:Record<string,any>)=>{const n=blueprintNodeDefaults(type);Object.assign(n.properties,properties);graph.nodes.push(n);return n;};
 const after=node('setUiProperty',{componentId:'label',property:'text',value:'演出完成'}),animate=node('animateUiProperty',{componentId:'label',property:'opacity',value:.3,duration:.5,easing:'linear',wait:true}),done=node('setUiProperty',{componentId:'label',property:'text',value:'全部完成'});
 for(const [a,b] of [[call,after],[after,animate],[animate,done]])assert.equal(connectBlueprintPins(graph,a.id,'exec_out',b.id,'exec_in'),undefined);
 synchronizeBlueprintSignatures(project);return {project,graph,timeline,image,audio};
}

export async function writeUiStageAssets(directory:string){
 await fs.mkdir(directory,{recursive:true});
 await fs.writeFile(path.join(directory,'card.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" rx="20" fill="#21bba5"/><circle cx="160" cy="100" r="54" fill="#e8fff8"/><path d="M145 72 L187 100 L145 128 Z" fill="#15776c"/><rect x="85" y="181" width="150" height="10" rx="5" fill="#e8fff8"/></svg>');
 const rate=16000,samples=rate*3,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i/rate*Math.PI*440*2)*500),44+i*2);
 await fs.writeFile(path.join(directory,'tone.wav'),wav);
}
