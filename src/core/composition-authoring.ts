import { cloneData } from "./project-mutation";
import { projectGraphs, addProjectGraphs } from './project-resources';
import { makeId, type BlueprintGraph, type BlueprintNode, type Project, type VariableValue, type VisualObject } from './model';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs, rawSavedBlueprintAction } from './blueprint-authoring';
import { applyVisualInputs, createVisualObject, syncVisualPins, updateVisualNodeObject, visualInputFields, visualPose } from './visual-object';
import { arrangePerformanceTimeline, insertTimelineAction, performanceTimeline } from './performance-timeline';
import { addCompositionChild, compositionFieldBinding, compositionObject, compositionTimeline } from './composition-timeline';
import { addVisualParameter, visualAtPath, visualFieldIdentity, visualValue, type VisualPath } from './visual-parameters';
import { compositionResourceRoot, instantiateVisualComposition, materializeVisualCompositions, assertCompositionInsertion } from './visual-composition';
import { renewVisualIdentities, visualInstancePath } from './visual-selection';
import { availableBlueprintName } from './blueprint-names';
import { chapterSource } from './chapter';
import { blueprintInputValue, connectBlueprintPins, createBlueprintGraph } from './blueprint';
import { performanceTiming } from './performance-timing';

function timelineDataLinks(graph: BlueprintGraph) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  return graph.links.filter(link => nodes.get(link.fromNodeId)?.pins.find(pin => pin.id === link.fromPinId)?.dataType !== 'exec');
}

/** A group paints on one parent layer. Reject a move across visible, unselected work. */
function assertTimelineGroupLayers(model: ReturnType<typeof performanceTimeline>, selected: Set<string>) {
  const rows = new Map(model.tracks.map((track, index) => [track.id, index]));
  const front = Math.min(...model.clips.filter(clip => selected.has(clip.nodeId)).map(clip => rows.get(clip.trackId)!));
  const intervals = new Map(model.clips.map(clip => {
    let at = clip.at;
    const ranges: { at: number; until: number }[] = [];
    for (const action of model.actionsByNode.get(clip.nodeId) ?? []) {
      const timing = performanceTiming([action]);
      if (action.kind === 'visual' || action.kind === 'show' || action.kind === 'chapter') {
        const until = action.kind === 'show' || action.kind === 'visual' && action.persistent ? Infinity : at + timing.until;
        if (until > at) ranges.push({ at, until });
      }
      at += timing.at;
    }
    return [clip.nodeId, ranges] as const;
  }));
  for (const clip of model.clips.filter(clip => selected.has(clip.nodeId))) {
    const row = rows.get(clip.trackId)!;
    for (const other of model.clips.filter(other => !selected.has(other.nodeId))) {
      const otherRow = rows.get(other.trackId)!;
      if (otherRow < front || otherRow > row) continue;
      // Include the front selected row: an unselected clip later on that row
      // can still cover a long selected clip on a lower row.
      if (intervals.get(clip.nodeId)!.some(a => intervals.get(other.nodeId)!.some(b => a.at < b.until && b.at < a.until))) {
        throw new Error('组合会改变与未选片段的前后遮挡关系，请把夹在中间的画面片段一同选中，或先调整轨道。');
      }
    }
  }
}

export function remapCompositionNode(graph: BlueprintGraph, node: BlueprintNode, root: VisualObject) {
  const before = rawSavedBlueprintAction(node);
  if (before?.kind !== 'visual') throw new Error('找不到画面片段。');
  const old = visualInputFields(before), next = visualInputFields(root);
  const matches = new Map(next.map(field => [visualFieldIdentity(root, field.path), 'object_' + field.key]));
  const pins = new Map(old.map(field => ['object_' + field.key, matches.get(visualFieldIdentity(before, field.path))]));
  const literals = Object.entries(node.properties).filter(([key]) => key.startsWith('object_'));
  for (const [key] of literals) delete node.properties[key];
  updateVisualNodeObject(node, root);
  for (const [key, value] of literals) { const target = pins.get(key); if (target) node.properties[target] = value; }
  graph.links = graph.links.flatMap(link => {
    if (link.toNodeId !== node.id || !link.toPinId.startsWith('object_')) return [link];
    const target = pins.get(link.toPinId); return target ? [{ ...link, toPinId: target }] : [];
  });
}

