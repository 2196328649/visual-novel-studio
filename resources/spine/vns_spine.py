"""Spine 4.2 adapter. Only versioned plain data enters Ren'Py saves.
Rendering advances a transient native track and records a sample. The shared
UI/task poll commits samples and dispatches author events outside rendering.
"""
import ctypes as ct
import math
import os
import renpy as engine
from renpy import exports as renpy

SPINE_ABI = 2


class Batch(ct.Structure):
    _fields_ = [("page", ct.c_int), ("blend", ct.c_int), ("vertex_count", ct.c_int), ("index_count", ct.c_int),
                ("positions", ct.POINTER(ct.c_float)), ("attributes", ct.POINTER(ct.c_float)),
                ("indices", ct.POINTER(ct.c_uint32)), ("vertex_capacity", ct.c_int), ("index_capacity", ct.c_int)]


_dll, _layout = None, None
_players, _resources, _live = {}, {}, {}
_polling = False


def library():
    global _dll
    if _dll is None:
        if engine.android:
            from jnius import autoclass
            activity = autoclass("org.renpy.android.PythonSDLActivity").mActivity
            filename = os.path.join(str(activity.getApplicationInfo().nativeLibraryDir), "libvns_spine.so")
        else:
            filename = os.path.join(os.path.dirname(__file__), "vns_spine.dll")
        dll = ct.CDLL(filename)
        dll.vns_spine_abi.restype = ct.c_int
        if dll.vns_spine_abi() != SPINE_ABI:
            raise Exception("骨骼动画运行库版本不匹配，请重新导出游戏。")
        dll.vns_spine_create.argtypes = [ct.c_char_p, ct.c_char_p, ct.c_char_p, ct.c_int]
        dll.vns_spine_create.restype = ct.c_void_p
        dll.vns_spine_dispose.argtypes = [ct.c_void_p]
        dll.vns_spine_dispose.restype = None
        dll.vns_spine_play.argtypes = [ct.c_void_p, ct.c_char_p, ct.c_char_p, ct.c_int, ct.c_float]
        dll.vns_spine_play.restype = ct.c_int
        dll.vns_spine_skin.argtypes = [ct.c_void_p, ct.c_char_p]
        dll.vns_spine_skin.restype = ct.c_int
        dll.vns_spine_loop.argtypes = [ct.c_void_p, ct.c_int]
        dll.vns_spine_loop.restype = None
        dll.vns_spine_restore.argtypes = [ct.c_void_p, ct.c_float]
        dll.vns_spine_restore.restype = None
        dll.vns_spine_observe.argtypes = [ct.c_void_p, ct.POINTER(ct.c_float), ct.POINTER(ct.c_float), ct.POINTER(ct.c_int)]
        dll.vns_spine_observe.restype = ct.c_int
        dll.vns_spine_update.argtypes = [ct.c_void_p, ct.c_float]
        dll.vns_spine_update.restype = None
        dll.vns_spine_render.argtypes = [ct.c_void_p] + [ct.c_float] * 5
        dll.vns_spine_render.restype = ct.c_int
        dll.vns_spine_batch.argtypes = [ct.c_void_p, ct.c_int]
        dll.vns_spine_batch.restype = ct.POINTER(Batch)
        _dll = dll
    return _dll


def _next(value):
    if type(value) is not int or not 0 <= value < 9007199254740991:
        raise Exception("骨骼请求序号超出安全范围，请明确重置控件。")
    return value + 1


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def _speed_problem(value):
    # The generated property catalog is shared with authoring, parameters and
    # blueprints. Fail closed if an incompatible export omits the native budget.
    info = getattr(engine.store, "vn_ui_property_info", {}).get("spineSpeed", {})
    if info.get("min") is None or info.get("max") is None:
        return "骨骼播放速度范围信息缺失，请使用当前编辑器重新导出游戏。"
    if type(value) not in (int, float) or not info["min"] <= value <= info["max"] or not math.isfinite(value):
        return info["invalidMessage"]
    return None


