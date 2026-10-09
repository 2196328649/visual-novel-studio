import type { Project } from '../core/model';

/** Constrain the client area, including Windows frame/DPI changes, without stretching the render. */
export function createWindowRuntime(project: Project) {
  return `python early in _vn_window:
    import os, json, ctypes
    from ctypes import wintypes

    class Controller(object):
        def __init__(self):
            self.user = ctypes.WinDLL("user32", use_last_error=True)
            # Chain SDL's procedure and retain the ctypes callback for the window lifetime.
            self.callback_type = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
            self.user.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
            self.user.SetWindowLongPtrW.restype = ctypes.c_ssize_t
            self.user.CallWindowProcW.argtypes = [ctypes.c_void_p, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
            self.user.CallWindowProcW.restype = ctypes.c_ssize_t
            self.user.IsWindow.argtypes = [wintypes.HWND]
            self.user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
            self.user.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
            self.user.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
            self.user.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
            self.user.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
            self.user.GetWindowLongPtrW.restype = ctypes.c_ssize_t
            self.user.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
            self.user.IsIconic.argtypes = [wintypes.HWND]
            self.callback = self.callback_type(self.message)
            self.hwnd = None
            self.original = None
            self.adjusting = False
            self.sizing = False

        def rectangles(self, hwnd):
            window, client = wintypes.RECT(), wintypes.RECT()
            self.user.GetWindowRect(hwnd, ctypes.byref(window))
            self.user.GetClientRect(hwnd, ctypes.byref(client))
            return window, client

        def windowed(self, hwnd):
            return not renpy.game.preferences.fullscreen and bool(self.user.GetWindowLongPtrW(hwnd, -16) & 0x00C00000) and not self.user.IsIconic(hwnd)

        def constrain(self, proposed, edge, frame_width, frame_height):
            width = max(1, proposed.right - proposed.left - frame_width)
            height = max(1, proposed.bottom - proposed.top - frame_height)
            if edge in (3, 6):
                width = max(1, round(height * ${project.width / project.height}))
                proposed.right = proposed.left + width + frame_width
            else:
                height = max(1, round(width * ${project.height / project.width}))
                if edge in (4, 5):
                    proposed.top = proposed.bottom - height - frame_height
                else:
                    proposed.bottom = proposed.top + height + frame_height

        def message(self, hwnd, message, wparam, lparam):
            try:
                if message == 0x0231:
                    self.sizing = True
                elif message == 0x0232:
                    self.sizing = False
                elif message == 0x0214 and self.windowed(hwnd):
                    window, client = self.rectangles(hwnd)
                    proposed = ctypes.cast(lparam, ctypes.POINTER(wintypes.RECT)).contents
                    self.constrain(proposed, int(wparam), window.right - window.left - client.right, window.bottom - window.top - client.bottom)
                    return 1
                elif message == 0x0082:
                    self.hwnd = None
            except Exception as error:
                renpy.log("Window geometry: " + str(error))
            return self.user.CallWindowProcW(self.original, hwnd, message, wparam, lparam)

        def find_window(self):
            info = renpy.display.core.pygame.display.get_wm_info()
            if info.get("window"):
                return int(info["window"])
            if self.hwnd and self.user.IsWindow(self.hwnd):
                return self.hwnd
            found = []
            def visit(hwnd, data):
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

        def tick(self):
            hwnd = self.find_window()
            if not hwnd:
                return
            if hwnd != self.hwnd:
                callback = ctypes.cast(self.callback, ctypes.c_void_p).value
                if self.hwnd and self.user.IsWindow(self.hwnd) and self.user.GetWindowLongPtrW(self.hwnd, -4) == callback:
                    self.user.SetWindowLongPtrW(self.hwnd, -4, self.original)
                original = self.user.SetWindowLongPtrW(hwnd, -4, callback)
                if not original:
                    renpy.log("Window geometry hook failed: " + str(ctypes.get_last_error()))
                    return
                self.original = original
                self.hwnd = hwnd
            if self.adjusting or self.sizing or not self.windowed(hwnd):
                return
            window, client = self.rectangles(hwnd)
            width, height = client.right, client.bottom
            if width <= 0 or height <= 0 or abs(height - width * ${project.height / project.width}) <= 1:
                return
            # Fit within the requested client rectangle, including snapped/maximized windows.
            target_width = min(width, round(height * ${project.width / project.height}))
            target_height = round(target_width * ${project.height / project.width})
            self.adjusting = True
            try:
                self.user.SetWindowPos(hwnd, None, 0, 0, target_width + window.right - window.left - width, target_height + window.bottom - window.top - height, 0x0016)
            finally:
                self.adjusting = False

    def tick():
        if os.name != "nt":
            return
        boot = os.environ.get("VNS_PREVIEW_BOOT")
        if boot and json.loads(boot).get("mode") == "embedded":
            return
        interface = renpy.display.interface
        controller = getattr(interface, "vn_window_geometry", None)
        if controller is None:
            controller = Controller()
            interface.vn_window_geometry = controller
        controller.tick()

init python:
    config.periodic_callbacks.append(_vn_window.tick)
`;
}
