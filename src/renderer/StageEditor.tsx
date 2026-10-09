import { actorKey } from '../core/actor-instance';
import { useEffect, useRef, useState } from "react";
import { Image, Plus, MousePointer2, Expand, Trash2 } from "lucide-react";
import { effectiveCharacter, makeId, targets, type InteractionHotspot, type Project, type StoryNode } from "../core/model";
import type { Commit } from "./editor";
import { finishPreviewLine, linePreviewSnapshot, type PreviewCamera } from '../core/line-preview';
import { IconButton } from "./components";

export type AssetUrl = (id?: string) => string | undefined;
function precedingPassage(project: Project, nodeId: string) {
  const visited = new Set([nodeId]);
  let incoming = [nodeId];
  while (incoming.length) {
    const previous = project.nodes.filter(node => !visited.has(node.id) && targets(node).some(port => !!port.target && incoming.includes(port.target)));
    const passage = previous.find(node => node.kind === "passage");
    if (passage?.kind === "passage") return passage;
    incoming = previous.map(node => node.id);
    incoming.forEach(id => visited.add(id));
  }
}

export function InteractionStage({ project, node, commit, assetUrl, editable = true }: {
  project: Project; node: Extract<StoryNode, { kind: "interaction" }>; commit: Commit; assetUrl: AssetUrl; editable?: boolean;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState(node.hotspots[0]?.id);
  const [referenceId, setReferenceId] = useState<string>();
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "resize"; clientX: number; clientY: number; initial: InteractionHotspot }>();
  const [draft, setDraft] = useState<InteractionHotspot>();
  const passages = project.nodes.filter(item => item.kind === "passage");
  const reference = referenceId === undefined ? precedingPassage(project, node.id) : passages.find(item => item.id === referenceId);
  const stage = linePreviewSnapshot(project, reference?.lines.length ? { nodeId: reference.id, lineId: reference.lines.at(-1)!.id } : undefined).after;
  finishPreviewLine(stage);
  useEffect(() => { setDrag(undefined); setDraft(undefined); }, [node, editable, reference?.id]);
  const selected = node.hotspots.find(hotspot => hotspot.id === selectedId) ?? node.hotspots[0];
  const update = (hotspot: InteractionHotspot) => commit("互动区域布局", changed => {
    const target = changed.nodes.find(item => item.id === node.id);
    if (target?.kind === "interaction") target.hotspots = target.hotspots.map(item => item.id === hotspot.id ? hotspot : item);
  });
  return <div className={`stage-workspace preview-interaction-stage ${editable ? "editing" : ""}`}>
    <div className="workspace-toolbar"><span><MousePointer2 size={16} />{node.name}</span><div className="spacer" /><span className="muted">{node.hotspots.length} 个互动区域</span></div>
    {editable && <div className="stage-controls">
      <label><Image size={15} /><select aria-label="参考演出" value={reference?.id ?? ""} onChange={event => setReferenceId(event.target.value)}><option value="">无参考演出</option>{passages.map(passage => <option key={passage.id} value={passage.id}>{project.scenes.find(scene => scene.id === passage.sceneId)?.name} / {passage.name}</option>)}</select></label>
      <select aria-label="选择互动区域" value={selected?.id ?? ""} onChange={event => setSelectedId(event.target.value)}>{node.hotspots.map(hotspot => <option key={hotspot.id} value={hotspot.id}>{hotspot.name}</option>)}</select>
      <IconButton title="添加互动区域" disabled={node.hotspots.length >= 64} onClick={() => {
        const id = makeId("hotspot");
        commit("添加互动区域", changed => { const target = changed.nodes.find(item => item.id === node.id); if (target?.kind === "interaction") target.hotspots.push({ id, name: `互动区域 ${target.hotspots.length + 1}`, x: 0.35, y: 0.3, width: 0.3, height: 0.4 }); });
        setSelectedId(id);
      }}><Plus size={16} /></IconButton>
      <IconButton title="删除当前互动区域" disabled={!selected || node.hotspots.length <= 1} onClick={() => commit("删除互动区域", changed => { const target = changed.nodes.find(item => item.id === node.id); if (target?.kind === "interaction") target.hotspots = target.hotspots.filter(hotspot => hotspot.id !== selected?.id); })}><Trash2 size={16} /></IconButton>
      <div className="spacer" /><span className="resolution">{project.width} × {project.height}</span>
    </div>}
    <div className="stage-scroll">
      <div className="stage-canvas" ref={stageRef} style={{ aspectRatio: `${project.width} / ${project.height}`, background: project.ui.background }}>
        <div className="stage-master" style={{ position: "absolute", inset: 0, transform: cameraTransform(stage.camera), transformOrigin: "center", pointerEvents: "none" }}>
        {stage.backgroundId && <img className="stage-background" src={assetUrl(stage.backgroundId)} alt="互动场景背景" draggable={false} />}
        {[...stage.actors.values()].sort((left, right) => left.layer - right.layer).map(actor => {
          const character = effectiveCharacter(project, actor.characterId);
          const expression = character?.expressions.find(item => item.id === actor.expressionId);
          const asset = project.assets.find(asset => asset.id === expression?.assetId);
          return expression ? <div className="text-stage-actor" key={actorKey(actor)} style={{ left: `${actor.x * 100}%`, top: `${actor.y * 100}%`, height: `${((asset?.height ?? project.height * .88) / project.height) * 100}%`, width: asset?.width ? `${asset.width / project.width * 100}%` : undefined, transform: `translate(-50%, -100%) scale(${actor.scale}) rotate(${actor.rotation}deg)`, transformOrigin: "50% 100%", opacity: actor.opacity, zIndex: actor.layer, pointerEvents: "none" }}><img src={assetUrl(expression.assetId)} alt={character?.name} draggable={false} /></div> : null;
        })}
        </div>
        {node.hotspots.map(hotspot => {
          const current = draft?.id === hotspot.id ? draft : hotspot;
          const active = selected?.id === hotspot.id;
          return <div key={hotspot.id} role="button" tabIndex={editable ? 0 : -1} aria-label={`互动区域 ${hotspot.name}`} aria-pressed={active}
            style={{ position: "absolute", left: `${current.x * 100}%`, top: `${current.y * 100}%`, width: `${current.width * 100}%`, height: `${current.height * 100}%`, border: `2px solid ${active ? "#e9b773" : "#67bac7"}`, background: active ? "#e9b77326" : "#67bac718", zIndex: 110 + node.hotspots.indexOf(hotspot), touchAction: "none", cursor: editable ? "move" : "default", minWidth: 0, outlineOffset: 2 }}
            onFocus={() => { if (editable) setSelectedId(hotspot.id); }}
            onPointerDown={event => {
              if (!editable || event.button !== 0) return;
              event.preventDefault(); event.stopPropagation(); setSelectedId(hotspot.id);
              const mode = (event.target as HTMLElement).closest('[data-resize]') ? "resize" : "move";
              setDrag({ id: hotspot.id, mode, clientX: event.clientX, clientY: event.clientY, initial: hotspot }); setDraft(hotspot);
              event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              if (!editable || drag?.id !== hotspot.id || !stageRef.current) return;
              const bounds = stageRef.current.getBoundingClientRect();
              const dx = (event.clientX - drag.clientX) / bounds.width;
              const dy = (event.clientY - drag.clientY) / bounds.height;
              const initial = drag.initial;
              setDraft(drag.mode === "move"
                ? { ...initial, x: Math.min(1 - initial.width, Math.max(0, initial.x + dx)), y: Math.min(1 - initial.height, Math.max(0, initial.y + dy)) }
                : { ...initial, width: Math.min(1 - initial.x, Math.max(0.01, initial.width + dx)), height: Math.min(1 - initial.y, Math.max(0.01, initial.height + dy)) });
            }}
            onPointerUp={event => { if (editable && drag?.id === hotspot.id && draft) update(draft); setDrag(undefined); setDraft(undefined); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onPointerCancel={() => { setDrag(undefined); setDraft(undefined); }}
            onKeyDown={event => {
              if (!editable) return;
              const movement = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
              if (!movement) return;
              event.preventDefault(); event.stopPropagation(); const amount = event.shiftKey ? 0.05 : 0.01;
              update({ ...hotspot, x: Math.min(1 - hotspot.width, Math.max(0, hotspot.x + movement[0] * amount)), y: Math.min(1 - hotspot.height, Math.max(0, hotspot.y + movement[1] * amount)) });
            }}>
            <span title={hotspot.name} style={{ display: "block", fontSize: 12, padding: "2px 5px", color: "#ffffff", background: "#172027dd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%", pointerEvents: "none" }}>{hotspot.name}</span>
            {editable && active && <span data-resize="true" title="调整区域尺寸" style={{ position: "absolute", right: 0, bottom: 0, width: 22, height: 22, display: "grid", placeItems: "center", color: "#172027", background: "#e9b773", cursor: "nwse-resize" }}><Expand size={14} /></span>}
          </div>;
        })}
      </div>
      {selected && <div className="actor-toolbar"><span><MousePointer2 size={15} />{selected.name}</span><span>{Math.round(selected.x * 100)}%, {Math.round(selected.y * 100)}%</span><span>{Math.round(selected.width * 100)}% × {Math.round(selected.height * 100)}%</span><div className="spacer" /><span>{project.nodes.find(target => target.id === selected.target)?.name ?? "未连接"}</span></div>}
      <div className="stage-line-list">{node.hotspots.map((hotspot, index) => <button key={hotspot.id} className={selected?.id === hotspot.id ? "active" : ""} onClick={() => setSelectedId(hotspot.id)}><span>{index + 1}</span><strong>{hotspot.name}</strong><span>{hotspot.characterId ? project.characters.find(character => character.id === hotspot.characterId)?.name ?? "角色缺失" : "场景区域"}</span><small>{project.nodes.find(target => target.id === hotspot.target)?.name ?? "未连接"}</small></button>)}</div>
    </div>
  </div>;
}

function cameraTransform(camera: PreviewCamera) {
  return `translate(${camera.x * 100}%, ${camera.y * 100}%) rotate(${camera.rotation}deg) scale(${camera.zoom})`;
}

export function hexOpacity(hex: string, opacity: number) {
  return `${hex}${Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0")}`;
}