def _legacy(row):
    # The only shipped pre-version record. Unknown shapes/versions are retained.
    return (isinstance(row, dict) and "version" not in row and set(row) == set(("animation", "skin", "loop", "paused", "speed", "time", "revision"))
        and all(isinstance(row.get(k), str) for k in ("animation", "skin")) and all(type(row.get(k)) is bool for k in ("loop", "paused"))
        and _number(row.get("time")) and type(row.get("revision")) is int and 0 <= row["revision"] < 9007199254740991)


def problem(row):
    if _legacy(row): return _speed_problem(row["speed"])
    if not isinstance(row, dict) or type(row.get("version")) is not int or row["version"] != 1:
        return "骨骼运行记录版本不受支持，请明确重置控件并保留原记录。"
    issue = _speed_problem(row.get("speed"))
    if issue: return issue
    if (any(type(row.get(k)) is not int or not 0 <= row[k] <= 9007199254740991 for k in ("sequence", "sourceSequence", "lastSample", "pageInstance"))
        or any(not isinstance(row.get(k), str) for k in ("assetId", "animation", "skin", "error")) or row.get("owner") is None
        or any(type(row.get(k)) is not bool for k in ("paused", "loop", "suspended", "durationKnown"))
        or row.get("status") not in ("empty", "loading", "ready", "playing", "paused", "completed", "failed")
        or any(not _number(row.get(k)) for k in ("time", "duration"))
        or not row["durationKnown"] and row["duration"] != 0 or row["durationKnown"] and row["time"] > row["duration"]):
        return "骨骼运行记录内容无效，请明确重置控件。"
    if type(row.get("eventPending", False)) is not bool or row.get("eventPending", False) and row["status"] not in ("completed", "failed"):
        return "骨骼事件记录无效，请明确重置控件。"
    return None


def make_states():
    # Instances are allocated by mutation/poll, never prediction or design reads.
    return {}


def _task(component_id):
    store = engine.store
    if component_id not in store.vn_spine_components: raise Exception("请选择骨骼动画组件。")
    return store.vn_bp_task_create(store.vn_spine_components[component_id]["pageId"], create_native=False)


def _waiting(row):
    return "empty" if not row["assetId"] else "paused" if row["paused"] or row["suspended"] or row["speed"] == 0 else "loading"


def _configured_speed(component_id, get=None):
    value = (get or engine.store.vn_ui_get)(component_id, "spineSpeed")
    issue = _speed_problem(value)
    if issue: raise Exception(issue)
    return value


def _fresh(component_id, task, owner, old=None, get=None):
    store = engine.store
    get = get or store.vn_ui_get
    component = store.vn_spine_components[component_id]
    source = get(component_id, "spineAsset") or ""
    asset = store.vn_spine_assets.get(source)
    settings = component.get("spine") or {}
    animations = asset["spine"]["animations"] if asset else []
    animation = settings.get("animation", animations[0]["name"] if animations else "") if source == component.get("assetId") else animations[0]["name"] if animations else ""
    same = old is not None and old.get("owner") is owner
    token = task.get("pageToken")
    return dict(version=1, owner=owner, pageInstance=token if type(token) is int else 0, assetId=source,
        animation=animation if source else "", skin=get(component_id, "spineSkin") or "", loop=get(component_id, "spineLoop"),
        paused=old["paused"] if same else not settings.get("autoplay", True), speed=_configured_speed(component_id, get),
        sequence=_next(old["sequence"]) if same else 1, sourceSequence=_next(old["sourceSequence"]) if same else 1, lastSample=0,
        status="loading" if source else "empty", suspended=False, time=0.0, duration=0.0, durationKnown=False, error="", eventPending=False)