export function groupCompositionSelection(project: Project, graph: BlueprintGraph, nodeId: string, groupId: string, ids: string[]) {
  const model = compositionTimeline(project, graph, nodeId, groupId), selected = model.children.filter(child => ids.includes(child.object.instanceId));
  if (!selected.length) throw new Error('先选中要组合的片段。');
  if (model.group.object.compositionId) throw new Error('请先打开组合资源，或转为本地组合。');
  const selectedRows = selected.map(child => model.children.indexOf(child));
  if (Math.max(...selectedRows) - Math.min(...selectedRows) + 1 !== selected.length) {
    throw new Error('组合会改变与未选片段的前后遮挡关系，请把夹在中间的画面片段一同选中，或先调整层级。');
  }
  const root = cloneData(model.group.root), parent = visualAtPath(root, model.group.path);
  const children = parent.children!.filter(child => ids.includes(child.instanceId));
  const start = Math.min(...children.map(child => child.startAt ?? 0));
  const group = createVisualObject('group'); group.name = '演出组合'; group.startAt = start;
  group.duration = Math.max(...selected.map(child => (child.at - model.group.at + child.action.duration) / model.group.scale)) - start;
  group.retimeOnDuration = true; group.layer = Math.max(...children.map(child => child.layer));
  group.children = children.map(child => ({ ...child, startAt: (child.startAt ?? 0) - start }));
  // Equal layers paint in array order. Place the group where its frontmost
  // selected layer lived, rather than where a lower selected sibling occurred.
  const firstFront = parent.children!.findIndex(child => ids.includes(child.instanceId) && child.layer === group.layer);
  const index = parent.children!.slice(0, firstFront).filter(child => !ids.includes(child.instanceId)).length;
  parent.children = parent.children!.filter(child => !ids.includes(child.instanceId)); parent.children.splice(index, 0, group);
  remapCompositionNode(graph, model.group.node, root);
  return group.instanceId;
}

export function groupTimelineSelection(project: Project, graph: BlueprintGraph, ids: string[]) {
  const model = performanceTimeline(project, graph), clips = model.clips.filter(clip => ids.includes(clip.nodeId));
  if (model.reason) throw new Error(model.reason);
  if (!clips.length) throw new Error('先选中要组合的片段。');
  const selected = new Set(clips.map(clip => clip.nodeId));
  assertTimelineGroupLayers(model, selected);
  const sources = clips.map(clip => ({ clip, node: graph.nodes.find(item => item.id === clip.nodeId)!, raw: rawSavedBlueprintAction(graph.nodes.find(item => item.id === clip.nodeId)!) }));
  if (sources.some(source => source.raw?.kind !== 'visual')) return groupTimelineAsComponent(project, graph, ids);
  const start = Math.min(...clips.map(clip => clip.at)), group = createVisualObject('group');
  group.name = '演出组合'; group.retimeOnDuration = true; group.duration = Math.max(...clips.map(clip => clip.at + clip.duration)) - start;
  group.children = sources.map(({ clip, raw }) => ({ ...cloneData(raw as VisualObject), startAt: clip.at - start, layer: (model.tracks.length - model.tracks.findIndex(track => track.id === clip.trackId)) * 1000 }));
  const inputs = sources.flatMap(({ node, raw }) => visualInputFields(raw as VisualObject).map(field => ({ identity: visualFieldIdentity(raw as VisualObject, field.path), value: node.properties['object_' + field.key], links: graph.links.filter(link => link.toNodeId === node.id && link.toPinId === 'object_' + field.key) })));
  const newId = insertTimelineAction(project, graph, group, start, makeId('track'));
  const node = graph.nodes.find(item => item.id === newId)!, fields = new Map(visualInputFields(group).map(field => [visualFieldIdentity(group, field.path), field]));
  for (const input of inputs) {
    const field = fields.get(input.identity); if (!field) continue;
    if (input.value !== undefined) node.properties['object_' + field.key] = input.value;
    for (const link of input.links) graph.links.push({ ...link, id: makeId('link'), toNodeId: newId, toPinId: 'object_' + field.key });
  }
  const updated = performanceTimeline(project, graph), grouped = updated.clips.find(clip => clip.nodeId === newId)!;
  const trackIndex = Math.min(...clips.map(clip => model.tracks.findIndex(track => track.id === clip.trackId)));
  const tracks = [...model.tracks]; tracks.splice(trackIndex, 0, { id: grouped.trackId, name: group.name });
  arrangePerformanceTimeline(project, graph, [...model.clips.filter(clip => !ids.includes(clip.nodeId)), { ...grouped, at: start }], tracks);
  return newId;
}

