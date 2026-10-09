import { actorInstanceIds, actorKey, actorReference } from '../core/actor-instance';
import { ActorLifetimeSelect } from './ActorInstanceFields';
import { CharacterPresetSelect } from './CharacterPresets';
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { Camera, Film, Image, Move, UserRound } from 'lucide-react';
import { effectiveCharacter, type Project, type StageAction } from '../core/model';
import { assetCategories } from '../core/asset-library';
import { moveStageActor, moveStageCamera, moveStageVisual, stageVisualObjects, setStageAction } from '../core/stage-edit';
import { VisualPlayheadEditor } from './VisualPlayheadEditor';
import type { PreviewActor, PreviewSelection, PreviewStage } from '../core/line-preview';
import { findLine, type Commit } from './editor';
import { Field } from './components';
import { UiAssetSelect } from './AssetPicker';
import { ActionEditor, NumberField } from './Inspector';
import type { AssetUrl } from './StageEditor';

const stageCoordinate = (value: number) => Math.round(value * 1000) / 1000;

export function useStageEditing({ project, selection, state, commit, enabled, milliseconds }: {
  project: Project; selection?: PreviewSelection; state: PreviewStage; commit?: Commit; enabled: boolean; milliseconds?: number;
}) {
  const [editError, setEditError] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);
  const [actorId, setActorId] = useState<string>();
  const [visualId, setVisualId] = useState<string>();
  const visuals = stageVisualObjects(state);
  const visualKey = (item: typeof visuals[number]) => JSON.stringify([item.rootId, item.object.instanceId]);
  const visual = visualId === undefined ? visuals[0] : visuals.find(item => visualKey(item) === visualId);
  const [point, setPoint] = useState<{ id: string; x: number; y: number }>();
  const drag = useRef<{ id: string; x: number; y: number; clientX: number; clientY: number; point: { x: number; y: number }; element: HTMLDivElement; pointerId: number } | undefined>(undefined);
  const key = selection ? `${selection.nodeId}/${selection.lineId}` : '';
  const cancelDrag = () => {
    const current = drag.current;
    drag.current = undefined; setPoint(undefined);
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  };
  useEffect(() => { cancelDrag(); }, [key, enabled, project]);
  useEffect(() => () => {
    const current = drag.current;
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    drag.current = undefined;
  }, []);
  const actor = state.actors.get(actorId ?? '') ?? [...state.actors.values()][0];
  const edit = (label: string, update: (project: Project, selected: PreviewSelection) => void) => {
    if (enabled && commit && selection) commit(label, project => update(project, selection));
  };
  const setAction = (action: StageAction) => edit('舞台演出', (project, selection) => setStageAction(project, selection, action));
  const move = (id: string, patch: Parameters<typeof moveStageActor>[3]) => {
    try {
      let notice: string | undefined;
      edit('调整角色', (project, selection) => { notice = moveStageActor(project, selection, id, patch, milliseconds); });
      setEditError(notice ?? '');
    }
    catch (error) { setEditError(error instanceof Error ? error.message : String(error)); }
  };
  const moveCamera = (patch: Parameters<typeof moveStageCamera>[2]) => {
    try {
      let notice: string | undefined;
      edit('调整镜头属性帧', (project, selection) => { notice = moveStageCamera(project, selection, patch, milliseconds); });
      setEditError(notice ?? '');
    } catch (error) { setEditError(error instanceof Error ? error.message : String(error)); }
  };
  const moveVisualTarget = (rootId: string, instanceId: string, patch: Parameters<typeof moveStageVisual>[4]) => {
    try {
      let notice: string | undefined;
      edit('调整对象属性帧', (project, selection) => { notice = moveStageVisual(project, selection, rootId, instanceId, patch, milliseconds); });
      setEditError(notice ?? '');
    } catch (error) { setEditError(error instanceof Error ? error.message : String(error)); }
  };
  const moveVisual = (patch: Parameters<typeof moveStageVisual>[4]) => { if (visual) moveVisualTarget(visual.rootId, visual.object.instanceId, patch); };
  const addActor = (id: string) => {
    const character = effectiveCharacter(project, id);
    if (!character?.expressions[0]) return;
    let instanceId: string | undefined;
    if ([...state.actors.values()].some(actor => actor.characterId === id)) {
      const used = new Set(actorInstanceIds(project)); let number = 1;
      while (used.has(`actor_${number}`)) number++;
      instanceId = `actor_${number}`;
    }
    setActorId(actorKey({ characterId: id, instanceId }));
    setAction({ kind: 'show', instanceId, lifetime: 'line', characterId: id, expressionId: character.defaultExpressionId ?? character.expressions[0].id, presetId: 'default', x: .5, y: 1, scale: 1, layer: 10, transition: 'dissolve' });
  };
  const actorEvents = (actor: PreviewActor) => ({
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (!enabled || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
      setActorId(actorKey(actor));
      drag.current = { id: actorKey(actor), x: actor.x, y: actor.y, clientX: event.clientX, clientY: event.clientY, point: { x: actor.x, y: actor.y }, element: event.currentTarget, pointerId: event.pointerId };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const initial = drag.current;
      if (!enabled || initial?.id !== actorKey(actor) || !canvasRef.current) return;
      const bounds = canvasRef.current.getBoundingClientRect(), radians = state.camera.rotation * Math.PI / 180;
      const dx = event.clientX - initial.clientX, dy = event.clientY - initial.clientY;
      const next = { x: stageCoordinate(initial.x + (dx * Math.cos(radians) + dy * Math.sin(radians)) / state.camera.zoom / bounds.width), y: stageCoordinate(initial.y + (-dx * Math.sin(radians) + dy * Math.cos(radians)) / state.camera.zoom / bounds.height) };
      initial.point = next; setPoint({ id: initial.id, ...next });
    },
    onPointerUp: () => {
      const current = drag.current;
      if (current && (current.point.x !== current.x || current.point.y !== current.y)) move(current.id, current.point);
      cancelDrag();
    },
    onPointerCancel: cancelDrag,
    onLostPointerCapture: cancelDrag,
    onFocus: () => { if (enabled) setActorId(actorKey(actor)); },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (event.key === 'Escape') cancelDrag();
      if (!delta) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? .05 : .01;
      move(actorKey(actor), { x: stageCoordinate(actor.x + delta[0] * step), y: stageCoordinate(actor.y + delta[1] * step) });
    },
  });
  const drop = (event: DragEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const id = event.dataTransfer.getData('application/vns-asset'), character = event.dataTransfer.getData('application/vns-character');
    if (!id && !character) return;
    event.preventDefault(); event.stopPropagation();
    if (character) { addActor(character); return; }
    const asset = project.assets.find(asset => asset.id === id), category = assetCategories(project).get(id);
    if (asset?.kind === 'image' && category === 'scene') setAction({ kind: 'background', assetId: id, transition: 'dissolve' });
    if (asset?.kind === 'audio') {
      if (category === 'voice') edit('设置对白配音', (project, selection) => { const line = findLine(project, selection.nodeId, selection.lineId); if (line) line.voiceId = id; });
      else setAction(category === 'sound' ? { kind: 'sound', assetId: id } : { kind: 'music', assetId: id, loop: true, fade: 0 });
    }
  };
  return { editError, canvasRef, actor, setActorId, addActor, setAction, move, moveCamera, visuals, visual, visualKey, setVisualId, moveVisual, moveVisualTarget, edit, actorEvents, drop, point };
}

