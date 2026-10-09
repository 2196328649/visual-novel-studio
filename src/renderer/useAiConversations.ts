import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { StudioBridge } from '../core/bridge';
import type { AiConversation, AiConversationList, AiConversationSummary, SavedAiMessage } from '../core/ai-conversations';
import { makeId } from '../core/model';

export function useAiConversations<T extends SavedAiMessage>(projectId:string, bridge:StudioBridge, serialize:(message:T)=>SavedAiMessage) {
  type Session = Omit<AiConversation,'messages'> & {messages:T[]};
  const [value,setValue]=useState<Session>(), [list,setList]=useState<AiConversationList>({items:[],unreadable:0});
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const latest=useRef<Session | undefined>(undefined), mounted=useRef(true), version=useRef(0);
  const lastWrite=useRef<{session:Session;task:Promise<void>} | undefined>(undefined);
  const timer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A close or send in the same event must see the latest draft.
  const update=(session:Session)=>{latest.current=session;setValue(session);};
  const fresh=():Session=>({version:1,id:makeId('chat'),projectId,title:'新会话',createdAt:Date.now(),updatedAt:Date.now(),mode:'edit',includeHistory:true,draft:'',messages:[]});
  const packed=(session:Session):AiConversation=>({...session,messages:session.messages.map(serialize)});
  const summary=(session:Session):AiConversationSummary=>({id:session.id,title:session.title,updatedAt:session.updatedAt,pinned:session.pinned,count:session.messages.length,preview:session.messages.map(item=>item.content).join('\n').slice(0,100000)});
  const save=useCallback((session:Session)=>{
    if(!bridge.saveAiConversation)return Promise.resolve();
    if(lastWrite.current?.session===session)return lastWrite.current.task;
    const sequence=++version.current;
    if(mounted.current)setSaving(true);
    const task=bridge.saveAiConversation({...session,messages:session.messages.map(serialize)});
    lastWrite.current={session,task};
    void task.then(()=>{if(mounted.current){setList(current=>({...current,items:[summary(session),...current.items.filter(item=>item.id!==session.id)]}));if(sequence===version.current){setSaving(false);setError('');}}},error=>{if(lastWrite.current?.session===session)lastWrite.current=undefined;if(mounted.current&&sequence===version.current){setSaving(false);setError('聊天记录未保存：'+String(error));}});
    return task;
  },[bridge,serialize]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(timer.current);if(latest.current)void save(latest.current).catch(()=>{});};},[save]);
  useEffect(()=>{
    let active=true;setReady(false);setError('');
    void (async()=>{
      try {
        const result=await bridge.listAiConversations?.(projectId)??{items:[],unreadable:0};
        const session=result.activeId?await bridge.readAiConversation?.(projectId,result.activeId):undefined;
        if(active){setList(result);update((session??fresh()) as Session);setReady(true);}
      }catch(error){if(active){setError('无法读取聊天记录：'+String(error));}}
    })();
    return()=>{active=false;};
  },[projectId,bridge]);
  useEffect(()=>{if(ready&&value?.projectId===projectId){if(lastWrite.current?.session!==value)setSaving(!!bridge.saveAiConversation);timer.current=setTimeout(()=>{void save(value).catch(()=>{});},200);}return()=>clearTimeout(timer.current);},[ready,value,projectId,save,bridge]);
  const flush=async()=>{clearTimeout(timer.current);if(latest.current)await save(latest.current);};
  const refresh=async()=>{await flush();if(bridge.listAiConversations)setList(await bridge.listAiConversations(projectId));};
  const change=(patch:Partial<Session>)=>{if(latest.current)update({...latest.current,...patch,updatedAt:Date.now()});};
  const setHistory=(action:SetStateAction<T[]>)=>{if(latest.current)change({messages:typeof action==='function'?action(latest.current.messages):action});};
  const select=async(id:string)=>{await flush();if(bridge.readAiConversation){const next=await bridge.readAiConversation(projectId,id);update(next as Session);}};
  const create=async()=>{await flush();update(fresh());};
  const fork=async(messages:T[])=>{await flush();update({...fresh(),title:(latest.current?.title??'会话').slice(0,110)+' · 分支',mode:latest.current?.mode??'edit',includeHistory:latest.current?.includeHistory??true,messages});};
  const remove=async()=>{
    await flush();if(!latest.current||!bridge.deleteAiConversation)return;
    await bridge.deleteAiConversation(projectId,latest.current.id);
    const result=await bridge.listAiConversations!(projectId);setList(result);
    update((result.activeId?await bridge.readAiConversation!(projectId,result.activeId):fresh()) as Session);
  };
  const visibleList={...list,items:(value?[summary(value),...list.items.filter(item=>item.id!==value.id)]:list.items).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||b.updatedAt-a.updatedAt)};
  return {value,history:value?.messages??[],setHistory,prompt:value?.draft??'',setPrompt:(draft:string)=>change({draft}),change,ready,error,saving,list:visibleList,refresh,select,create,fork,remove,flush,packed:()=>latest.current?packed(latest.current):undefined};
}