export function duplicateTimelineSelection(project: Project, graph: BlueprintGraph, ids: string[]) {
  const model = performanceTimeline(project, graph), selected = model.clips.filter(clip => ids.includes(clip.nodeId));
  if (model.reason) throw new Error(model.reason);
  if (!selected.length) throw new Error('先选中要复制的片段。');
  if (selected.length !== new Set(ids).size) throw new Error('部分片段已不存在，请重新选择。');
  const selectedRows = selected.map(clip => model.tracks.findIndex(track => track.id === clip.trackId));
  // Keep the selected layer span, including gaps and clips sharing one track.
  const sourceTracks = model.tracks.slice(Math.min(...selectedRows), Math.max(...selectedRows) + 1);
  if (model.clips.length + selected.length > 240 || model.tracks.length + sourceTracks.length > 64) throw new Error('一张演出轨道最多 240 个片段、64 条轨道。');
  const copyTracks = sourceTracks.map(track => ({ id: makeId('track'), name: (track.name + ' 副本').slice(0, 120) }));
  const tracks = new Map(sourceTracks.map((track, index) => [track.id, copyTracks[index].id]));
  const offset = Math.max(...selected.map(clip => clip.at + clip.duration)) - Math.min(...selected.map(clip => clip.at));
  const dataLinks = timelineDataLinks(graph);
  // Prepare every identity before reconnecting data, including references to
  // another selected clip that has not yet been appended to the execution chain.
  const duplicates = selected.map(clip => {
    const node = cloneData(graph.nodes.find(item => item.id === clip.nodeId)!); node.id = makeId('bpnode');
    const action = rawSavedBlueprintAction(node);
    let pins: Map<string, string> | undefined;
    if (action?.kind === 'visual') {
      const before = visualInputFields(action);
      renewVisualIdentities(action, () => makeId('object'));
      action.name = (action.name + ' 副本').slice(0, 120);
      // Child inputs are keyed by object identity. Renew their input IDs along
      // with literals and incoming links, without changing the original graph.
      const fields = new Map(visualInputFields(action).map(field => [JSON.stringify(field.path), 'object_' + field.key]));
      pins = new Map(before.map(field => ['object_' + field.key, fields.get(JSON.stringify(field.path))!]));
      node.pins.forEach(pin => { pin.id = pins!.get(pin.id) ?? pin.id; });
      const literals = Object.entries(node.properties).filter(([key]) => key.startsWith('object_'));
      for (const [key] of literals) delete node.properties[key];
      for (const [key, value] of literals) node.properties[pins.get(key) ?? key] = value;
      node.properties.action = JSON.stringify(action); node.name = action.name;
      syncVisualPins(node, action);
    }
    else if (action?.kind === 'audioClip') { node.name = (action.name + ' 副本').slice(0, 120); node.properties.action = JSON.stringify({ ...action, instanceId: makeId('audio'), name: node.name }); }
    return { clip, node, pins };
  });
  const bySource = new Map(duplicates.map(copy => [copy.clip.nodeId, copy]));
  let previous = graph.nodes.find(node => node.id === graph.timeline?.tailNodeId) ?? graph.nodes.find(node => node.id === model.clips.at(-1)?.nodeId) ?? graph.nodes.find(node => node.type === 'event')!;
  const previousPin = previous.type === 'event' ? 'exec' : 'exec_out';
  const outgoing = graph.links.find(link => link.fromNodeId === previous.id && link.fromPinId === previousPin);
  if (outgoing) graph.links = graph.links.filter(link => link.id !== outgoing.id);
  const copies = duplicates.map(({ clip, node, pins }) => {
    graph.nodes.push(node);
    graph.links.push(...dataLinks.filter(link => link.toNodeId === clip.nodeId).map(link => {
      const source = bySource.get(link.fromNodeId);
      return { ...link, id: makeId('link'), fromNodeId: source?.node.id ?? link.fromNodeId, fromPinId: source?.pins?.get(link.fromPinId) ?? link.fromPinId, toNodeId: node.id, toPinId: pins?.get(link.toPinId) ?? link.toPinId };
    }));
    const error = connectBlueprintPins(graph, previous.id, previous.type === 'event' ? 'exec' : 'exec_out', node.id, 'exec_in');
    if (error) throw new Error(error);
    previous = node;
    return { ...clip, nodeId: node.id, at: clip.at + offset, trackId: tracks.get(clip.trackId)! };
  });
  if (outgoing) {
    const error = connectBlueprintPins(graph, previous.id, 'exec_out', outgoing.toNodeId, outgoing.toPinId);
    if (error) throw new Error(error);
  }
  arrangePerformanceTimeline(project, graph, [...model.clips, ...copies], [...model.tracks, ...copyTracks]);
  return copies.map(clip => clip.nodeId);
}