def snapshot(component_id, task=None, rows=None, strict=False, get=None, assigned=()):
    store = engine.store
    get = get or store.vn_ui_get
    task = task or _task(component_id)
    owner = store.vn_ui_image_owner(task)
    old = store.vn_spine_states.get(component_id)
    issue = problem(old) if old is not None else None
    if strict and issue: raise Exception(issue)
    if owner is None:
        if strict: raise Exception("骨骼所在页面实例已经关闭或尚未显示。")
        return dict(animation="", status="empty", paused=False, suspended=False, speed=0.0, time=0.0, duration=0.0, durationKnown=False, error=issue or "")
    if issue:
        return dict(_fresh(component_id, task, owner, get=get), status="failed", error=issue)
    if _legacy(old):
        row = _fresh(component_id, task, owner, get=get)
        changed_source = get(component_id, "spineAsset") != store.vn_ui_get(component_id, "spineAsset")
        retained = ("loop", "paused", "speed") if changed_source else ("animation", "skin", "loop", "paused", "speed", "time")
        row.update({k: old[k] for k in retained})
        override = store.vn_ui_overrides.get(component_id, {})
        for key in ("skin", "loop", "speed"):
            field = "spine" + key.capitalize()
            if store.vn_ui_property_control(component_id, field) is not None or field in override or (component_id, field) in assigned:
                row[key] = get(component_id, field)
        row.update(sequence=_next(old["revision"]), sourceSequence=_next(old["revision"]))
        issue = _speed_problem(row["speed"])
        if issue: raise Exception(issue)
        # Loaded metadata is not completion proof. Retain the prior record until
        # the first mutation/poll explicitly adopts this known historical shape.
        return dict(row, suspended=not store.vn_ui_video_visible(component_id, task, rows, get) or store.vn_game_flow_transition_media_held(task, row["loop"]))
    source = get(component_id, "spineAsset") or ""
    row = old if old and old.get("owner") is owner and old["assetId"] == source else _fresh(component_id, task, owner, old, get)
    loop = get(component_id, "spineLoop")
    config = dict(skin=get(component_id, "spineSkin") or "", loop=loop, speed=_configured_speed(component_id, get), suspended=not store.vn_ui_video_visible(component_id, task, rows, get) or store.vn_game_flow_transition_media_held(task, loop))
    if any(row[k] != v for k, v in config.items()):
        row = dict(row, **config, sequence=_next(row["sequence"]), lastSample=0)
        if row["status"] not in ("completed", "failed"): row["status"] = _waiting(row)
    return row


def _store(component_id, row):
    store = engine.store
    previous = store.vn_spine_states.get(component_id)
    if _legacy(previous):
        # Mutation before the first render must migrate the same configuration
        # as polling; retain the known historical record for explicit recovery.
        store.vn_spine_recovery[component_id] = previous
        override = dict(store.vn_ui_overrides.get(component_id, {}))
        for key in ("skin", "loop", "speed"):
            field = "spine" + key.capitalize()
            if store.vn_ui_property_control(component_id, field) is None: override[field] = row[key]
        store.vn_ui_overrides[component_id] = override
    if previous is not row:
        store.vn_spine_states[component_id] = row
        renpy.retain_after_load()


def state(component_id):
    row = snapshot(component_id, strict=True)
    _store(component_id, row)
    return row


def sync(component_id):
    if component_id not in engine.store.vn_spine_components: return
    task = _task(component_id)
    if engine.store.vn_ui_image_owner(task) is not None: _store(component_id, snapshot(component_id, task, strict=True))


def validate_change(component_id, property, value):
    if component_id not in engine.store.vn_spine_components or not property.startswith("spine"): return
    row = engine.store.vn_spine_states.get(component_id)
    if row is not None and problem(row): raise Exception(problem(row))
    if property == "spineSkin" and value:
        source = engine.store.vn_ui_get(component_id, "spineAsset")
        asset = engine.store.vn_spine_assets.get(source)
        if not asset or value not in asset["spine"]["skins"]: raise Exception("当前骨骼素材没有所选皮肤；空值表示默认皮肤。")


