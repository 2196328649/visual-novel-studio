/** Session-only observations and atomic node stops; never generated for release games. */
export const blueprintDebugRuntime = String.raw`# Only generated for an explicitly instrumented development preview.
default vn_bp_debug_cursor = 0

init 998 python in _vn_bp_debug:
    _constant = True
    import os, json, time, math, inspect, builtins
    import renpy

    class Debugger:
        def __init__(self, boot):
            self.session = boot["sessionId"]
            self.points = set((p["graphId"], p["nodeId"]) for p in boot.get("breakpoints", []))
            self.generation = 0
            self.revision = 0
            self.ack = 0
            self.sequence = 0
            self.invocations = 0
            self.frames = {}
            self.sites = {}
            self.values = {}
            self.pending = []
            self.paused = False
            self.step = None
            self.site = None
            self.reason = "running"
            self.cursor = None
            self.last_poll = 0.0
            self.last_flush = 0.0
            self.busy = False
            self.fallback_clock = None
            self.frozen = None
            self.offset = 0.0

        def player(self):
            store = getattr(renpy.store, "_studio_preview", None)
            return getattr(store, "player", None)

        def freeze(self, value):
            player = self.player()
            if player:
                player.debug_pause(value)
                return
            # Standalone diagnostic fixtures have no window-embedding host.
            if self.fallback_clock is None:
                self.fallback_clock = renpy.display.core.get_time
                renpy.display.core.get_time = self.now
            if value and self.frozen is None:
                self.frozen = self.fallback_clock()
                renpy.audio.audio.pause_all()
            elif not value and self.frozen is not None:
                self.offset += self.fallback_clock() - self.frozen
                self.frozen = None
                renpy.audio.audio.unpause_all()

        def now(self):
            return (self.frozen if self.frozen is not None else self.fallback_clock()) - self.offset

        def reset(self, reason):
            # Keep breakpoints/command acknowledgements outside save and rollback.
            self.generation += 1
            self.sequence = 0
            self.frames = {}
            self.sites = {}
            self.values = {}
            self.invocations = 0
            self.pending = []
            self.site = None
            self.step = None
            self.reason = reason
            self.cursor = getattr(renpy.store, "vn_bp_debug_cursor", 0)
            self.flush(True)

        def epoch(self):
            cursor = getattr(renpy.store, "vn_bp_debug_cursor", 0)
            if self.cursor is not None and cursor != self.cursor:
                self.reset("rollback")
            self.cursor = cursor + 1
            renpy.store.vn_bp_debug_cursor = self.cursor

        def origin(self, task):
            task = task or {}
            result = {}
            if isinstance(task.get("page"), str):
                result["pageId"] = task["page"]
            token = task.get("pageToken")
            if isinstance(token, int) and not isinstance(token, bool) and token >= 0:
                result["pageInstance"] = token
            return result

        def authored_location(self, graph, node=None, pin=None):
            origins = getattr(renpy.store, "vn_bp_debug_origins", {})
            source = origins.get("nodes", {}).get(graph, {}).get(node, {})
            return (source.get("graphId", origins.get("graphs", {}).get(graph, graph)),
                source.get("nodeId", node), source.get("pins", {}).get(pin, pin))

        def authored_data(self, data):
            result = dict(data)
            graph = data.get("graphId")
            source = self.authored_location(graph, data.get("nodeId"), data.get("pinId"))
            for key, value in zip(("graphId", "nodeId", "pinId"), source):
                if value is not None:
                    result[key] = value
            if data.get("sourceNodeId"):
                source = self.authored_location(data.get("sourceGraphId", graph), data["sourceNodeId"], data.get("sourcePinId"))
                for key, value in zip(("sourceGraphId", "sourceNodeId", "sourcePinId"), source):
                    if value is not None:
                        result[key] = value
            return result

        def has_breakpoint(self, graph, node):
            origins = getattr(renpy.store, "vn_bp_debug_origins", {})
            source = origins.get("nodes", {}).get(graph, {}).get(node, {})
            if source.get("breakpoint") is False:
                return False
            authored = self.authored_location(graph, node)
            return (authored[0], authored[1]) in self.points

        def authored_stack(self, stack):
            result = []
            for index, item in enumerate(stack):
                frame = dict(item, graphId=self.authored_location(item["graphId"])[0])
                if index and item.get("callNodeId"):
                    frame["callNodeId"] = self.authored_location(stack[index - 1]["graphId"], item["callNodeId"])[1]
                result.append(frame)
            return result

        def authored_site(self, site):
            if not site:
                return site
            return dict(self.authored_data(site), stack=self.authored_stack(site.get("stack", [])))

        def stack(self, frame=None, task=None):
            frame = frame if frame is not None else getattr(renpy.store, "vn_bp_frame", None)
            if not frame:
                return []
            raw = frame.get("debugStack") or [dict(id=frame["id"], graphId=frame["graph"], **self.origin(task))]
            stack = []
            for item in raw[-32:]:
                key = (item["id"], item["graphId"])
                if key not in self.frames:
                    self.invocations += 1
                    self.frames[key] = self.invocations
                entry = dict(item, id=self.frames[key])
                if stack:
                    entry["parentId"] = stack[-1]["id"]
                else:
                    entry.pop("parentId", None)
                stack.append(entry)
            return stack

        def frame(self, frame, parent=None, event=None, task=None, call_node=None):
            task = task if task is not None else getattr(renpy.store, "vn_bp_task", None)
            parent_stack = list((parent or {}).get("debugStack", []))
            meta = renpy.store.vn_bp_debug_nodes.get((frame["graph"], event), {})
            item = dict(id=frame["id"], graphId=frame["graph"], **self.origin(task))
            for key in ("componentId", "trigger"):
                if meta.get(key) is not None:
                    item[key] = meta[key]
            if call_node is None and self.site and parent and self.site.get("graphId") == parent.get("graph"):
                call_node = self.site["nodeId"]
            if call_node:
                item["callNodeId"] = call_node
            frame = dict(frame, debugStack=(parent_stack + [item])[-32:], debugTask=(task or {}).get("async"))
            data = {"taskHandle": task["async"]} if (task or {}).get("async") else {}
            self.record("enter", stack=self.stack(frame, task), reason="restored" if not event else "called", **data)
            return frame

        def record(self, kind, stack=None, value=None, has_value=False, **data):
            if stack is None:
                stack = self.stack(task=getattr(renpy.store, "vn_bp_task", None))
            top = stack[-1] if stack else {}
            entry = {key: top[key] for key in ("graphId", "pageId", "pageInstance", "componentId", "trigger") if key in top}
            entry.update(data)
            entry = self.authored_data(entry)
            if has_value:
                valid = isinstance(value, (str, bool)) or isinstance(value, (int, float)) and math.isfinite(value)
                entry["available"] = valid
                if valid:
                    entry["value"] = value[:4000] if isinstance(value, str) else value
                    if isinstance(value, str) and len(value) > 4000:
                        entry["valueTruncated"] = True
                else:
                    entry.setdefault("reason", "此输入没有可观察的标量值。")
            task = getattr(renpy.store, "vn_bp_task", None) or {}
            if task.get("async") and "taskHandle" not in entry:
                entry["taskHandle"] = task["async"]
            self.sequence += 1
            entry.update(kind=kind, sequence=self.sequence, time=max(0.0, renpy.display.core.get_time()), stack=self.authored_stack(stack))
            if top:
                entry["invocationId"] = top["id"]
            self.pending.append(entry)
            if len(self.pending) >= 64:
                self.flush()

        def flush(self, force=False):
            now = time.monotonic()
            if not force and not self.pending and now - self.last_flush < 0.1:
                return
            self.revision += 1
            data = dict(version=1, sessionId=self.session, generation=self.generation, revision=self.revision, acknowledgement=self.ack,
                phase="paused" if self.paused else "stepping" if self.step else "running", reason=self.reason,
                entries=self.pending, dropped=max(0, self.sequence - 1600), invocations=self.invocations,
                breakpoints=[dict(graphId=graph, nodeId=node) for graph, node in sorted(self.points)])
            if self.site:
                data["site"] = self.authored_site(self.site)
            print("VNS_BLUEPRINT_DEBUG:" + json.dumps(data, ensure_ascii=True, allow_nan=False), flush=True)
            self.pending = []
            self.last_flush = now

        def command(self, command):
            if command.get("sessionId") != self.session or not isinstance(command.get("revision"), int) or command["revision"] <= self.ack:
                return
            action = command.get("action")
            if action == "breakpoints":
                points = command.get("breakpoints")
                if not isinstance(points, builtins.list) or len(points) > 512 or any(not isinstance(p, builtins.dict) or not isinstance(p.get("graphId"), str) or not isinstance(p.get("nodeId"), str) for p in points):
                    return
                self.points = set((p["graphId"], p["nodeId"]) for p in points)
            elif action == "clear":
                self.generation += 1
                self.sequence = 0
                self.pending = []
            elif action == "pause":
                self.paused = True
                self.step = None
                self.reason = "pauseRequested"
            elif action in ("continue", "stepInto", "stepOver", "stepOut"):
                target = self.site
                if target and target.get("entry") == "return" and len(target.get("stack", [])) <= 1:
                    target = None
                self.step = None if action == "continue" else dict(action=action, site=target)
                self.paused = False
                self.reason = action
            else:
                return
            self.ack = command["revision"]
            self.flush(True)

        def poll(self, block=True, force=False):
            if self.cursor is not None and getattr(renpy.store, "vn_bp_debug_cursor", 0) != self.cursor:
                self.reset("rollback")
            now = time.monotonic()
            if force or now - self.last_poll >= 0.02:
                self.last_poll = now
                try:
                    with open(os.path.join(renpy.config.basedir, "blueprint-debug-control.json"), encoding="utf-8") as stream:
                        payload = json.loads(stream.read(512000))
                    if payload.get("version") == 1 and isinstance(payload.get("commands"), builtins.list) and len(payload["commands"]) <= 128:
                        for command in payload["commands"]:
                            if isinstance(command, builtins.dict):
                                self.command(command)
                except (OSError, ValueError, TypeError):
                    pass
            if block and self.paused and not self.busy:
                self.wait()
            if self.pending and now - self.last_flush >= 0.1:
                self.flush()

        def wait(self):
            self.busy = True
            self.freeze(True)
            self.flush(True)
            try:
                # Do not create a Ren'Py interaction, run timers, or pump the
                # cooperative task queue while stopped at an atomic boundary.
                while self.paused:
                    self.poll(False, True)
                    player = self.player()
                    if player:
                        player.tick()
                    pygame = renpy.display.core.pygame
                    if pygame.display.get_init():
                        pygame.event.pump()
                        if pygame.event.get([pygame.QUIT]):
                            renpy.exports.quit()
                    renpy.execution.not_infinite_loop(60)
                    time.sleep(0.02)
            finally:
                self.freeze(False)
                self.busy = False
                self.flush(True)

        def current_site(self, graph, node, entry, frame=None, task=None):
            task = task if task is not None else getattr(renpy.store, "vn_bp_task", None) or {}
            stack = self.stack(frame, task)
            site = dict(graphId=graph, nodeId=node, invocationId=stack[-1]["id"] if stack else 0, stack=stack, entry=entry, **self.origin(task))
            if task.get("async"):
                site["taskHandle"] = task["async"]
            return site

        def should_step(self, site):
            if not self.step:
                return False
            previous = self.step.get("site")
            if not previous:
                return True
            if site.get("taskHandle") != previous.get("taskHandle"):
                return False
            ids = [frame["id"] for frame in site["stack"]]
            previous_ids = [frame["id"] for frame in previous["stack"]]
            # A suspended event does not transfer its single-step to an
            # unrelated callback. Other tasks may progress to satisfy waits.
            if ids and previous_ids and ids[0] != previous_ids[0]:
                return False
            action = self.step["action"]
            if action == "stepInto":
                return True
            if action == "stepOver":
                return len(ids) <= len(previous_ids)
            return len(ids) < len(previous_ids)

        def checkpoint(self, graph, node, entry="exec_in", frame=None, task=None):
            self.epoch()
            self.poll(False)
            site = self.current_site(graph, node, entry, frame, task)
            stepping = self.should_step(site)
            self.site = site
            current = frame if frame is not None else getattr(renpy.store, "vn_bp_frame", None)
            if current:
                self.sites[current["id"]] = site
                self.values[current["id"]] = {}
            breakpoint = self.has_breakpoint(graph, node)
            if breakpoint or stepping:
                self.paused = True
                self.reason = "breakpoint" if breakpoint else self.step["action"]
                self.step = None
            if self.paused:
                self.wait()
            meta = renpy.store.vn_bp_debug_nodes.get((graph, node), {})
            self.record("event" if meta.get("event") else "node", stack=site["stack"], graphId=graph, nodeId=node, reason=entry)

        def leave(self, frame):
            if not frame:
                return
            stack = self.stack(frame)
            data = {"taskHandle": frame["debugTask"]} if frame.get("debugTask") else {}
            self.record("return", stack=stack, reason="调用帧结束", **data)
            previous = self.step.get("site") if self.step else None
            if previous and previous.get("invocationId") == (stack[-1]["id"] if stack else 0):
                self.site = dict(previous, entry="return")
                self.paused = True
                self.step = None
                self.reason = "callReturned"
                self.wait()
            if self.site and self.site.get("invocationId") == (stack[-1]["id"] if stack else 0):
                self.site = None
            self.frames.pop((frame["id"], frame["graph"]), None)
            self.sites.pop(frame["id"], None)
            self.values.pop(frame["id"], None)

    debugger = None
    try:
        boot = json.loads(os.environ.get("VNS_BLUEPRINT_DEBUG", "null"))
        if isinstance(boot, builtins.dict) and isinstance(boot.get("sessionId"), str):
            debugger = Debugger(boot)
    except (ValueError, TypeError, KeyError):
        pass

    def tick():
        if debugger:
            debugger.poll()

    def after_load():
        if debugger:
            debugger.reset("loaded")


    def wrap_step(graph, node, original):
        def run(entry):
            debugger.checkpoint(graph, node, entry)
            try:
                result = original(entry)
            except Exception as error:
                debugger.record("stop", graphId=graph, nodeId=node, reason=str(error)[:4000])
                raise
            renpy.store.vn_bp_debug_written(graph, node)
            if result[0] in ("next", "time", "animation", "call"):
                for pin in result[1]:
                    debugger.record("branch", graphId=graph, nodeId=node, pinId=pin)
            if result[0] in ("time", "animation", "await"):
                debugger.record("wait", graphId=graph, nodeId=node, reason=result[0])
            return result
        return run

    if debugger:
        original_exception_handler = renpy.config.exception_handler
        def exception_handler(traceback):
            site = debugger.site or {}
            debugger.record("stop", reason=str(traceback)[:4000], **{key: site[key] for key in ("graphId", "nodeId") if key in site})
            debugger.reason = "exception"
            debugger.flush(True)
            if original_exception_handler:
                try:
                    inspect.signature(original_exception_handler).bind(traceback)
                except TypeError:
                    return original_exception_handler(*traceback)
                return original_exception_handler(traceback)
            return False
        renpy.config.exception_handler = exception_handler
        original_release = renpy.store.vn_bp_release_frame
        def release(frame):
            if frame and str(frame.get("id")) in renpy.store.vn_bp_live_frames:
                debugger.leave(frame)
            return original_release(frame)
        renpy.store.vn_bp_release_frame = release

        original_capture = renpy.store.vn_bp_capture_local
        def capture(name, value):
            result = original_capture(name, value)
            meta = renpy.store.vn_bp_debug_slots.get(name)
            if meta:
                frame = getattr(renpy.store, "vn_bp_frame", None) or {}
                site = debugger.sites.get(frame.get("id"), {})
                node = meta[1] or site.get("nodeId")
                debugger.record("output", graphId=meta[0], **dict({"nodeId": node} if node else {}, pinId=meta[2], value=value, has_value=True))
            return result
        renpy.store.vn_bp_capture_local = capture

        original_async_frame = renpy.store.vn_bp_async_new_frame
        def async_frame(graph, arguments, handle, return_node=None):
            frame = original_async_frame(graph, arguments, handle, return_node)
            record = renpy.store.vn_bp_async_tasks.get(handle, {})
            stack = record.get("stack", [])
            task = dict(record.get("task") or {}, **{"async": handle})
            return debugger.frame(frame, stack[-1] if return_node and stack else None, renpy.store.vn_bp_async_graphs[graph]["entry"], task, return_node)
        renpy.store.vn_bp_async_new_frame = async_frame
        for key, original in list(renpy.store.vn_bp_async_steps.items()):
            renpy.store.vn_bp_async_steps[key] = wrap_step(key[0], key[1], original)

        original_pause = renpy.store.vn_bp_pause
        def pause(seconds, hard=False):
            site = debugger.site or {}
            data = {key: site[key] for key in ("graphId", "nodeId") if key in site}
            debugger.record("wait", reason="时间等待", value=seconds, has_value=True, **data)
            try:
                return original_pause(seconds, hard)
            finally:
                debugger.record("resume", reason="等待结束或取消", **data)
        renpy.store.vn_bp_pause = pause
        debugger.flush(True)

    renpy.config.periodic_callbacks.append(tick)
    renpy.config.after_load_callbacks.insert(0, after_load)

init python:
    def vn_bp_debug_frame(frame, parent=None, event=None, task=None, call_node=None):
        debugger = _vn_bp_debug.debugger
        return debugger.frame(frame, parent, event, task, call_node) if debugger else frame

    def vn_bp_debug_checkpoint(graph, node, entry="exec_in"):
        if _vn_bp_debug.debugger:
            _vn_bp_debug.debugger.checkpoint(graph, node, entry)

    def vn_bp_debug_leave(frame):
        if _vn_bp_debug.debugger:
            _vn_bp_debug.debugger.leave(frame)

    def vn_bp_debug_value(graph, node, pin, value, source_node=None, source_pin=None):
        debugger = _vn_bp_debug.debugger
        if debugger:
            frame = getattr(renpy.store, "vn_bp_frame", None)
            if frame:
                debugger.values.setdefault(frame["id"], {})[(graph, node, pin)] = value
            if source_node:
                debugger.record("output", graphId=graph, nodeId=source_node, pinId=source_pin, value=value, has_value=True)
            data = dict(graphId=graph, nodeId=node, pinId=pin, value=value, has_value=True)
            if source_node:
                data.update(sourceNodeId=source_node, sourcePinId=source_pin)
            debugger.record("input", **data)
        return value

    def vn_bp_debug_written(graph, node):
        debugger = _vn_bp_debug.debugger
        meta = vn_bp_debug_nodes.get((graph, node), {})
        if not debugger or meta.get("type") != "setVariable":
            return
        frame = getattr(renpy.store, "vn_bp_frame", None) or {}
        values = debugger.values.get(frame.get("id"), {})
        key = (graph, node, "value")
        if key in values:
            data = dict(graphId=graph, nodeId=node, pinId="value", value=values[key], has_value=True)
            for field in ("scope", "variableId"):
                if meta.get(field) is not None:
                    data[field] = meta[field]
            page = values.get((graph, node, "pageId"))
            if isinstance(page, str):
                data["targetPageId"] = page
            debugger.record("write", **data)

    def vn_bp_debug_record(kind, graph=None, node=None, **data):
        debugger = _vn_bp_debug.debugger
        if debugger:
            if graph is not None:
                data["graphId"] = graph
            if node is not None:
                data["nodeId"] = node
            debugger.record(kind, **data)
`;