/** Mixed selections retain their tracks and data links inside a callable timeline. */
function groupTimelineAsComponent(project: Project, graph: BlueprintGraph, ids: string[]) {
  if (projectGraphs(project).length >= 256) throw new Error('组合资源数量已达上限。');
  const model = performanceTimeline(project, graph), selected = model.clips.filter(clip => ids.includes(clip.nodeId));
  const selectedIds = new Set(selected.map(clip => clip.nodeId)), dataLinks = timelineDataLinks(graph);
  if (dataLinks.some(link => selectedIds.has(link.fromNodeId) && !selectedIds.has(link.toNodeId))) {
    throw new Error('所选片段的输出仍连接到组合外，请将相关片段一同选中，或先调整数据连线。');
  }
  const start = Math.min(...selected.map(clip => clip.at));
  const child = createBlueprintGraph('effect', availableBlueprintName(project, '演出组合')); child.timelineComponent = true; child.compositionContainer = true;
  const event = child.nodes[0]; child.nodes.push(...graph.nodes.filter(node => selectedIds.has(node.id)).map(node => cloneData(node)));
  child.links = dataLinks.filter(link => selectedIds.has(link.fromNodeId) && selectedIds.has(link.toNodeId)).map(link => cloneData(link));
  let previous = event;
  for (const clip of [...selected].sort((a, b) => a.at - b.at)) { connectBlueprintPins(child, previous.id, previous.type === 'event' ? 'exec' : 'exec_out', clip.nodeId, 'exec_in'); previous = child.nodes.find(node => node.id === clip.nodeId)!; }
  const incoming = dataLinks.filter(link => selectedIds.has(link.toNodeId) && !selectedIds.has(link.fromNodeId));
  const readers = new Map<string, { id: string; readerId: string; source: typeof incoming[number] }>();
  for (const link of incoming) {
    const target = child.nodes.find(node => node.id === link.toNodeId)!, pin = target.pins.find(pin => pin.id === link.toPinId)!;
    const key = link.fromNodeId + '/' + link.fromPinId, existing = readers.get(key);
    if (existing) { connectBlueprintPins(child, existing.readerId, 'value', target.id, pin.id); continue; }
    const source = graph.nodes.find(node => node.id === link.fromNodeId), sourceInput = source?.type === 'getInput' ? graph.exposedInputs.find(pin => pin.id === source.properties.inputId) : undefined;
    let name = sourceInput?.name ?? pin.name, index = 2; const base = name;
    while (child.exposedInputs.some(pin => pin.name === name)) name = base + ' ' + index++;
    exposePerformanceInputs(child, [{ nodeId: target.id, pinId: pin.id, name, dataType: pin.dataType, defaultValue: sourceInput?.defaultValue ?? blueprintInputValue(target, pin.id) ?? (pin.dataType === 'number' ? 0 : pin.dataType === 'boolean' ? false : '') }]);
    const input = child.exposedInputs.at(-1)!; readers.set(key, { id: input.id, readerId: child.nodes.at(-1)!.id, source: link });
  }
  addProjectGraphs(project, child);
  const tracks = model.tracks.filter(track => selected.some(clip => clip.trackId === track.id));
  arrangePerformanceTimeline(project, child, selected.map(clip => ({ ...clip, at: clip.at - start })), tracks);
  const newId = insertTimelineAction(project, graph, { kind: 'blueprint', blueprintId: child.id }, start, makeId('track'));
  for (const reader of readers.values()) { const error = connectBlueprintPins(graph, reader.source.fromNodeId, reader.source.fromPinId, newId, 'arg_' + reader.id); if (error) throw new Error(error); }
  const updated = performanceTimeline(project, graph), grouped = updated.clips.find(clip => clip.nodeId === newId)!;
  const nextTracks = [...model.tracks]; nextTracks.splice(Math.min(...selected.map(clip => model.tracks.findIndex(track => track.id === clip.trackId))), 0, { id: grouped.trackId, name: child.name });
  arrangePerformanceTimeline(project, graph, [...model.clips.filter(clip => !ids.includes(clip.nodeId)), { ...grouped, at: start }], nextTracks);
  return newId;
}