def get(component_id, property):
    row = snapshot(component_id)
    status = row["status"]
    live = _live.get(component_id)
    if status == "playing" and (not live or not live.get("native") or live["native"].record is not engine.store.vn_spine_states.get(component_id)):
        status = "loading"
    return dict(spineAnimation=row["animation"], spineStatus=status, spinePlaying=status == "playing" and not row["paused"] and not row["suspended"] and row["speed"] > 0,
        spinePaused=status == "paused", spinePosition=row["time"], spineDuration=row["duration"], spineDurationKnown=row["durationKnown"],
        spineProgress=min(1.0, row["time"] / row["duration"]) if row["durationKnown"] and row["duration"] > 0 else 1.0 if status == "completed" else 0.0,
        spineError=row["error"])[property]


def play(component_id, animation, loop=True, restart=True):
    row = snapshot(component_id, strict=True)
    asset = engine.store.vn_spine_assets.get(row["assetId"])
    if not asset or animation not in [a["name"] for a in asset["spine"]["animations"]]: raise Exception("当前骨骼素材没有所选动画。")
    if type(loop) is not bool or type(restart) is not bool: raise Exception("循环播放和重新开始需要开关值。")
    control = engine.store.vn_ui_property_control(component_id, "spineLoop")
    changes = []
    if control and control["mode"] == "follow":
        loop = engine.store.vn_ui_get(component_id, "spineLoop")
    else:
        changes = engine.store.vn_ui_property_apply([(component_id, "spineLoop", loop)], notify=False)
    reset_track = restart or row["animation"] != animation or row["status"] in ("completed", "failed")
    if not reset_track and row["loop"] == loop and not row["paused"]: return
    row = dict(row, animation=animation, loop=loop, paused=False, sequence=_next(row["sequence"]), lastSample=0, error="", eventPending=False)
    if reset_track: row.update(sourceSequence=_next(row["sourceSequence"]), time=0.0, duration=0.0, durationKnown=False)
    row["status"] = _waiting(row)
    _store(component_id, row)
    engine.store.vn_ui_property_changes_applied(changes)
    renpy.restart_interaction()


def pause(component_id, paused=True):
    if type(paused) is not bool: raise Exception("暂停骨骼动画需要开关值。")
    row = snapshot(component_id, strict=True)
    if row["paused"] == paused or not row["assetId"]: return
    row = dict(row, paused=paused, sequence=_next(row["sequence"]), lastSample=0)
    if row["status"] not in ("completed", "failed"): row["status"] = _waiting(row)
    _store(component_id, row)
    renpy.restart_interaction()


def speed(component_id, value):
    issue = _speed_problem(value)
    if issue: raise Exception(issue)
    if component_id not in engine.store.vn_spine_components: raise Exception("请选择骨骼动画组件。")
    engine.store.vn_ui_set(component_id, "spineSpeed", float(value))


def _drop_live(component_id, live=None):
    current = _live.get(component_id)
    if live is not None and current is not live: return
    _live.pop(component_id, None)
    native = _resources.pop(component_id, None)
    if native: native.close()
    for key in list(_players):
        if key[0] == component_id: _players.pop(key, None)


def release(component_id):
    old = engine.store.vn_spine_states.get(component_id)
    if old is not None and problem(old): engine.store.vn_spine_recovery[component_id] = old
    engine.store.vn_spine_states.pop(component_id, None)
    _drop_live(component_id)


def reset(component_id):
    if component_id not in engine.store.vn_spine_components: return
    old = engine.store.vn_spine_states.get(component_id)
    task = _task(component_id)
    owner = engine.store.vn_ui_image_owner(task)
    if old is not None and (problem(old) or _legacy(old)):
        engine.store.vn_spine_recovery[component_id] = old
        engine.store.vn_spine_states.pop(component_id, None)
    _drop_live(component_id)
    if owner is None:
        engine.store.vn_spine_states.pop(component_id, None)
        return
    previous = old if old and not problem(old) and not _legacy(old) else None
    row = _fresh(component_id, task, owner, previous)
    row["paused"] = not (engine.store.vn_spine_components[component_id].get("spine") or {}).get("autoplay", True)
    _store(component_id, row)


