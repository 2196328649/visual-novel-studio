import type { BlueprintGraph, VariableValue } from '../core/model';

/** Values evaluated by execution nodes belong to one invocation, not the graph asset. */
export function blueprintInvocationDefaults(graph: BlueprintGraph, byId: ReadonlyMap<string, BlueprintGraph>) {
  const values: Record<string, VariableValue | undefined> = {};
  for (const pin of graph.exposedOutputs) values['vn_bp_out_' + graph.id + '_' + pin.id] = pin.defaultValue;
  for (const node of graph.nodes) {
    if (node.type === 'showUiPage') {
      values['vn_bp_page_result_' + node.id] = ''; values['vn_bp_page_reason_' + node.id] = ''; values['vn_bp_page_target_' + node.id] = '';
      for (const pin of node.pins.filter(pin => pin.direction === 'output' && pin.id.startsWith('out_'))) values['vn_bp_page_' + pin.id + '_' + node.id] = pin.defaultValue;
    }
    if (node.type === 'startTask' || node.type === 'debounce') values['vn_bp_task_handle_' + node.id] = '';
    if (node.type === 'focusUiComponent') values['vn_bp_focus_accepted_' + node.id] = false;
    if (node.type === 'cancelTask') values['vn_bp_task_cancelled_' + node.id] = false;
    if (node.type === 'waitTask') values['vn_bp_task_reason_' + node.id] = '';
    if (node.type === 'callFunction' || node.type === 'callMacro' || node.type === 'waitTask') {
      for (const pin of byId.get(String(node.properties.graphId))?.exposedOutputs ?? []) values['vn_bp_result_' + node.id + '_' + pin.id] = pin.defaultValue;
    }
  }
  return values;
}

export const blueprintInvocationRuntime = `default vn_bp_frame = None
default vn_bp_frame_serial = 0

init python:
    def vn_bp_enter_frame(graph_id, values, async_handle=None):
        global vn_bp_frame_serial
        vn_bp_frame_serial += 1
        return vn_bp_track_frame(dict(id=vn_bp_frame_serial, graph=graph_id, values=dict(values), locals={}), async_handle)

    def vn_bp_local(name, fallback=None):
        # Only pre-frame saves may fall back to generated store slots. A new
        # invocation must never inherit a value it has not evaluated itself.
        if vn_bp_frame is None:
            return getattr(renpy.store, name, fallback)
        if vn_bp_frame.get("legacyValues") and name not in vn_bp_frame.get("values", {}):
            return getattr(renpy.store, name, fallback)
        return vn_bp_frame.get("values", {}).get(name, fallback)

    def vn_bp_capture_local(name, value):
        global vn_bp_frame
        if vn_bp_frame is not None:
            values = dict(vn_bp_frame.get("values", {}))
            values[name] = value
            vn_bp_frame = dict(vn_bp_frame, values=values)
        return value

    def vn_bp_publish_frame():
        # Keep the legacy generated slots available for script integrations
        # and diagnostics. Internal data pins read the call frame instead.
        for name, value in (vn_bp_frame or {}).get("values", {}).items():
            setattr(renpy.store, name, value)
`;