export function exposeCompositionProperty(project: Project, graph: BlueprintGraph, nodeId: string, groupId: string, targetId: string, tail: VisualPath, name: string, dataType: 'number' | 'string' | 'boolean' | 'asset', value: VariableValue, existingId?: string) {
  const view = compositionObject(project, graph, nodeId, groupId), root = cloneData(view.root), group = visualAtPath(root, view.path);
  const targetPath = visualInstancePath(root, targetId)!;
  const physicalPath = [...targetPath.flatMap(index => ['children', index]), ...tail];
  const beforeField = visualInputFields(view.root).find(field => JSON.stringify(field.path) === JSON.stringify(physicalPath));
  const oldPin = beforeField && 'object_' + beforeField.key;
  const oldValue = oldPin ? view.node.properties[oldPin] : undefined;
  const oldLinks = oldPin ? graph.links.filter(link => link.toNodeId === nodeId && link.toPinId === oldPin).map(link => link.id) : [];
  const parameterId = addVisualParameter(group, targetId, tail, dataType, value, name, existingId);
  remapCompositionNode(graph, view.node, root);
  const field = visualInputFields(root).find(field => JSON.stringify(field.path) === JSON.stringify([...view.path.flatMap(index => ['children', index]), 'parameterValues', parameterId]))!;
  if (oldPin) delete view.node.properties[oldPin];
  if (existingId) graph.links = graph.links.filter(link => !oldLinks.includes(link.id));
  else {
    if (oldValue !== undefined) view.node.properties['object_' + field.key] = oldValue;
    graph.links.forEach(link => { if (oldLinks.includes(link.id)) link.toPinId = 'object_' + field.key; });
  }
  return parameterId;
}

export function saveCompositionResource(project: Project, graph: BlueprintGraph, nodeId: string, instanceId: string, name?: string) {
  if (projectGraphs(project).length >= 256) throw new Error('组合资源数量已达上限。');
  const view = compositionObject(project, graph, nodeId, instanceId);
  if (view.object.content !== 'group') throw new Error('先制作或选中一个组合。');
  if (view.object.compositionId) return view.object.compositionId;
  const root = cloneData(view.action); delete root.startAt;
  const resource = blueprintFromPerformance(project, [root], availableBlueprintName(project, name ?? root.name));
  resource.timelineComponent = true; resource.visualComposition = true;
  addProjectGraphs(project, resource);
  const model = performanceTimeline(project, resource); arrangePerformanceTimeline(project, resource, model.clips, model.tracks);
  const resourceNode = resource.nodes.find(item => item.type === 'savedAction')!;
  for (const parameter of root.parameters ?? []) {
    const field = visualInputFields(root).find(field => field.path[0] === 'parameterValues' && field.path[1] === parameter.id)!;
    const input = performanceInputs(resource).find(input => input.nodeId === resourceNode.id && input.pinId === 'object_' + field.key)!;
    exposePerformanceInputs(resource, [{ ...input, name: parameter.name }]);
  }
  return resource.id;
}

export function insertCompositionResource(project: Project, graph: BlueprintGraph, resourceId: string, at: number, trackId?: string) {
  assertCompositionInsertion(project, graph.id, resourceId);
  const resource = projectGraphs(project).find(item => item.id === resourceId);
  if (resource?.compositionContainer || resource?.timeline && !resource.visualComposition) {
    if (resourceId === graph.id) throw new Error('组合资源不能调用自身。');
    return insertTimelineAction(project, graph, { kind: 'blueprint', blueprintId: resourceId }, at, trackId);
  }
  const object = instantiateVisualComposition(project, resourceId, makeId('object'));
  materializeVisualCompositions(project, object, [graph.id]);
  return insertTimelineAction(project, graph, object, at, trackId);
}

export function detachCompositionResource(project: Project, graph: BlueprintGraph, nodeId: string, instanceId: string) {
  const view = compositionObject(project, graph, nodeId, instanceId), expanded = materializeVisualCompositions(project, view.object);
  delete expanded.compositionId;
  updateVisualNodeObject(view.node, expanded);
}