export function StageTools({ project, selection, state, controls, assetUrl }: {
  project: Project; selection: PreviewSelection; state: PreviewStage; controls: ReturnType<typeof useStageEditing>; assetUrl: AssetUrl;
}) {
  const actor = controls.actor, character = actor && effectiveCharacter(project, actor.characterId);
  const line = findLine(project, selection.nodeId, selection.lineId);
  const animationIndex = line?.actions.reduce((found, action, index) => action.kind === 'animate' && actor && actorKey(action) === actorKey(actor) ? index : found, -1) ?? -1;
  const animation = line?.actions[animationIndex];
  const position = actor && controls.point?.id === actorKey(actor) ? controls.point : actor;
  return <div className="preview-stage-tools" role="region" aria-label="舞台编辑工具">
    <div className="preview-stage-resources">
      <label><Image size={14} /><UiAssetSelect project={project} kind="image" category="scene" label="舞台背景" value={state.backgroundId} empty="选择背景" assetUrl={assetUrl} onChange={id => { if (id) controls.setAction({ kind: 'background', assetId: id, transition: 'dissolve' }); }} /></label>
      <label><UserRound size={14} /><select aria-label="舞台添加角色" value="" onChange={event => controls.addActor(event.target.value)}><option value="">添加角色</option>{project.characters.filter(character => !!effectiveCharacter(project, character.id)?.expressions.length).map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
    </div>
    {controls.editError && <p role="alert">{controls.editError}</p>}
    <div className="preview-actor-heading"><Move size={14} /><select aria-label="舞台选择角色" value={actor ? actorKey(actor) : ''} onChange={event => controls.setActorId(event.target.value)}><option value="" disabled>{state.actors.size ? '选择角色' : '画面中暂无角色'}</option>{[...state.actors.values()].sort((a, b) => b.layer - a.layer).map(actor => <option key={actorKey(actor)} value={actorKey(actor)}>{project.characters.find(character => character.id === actor.characterId)?.name ?? '角色'}{actor.instanceId ? ` [${actor.instanceId}]` : ''} · 图层 {actor.layer}</option>)}</select><span className="spacer" />{actor && <button className="small-button" onClick={() => controls.setAction({ kind: 'hide', ...actorReference(actor), transition: 'dissolve' })}>隐藏角色</button>}</div>
    {actor && character && <>
      <div className="preview-stage-fields">
        <Field label="舞台显示范围"><ActorLifetimeSelect label="舞台显示范围" value={actor.lifetime} onChange={lifetime => { const { rotation: _r, opacity: _o, ...show } = actor; controls.setAction({ ...show, lifetime }); }} /></Field>
        <div className="muted">实例 ID：{actor.instanceId ?? '角色默认'}；再次添加同一角色可创建独立副本。</div>
        <Field label="舞台站位预设"><CharacterPresetSelect label="舞台站位预设" project={project} characterId={actor.characterId} value={actor.presetId} onChange={presetId => {
          const { rotation: _r, opacity: _o, presetId: _p, ...show } = actor;
          controls.setAction({ ...show, ...(presetId ? { presetId } : {}) });
        }} /></Field>
        <NumberField label="角色横向位置 %" value={(position?.x ?? actor.x) * 100} step={.1} onChange={x => controls.move(actorKey(actor), { x: x / 100 })} />
        <NumberField label="角色纵向位置 %" value={(position?.y ?? actor.y) * 100} step={.1} onChange={y => controls.move(actorKey(actor), { y: y / 100 })} />
        <NumberField label="角色缩放 %" value={actor.scale * 100} min={5} max={400} onChange={scale => controls.move(actorKey(actor), { scale: scale / 100 })} />
        <NumberField label="角色旋转 度" value={actor.rotation} step={1} onChange={rotation => controls.move(actorKey(actor), { rotation })} />
        <NumberField label="角色不透明度 %" value={actor.opacity * 100} min={0} max={100} step={1} onChange={opacity => controls.move(actorKey(actor), { opacity: Math.max(0, Math.min(1, opacity / 100)) })} />
        <NumberField label="角色图层" value={actor.layer} min={0} max={100} onChange={layer => controls.move(actorKey(actor), { layer: Math.round(layer) })} />
        <Field label="角色表情"><select aria-label="角色表情" value={actor.expressionId} onChange={event => controls.move(actorKey(actor), { expressionId: event.target.value })}>{character.expressions.map(expression => <option key={expression.id} value={expression.id}>{expression.name}</option>)}</select></Field>
      </div>
      <details className="preview-stage-details"><summary><Film size={14} />角色关键帧{animation?.kind === 'animate' && <span>{animation.keyframes.length} 帧</span>}</summary>
        {animation?.kind === 'animate' ? <><ActionEditor project={project} assetUrl={assetUrl} action={animation} onChange={next => controls.edit('编辑角色关键帧', (project, selection) => { const line = findLine(project, selection.nodeId, selection.lineId); if (line) line.actions[animationIndex] = next; })} /><button className="small-button" onClick={() => controls.edit('移除角色动画', (project, selection) => { findLine(project, selection.nodeId, selection.lineId)?.actions.splice(animationIndex, 1); })}>移除角色动画</button></> : <button className="small-button" onClick={() => controls.setAction({ kind: 'animate', ...actorReference(actor), repeat: false, wait: false, keyframes: [0, 1].map(duration => ({ x: actor.x, y: actor.y, scale: actor.scale, rotation: actor.rotation, opacity: actor.opacity, duration, easing: 'ease' })) })}>添加角色动画</button>}
      </details>
    </>}
    {!!controls.visuals.length && <details open className="preview-stage-details"><summary>视觉对象</summary>
      <select aria-label="舞台选择视觉对象" value={controls.visual ? controls.visualKey(controls.visual) : ''} onChange={event => controls.setVisualId(event.target.value)}>
        <option value="" disabled>选择画面中的对象</option>
        {controls.visuals.map(item => <option key={controls.visualKey(item)} value={controls.visualKey(item)}>{item.name}</option>)}
      </select>
      {controls.visual && <VisualPlayheadEditor object={controls.visual.object} time={controls.visual.elapsed} onChange={controls.moveVisual} />}
    </details>}
    <details className="preview-stage-details"><summary><Camera size={14} />镜头</summary>
      <p className="muted">修改会写入当前播放时刻的镜头属性帧。</p>
      <NumberField label="镜头横移 %" value={state.camera.x * 100} step={1} onChange={x => controls.moveCamera({ x: x / 100 })} />
      <NumberField label="镜头纵移 %" value={state.camera.y * 100} step={1} onChange={y => controls.moveCamera({ y: y / 100 })} />
      <NumberField label="镜头缩放 %" value={state.camera.zoom * 100} min={1} step={1} onChange={zoom => controls.moveCamera({ zoom: Math.max(.01, zoom / 100) })} />
      <NumberField label="镜头旋转 度" value={state.camera.rotation} step={1} onChange={rotation => controls.moveCamera({ rotation })} />
      <button className="small-button" onClick={() => controls.moveCamera({ x: 0, y: 0, zoom: 1, rotation: 0 })}>重置镜头位置</button>
    </details>
  </div>;
}
