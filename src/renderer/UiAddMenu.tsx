import { useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Project, UiComponent } from '../core/model';
import { sliderPreferences } from '../core/preferences';
import { componentNames, preferenceNames, bindingNames } from './UiNames';

export function UiAddMenu({project,page,canAdd,add,specialKind,confirmation}:{project:Project;page:UiComponent['page'];canAdd:boolean;add:(kind:UiComponent['kind'],patch?:Partial<UiComponent>)=>void;specialKind?:UiComponent['kind'];confirmation?:()=>void}) {
 const id=useId(),menu=useRef<HTMLDivElement>(null),[query,setQuery]=useState('');
 const items:{name:string;disabled?:boolean;run:()=>void}[]=[];
 const kind=(value:UiComponent['kind'])=>items.push({name:componentNames[value],disabled:['image','spine','video'].includes(value)&&!project.assets.some(a=>a.kind===value),run:()=>add(value)});
 for(const value of ['text','button','image','panel','progress','spine','video'] as const)kind(value);
 const binding=(value:NonNullable<UiComponent['binding']>)=>items.push({name:bindingNames[value],run:()=>add('text',{binding:value,text:''})});
 binding('tooltip');if(page==='main')binding('title');if(page==='say'){binding('speaker');binding('dialogue');}
 if(page==='custom'){binding('minigameTitle');binding('minigamePrompt');binding('minigameStatus');}
 if(page==='choice')kind('choiceList');if(page==='save')kind('saveSlots');
 if(page==='preferences'||page==='voiceSettings'){for(const preference of sliderPreferences)items.push({name:preferenceNames[preference],run:()=>add('preference',{preference,text:''})});kind('preferenceChoice');}
 if(page==='messageBox'){binding('confirmation');if(confirmation)items.push({name:'创建确认框布局',run:confirmation});}
 if(specialKind)kind(specialKind);
 const filtered=items.filter(item=>item.name.includes(query.trim()));
 return <><button type="button" className="icon-button ui-add-component" aria-label="添加组件" title="添加组件" disabled={!canAdd} popoverTarget={id} onClick={event=>{const bounds=event.currentTarget.getBoundingClientRect();setQuery('');if(menu.current){menu.current.style.left=Math.min(bounds.left,window.innerWidth-260)+'px';menu.current.style.top=Math.min(bounds.bottom+4,window.innerHeight-330)+'px';}}}><Plus size={16}/></button>
 <div id={id} ref={menu} popover="auto" className="ui-add-menu" aria-label="添加组件菜单" onDragStart={event=>event.stopPropagation()}>
 <input autoFocus aria-label="搜索添加组件" placeholder="搜索组件…" value={query} onChange={event=>setQuery(event.target.value)}/>
 <div>{filtered.map(item=><button type="button" key={item.name} disabled={item.disabled} title={item.disabled?'请先导入对应素材':undefined} onClick={()=>{menu.current?.hidePopover();item.run();}}>{item.name}</button>)}{!filtered.length&&<p>没有匹配的组件</p>}</div>
 </div></>;
}