def clear():
    for native in list(_resources.values()): native.close()
    _resources.clear()
    _players.clear()
    _live.clear()


def has_live():
    return bool(_live)


class Native:
    def __init__(self, asset):
        self.handle = None
        self.dll = library()
        error = ct.create_string_buffer(2048)
        with renpy.file(asset["path"]) as source: skeleton = source.read()
        with renpy.file(asset["spine"]["atlasPath"]) as source: atlas = source.read()
        self.handle = self.dll.vns_spine_create(skeleton, atlas, error, len(error))
        if not self.handle: raise Exception("骨骼动画读取失败：" + error.value.decode("utf-8", "replace"))
        self.pages = [engine.display.im.Image(page["path"]) for page in asset["spine"]["pages"]]
        self.asset_id, self.owner, self.source_sequence, self.sequence = asset["id"], None, 0, 0
        self.skin, self.loop, self.record, self.last_frame, self.pending = None, None, None, None, None

    def close(self):
        if self.handle:
            self.dll.vns_spine_dispose(self.handle)
            self.handle = None

    def __del__(self):
        self.close()

    def configure(self, row, record):
        issue = _speed_problem(row.get("speed"))
        if issue: raise Exception(issue)
        source_changed = self.source_sequence != row["sourceSequence"] or self.owner is not row["owner"]
        restored = self.record is not record and row["sequence"] <= self.sequence
        if source_changed or restored:
            if not self.dll.vns_spine_play(self.handle, row["animation"].encode("utf8"), row["skin"].encode("utf8"), row["loop"], 0):
                raise Exception("骨骼动画名称或皮肤不存在，请检查组件设置。")
            self.dll.vns_spine_restore(self.handle, row["time"])
            self.last_frame, self.pending = None, None
            self.skin, self.loop = row["skin"], row["loop"]
        if self.skin != row["skin"]:
            if not self.dll.vns_spine_skin(self.handle, row["skin"].encode("utf8")): raise Exception("当前骨骼素材没有所选皮肤。")
            self.skin = row["skin"]
        if self.loop != row["loop"] and row["status"] != "completed":
            self.dll.vns_spine_loop(self.handle, row["loop"])
            self.loop = row["loop"]
        if self.sequence != row["sequence"]: self.last_frame = None
        self.source_sequence, self.sequence, self.owner, self.record = row["sourceSequence"], row["sequence"], row["owner"], record

    def advance(self, row):
        # Check again immediately before the DLL, including restored records.
        # An extreme finite speed can make float32 native substeps stop progressing.
        issue = _speed_problem(row.get("speed"))
        if issue: raise Exception(issue)
        now = engine.display.core.get_time()
        delta = now - self.last_frame if self.last_frame is not None else 0.0
        self.last_frame = now
        paused = row["paused"] or row["suspended"] or row["speed"] == 0
        terminal = row["status"] in ("completed", "failed")
        delta = min(.1, delta) * row["speed"] if not paused and not terminal and 0 < delta < .25 else 0.0
        self.dll.vns_spine_update(self.handle, delta)
        position, duration, completed = ct.c_float(), ct.c_float(), ct.c_int()
        if not self.dll.vns_spine_observe(self.handle, ct.byref(position), ct.byref(duration), ct.byref(completed)):
            raise Exception("骨骼运行库无法读取当前轨道。")
        status = row["status"] if terminal else "ready" if not row["animation"] else "completed" if completed.value and not row["loop"] and not paused else "paused" if paused else "playing"
        at = duration.value if status == "completed" else min(duration.value, max(0.0, position.value))
        return dict(time=at, duration=duration.value, durationKnown=True, status=status, error="")


def _matches(sample, row, old):
    return sample and sample["base"] is old and sample["owner"] is row["owner"] and sample["sequence"] == row["sequence"] and sample["sourceSequence"] == row["sourceSequence"] and sample["assetId"] == row["assetId"]


