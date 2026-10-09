import { MessageSquare, Plus, Search, Pin } from 'lucide-react';
import { useState } from 'react';
import type { AiConversationList } from '../core/ai-conversations';

export function AiConversationSidebar({ list, activeId, projectName, busy, onCreate, onSelect }: {
  list: AiConversationList; activeId?: string; projectName: string; busy: boolean;
  onCreate: () => void; onSelect: (id: string) => void;
}) {
  const [query,setQuery]=useState('');
  const needle=query.trim().toLocaleLowerCase();
  const items=list.items.filter(item=>(item.title+' '+item.preview).toLocaleLowerCase().includes(needle));
  const groups=[{title:'已置顶',items:items.filter(item=>item.pinned)},{title:'最近会话',items:items.filter(item=>!item.pinned)}];
  return <aside className="ai-conversation-sidebar" aria-label="会话列表">
    <header><MessageSquare size={16}/><strong>会话</strong><span>{list.items.length}</span></header>
    <p className="ai-sidebar-project" title={projectName}>{projectName}</p>
    <button className="ai-new-conversation" disabled={busy} onClick={()=>{setQuery('');onCreate();}}><Plus size={16}/>新建会话</button>
    <label className="ai-conversation-search"><Search size={15}/><input aria-label="搜索历史会话" placeholder="搜索会话" value={query} onChange={event=>setQuery(event.target.value)}/></label>
    <nav aria-label="历史会话列表">
      {groups.map(group=>group.items.length>0&&<section key={group.title}><h3>{group.title}</h3>{group.items.map(item=><button key={item.id} className="ai-conversation-item" aria-current={item.id===activeId?'page':undefined} aria-pressed={item.id===activeId} disabled={busy} onClick={()=>{if(item.id!==activeId)onSelect(item.id);}} title={item.title}>
        <span className="ai-conversation-name">{item.pinned&&<Pin size={12}/>}<strong>{item.title}</strong></span>
        <span className="ai-conversation-preview">{item.preview.replace(/\s+/g,' ').trim().slice(-100)||'开始新的对话'}</span>
        <small>{item.count} 条消息 · {new Date(item.updatedAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</small>
      </button>)}</section>)}
      {!items.length&&<p className="ai-conversation-empty">{needle?'没有匹配的会话':'点击“新建会话”开始聊天'}</p>}
    </nav>
    {list.unreadable>0&&<p className="ai-sidebar-warning" role="alert">{list.unreadable} 个会话无法读取，源文件已保留。</p>}
  </aside>;
}
