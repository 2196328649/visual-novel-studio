/** Only written to an editor preview build. Never included in released games. */
export function createPreviewRuntime(): string {
  return String.raw`init 999 python in _studio_preview:
    _constant = True
    import os, json, queue, ctypes
    from ctypes import wintypes
    import renpy

    class Player:
        def __init__(self, boot):
            self.boot = boot
            self.commands = queue.Queue()
            self.hwnd = None
            self.attached = False
            self.last_layout = None
            self.present_after = 0.0
            self.ready = False
            self.revision = -1
            self.focus_counter = 0
            self.paused_at = None
            self.offset = 0.0
            self.clock = renpy.display.core.get_time
            self.viewport = boot.get("viewport", {})
            self.user = ctypes.WinDLL("user32", use_last_error=True)
            for name, args, result in [
                ("GetParent", [wintypes.HWND], wintypes.HWND),
                ("GetWindow", [wintypes.HWND, wintypes.UINT], wintypes.HWND),
                ("ClientToScreen", [wintypes.HWND, ctypes.POINTER(wintypes.POINT)], wintypes.BOOL),
                ("GetWindowLongPtrW", [wintypes.HWND, ctypes.c_int], ctypes.c_ssize_t),
                ("SetWindowLongPtrW", [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t], ctypes.c_ssize_t),
                ("ShowWindow", [wintypes.HWND, ctypes.c_int], wintypes.BOOL),
                ("IsWindowVisible", [wintypes.HWND], wintypes.BOOL),
                ("IsWindow", [wintypes.HWND], wintypes.BOOL),
                ("IsIconic", [wintypes.HWND], wintypes.BOOL),
                ("EnableWindow", [wintypes.HWND, wintypes.BOOL], wintypes.BOOL),
                ("SetForegroundWindow", [wintypes.HWND], wintypes.BOOL),
                ("SetFocus", [wintypes.HWND], wintypes.HWND),
                ("MoveWindow", [wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.BOOL], wintypes.BOOL),
                ("SetWindowPos", [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT], wintypes.BOOL),
                ("GetWindowThreadProcessId", [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)], wintypes.DWORD),
                ("GetWindowRect", [wintypes.HWND, ctypes.POINTER(wintypes.RECT)], wintypes.BOOL),
                ("GetClassNameW", [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int], ctypes.c_int),
            ]:
                method = getattr(self.user, name)
                method.argtypes, method.restype = args, result
            renpy.display.core.get_time = self.now

        def now(self):
            return (self.paused_at if self.paused_at is not None else self.clock()) - self.offset

        def emit(self, phase, **extra):
            value = dict(phase=phase, mode=self.boot["mode"], sessionId=self.boot["id"], windowId=str(self.hwnd or ""), visible=bool(self.hwnd and self.user.IsWindowVisible(self.hwnd)))
            value.update(extra)
            print("VNS_PREVIEW:" + json.dumps(value), flush=True)

        def find_window(self):
            try:
                info = renpy.display.core.pygame.display.get_wm_info()
                if info.get("window"): return int(info["window"])
            except (AttributeError, TypeError): pass
            found = []
            def visit(hwnd, unused):
                pid = wintypes.DWORD()
                self.user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                name = ctypes.create_unicode_buffer(256)
                self.user.GetClassNameW(hwnd, name, 256)
                if pid.value == os.getpid() and "SDL" in name.value:
                    found.append(hwnd)
                return True
            callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(visit)
            self.user.EnumWindows(callback, 0)
            return found[0] if found else None

        def layout(self):
            if not self.hwnd: return
            view = self.viewport
            parent = int(self.boot["parent"])
            if not view.get("visible", True) or not self.user.IsWindowVisible(parent) or self.user.IsIconic(parent):
                if self.user.IsWindowVisible(self.hwnd): self.user.ShowWindow(self.hwnd, 0)
                self.last_layout = None
                return
            if self.boot["mode"] == "embedded":
                if view.get("width", 0) < 20 or view.get("height", 0) < 20:
                    if self.user.IsWindowVisible(self.hwnd): self.user.ShowWindow(self.hwnd, 0)
                    self.last_layout = None
                    return
                attaching = not self.attached
                if not self.attached:
                    # An OpenGL WS_CHILD can remain invisible under Chromium's
                    # DirectComposition surface despite IsWindowVisible=True.
                    # Keep its own presentation surface, owned by the editor and
                    # fitted to the viewport. Ownership handles stacking/minimize.
                    style = self.user.GetWindowLongPtrW(self.hwnd, -16)
                    self.user.SetWindowLongPtrW(self.hwnd, -16, (style & ~0x40CF0000) | 0x80000000)
                    exstyle = self.user.GetWindowLongPtrW(self.hwnd, -20)
                    self.user.SetWindowLongPtrW(self.hwnd, -20, (exstyle & ~0x00040000) | 0x00000080)
                    ctypes.set_last_error(0)
                    self.user.SetWindowLongPtrW(self.hwnd, -8, parent)
                    if self.user.GetWindow(self.hwnd, 4) != parent:
                        raise RuntimeError("无法将游戏窗口放入编辑器（Windows %s），请改用独立窗口试玩。" % ctypes.get_last_error())
                    self.attached = True
                point = wintypes.POINT(int(view["x"]), int(view["y"]))
                if not self.user.ClientToScreen(parent, ctypes.byref(point)):
                    raise RuntimeError("无法取得编辑器试玩区域的位置。")
                desired = (point.x, point.y, int(view["width"]), int(view["height"]))
                if desired != self.last_layout or not self.user.IsWindowVisible(self.hwnd):
                    # Never raise the editor over another app while following its
                    # viewport, and avoid repeated resize/activation messages.
                    flags = 0x0254 | (0x0020 if attaching else 0)
                    if not self.user.SetWindowPos(self.hwnd, None, *desired, flags):
                        raise RuntimeError("无法更新编辑器试玩画面的位置。")
                    if self.last_layout is None or self.last_layout[2:] != desired[2:]:
                        self.present_after = self.clock() + 0.15
                    self.last_layout = desired
                    renpy.game.interface.force_redraw = True
            else:
                if not self.user.IsWindowVisible(self.hwnd): self.user.ShowWindow(self.hwnd, 8)

        def pause(self, paused):
            if paused and self.paused_at is None:
                self.paused_at = self.clock()
                renpy.audio.audio.pause_all()
                self.user.EnableWindow(self.hwnd, False)
                self.emit("focus-editor")
                self.emit("paused")
            elif not paused and self.paused_at is not None:
                self.offset += self.clock() - self.paused_at
                self.paused_at = None
                self.user.EnableWindow(self.hwnd, True)
                renpy.audio.audio.unpause_all()
                self.emit("running")

        def tick(self):
            try:
                if not self.user.IsWindow(int(self.boot["parent"])):
                    renpy.exports.quit(status=0)
                if not self.hwnd:
                    self.hwnd = self.find_window()
                    if not self.hwnd: return
                    was_visible = bool(self.user.IsWindowVisible(self.hwnd))
                    self.layout()
                    self.initial_visibility = was_visible
                self.layout()
                # A snapshot keeps pause and viewport updates ordered, including
                # during scene changes. It stays outside Ren'Py save/rollback data.
                try:
                    with open(os.path.join(renpy.config.basedir, "preview-control.json"), encoding="utf-8") as control_file:
                        control = json.load(control_file)
                except (OSError, ValueError): control = {}
                # An unavailable or incomplete snapshot keeps the last state.
                if control.get("revision", self.revision) != self.revision:
                    self.revision = control["revision"]
                    if "viewport" in control:
                        self.viewport = control["viewport"]
                        self.layout()
                    self.pause(bool(control.get("paused", False)))
                    if control.get("focus", 0) != self.focus_counter:
                        self.focus_counter = control["focus"]
                        self.commands.put({"command": "focus"})
                for unused in range(100):
                    try: item = self.commands.get_nowait()
                    except queue.Empty: break
                    command = item.get("command")
                    if command == "stop":
                        self.pause(False)
                        renpy.exports.quit(status=0)
                    elif command == "viewport":
                        self.viewport = item["viewport"]
                        self.layout()
                    elif command == "pause": self.pause(True)
                    elif command == "resume": self.pause(False)
                    elif command == "focus":
                        self.layout()
                        if self.paused_at is None:
                            self.user.SetForegroundWindow(self.hwnd)
                            self.user.SetFocus(self.hwnd)
                        else:
                            self.emit("focus-editor")
                if not self.ready and self.clock() >= self.present_after and self.user.IsWindowVisible(self.hwnd) and renpy.game.interface.surftree is not None and hasattr(renpy.store, "vn_current_node"):
                    frame = os.path.join(renpy.config.basedir, "preview-first-frame.png")
                    if renpy.exports.screenshot(frame):
                        self.ready = True
                        rect = wintypes.RECT()
                        self.user.GetWindowRect(self.hwnd, ctypes.byref(rect))
                        self.emit("running", initialVisibility=self.initial_visibility, parent=str(self.user.GetParent(self.hwnd) or ""), owner=str(self.user.GetWindow(self.hwnd, 4) or ""), presentation="owned-viewport" if self.boot["mode"] == "embedded" else "window", bounds=[rect.left, rect.top, rect.right, rect.bottom])
                        if self.boot["mode"] == "window": self.user.SetForegroundWindow(self.hwnd)
            except (OSError, ValueError, RuntimeError, AttributeError, TypeError) as error:
                self.emit("failed", message=str(error))
                renpy.exports.quit(status=1)

    player = None
    boot = os.environ.get("VNS_PREVIEW_BOOT")
    if boot and os.name == "nt":
        player = Player(json.loads(boot))
        renpy.config.periodic_callbacks.append(player.tick)
        # Embedded mode remains windowed even when a player's settings request fullscreen.
        renpy.store.preferences.fullscreen = False
        if player.boot["mode"] == "embedded":
            renpy.config.keymap["toggle_fullscreen"] = []
            renpy.config.mouse_focus_clickthrough = True

screen _studio_preview_keys():
    zorder 10000
    key "shift_K_F5" action Function(_studio_preview.player.commands.put, {"command": "stop"})
    key "keyup_shift_K_F1" action Function(_studio_preview.player.emit, "focus-editor")
    # Release before disabling the SDL window so it never loses the matching
    # key-up to Electron and mistakes the next physical press for a repeat.
    key "keyup_K_F6" action Function(_studio_preview.player.commands.put, {"command": "pause"})

init 1000 python:
    if _studio_preview.player:
        config.always_shown_screens.append("_studio_preview_keys")
`;
}