def poll():
    global _polling
    if _polling: return
    _polling = True
    completions = []
    store = engine.store
    try:
        rows = store.vn_ui_layout_for_components(_live)
        for component_id, live in list(_live.items()):
            task = live["task"]
            old = store.vn_spine_states.get(component_id)
            if not store.vn_bp_task_alive(task) or live["owner"] is not store.vn_ui_image_owner(task):
                if isinstance(old, dict) and old.get("owner") is live["owner"]: release(component_id)
                else: _drop_live(component_id, live)
                continue
            if old is not None and problem(old): continue
            row = snapshot(component_id, task, rows, strict=True)
            native = live.get("native")
            sample = live.pop("pending", None)
            before = row["status"] in ("completed", "failed")
            if not before and _matches(sample, row, old) and (sample["values"]["status"] == "failed" or not row["suspended"]):
                values = sample["values"]
                if values["status"] != "completed" or not row["loop"] and not row["paused"] and row["speed"] > 0:
                    row = dict(row, **values, lastSample=_next(row["lastSample"]))
            if not before and row["status"] in ("completed", "failed"):
                row = dict(row, eventPending=True)
            if row.get("eventPending", False) and store.vn_game_flow_transition_media_events_ready(task):
                completions.append((component_id, task, row))
            _store(component_id, row)
            if not row["assetId"] and native:
                native.close()
                _resources.pop(component_id, None)
                live["native"] = native = None
            if native and native.record is old and native.sequence == row["sequence"]:
                native.record = row
            if row["suspended"] and native: native.last_frame = None
        for component_id, task, row in completions:
            if store.vn_spine_states.get(component_id) is not row or not store.vn_bp_task_alive(task) or not store.vn_game_flow_transition_media_events_ready(task): continue
            previous, row = row, dict(row, eventPending=False)
            _store(component_id, row)
            native = _live.get(component_id, {}).get("native")
            if native and native.record is previous: native.record = row
            payload = dict(assetId=row["assetId"], animation=row["animation"], skin=row["skin"], position=row["time"], duration=row["duration"], error=row["error"])
            focus = store.vn_ui_focus_snapshot()
            for graph_id, node_id in store.vn_spine_components[component_id]["handlers"].get(row["status"], []):
                if not store.vn_bp_task_alive(task): break
                store.vn_run_blueprint(graph_id, node_id, {node_id: payload}, page_id=store.vn_spine_components[component_id]["pageId"])
            if store.vn_bp_task_alive(task): store.vn_ui_restore_focus(focus)
    finally:
        _polling = False


def placement(asset, settings, width, height):
    bounds = asset["spine"]["bounds"]
    fit = settings.get("fit", "contain") != "manual"
    scale = min(width / bounds["width"], height / bounds["height"]) * 0.95 if fit else settings.get("scale", 1.0)
    sx = -scale if settings.get("flipX") else scale
    sy = -scale if settings.get("flipY") else scale
    x = width / 2 - (bounds["x"] + bounds["width"] / 2) * sx if fit else settings.get("originX", 0.5) * width
    y = height / 2 + (bounds["y"] + bounds["height"] / 2) * sy if fit else settings.get("originY", 0.5) * height
    return x, y, sx, sy, settings.get("rotation", 0.0)


