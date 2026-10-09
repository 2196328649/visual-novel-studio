"""Real-time Spine meshes for Ren'Py. Native resources never enter saved state.

The editor imports straight-alpha PNGs, retaining atlas UV dimensions. The
native C runtime evaluates bones, constraints, deform timelines and clipping;
Ren'Py renders its triangles directly with the game's normal GL renderer.
"""
import ctypes as ct
import os
import renpy as engine
from renpy import exports as renpy


class Batch(ct.Structure):
    _fields_ = [("page", ct.c_int), ("blend", ct.c_int), ("vertex_count", ct.c_int), ("index_count", ct.c_int),
                ("positions", ct.POINTER(ct.c_float)), ("attributes", ct.POINTER(ct.c_float)),
                ("indices", ct.POINTER(ct.c_uint32)), ("vertex_capacity", ct.c_int), ("index_capacity", ct.c_int)]


_dll = None
_players = {}
_resources = {}
_layout = None


def library():
    global _dll
    if _dll is None:
        if engine.android:
            from jnius import autoclass
            activity = autoclass("org.renpy.android.PythonSDLActivity").mActivity
            native_directory = str(activity.getApplicationInfo().nativeLibraryDir)
            filename = os.path.join(native_directory, "libvns_spine.so")
        else:
            filename = os.path.join(os.path.dirname(__file__), "vns_spine.dll")
        dll = ct.CDLL(filename)
        dll.vns_spine_abi.restype = ct.c_int
        if dll.vns_spine_abi() != 1:
            raise Exception("骨骼动画运行库版本不匹配，请重新导出游戏。")
        dll.vns_spine_create.argtypes = [ct.c_char_p, ct.c_char_p, ct.c_char_p, ct.c_int]
        dll.vns_spine_create.restype = ct.c_void_p
        dll.vns_spine_dispose.argtypes = [ct.c_void_p]
        dll.vns_spine_dispose.restype = None
        dll.vns_spine_play.argtypes = [ct.c_void_p, ct.c_char_p, ct.c_char_p, ct.c_int, ct.c_float]
        dll.vns_spine_play.restype = ct.c_int
        dll.vns_spine_update.argtypes = [ct.c_void_p, ct.c_float]
        dll.vns_spine_update.restype = None
        dll.vns_spine_render.argtypes = [ct.c_void_p] + [ct.c_float] * 5
        dll.vns_spine_render.restype = ct.c_int
        dll.vns_spine_batch.argtypes = [ct.c_void_p, ct.c_int]
        dll.vns_spine_batch.restype = ct.POINTER(Batch)
        _dll = dll
    return _dll


class Native:
    def __init__(self, asset):
        self.handle = None
        self.dll = library()
        error = ct.create_string_buffer(2048)
        with renpy.file(asset["path"]) as source:
            skeleton = source.read()
        with renpy.file(asset["spine"]["atlasPath"]) as source:
            atlas = source.read()
        self.handle = self.dll.vns_spine_create(skeleton, atlas, error, len(error))
        if not self.handle:
            raise Exception("骨骼动画读取失败：" + error.value.decode("utf-8", "replace"))
        self.pages = [renpy.display.im.Image(page["path"]) for page in asset["spine"]["pages"]]
        self.signature = None
        self.position = 0.0
        self.last_frame = None
        self.state_identity = None

    def close(self):
        if self.handle:
            self.dll.vns_spine_dispose(self.handle)
            self.handle = None

    def __del__(self):
        self.close()


def clear():
    for native in _resources.values():
        native.close()
    _resources.clear()
    _players.clear()


def make_states():
    states = renpy.python.RevertableDict()
    for component_id, component in renpy.store.vn_spine_components.items():
        asset = renpy.store.vn_spine_assets[component["assetId"]]
        settings = component.get("spine") or {}
        animations = asset["spine"]["animations"]
        states[component_id] = renpy.python.RevertableDict(animation=settings.get("animation", animations[0]["name"] if animations else ""),
            skin=settings.get("skin", ""), loop=settings.get("loop", True), paused=not settings.get("autoplay", True),
            speed=settings.get("speed", 1.0), time=0.0, revision=0)
    return states


