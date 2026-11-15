/** Controls reuse the rollback/save-owned call and page records of author variables. */
export const blueprintFlowControlRuntime = `init python:
    def vn_bp_control_step(scope, page_id, graph_id, node_id, kind, entry, initially_closed):
        global vn_bp_frame, vn_ui_state_records
        entries = ("exec_in", "reset") if kind == "doOnce" else ("exec_in", "open", "close", "toggle", "reset")
        if kind not in ("doOnce", "gate") or entry not in entries or scope not in ("call", "page") or not isinstance(initially_closed, bool):
            raise Exception("状态型节点的入口、作用域或初始值无效。")
        if scope == "call":
            if vn_bp_frame is None:
                vn_bp_frame = dict(graph=graph_id, values={}, locals={}, legacyValues=True)
            if vn_bp_frame.get("graph") != graph_id:
                raise Exception("状态型节点不能跨调用帧读写。")
            controls = dict(vn_bp_frame.get("controls", {}))
            key = node_id
        else:
            task, owner = vn_ui_state_owner(page_id)
            record = vn_ui_state_records.get(owner, {})
            controls = dict(record.get("controls", {}))
            key = (graph_id, node_id)
        closed = controls.get(key, initially_closed)
        if not isinstance(closed, bool):
            closed = initially_closed
        if entry == "exec_in":
            output = "blocked" if closed else "exec_out"
            if kind == "doOnce":
                closed = True
        else:
            output = "updated"
            if entry == "reset":
                closed = False if kind == "doOnce" else initially_closed
            elif entry == "open":
                closed = False
            elif entry == "close":
                closed = True
            else:
                closed = not closed
        controls[key] = closed
        if scope == "call":
            vn_bp_frame = dict(vn_bp_frame, controls=controls)
        else:
            records = dict(vn_ui_state_records)
            records[owner] = dict(record, task=task, page=page_id, controls=controls)
            vn_ui_state_records = records
        # Preserve a transition even when its first downstream interaction is saved.
        renpy.retain_after_load()
        return output
`;
