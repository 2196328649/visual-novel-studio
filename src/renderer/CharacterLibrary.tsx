import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { ChevronRight, Folder, FolderOpen, FolderPlus, Plus, Search, UserRound, X } from 'lucide-react';
import { effectiveCharacter, type Project } from '../core/model';
import { createContentFolder, folderTrail, moveContent } from '../core/content-browser';
import { folderCategory } from '../core/asset-library';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import { ResourceInspector, type CharacterSection, type ResourceSelection } from './Inspector';
import { Empty, IconButton } from './components';
import './character-library.css';

export function CharacterLibrary({ project, commit, assetUrl, resource, select, add }: { project: Project; commit: Commit; assetUrl: AssetUrl; resource?: ResourceSelection; select: (r?: ResourceSelection) => void; add: (folderId?: string) => void }) {
  const [location, setLocation] = useState(''), [query, setQuery] = useState('');
  const [section, setSection] = useState<CharacterSection>('appearance');
  const [creating, setCreating] = useState(false), [name, setName] = useState(''), [notice, setNotice] = useState('');
  const folders = project.contentBrowser?.folders ?? [], assignments = project.contentBrowser?.assignments ?? {};
  const folderId = location === '*' || location === '' ? undefined : location;
  const availableFolders = folders.filter(folder => !folderCategory(project, folder.id));
  useEffect(() => { setLocation(''); setQuery(''); setCreating(false); }, [project.id]);
  useEffect(() => { if (folderId && !availableFolders.some(folder => folder.id === folderId)) setLocation(''); }, [folderId, folders]);
  const navigate = (id: string) => { setLocation(id); setQuery(''); setCreating(false); setNotice(''); };
  const assignedFolder = (id: string) => availableFolders.find(folder => folder.id === assignments['character:' + id])?.id;
  const characters = project.characters.filter(character => character.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
    (location === '*' || (query.trim() && folderId ? folderTrail(project, assignedFolder(character.id)).some(folder => folder.id === folderId) : assignedFolder(character.id) === folderId)));
  const children = availableFolders.filter(folder => folder.parentId === folderId);
  const current = resource?.kind === 'character' ? project.characters.find(character => character.id === resource.id) : undefined;
  useEffect(() => { if (!current && characters[0]) select({ kind: 'character', id: characters[0].id }); }, [current?.id, characters[0]?.id]);
  const currentEffective = current && effectiveCharacter(project, current.id);
  const move = (id: string, destination?: string) => {
    if (!project.characters.some(character => character.id === id)) return;
    commit('移动角色到文件夹', draft => { moveContent(draft, ['character:' + id], destination); });
    setNotice('角色已移动');
  };
  const drop = (event: DragEvent, destination?: string) => { const id = event.dataTransfer.getData('application/vns-character'); if (id) { event.preventDefault(); event.stopPropagation(); move(id, destination); } };
  const allow = (event: DragEvent) => { if (event.dataTransfer.types.includes('application/vns-character')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } };
  const create = () => {
    let id: string | undefined;
    commit('新建角色文件夹', draft => { id = createContentFolder(draft, name, folderId); });
    if (id) { setName(''); setCreating(false); navigate(id); } else setNotice('名称为空、同级重名或文件夹已达上限');
  };
  const folderTree = (parentId?: string, depth = 0): ReactNode => depth >= 24 ? null : availableFolders.filter(folder => folder.parentId === parentId).map(folder => <div key={folder.id}>
    <button className={location === folder.id ? 'active' : ''} aria-current={location === folder.id ? 'page' : undefined} style={{ paddingLeft: 12 + depth * 16 }} onClick={() => navigate(folder.id)} onDragOver={allow} onDrop={event => drop(event, folder.id)}>
      {location === folder.id ? <FolderOpen size={15} /> : <Folder size={15} />}<span>{folder.name}</span>
      <small>{project.characters.filter(character => folderTrail(project, assignedFolder(character.id)).some(parent => parent.id === folder.id)).length}</small>
    </button>{folderTree(folder.id, depth + 1)}
  </div>);
  return <div className="library-workspace character-library">
    <div className="workspace-toolbar"><strong>角色</strong><div className="search library-search"><Search size={14} /><input aria-label="搜索角色" placeholder="搜索角色…" value={query} onChange={event => setQuery(event.target.value)} /></div><div className="spacer" />
      <IconButton title="新建文件夹" onClick={() => { setCreating(!creating); setName(''); }}><FolderPlus size={16} /></IconButton>
      <button className="primary small-button" onClick={() => add(folderId)}><Plus size={15} />添加角色</button>
    </div>
    <div className="character-library-body">
      <nav className="character-directory" aria-label="角色文件夹导航">
        <button className={location === '*' ? 'active' : ''} aria-current={location === '*' ? 'page' : undefined} onClick={() => navigate('*')}><UserRound size={15} /><span>全部角色</span><small>{project.characters.length}</small></button>
        <div className="character-directory-title">文件夹</div>
        <button className={location === '' ? 'active' : ''} aria-current={location === '' ? 'page' : undefined} onClick={() => navigate('')} onDragOver={allow} onDrop={event => drop(event)}><FolderOpen size={15} /><span>角色目录</span></button>
        {folderTree()}
      </nav>
      <div className="character-directory-content">
        <nav className="character-breadcrumb" aria-label="当前角色目录"><button onClick={() => navigate('')}>角色目录</button>{location === '*' ? <><ChevronRight size={13} /><span>全部角色</span></> : folderTrail(project, folderId).map(folder => <span key={folder.id}><ChevronRight size={13} /><button aria-current={folder.id === folderId ? 'page' : undefined} onClick={() => navigate(folder.id)}>{folder.name}</button></span>)}<div className="spacer" /><small>{characters.length} 个角色</small></nav>
        {creating && <form className="character-folder-form" onSubmit={event => { event.preventDefault(); create(); }}><FolderPlus size={16} /><input aria-label="角色文件夹名称" placeholder="文件夹名称" autoFocus maxLength={80} value={name} onChange={event => setName(event.target.value)} /><button className="primary small-button" type="submit" disabled={!name.trim()}>创建</button><IconButton title="取消创建文件夹" onClick={() => setCreating(false)}><X size={14} /></IconButton></form>}
        {notice && <p className="character-folder-notice" role="status">{notice}</p>}
        <div className="library-scroll">
          {!query.trim() && location !== '*' && !!children.length && <div className="character-folder-list" aria-label="当前目录的子文件夹">{children.map(folder => <button key={folder.id} data-character-folder={folder.id} onClick={() => navigate(folder.id)} onDragOver={allow} onDrop={event => drop(event, folder.id)}><Folder size={20} /><span>{folder.name}</span><small>{project.characters.filter(character => assignedFolder(character.id) === folder.id).length}</small></button>)}</div>}
          {characters.length ? <div className="character-list">{characters.map(character => { const effective = effectiveCharacter(project, character.id)!; return <button key={character.id} data-character-id={character.id} draggable onDragStart={event => { event.dataTransfer.setData('application/vns-character', character.id); event.dataTransfer.effectAllowed = 'move'; }} className={'character-item ' + (resource?.id === character.id ? 'selected' : '')} onClick={() => select({ kind: 'character', id: character.id })}><div className="character-portrait">{effective.expressions[0] ? <img src={assetUrl(effective.expressions[0].assetId)} loading="lazy" alt={character.name} /> : <UserRound size={38} />}</div><div><h3 style={{ color: character.color }}>{character.name}</h3><span>{effective.expressions.length} 个表情</span><small className="character-folder-path">{folderTrail(project, assignedFolder(character.id)).map(folder => folder.name).join(' / ') || '角色目录'}</small></div></button>; })}</div> : <Empty title={query ? '没有匹配的角色' : '当前目录没有角色'} />}
        </div>
      </div>
      <section className="character-workspace" aria-label="角色编辑工作区">
        {current ? <>
          <header className="character-workspace-heading"><span className="character-heading-color" style={{ background: current.color }} /><div><h2>{current.name}</h2><span>{currentEffective?.expressions.length ?? 0} 个表情</span></div></header>
          <nav className="character-workspace-tabs" role="tablist" aria-label="角色编辑分类">{([['appearance', '外观与表情'], ['staging', '构图与站位'], ['transitions', '角色过渡']] as const).map(([id, label]) => <button key={id} id={'character-tab-' + id} role="tab" aria-selected={section === id} aria-controls="character-details" onClick={() => setSection(id)}>{label}</button>)}</nav>
          <div className="character-workspace-scroll" id="character-details" role="tabpanel" aria-labelledby={'character-tab-' + section} key={current.id + section}>
            <ResourceInspector project={project} selection={{ kind: 'character', id: current.id }} commit={commit} assetUrl={assetUrl} selectResource={select} characterSection={section} />
          </div>
          <div className="character-selection-footer"><label>所在文件夹<select aria-label="角色所在文件夹" value={assignedFolder(current.id) ?? ''} onChange={event => move(current.id, event.target.value || undefined)}><option value="">角色目录</option>{availableFolders.map(folder => <option key={folder.id} value={folder.id}>{folderTrail(project, folder.id).map(parent => parent.name).join(' / ')}</option>)}</select></label></div>
        </> : <Empty title="选择角色开始编辑">添加角色后，可以在这里设置表情、构图和站位。</Empty>}
      </section>
    </div>
  </div>;
}
