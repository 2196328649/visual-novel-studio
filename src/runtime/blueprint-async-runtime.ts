/** Serializable cooperative tasks. No Python generators, OS threads or nested interactions. */
export const blueprintAsyncRuntime = `default vn_bp_temporal_clock = {"elapsed": 0.0}
default vn_bp_live_frames = {}
default vn_bp_async_tasks = {}
default vn_bp_async_serial = 0
default vn_bp_async_finished_serial = 0
default vn_bp_async_cursor = 0

init python:
    def vn_bp_time_now():
        global vn_bp_temporal_clock
        now = renpy.display.core.get_time()
        sample = getattr(vn_bp_time_now, "sample", None)
        delta = max(0.0, now - sample[1]) if sample and sample[0] is vn_bp_temporal_clock else 0.0
        vn_bp_temporal_clock = dict(elapsed=vn_bp_temporal_clock.get("elapsed", 0.0) + delta)
        vn_bp_time_now.sample = (vn_bp_temporal_clock, now)
        renpy.retain_after_load()
        return vn_bp_temporal_clock["elapsed"]

    def vn_bp_track_frame(frame, async_handle=None):
        global vn_bp_live_frames
        vn_bp_live_frames = dict(vn_bp_live_frames, **{str(frame["id"]): dict(kind="async" if async_handle else "label", depth=len(renpy.game.contexts), until=0.0)})
        return frame

    def vn_bp_release_frame(frame):
        global vn_bp_live_frames
        if frame and str(frame.get("id")) in vn_bp_live_frames:
            vn_bp_live_frames = {key: value for key, value in vn_bp_live_frames.items() if key != str(frame["id"])}
            for handle, record in list(vn_bp_async_tasks.items()):
                if record.get("ownerFrame") == frame["id"] and vn_bp_async_active(record):
                    vn_bp_async_finish(handle, "cancelled", "callEnded")

    def vn_bp_require_frame(graph_id):
        global vn_bp_frame
        if vn_bp_frame is None or vn_bp_frame.get("graph") != graph_id:
            raise Exception("调用内任务需要本图的有效调用帧。")
        if str(vn_bp_frame.get("id")) not in vn_bp_live_frames:
            # Pre-task saves can contain a valid invocation but no lease table.
            # Adopt it copy-on-write; do not discard its locals/controls/results.
            previous = vn_bp_frame
            defaults = dict(vn_bp_async_graphs.get(graph_id, {}).get("defaults", {}))
            defaults.update(previous.get("values", {}))
            fresh = vn_bp_enter_frame(graph_id, defaults)
            vn_bp_frame = dict(previous, id=fresh["id"], graph=graph_id, values=defaults, locals=dict(previous.get("locals", {})), legacyValues=previous.get("legacyValues", "values" not in previous))
        return vn_bp_frame

    def vn_bp_leave_frame():
        vn_bp_release_frame(vn_bp_frame)

    def vn_bp_close_label_frames_since(before):
        for key, record in list(vn_bp_live_frames.items()):
            if key not in before and record.get("kind") == "label":
                vn_bp_release_frame(dict(id=int(key)))

    def vn_bp_async_after_load():
        global vn_bp_async_finished_serial
        vn_bp_async_finished_serial = max([vn_bp_async_finished_serial] + [record.get("completedOrder", record.get("serial", 0)) for record in vn_bp_async_tasks.values() if not vn_bp_async_active(record)])
        # Ren'Py restores the base script stack, not transient UI callback
        # contexts. Page tasks have their own serialized stack and survive.
        for key, record in list(vn_bp_live_frames.items()):
            if record.get("kind") == "label" and record.get("depth", 1) > len(renpy.game.contexts):
                vn_bp_release_frame(dict(id=int(key)))
        vn_bp_async_prune()

    def vn_bp_async_clear():
        global vn_bp_async_tasks, vn_bp_live_frames, vn_bp_temporal_clock, vn_bp_async_cursor
        for handle in list(vn_bp_async_tasks):
            vn_bp_async_finish(handle, "cancelled", "navigated")
        vn_bp_async_tasks = {}
        vn_bp_live_frames = {}
        vn_bp_temporal_clock = dict(elapsed=0.0)
        vn_bp_async_cursor = 0

    config.after_load_callbacks.append(vn_bp_async_after_load)

    def vn_bp_throttle(scope, page_id, graph_id, node_id, entry, seconds):
        global vn_bp_frame, vn_ui_state_records, vn_bp_live_frames
        seconds = vn_bp_number(seconds, 0, None, "节流冷却秒数")
        if scope not in ("call", "page") or entry not in ("exec_in", "reset"):
            raise Exception("节流节点的作用域或入口无效。")
        now = vn_bp_time_now()
        if scope == "call":
            vn_bp_require_frame(graph_id)
            record = vn_bp_frame
            key = node_id
        else:
            task, owner = vn_ui_state_owner(page_id)
            record = vn_ui_state_records.get(owner, {})
            key = (graph_id, node_id)
        values = dict(record.get("temporal", {}))
        until = values.get(key)
        output = "updated" if entry == "reset" else "blocked" if until is not None and now < until else "exec_out"
        if entry == "reset":
            values.pop(key, None)
        elif output == "exec_out":
            values[key] = now + seconds
        if scope == "call":
            vn_bp_frame = dict(vn_bp_frame, temporal=values)
            tracked = dict(vn_bp_live_frames.get(str(vn_bp_frame.get("id")), {}), until=max(list(values.values()) + [0.0]))
            vn_bp_live_frames = dict(vn_bp_live_frames, **{str(vn_bp_frame.get("id")): tracked})
        else:
            records = dict(vn_ui_state_records)
            records[owner] = dict(record, task=task, page=page_id, temporal=values)
            vn_ui_state_records = records
        renpy.retain_after_load()
        return output

    def vn_bp_async_active(record):
        return record.get("status") in ("queued", "running", "waiting")

    def vn_bp_async_owner_alive(record):
        return (record.get("ownerFrame") is None or str(record["ownerFrame"]) in vn_bp_live_frames) and vn_bp_task_alive(record.get("task"))

    def vn_bp_async_put(handle, record):
        global vn_bp_async_tasks
        records = dict(vn_bp_async_tasks)
        records[handle] = dict(record, stack=list(record["stack"])) if "stack" in record else dict(record)
        vn_bp_async_tasks = records
        renpy.retain_after_load()

    def vn_bp_async_finish(handle, status, reason, outputs=None):
        global vn_ui_animations, vn_bp_async_finished_serial
        record = vn_bp_async_tasks.get(handle)
        if not record or not vn_bp_async_active(record):
            return False
        if status != "completed":
            # Sample before invalidating the owner so cancellation freezes the
            # current pose and removes only this task's still-owned resources.
            vn_ui_animation_tick(False)
        # Successful detached animations keep the same behavior as ordinary
        # non-waited animations. Cancellation keeps the task token and prunes them.
        if status == "completed":
            vn_ui_animations = {key: dict(value, task=record.get("task")) if (value.get("task") or {}).get("async") == handle else value for key, value in vn_ui_animations.items()}
        else:
            vn_ui_animations = {key: value for key, value in vn_ui_animations.items() if (value.get("task") or {}).get("async") != handle}
            vn_parameter_flush_animations()
        # Mark terminal before cancelling owned children to break dependency cycles.
        vn_bp_async_finished_serial += 1
        vn_bp_async_put(handle, dict(version=1, completedOrder=vn_bp_async_finished_serial, handle=handle, serial=record["serial"], graph=record["graph"], status=status, reason=reason, outputs=dict(outputs or {}), **({"recovery": dict(record)} if reason == "unsupportedTaskVersion" else {})))
        for frame in record.get("stack", []):
            vn_bp_release_frame(frame)
        vn_bp_async_trim_results()
        return True

    def vn_bp_async_cancel(handle):
        if not isinstance(handle, str):
            raise Exception("取消任务需要文字任务标识。")
        return vn_bp_async_finish(handle, "cancelled", "cancelled")

    def vn_bp_async_prune():
        global vn_bp_async_tasks
        for handle, record in list(vn_bp_async_tasks.items()):
            if vn_bp_async_active(record) and not vn_bp_async_owner_alive(record):
                vn_bp_async_finish(handle, "cancelled", "ownerClosed")
        vn_bp_async_trim_results()

    def vn_bp_async_trim_results():
        global vn_bp_async_tasks
        finished = sorted((record.get("completedOrder", record["serial"]), handle) for handle, record in vn_bp_async_tasks.items() if not vn_bp_async_active(record))
        removed = set(handle for serial, handle in finished[:-512])
        if removed:
            vn_bp_async_tasks = {key: record for key, record in vn_bp_async_tasks.items() if key not in removed}

    def vn_bp_async_result(handle, expected_graph=None):
        if not isinstance(handle, str):
            raise Exception("任务标识必须为文字。")
        record = vn_bp_async_tasks.get(handle)
        if record and vn_bp_async_active(record) and not vn_bp_async_owner_alive(record):
            vn_bp_async_finish(handle, "cancelled", "ownerClosed")
            record = vn_bp_async_tasks.get(handle)
        if not record:
            return dict(status="missing", reason="missing", outputs={})
        if expected_graph and record.get("graph") != expected_graph:
            return dict(status="failed", reason="moduleMismatch", outputs={})
        return dict(status=record["status"], reason=record.get("reason", ""), graph=record["graph"], outputs=dict(record.get("outputs", {})))

    def vn_bp_async_wait(handle, expected_graph=None):
        # Stay in one script statement. A script-level polling loop creates
        # hundreds of rollback records and evicts the preceding dialogue.
        # Task state lives in the store, so loading re-enters this function
        # with the saved handle and remaining time, without saving a stack.
        renpy.stop_skipping()
        while vn_bp_task_alive(vn_bp_task) and vn_bp_async_result(handle, expected_graph)["status"] in ("queued", "running", "waiting"):
            renpy.pause(0.02, hard=True, modal=False)

    def vn_bp_async_valid_value(kind, value):
        if kind == "boolean":
            return isinstance(value, bool)
        if kind == "number":
            return not isinstance(value, bool) and isinstance(value, (int, float)) and __import__("math").isfinite(value)
        if kind == "any":
            return isinstance(value, (str, bool)) or isinstance(value, (int, float)) and __import__("math").isfinite(value)
        return kind in ("string", "asset", "scene", "character", "ui", "component") and isinstance(value, str)

    def vn_bp_async_inputs(graph, arguments):
        definitions = vn_bp_async_graphs[graph]["inputs"]
        result = {}
        for key, definition in definitions.items():
            value = arguments.get(key, definition.get("default"))
            kind = definition["type"]
            valid = vn_bp_async_valid_value(kind, value) or value is None and definition.get("default") is None and not definition.get("required")
            if not valid or definition.get("required") and kind in ("asset", "character", "scene", "ui", "component") and not value:
                raise Exception("任务参数类型不匹配：" + definition["name"])
            result[key] = value
        return result

    def vn_bp_async_start(scope, page_id, source_graph, node_id, graph_id, arguments, seconds=0.0, conflict="parallel"):
        global vn_bp_async_serial
        if scope not in ("call", "page") or conflict not in ("parallel", "replace", "ignore"):
            raise Exception("任务生命周期或重复策略无效。")
        definition = vn_bp_async_graphs.get(graph_id)
        if not definition or definition.get("problem"):
            raise Exception((definition or {}).get("problem") or "任务模块不存在。")
        seconds = vn_bp_number(seconds, 0, None, "任务延后秒数")
        inputs = vn_bp_async_inputs(graph_id, arguments)
        if scope == "page":
            task, owner = vn_ui_state_owner(page_id)
            owner_frame = None
        else:
            vn_bp_require_frame(source_graph)
            task, owner_frame = vn_bp_task or vn_bp_task_create(), vn_bp_frame["id"]
            owner = ("call", owner_frame)
        # Page scope explicitly detaches from a launching task, never its page.
        task = {key: value for key, value in task.items() if key != "async"}
        group = (owner, source_graph, node_id)
        vn_bp_async_prune()
        previous = [(handle, record) for handle, record in vn_bp_async_tasks.items() if record.get("group") == group and vn_bp_async_active(record)]
        if previous and conflict == "ignore":
            return dict(handle=previous[-1][0], output="blocked")
        if conflict == "replace":
            for handle, record in previous:
                vn_bp_async_finish(handle, "cancelled", "replaced")
        if sum(1 for record in vn_bp_async_tasks.values() if vn_bp_async_active(record)) >= 256:
            return dict(handle="", output="blocked")
        vn_bp_async_serial += 1
        handle = "task:" + str(vn_bp_async_serial) + ":" + __import__("uuid").uuid4().hex
        record = dict(version=1, handle=handle, serial=vn_bp_async_serial, graph=graph_id, arguments=inputs, task=task, ownerFrame=owner_frame, group=group, status="queued", reason="", due=vn_bp_time_now() + seconds, stack=[], steps=0)
        vn_bp_async_put(handle, record)
        renpy.restart_interaction()
        return dict(handle=handle, output="exec_out")

    def vn_bp_async_new_frame(graph_id, arguments, handle, return_node=None):
        definition = vn_bp_async_graphs[graph_id]
        frame = vn_bp_enter_frame(graph_id, definition["defaults"], async_handle=handle)
        return dict(frame, arguments=vn_bp_async_inputs(graph_id, arguments), todo=[(definition["entry"], "exec_in")], returnNode=return_node)

    def vn_bp_async_successors(graph_id, node_id, pins):
        links = vn_bp_async_graphs[graph_id]["links"]
        return [links[node_id][pin] for pin in pins if pin in links.get(node_id, {})]

    def vn_bp_async_deadlock(handle, target):
        seen = {handle}
        while target:
            if target in seen:
                return True
            seen.add(target)
            target = (vn_bp_async_tasks.get(target, {}).get("wait") or {}).get("handle")
        return False

    def vn_bp_async_return_frames(handle, record):
        while record["stack"] and not record["stack"][-1].get("todo"):
            finished = record["stack"].pop()
            outputs = {key: finished["values"].get("vn_bp_out_" + finished["graph"] + "_" + key, definition.get("default")) for key, definition in vn_bp_async_graphs[finished["graph"]]["outputs"].items()}
            for key, value in outputs.items():
                definition = vn_bp_async_graphs[finished["graph"]]["outputs"][key]
                if not vn_bp_async_valid_value(definition["type"], value) and not (value is None and definition.get("default") is None):
                    raise Exception("任务输出类型不匹配：" + definition["name"])
            vn_bp_release_frame(finished)
            if not record["stack"]:
                vn_bp_async_put(handle, record)
                vn_bp_async_finish(handle, "completed", "completed", outputs)
                return True
            parent = record["stack"][-1]
            values = dict(parent["values"])
            for key, value in outputs.items():
                values["vn_bp_result_" + finished["returnNode"] + "_" + key] = value
            record["stack"][-1] = dict(parent, values=values)
        return False

    def vn_bp_async_step(handle, now):
        global vn_bp_frame, vn_bp_task
        record = vn_bp_async_tasks.get(handle)
        if not record or not vn_bp_async_active(record):
            return False
        if type(record.get("version", 1)) is not int or record.get("version", 1) != 1:
            vn_bp_async_finish(handle, "failed", "unsupportedTaskVersion")
            return True
        if record.get("due", 0.0) > now:
            return False
        wait = record.get("wait") or {}
        if wait.get("kind") == "time" and wait["until"] > now:
            return False
        if wait.get("kind") == "animation" and vn_ui_animation_active(wait["token"]):
            return False
        if wait.get("kind") == "task" and vn_bp_async_result(wait["handle"], wait.get("graph"))["status"] in ("queued", "running", "waiting"):
            return False
        record = dict(record, status="running", wait=None, stack=list(record["stack"]), steps=record["steps"] + 1)
        if record["steps"] > 100000:
            vn_bp_async_finish(handle, "failed", "stepLimit")
            return True
        previous_frame, previous_task = vn_bp_frame, vn_bp_task
        try:
            if not record["stack"]:
                record["stack"].append(vn_bp_async_new_frame(record["graph"], record["arguments"], handle))
            vn_bp_async_put(handle, record)
            if vn_bp_async_return_frames(handle, record):
                return True
            frame = dict(record["stack"][-1])
            todo = list(frame.get("todo", []))
            node_id, entry = todo.pop(0)
            vn_bp_frame = dict(frame, todo=todo)
            vn_bp_task = dict(record["task"], **{"async": handle})
            # Publish before helpers create/cancel children. The frame itself is
            # then copied back; callbacks never retain an unserializable generator.
            vn_bp_async_put(handle, record)
            command = vn_bp_async_steps[(frame["graph"], node_id)](entry)
            frame = dict(vn_bp_frame)
            if not vn_bp_async_active(vn_bp_async_tasks.get(handle, {})):
                return True
            op = command[0]
            todo = list(frame.get("todo", []))
            if op == "return":
                todo = []
            elif op == "walk":
                todo = list(command[1]) + todo
            elif op in ("next", "time", "animation", "call"):
                todo = vn_bp_async_successors(frame["graph"], node_id, command[1]) + todo
            elif op == "await":
                result = vn_bp_async_result(command[1], command[2])
                if result["status"] in ("queued", "running", "waiting"):
                    if vn_bp_async_deadlock(handle, command[1]):
                        vn_bp_async_finish(handle, "failed", "dependencyCycle")
                        return True
                    todo = [(node_id, "__resume")] + todo
                    record = dict(record, status="waiting", wait=dict(kind="task", handle=command[1], graph=command[2]))
                else:
                    values = dict(frame["values"])
                    values["vn_bp_task_reason_" + node_id] = result["reason"]
                    for key, definition in vn_bp_async_graphs.get(command[2], {}).get("outputs", {}).items():
                        values["vn_bp_result_" + node_id + "_" + key] = result["outputs"].get(key, definition.get("default")) if result["status"] == "completed" else definition.get("default")
                    frame = dict(frame, values=values)
                    todo = vn_bp_async_successors(frame["graph"], node_id, [result["status"]]) + todo
            else:
                raise Exception("任务操作无法识别。")
            frame = dict(frame, todo=todo)
            record["stack"][-1] = frame
            if op == "time":
                record = dict(record, status="waiting", wait=dict(kind="time", until=now + vn_bp_number(command[2], 0, None, "任务等待秒数")))
            elif op == "animation":
                record = dict(record, status="waiting", wait=dict(kind="animation", token=command[2]))
            elif op == "call":
                if len(record["stack"]) >= 16:
                    raise Exception("任务调用超过 16 层。")
                record["stack"].append(vn_bp_async_new_frame(command[2], command[3], handle, node_id))
            # A wait at the end of a module must finish only after its deadline.
            if record["status"] != "waiting":
                if vn_bp_async_return_frames(handle, record):
                    return True
            vn_bp_async_put(handle, record)
            return True
        except Exception as error:
            vn_bp_async_finish(handle, "failed", str(error)[:1000])
            return True
        finally:
            vn_bp_frame, vn_bp_task = previous_frame, previous_task

    def vn_bp_async_needs_tick():
        now = vn_bp_temporal_clock.get("elapsed", 0.0)
        return any(vn_bp_async_active(record) for record in vn_bp_async_tasks.values()) or any(record.get("until", 0.0) > now for record in vn_bp_live_frames.values()) or any(until > now for record in vn_ui_state_records.values() for until in record.get("temporal", {}).values())

    def vn_bp_async_tick():
        global vn_bp_async_cursor
        if getattr(vn_bp_async_tick, "busy", False):
            return
        vn_bp_async_tick.busy = True
        try:
            before = vn_bp_async_tasks
            now = vn_bp_time_now()
            vn_bp_async_prune()
            budget = 64
            while budget:
                records = sorted((record["serial"], handle) for handle, record in vn_bp_async_tasks.items() if vn_bp_async_active(record))
                records = [item for item in records if item[0] > vn_bp_async_cursor] + [item for item in records if item[0] <= vn_bp_async_cursor]
                progressed = False
                for serial, handle in records:
                    if vn_bp_async_step(handle, now):
                        vn_bp_async_cursor = serial
                        progressed = True
                        budget -= 1
                        if not budget:
                            break
                if not progressed:
                    break
            vn_bp_async_prune()
            if vn_bp_async_tasks is not before:
                renpy.restart_interaction()
        finally:
            vn_bp_async_tick.busy = False
`;
