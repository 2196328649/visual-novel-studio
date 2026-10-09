import { useEffect, useRef, useState } from 'react';
import { BookOpen, Copy, FilePlus2, Pencil, X } from 'lucide-react';
import type { ProjectSession, StudioBridge } from '../core/bridge';
import type { ProjectTemplate, ProjectTemplateInfo } from '../core/project-templates';

export function TemplateManager({ templates, bridge, onOpen, run, busy, error }: {
  templates: ProjectTemplateInfo[]; bridge: StudioBridge; onOpen: (session: ProjectSession) => void;
  run: (label: string, action: () => Promise<void>) => Promise<void>; busy: string; error: string;
}) {
  const [creating, setCreating] = useState<{ source: ProjectTemplate; name: string }>();
  return <div className="template-manager">
    <div className="template-manager-toolbar"><p>模板保存在本机。打开编辑后可修改剧情、界面、参数和素材，保存后用于新建项目。</p><button className="primary" disabled={!!busy} onClick={() => setCreating({ source: 'blank', name: '我的模板' })}><FilePlus2 size={17} />新建模板</button></div>
    <div className="template-library-grid">{templates.map(item => <article className="template-library-card" key={item.id} aria-label={`模板 ${item.name}`}>
      <div className="template-library-heading"><BookOpen size={28} /><span>{item.builtin ? item.customized ? '内置模板 · 已在本机修改' : '内置模板' : '我的模板'}</span></div>
      <h2>{item.name}</h2><p>{item.description}</p>
      <small>{item.builtin && !item.customized ? '首次编辑会建立本机副本。' : item.updatedAt ? `保存于 ${new Date(item.updatedAt).toLocaleString('zh-CN')}` : '尚无可用的保存记录'}</small>
      <div className="template-library-actions"><button className="small-button" disabled={!!busy} onClick={() => void run('打开模板', async () => onOpen(await bridge.editTemplate!(item.id)))}><Pencil size={15} />打开编辑</button><button className="small-button" disabled={!!busy || !item.available} onClick={() => setCreating({ source: item.id, name: `${item.name} 副本`.slice(0, 200) })}><Copy size={15} />复制模板</button></div>
    </article>)}</div>
    <p>在编辑器的“作品设置”中可以修改模板名称。每次新建项目都会复制模板内容与素材，已有项目保持独立。</p>
    {creating && <TemplateNameDialog initial={creating.name} copying={creating.source !== 'blank'} busy={!!busy} error={error} close={() => setCreating(undefined)} submit={name => void run('保存新模板', async () => { const session = await bridge.createTemplate!(name, creating.source); setCreating(undefined); onOpen(session); })} />}
  </div>;
}

function TemplateNameDialog({ initial, copying, busy, error, close, submit }: { initial: string; copying: boolean; busy: boolean; error: string; close: () => void; submit: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="dialog template-name-dialog" aria-label={copying ? '复制模板' : '新建模板'} onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <form onSubmit={event => { event.preventDefault(); if (name.trim() && !busy) submit(name.trim()); }}>
      <div className="dialog-header"><h2>{copying ? '复制模板' : '新建模板'}</h2><button type="button" className="icon-button" aria-label="关闭模板命名" disabled={busy} onClick={close}><X size={18} /></button></div>
      <label>模板名称<input autoFocus aria-label="模板名称" value={name} maxLength={200} onChange={event => setName(event.target.value)} /></label>
      <p>{copying ? '复制已保存的内容和素材，原模板保持独立。' : '从空白内容开始，在编辑器中制作自己的模板。'}</p>
      {error && <p role="alert" className="project-browser-error">{error}</p>}<div className="dialog-actions"><button type="button" className="small-button" disabled={busy} onClick={close}>取消</button><button type="submit" className="primary" disabled={busy || !name.trim()}>{busy ? '正在创建…' : '创建并编辑模板'}</button></div>
    </form>
  </dialog>;
}
