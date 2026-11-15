import type { Connection, Edge, HandleType } from '@xyflow/react';

export const blueprintWireShortcuts = '拖动已连接端点改接，空白处松开断线；Esc 取消；Alt+单击断开此端点全部可编辑连线；Ctrl 拖动新建分支。';
export const blueprintSharedPinHint = '先选中要改接的连线，再拖动端点；Alt+单击断开此端点全部连线。';

export interface WirePin { nodeId: string; handleId: string | null; type: HandleType }
export type EditableWire = Edge<{ readonly?: boolean }>;

export function wiresAtPin<T extends EditableWire>(edges: readonly T[], pin: WirePin): T[] {
  return edges.filter(edge => pin.type === 'source'
    ? edge.source === pin.nodeId && (edge.sourceHandle ?? null) === pin.handleId
    : edge.target === pin.nodeId && (edge.targetHandle ?? null) === pin.handleId);
}

export function wireCanDisconnect(edge: EditableWire): boolean {
  return !edge.data?.readonly && edge.deletable !== false && edge.reconnectable !== false;
}

export function wireCanMovePin(edge: EditableWire, type: HandleType): boolean {
  return wireCanDisconnect(edge) && (edge.reconnectable == null || edge.reconnectable === true || edge.reconnectable === type);
}

/** A shared pin never arbitrarily chooses a wire: the unique selected wire wins. */
export function reconnectWireAtPin<T extends EditableWire>(edges: readonly T[], pin: WirePin): T | undefined {
  const candidates = wiresAtPin(edges, pin).filter(edge => wireCanMovePin(edge, pin.type));
  const selected = candidates.filter(edge => edge.selected);
  return selected.length === 1 ? selected[0] : candidates.length === 1 ? candidates[0] : undefined;
}

export function sameWireConnection(edge: Edge, connection: Connection): boolean {
  return edge.source === connection.source && edge.target === connection.target
    && (edge.sourceHandle ?? null) === connection.sourceHandle && (edge.targetHandle ?? null) === connection.targetHandle;
}

export function canDisconnectWireDrop(drop: { started: boolean; moved: boolean; cancelled: boolean; completed: boolean; isValid: boolean | null; hasDestination: boolean; onBlankPane: boolean }): boolean {
  return drop.started && drop.moved && !drop.cancelled && !drop.completed && !drop.isValid && !drop.hasDestination && drop.onBlankPane;
}

export function pointerOnBlankFlowPane(canvas: HTMLElement | null, point: { clientX: number; clientY: number }): boolean {
  if (!canvas) return false;
  const element = canvas.ownerDocument.elementFromPoint(point.clientX, point.clientY);
  if (!element || !canvas.contains(element)) return false;
  // Empty canvas can hit the pane or its decorative background. Node bodies,
  // controls, labels and wire strokes are all deliberate drop cancellation.
  return element.matches('.react-flow__pane') || !!element.closest('.react-flow__background');
}
