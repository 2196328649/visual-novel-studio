import { promises as fs } from 'node:fs';
import path from 'node:path';
import { aiConversationSchema, conversationId, type AiConversation, type AiConversationList } from '../core/ai-conversations';
import { atomicWrite, WriteQueue } from './project-store';

export class AiConversationStore {
  private writes = new WriteQueue();
  constructor(private root: string) {}
  private folder(projectId: string) { return path.join(this.root, conversationId.parse(projectId)); }
  private file(projectId: string, id: string) { return path.join(this.folder(projectId), conversationId.parse(id) + '.json'); }
  async read(projectId: string, id: string): Promise<AiConversation> {
    const file = this.file(projectId,id);
    if ((await fs.stat(file)).size > 24 * 1024 * 1024) throw Error('会话文件过大，无法打开。');
    const conversation = aiConversationSchema.parse(JSON.parse(await fs.readFile(file,'utf8')));
    if (conversation.projectId !== projectId || conversation.id !== id) throw Error('会话不属于当前项目。');
    return conversation;
  }
  async list(projectId: string): Promise<AiConversationList> {
    await this.writes.run(async()=>{});
    const folder = this.folder(projectId), items: AiConversationList['items'] = [];
    const files = await fs.readdir(folder).catch(error => {if(error.code==='ENOENT') return []; throw error;});
    let unreadable = 0;
    for (const file of files.filter(file=>file.endsWith('.json') && file !== '_active.json')) {
      try { const c = await this.read(projectId,file.slice(0,-5)); items.push({id:c.id,title:c.title,updatedAt:c.updatedAt,pinned:c.pinned,count:c.messages.length,preview:c.messages.map(m=>m.content).join('\n').slice(0,100000)}); }
      catch { unreadable++; }
    }
    const state = await fs.readFile(path.join(folder,'_active.json'),'utf8').then(JSON.parse).catch(()=>({}));
    items.sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||b.updatedAt-a.updatedAt);
    return {items, activeId: items.some(c=>c.id===state.id)?state.id:items[0]?.id, unreadable};
  }
  save(raw: AiConversation): Promise<void> {
    const conversation = aiConversationSchema.parse(raw), file = this.file(conversation.projectId,conversation.id);
    const contents = JSON.stringify({...conversation,updatedAt:Date.now()},null,2);
    if(Buffer.byteLength(contents)>24*1024*1024) throw Error('会话已达到保存上限，请新建会话。');
    return this.writes.run(async()=>{
      await atomicWrite(file,contents);
      await atomicWrite(path.join(this.folder(conversation.projectId),'_active.json'),JSON.stringify({id:conversation.id}));
    });
  }
  delete(projectId: string, id: string) {
    const file=this.file(projectId,id);
    return this.writes.run(async()=>{await fs.rm(file,{force:true});});
  }
}
