import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { useStoreApi, type Connection, type Edge, type FinalConnectionState, type HandleType, type OnConnectStartParams } from '@xyflow/react';
import { blueprintSharedPinHint, canDisconnectWireDrop, pointerOnBlankFlowPane, reconnectWireAtPin, sameWireConnection, wireCanDisconnect, wireCanMovePin, wiresAtPin, type EditableWire, type WirePin } from './blueprint-wire-interaction';

type Gesture<T extends Edge> = { edge?: T; started: boolean; moved: boolean; cancelled: boolean; completed: boolean; blockedDrop?: boolean; x: number; y: number };

/** Start React Flow's native reconnect from the visible pin. Its transparent
 * anchors remain available for programmatic dispatch, but never intercept UI. */
export function useBlueprintPinReconnect<T extends EditableWire>(options: {
  scopeKey: string | undefined;
  canvas: RefObject<HTMLDivElement | null>;
  edges: readonly T[];
  reconnect: (edge: T, connection: Connection) => void;
  disconnect: (edges: T[]) => void;
  notify: (message: string) => void;
}) {
  const store = useStoreApi();
  const latest = useRef(options); latest.current = options;
  const gesture = useRef<Gesture<T> | undefined>(undefined);
  const currentEdge = useRef<T | undefined>(undefined);
  const suppressClick = useRef(false);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearFinishTimer = () => { if (finishTimer.current !== undefined) clearTimeout(finishTimer.current); finishTimer.current = undefined; };
  const callbacks = useRef({
    onMouseDownCapture(event: ReactMouseEvent<HTMLDivElement>) {
      if (event.target instanceof Element && event.target.closest('.react-flow__edgeupdater')) return;
      suppressClick.current = false;
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      const handle = event.target.closest('.react-flow__handle');
      if (!handle || !latest.current.canvas.current?.contains(handle)) return;
      const nodeId = handle.getAttribute('data-nodeid');
      if (!nodeId) return;
      const pin: WirePin = { nodeId, handleId: handle.getAttribute('data-handleid'), type: handle.classList.contains('source') ? 'source' : 'target' };
      const incident = wiresAtPin(latest.current.edges, pin);
      if (event.altKey) {
        store.getState().cancelConnection(); store.setState({ connectionClickStartHandle: null });
        event.preventDefault(); event.stopPropagation(); suppressClick.current = true;
        const editable = incident.filter(wireCanDisconnect);
        if (editable.length) latest.current.disconnect(editable);
        else if (incident.length) latest.current.notify('此端点的连线由运行时决定，不能断开。');
        return;
      }
      // The second click of a click-to-connect operation must reach Handle's
      // native onClick, including when the destination is already occupied.
      if (store.getState().connectionClickStartHandle) return;
      const edge = !event.ctrlKey && !event.metaKey ? reconnectWireAtPin(latest.current.edges, pin) : undefined;
      if (!handle.classList.contains('connectablestart')) return;
      if (!edge && incident.length && !event.ctrlKey && !event.metaKey) {
        if (!incident.some(item => wireCanMovePin(item, pin.type))) {
          event.preventDefault(); event.stopPropagation(); suppressClick.current = true;
          latest.current.notify('请保留此出口，从连线另一端改接目标。'); return;
        }
        latest.current.notify(blueprintSharedPinHint);
      }
      clearFinishTimer();
      currentEdge.current = undefined;
      gesture.current = { edge, started: false, moved: false, cancelled: false, completed: false, x: event.clientX, y: event.clientY };
      if (!edge) return;
      const edgeElement = [...(latest.current.canvas.current?.querySelectorAll('.react-flow__edge') ?? [])].find(element => element.getAttribute('data-id') === edge.id);
      const anchor = edgeElement?.querySelector('.react-flow__edgeupdater-' + pin.type);
      // Never fall back to creating a new wire when an intended reconnect
      // cannot start (e.g. a stale or not-yet-measured endpoint).
      event.preventDefault(); event.stopPropagation(); suppressClick.current = true;
      anchor?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: event.clientX, clientY: event.clientY, view: window }));
    },
    onClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
      if (!suppressClick.current) return;
      suppressClick.current = false; event.preventDefault(); event.stopPropagation();
    },
    onConnectStart(_event: MouseEvent | TouchEvent, _params: OnConnectStartParams) {
      if (gesture.current) gesture.current.started = true;
    },
    onReconnectStart(_event: ReactMouseEvent, edge: T, _type: HandleType) {
      currentEdge.current = edge;
      if (gesture.current) { gesture.current.edge = edge; gesture.current.started = true; }
    },
    onReconnect(edge: T, connection: Connection) {
      const active = gesture.current;
      if (!active || active.cancelled || active.blockedDrop) return;
      active.completed = true;
      if (!sameWireConnection(edge, connection)) latest.current.reconnect(edge, connection);
    },
    onConnectEnd(event: MouseEvent | TouchEvent, state: FinalConnectionState): boolean {
      const active = gesture.current;
      // Native reconnect invokes onConnectEnd before onReconnectEnd. It must
      // never open the ordinary drag-to-create node picker.
      if (active?.edge || active?.cancelled) return true;
      if (!active?.started || !active.moved || state.isValid || state.toNode || state.toHandle) return true;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      return !point || !pointerOnBlankFlowPane(latest.current.canvas.current, point);
    },
    onReconnectEnd(event: MouseEvent | TouchEvent, edge: T, _type: HandleType, state: FinalConnectionState) {
      const active = gesture.current;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      if (active && canDisconnectWireDrop({ ...active, isValid: state.isValid, hasDestination: !!state.toNode || !!state.toHandle, onBlankPane: !!point && pointerOnBlankFlowPane(latest.current.canvas.current, point) })) latest.current.disconnect([edge]);
      clearFinishTimer(); gesture.current = undefined; currentEdge.current = undefined;
    },
    acceptsConnection() { return !gesture.current?.cancelled && !gesture.current?.blockedDrop; },
  });
  useEffect(() => {
    const move = (event: MouseEvent) => {
      const active = gesture.current;
      if (active && Math.hypot(event.clientX - active.x, event.clientY - active.y) > 3) active.moved = true;
    };
    const finish = (event: MouseEvent) => {
      // XYHandle completes on any mouseup. A secondary-button release must
      // cancel before that native bubble listener can reconnect or disconnect.
      if (event.button !== 0) { cancel(); return; }
      const active = gesture.current, canvas = latest.current.canvas.current;
      // A connected pin clicked without dragging keeps React Flow's existing
      // click-to-connect shortcut. Only a real reconnect drag consumes click.
      if (active?.edge && !active.started && !active.moved && !active.cancelled) suppressClick.current = false;
      if (active && canvas) {
        const hit = canvas.ownerDocument.elementFromPoint(event.clientX, event.clientY);
        active.blockedDrop = !hit || !canvas.contains(hit) || !!hit.closest('input, textarea, select, button, [contenteditable="true"], .react-flow__controls, .react-flow__minimap, .react-flow__edgelabel-renderer')
          || !!hit.closest('.react-flow__node') && !hit.closest('.react-flow__handle');
      }
      // Trusted browser events can run microtasks between capture and bubble
      // listeners. Keep this gesture through XYHandle's bubble onPointerUp:
      // onConnect -> onConnectEnd -> onReconnectEnd. A task runs after dispatch.
      if (active) {
        clearFinishTimer();
        finishTimer.current = setTimeout(() => {
          finishTimer.current = undefined;
          if (gesture.current === active) { gesture.current = undefined; currentEdge.current = undefined; }
        }, 0);
      }
    };
    const cancel = () => {
      const active = gesture.current;
      // A store reset or the synthetic native finish can re-enter cancellation.
      // Mark first and dispatch at most once, keeping all mutation gates closed.
      if (active?.cancelled) return;
      if (active) active.cancelled = true;
      store.setState({ connectionClickStartHandle: null }); store.getState().cancelConnection();
      if (!active) return;
      // Finish native listeners and clear their temporary reconnect preview.
      // Mutation callbacks above reject this deliberately cancelled mouseup.
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: active.x, clientY: active.y }));
    };
    // On Windows contextmenu follows the right-button mouseup, which XYHandle
    // otherwise treats as a blank drop. Cancel on press without consuming the
    // event, so the pane/node's normal context menu remains available.
    const down = (event: MouseEvent) => { if (event.button !== 0) cancel(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('mousemove', move, true); document.addEventListener('mouseup', finish, true);
    document.addEventListener('keydown', key, true); document.addEventListener('contextmenu', cancel, true);
    window.addEventListener('blur', cancel); window.addEventListener('pointercancel', cancel);
    return () => {
      document.removeEventListener('mousedown', down, true);
      cancel(); document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseup', finish, true);
      document.removeEventListener('keydown', key, true); document.removeEventListener('contextmenu', cancel, true); window.removeEventListener('blur', cancel); window.removeEventListener('pointercancel', cancel);
      clearFinishTimer(); gesture.current = undefined; currentEdge.current = undefined;
    };
  }, [options.scopeKey, store]);
  return { ...callbacks.current, currentEdge };
}