class SpineDisplayable(renpy.Displayable):
    def __init__(self, component_id, width, height):
        super(SpineDisplayable, self).__init__()
        self.component_id, self.width, self.height = component_id, width, height

    def per_interact(self):
        renpy.redraw(self, 0)

    def render(self, width, height, st, at):
        result = renpy.Render(self.width, self.height)
        if renpy.predicting(): return result
        store, component_id = engine.store, self.component_id
        task = _task(component_id)
        owner = store.vn_ui_image_owner(task)
        if owner is None: return result
        live = _live.get(component_id)
        if live is None or live["owner"] is not owner:
            _drop_live(component_id)
            live = dict(owner=owner, task=task, native=None)
            _live[component_id] = live
        old = store.vn_spine_states.get(component_id)
        if old is not None and problem(old): return result
        playback = snapshot(component_id, task)
        if not playback.get("assetId") or playback["status"] == "failed": return result
        try:
            asset = store.vn_spine_assets[playback["assetId"]]
            native = live.get("native")
            if native is None or native.asset_id != asset["id"]:
                if native: native.close()
                native = Native(asset)
                live["native"] = _resources[component_id] = native
            native.configure(playback, old)
            values = native.advance(playback)
            settings = {key: store.vn_ui_get(component_id, field) for key, field in (("fit", "spineFit"), ("scale", "spineScale"), ("originX", "spineOriginX"), ("originY", "spineOriginY"), ("rotation", "spineRotation"), ("flipX", "spineFlipX"), ("flipY", "spineFlipY"))}
            transform = placement(asset, settings, self.width, self.height)
            count = native.dll.vns_spine_render(native.handle, *transform)
            if count < 0: raise Exception("骨骼动画网格无法分配内存。")
            from renpy.gl2.gl2mesh2 import Mesh2
            from renpy.display.model import Model
            for index in range(count):
                batch = native.dll.vns_spine_batch(native.handle, index).contents
                mesh = Mesh2(_layout, batch.vertex_count, batch.index_count // 3)
                mesh.set_geometry_data(batch.positions[:batch.vertex_count * 2])
                mesh.set_attribute_data(batch.attributes[:batch.vertex_count * 9])
                mesh.set_triangle_data(batch.indices[:batch.index_count])
                model = Model(size=(self.width, self.height)).texture(native.pages[batch.page]).shader("renpy.texture").shader("vns.spine")
                model._mesh = mesh
                blend = {0: "normal", 1: "add", 2: "multiply", 3: "vn_spine_screen"}[batch.blend]
                model.property("gl_blend_func", engine.config.gl_blend_func[blend])
                result.blit(renpy.render(model, self.width, self.height, st, at), (0, 0))
        except Exception as error:
            values = dict(time=0.0, duration=0.0, durationKnown=False, status="failed", error=str(error)[:2000])
        live["pending"] = dict(base=old, owner=owner, sequence=playback["sequence"], sourceSequence=playback["sourceSequence"], assetId=playback["assetId"], values=values)
        if values["status"] in ("playing", "loading"):
            renpy.redraw(self, 1.0 / 60)
        return result


def player(component_id, width, height):
    key = (component_id, max(1, int(width)), max(1, int(height)))
    if key not in _players:
        # Resizing does not reset a component's native track or grow this cache.
        for previous in list(_players):
            if previous[0] == component_id: _players.pop(previous, None)
        _players[key] = SpineDisplayable(*key)
    return _players[key]


def install():
    global _layout
    from renpy.gl2.gl2mesh import AttributeLayout
    _layout = AttributeLayout()
    _layout.add_attribute("a_tex_coord", 2)
    _layout.add_attribute("a_spine_light", 4)
    _layout.add_attribute("a_spine_dark", 3)
    renpy.register_shader("vns.spine", variables="""
        attribute vec4 a_spine_light;
        attribute vec3 a_spine_dark;
        varying vec4 v_spine_light;
        varying vec3 v_spine_dark;
    """, vertex_200="""
        v_spine_light = a_spine_light;
        v_spine_dark = a_spine_dark;
    """, fragment_300="""
        vec4 spine_tex = gl_FragColor;
        gl_FragColor = vec4((spine_tex.a - spine_tex.rgb) * v_spine_dark + spine_tex.rgb * v_spine_light.rgb,
                            spine_tex.a * v_spine_light.a);
    """)
    # GL_FUNC_ADD, GL_ONE, GL_ONE_MINUS_SRC_COLOR; preserve destination alpha.
    engine.config.gl_blend_func["vn_spine_screen"] = (32774, 1, 769, 32774, 0, 1)