export function renameCompositionParameter(project: Project, graph: BlueprintGraph, nodeId: string, instanceId: string, id: string, name: string) {
  const view = compositionObject(project, graph, nodeId, instanceId), object = cloneData(view.object), parameter = object.parameters?.find(item => item.id === id);
  const clean = name.trim();
  if (!parameter || !clean || /[\n，,=：:【】]/.test(clean) || object.parameters?.some(item => item.id !== id && item.name === clean)) throw new Error('参数名称不能为空、重复或包含标点分隔符。');
  parameter.name = clean.slice(0, 120); updateVisualNodeObject(view.node, object);
}

export function removeCompositionParameter(project: Project, graph: BlueprintGraph, nodeId: string, instanceId: string, id: string) {
  const view = compositionObject(project, graph, nodeId, instanceId), object = cloneData(view.object);
  const field = visualInputFields(object).find(field => field.path[0] === 'parameterValues' && field.path[1] === id);
  if (!field) return;
  const value = view.action.parameterValues?.[id] ?? field.value;
  const baked = applyVisualInputs(object, { [field.key]: value });
  baked.parameters = baked.parameters?.filter(parameter => parameter.id !== id); delete baked.parameterValues?.[id];
  updateVisualNodeObject(view.node, baked);
}

export function addCompositionGlyphParticles(project: Project, graph: BlueprintGraph, nodeId: string, groupId: string, sourceId: string) {
  const source = compositionObject(project, graph, nodeId, sourceId), parent = compositionObject(project, graph, nodeId, groupId);
  if (!['text', 'image'].includes(source.object.content)) throw new Error('选择文字或图片来生成字形粒子。');
  const particle = cloneData(source.action); particle.instanceId = makeId('object'); particle.content = 'particles'; particle.name = (source.object.name + ' · 粒子').slice(0, 120);
  const pose = visualPose(source.action, source.action.duration), neutral = pose.scale === 1 && pose.rotation === 0;
  particle.width = particle.height = 1; particle.color = '#ffffff';
  particle.keyframes = [{ ...pose, opacity: source.action.keyframes[0].opacity, ...(neutral ? { x: .5, y: .5 } : {}), duration: 0, easing: 'linear' }];
  delete particle.curves; delete particle.dissolve; delete particle.ripple; delete particle.maskAssetId; delete particle.characterId; delete particle.expressionId;
  particle.glyphParticles = { source: source.object.content === 'text' ? 'text' : 'image', assetId: source.action.assetId, count: 200, seed: 0, emissionStart: (chapterSource.timing.move + chapterSource.timing.holdTitle) * particle.duration / chapterSource.timing.duration, timeScale: chapterSource.timing.duration / particle.duration, sizeScale: 1, motionScale: 1, rect: { x: (neutral ? pose.x : .5) - source.action.width / 2, y: (neutral ? pose.y : .5) - source.action.height / 2, width: source.action.width, height: source.action.height } };
  const id = addCompositionChild(project, graph, nodeId, groupId, particle, source.at - parent.at);
  const root = rawSavedBlueprintAction(source.node) as VisualObject;
  const newView = compositionObject(project, graph, nodeId, id);
  for (const key of source.object.content === 'text' ? ['text', 'fontSize', 'fontAssetId'] : ['assetId']) {
    const binding = compositionFieldBinding(graph, source, [key]);
    const nextBinding = compositionFieldBinding(graph, newView, key === 'assetId' ? ['glyphParticles', 'assetId'] : [key]);
    if (binding.publicPath) {
      let group = root; const path = binding.publicPath;
      let i = 0; while (path[i] === 'children') { group = group.children![Number(path[i + 1])]; i += 2; }
      group.parameters?.find(parameter => parameter.id === path[i + 1])?.targets.push({ instanceId: id, path: key === 'assetId' ? ['glyphParticles', 'assetId'] : [key] });
    } else if (binding.pinId && nextBinding.pinId) {
      const links = graph.links.filter(link => link.toNodeId === nodeId && link.toPinId === binding.pinId);
      links.forEach(link => graph.links.push({ ...link, id: makeId('link'), toPinId: nextBinding.pinId! }));
    }
  }
  updateVisualNodeObject(source.node, root);
  return id;
}