def state(component_id):
    if component_id not in renpy.store.vn_spine_components:
        raise Exception("请选择骨骼动画组件。")
    states = renpy.store.vn_spine_states
    # Older saves can precede a newly authored component.
    if component_id not in states:
        states[component_id] = make_states()[component_id]
    return states[component_id]


def play(component_id, animation, loop=True, restart=True):
    playback = state(component_id)
    component = renpy.store.vn_spine_components[component_id]
    asset = renpy.store.vn_spine_assets[component["assetId"]]
    if animation not in [entry["name"] for entry in asset["spine"]["animations"]]:
        raise Exception("此骨骼素材没有动画“" + str(animation) + "”，请重新选择。")
    if not isinstance(loop, bool) or not isinstance(restart, bool):
        raise Exception("循环播放和重新开始需要开关值。")
    if restart or playback["animation"] != animation:
        playback["time"] = 0.0
        playback["revision"] += 1
    playback["animation"], playback["loop"], playback["paused"] = animation, loop, False
    renpy.restart_interaction()


def pause(component_id, paused=True):
    if not isinstance(paused, bool):
        raise Exception("暂停骨骼动画需要开关值。")
    state(component_id)["paused"] = paused
    renpy.restart_interaction()


def speed(component_id, value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 8:
        raise Exception("动画速度需要 0 至 8 的数值。")
    state(component_id)["speed"] = float(value)
    renpy.restart_interaction()


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
        if renpy.predicting():
            return result
        component = renpy.store.vn_spine_components[self.component_id]
        asset = renpy.store.vn_spine_assets[component["assetId"]]
        playback = state(self.component_id)
        native = _resources.get(self.component_id)
        if native is None:
            native = _resources[self.component_id] = Native(asset)
        signature = (playback["animation"], playback["skin"], playback["loop"], playback["revision"])
        reset = native.signature != signature or native.state_identity != id(playback) or playback["time"] < native.position - 0.00001
        duration = next((entry["duration"] for entry in asset["spine"]["animations"] if entry["name"] == playback["animation"]), 0)
        if reset:
            if not native.dll.vns_spine_play(native.handle, playback["animation"].encode("utf8"), playback["skin"].encode("utf8"), playback["loop"], 0):
                raise Exception("骨骼动画名称或皮肤不存在，请检查组件设置。")
            native.signature, native.state_identity = signature, id(playback)
            initial = playback["time"] % duration if duration and playback["loop"] else min(playback["time"], duration)
            native.dll.vns_spine_update(native.handle, initial)
            native.position, native.last_frame = playback["time"], None
        now = renpy.display.core.get_time()
        delta = now - native.last_frame if native.last_frame is not None else 0.0
        native.last_frame = now
        # Hidden pages resume at their last pose; they do not jump through an
        # arbitrary amount of physics when shown again after a long menu visit.
        if not playback["paused"] and 0 < delta < 0.25:
            next_time = playback["time"] + delta * playback["speed"]
            if not playback["loop"]:
                next_time = min(next_time, duration)
            playback["time"] = next_time
        native.dll.vns_spine_update(native.handle, max(0.0, playback["time"] - native.position))
        native.position = playback["time"]
        transform = placement(asset, component.get("spine") or {}, self.width, self.height)
        count = native.dll.vns_spine_render(native.handle, *transform)
        if count < 0:
            raise Exception("骨骼动画网格无法分配内存。")
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
            model.property("gl_blend_func", renpy.config.gl_blend_func[blend])
            result.blit(renpy.render(model, self.width, self.height, st, at), (0, 0))
        if not playback["paused"] and playback["speed"] > 0 and (playback["loop"] or playback["time"] < duration):
            renpy.redraw(self, 1.0 / 60)
        return result


def player(component_id, width, height):
    key = (component_id, width, height)
    if key not in _players:
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
    renpy.config.gl_blend_func["vn_spine_screen"] = (32774, 1, 769, 32774, 0, 1)
