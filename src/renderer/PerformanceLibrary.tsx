import { graphResourceKey, isTimelineResource, projectGraphs } from '../core/project-resources';
import { createContentFolder, folderTrail, moveContent } from '../core/content-browser';
import type { Commit } from './editor';
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Film, Folder, FolderOpen, Image, Layers, Music2, Plus, Search, UserRound } from 'lucide-react';
import { effectiveCharacter, type Project, type VisualObject } from '../core/model';
import { blueprintCatalog } from '../core/blueprint';
import { timelineNodeTypes } from '../core/performance-timeline';
import type { AssetUrl } from './StageEditor';

type ActionType = (typeof timelineNodeTypes)[number] | 'image' | 'audio' | 'video';
export function PerformanceLibrary({ project, assetUrl, add, commit, compositionAdd, insideComposition = false, resourceAdd, currentGraphId }: {
  project: Project; assetUrl: AssetUrl; commit: Commit; add: (type: ActionType, assetId?: string, characterId?: string) => void; compositionAdd?: (content: VisualObject['content'], assetId?: string) => void;
  insideComposition?: boolean; resourceAdd?: (id: string) => void; currentGraphId?: string;
}) {
  const [tab, setTab] = useState<'media' | 'characters' | 'actions' | 'compositions'>('media');
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState<string>();
  useEffect(() => { setFolderId(undefined); }, [tab, project.id]);
  const matches = (name: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  // The playhead updates this parent every frame; folder traversal only changes
  // when the project or the library's own filters change.
  const { trail, visibleFolders, assets, resources, characters } = useMemo(() => {
    const folders = project.contentBrowser?.folders ?? [];
    const assignments = project.contentBrowser?.assignments ?? {};
    const trail = folderTrail(project, folderId);
    const within = (key: string) => query.trim() ? !folderId || folderTrail(project, assignments[key]).some(f => f.id === folderId) : assignments[key] === folderId;
    const keys = tab === 'compositions' ? projectGraphs(project).filter(graph => graph.visualComposition || !insideComposition && graph.compositionContainer).map(graphResourceKey) : tab === 'characters' ? project.characters.map(c => 'character:' + c.id) : project.assets.filter(a => a.kind === 'image' || a.kind === 'video' || !insideComposition && a.kind === 'audio').map(a => 'asset:' + a.id);
    const visibleFolders = folders.filter(f => f.parentId === folderId && (keys.some(key => folderTrail(project, assignments[key]).some(parent => parent.id === f.id)) || !f.category && !Object.values(assignments).some(id => folderTrail(project, id).some(parent => parent.id === f.id))));
    const matches = (name: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    const assets = project.assets.filter(asset => (asset.kind === 'image' || asset.kind === 'video' || !insideComposition && asset.kind === 'audio') && matches(asset.name) && within('asset:' + asset.id));
    const resources = projectGraphs(project).filter(graph => (graph.visualComposition || !insideComposition && graph.compositionContainer) && graph.id !== currentGraphId && matches(graph.name) && within(graphResourceKey(graph)));
    const characters = project.characters.filter(character => matches(character.name) && within('character:' + character.id));
    return { trail, visibleFolders, assets, resources, characters };
  }, [project, tab, folderId, query, insideComposition, currentGraphId]);
  return <aside className="performance-library" aria-label="演出素材库">
    <header><strong>素材库</strong></header>
    <div className="segmented" role="tablist" aria-label="演出素材分类">{([['media', '素材'], ['characters', '角色'], ['actions', '添加'], ['compositions', '组合']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
    <label className="performance-library-search"><Search size={14} /><input aria-label="搜索演出素材" placeholder="搜索名称" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {tab !== 'actions' && <nav className="performance-library-folders" aria-label="演出素材文件夹">
      <div className="performance-directory-label"><FolderOpen size={15} /><strong>当前位置</strong></div>
      <ol><li><button aria-current={!folderId ? 'location' : undefined} onClick={() => setFolderId(undefined)}>全部{tab === 'characters' ? '角色' : tab === 'compositions' ? '组合' : '素材'}</button></li>{trail.map(folder => <li key={folder.id}><ChevronRight size={12} /><button title={folder.name} aria-current={folder.id === folderId ? 'location' : undefined} onClick={() => setFolderId(folder.id)}>{folder.name}</button></li>)}</ol>
      {tab === 'characters' && <button onClick={() => commit('创建角色分类', draft => { for (const name of ['主角', '重要NPC', 'NPC']) createContentFolder(draft, name, folderId); })}>创建角色分类</button>}
    </nav>}
    <div className="performance-library-items">
      {tab !== 'actions' && !query.trim() && !!visibleFolders.length && <div className="performance-library-section">文件夹 · {visibleFolders.length}</div>}
      {tab !== 'actions' && !query.trim() && visibleFolders.map(folder => <button key={folder.id} className="performance-library-item performance-library-folder" aria-label={'打开文件夹 ' + folder.name} onClick={() => setFolderId(folder.id)} onDragOver={event => { if (['application/vns-asset', 'application/vns-character', 'application/vns-blueprint', 'application/vns-timeline'].some(type => event.dataTransfer.types.includes(type))) event.preventDefault(); }} onDrop={event => { const asset = event.dataTransfer.getData('application/vns-asset'), character = event.dataTransfer.getData('application/vns-character'), blueprint = (event.dataTransfer.getData('application/vns-blueprint') || event.dataTransfer.getData('application/vns-timeline')); if (!asset && !character && !blueprint) return; event.preventDefault(); event.stopPropagation(); commit('移动演出素材到文件夹', draft => { moveContent(draft, [asset ? 'asset:' + asset : character ? 'character:' + character : (event.dataTransfer.getData('application/vns-timeline') ? 'timeline:' : 'blueprint:') + blueprint], folder.id); }); }}><Folder size={28} /><span>{folder.name}</span></button>)} 
      {tab !== 'actions' && <div className="performance-library-section">{tab === 'characters' ? '角色' : tab === 'compositions' ? '组合' : '素材'} · {tab === 'characters' ? characters.length : tab === 'compositions' ? resources.length : assets.length}</div>}
      {tab === 'media' && assets.map(asset => <button key={asset.id} className="performance-library-item" draggable title={asset.name + ' · 点击添加片段，也可拖入轨道'} aria-label={'添加素材 ' + asset.name} onDragStart={event => { event.dataTransfer.setData('application/vns-asset', asset.id); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => compositionAdd && asset.kind !== 'audio' ? compositionAdd(asset.kind === 'video' ? 'video' : 'image', asset.id) : add(asset.kind === 'image' ? 'image' : asset.kind === 'video' ? 'video' : 'audio', asset.id)}>
        {asset.kind === 'image' ? <img loading="lazy" src={assetUrl(asset.id)} alt="" /> : <span className="performance-library-icon">{asset.kind === 'video' ? <Film size={24} /> : <Music2 size={24} />}</span>}<span>{asset.name}</span><Plus size={12} />
      </button>)}
      {tab === 'characters' && characters.map(item => { const character = effectiveCharacter(project, item.id)!; const expression = character.expressions.find(expression => expression.id === character.defaultExpressionId) ?? character.expressions[0]; return <button key={item.id} className="performance-library-item" draggable title="点击添加到播放头；也可拖入轨道" aria-label={'添加角色 ' + item.name} onDragStart={event => { event.dataTransfer.setData('application/vns-character', item.id); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => add('showCharacter', undefined, item.id)}>
        {expression ? <img loading="lazy" src={assetUrl(expression.assetId)} alt="" /> : <span className="performance-library-icon"><UserRound size={24} /></span>}<span>{item.name}</span><Plus size={12} />
      </button>; })}
      {tab === 'actions' && !insideComposition && <details className="performance-library-commands"><summary>演出指令</summary>{timelineNodeTypes.filter(type => matches(blueprintCatalog[type].name)).map(type => <button key={type} className="performance-library-action" draggable onDragStart={event => { event.dataTransfer.setData('application/vns-timeline-action', type); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => add(type)}><Plus size={13} />{blueprintCatalog[type].name}</button>)}</details>}
      {tab === 'actions' && compositionAdd && (['text', 'image', 'video', 'solid', 'group', 'particles'] as const).map(content => ({ content, name: { text: '文字', image: '图片', video: '视频', solid: '色块', group: '组合', particles: '粒子效果' }[content] })).filter(item => matches(item.name)).map(({ content, name }) => <button key={content} className="performance-library-action" draggable onDragStart={event => { event.dataTransfer.setData('application/vnd.vns-composition-object', content); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => compositionAdd(content)}><Plus size={13} />{name}</button>)}
      {tab === 'compositions' && resources.map(graph => <button className="performance-library-item" key={graph.id} draggable aria-label={'添加组合资源 ' + graph.name} onDragStart={event => { event.dataTransfer.setData(isTimelineResource(graph) ? 'application/vns-timeline' : 'application/vns-blueprint', graph.id); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => resourceAdd?.(graph.id)}><Layers size={24} /><span>{graph.name}</span><Plus size={12} /></button>)}
      {tab === 'compositions' && !resources.length && <p className="performance-library-empty"><Layers size={24} />选中片段，右键制作组合，再保存为组合资源。</p>}
      {((tab === 'media' && !assets.length && !visibleFolders.length) || (tab === 'characters' && !characters.length && !visibleFolders.length)) && <p className="performance-library-empty"><Image size={22} />{query ? '没有匹配的内容' : tab === 'media' ? '可在“素材”页面导入图片、声音和视频。' : '可在“角色”页面添加角色。'}</p>}
    </div>
    <footer>点击添加到播放头，或拖入轨道</footer>
  </aside>;
}
