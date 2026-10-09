import ctypes, sys, json, time
from ctypes import wintypes
user = ctypes.WinDLL("user32", use_last_error=True)
user.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
user.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
hwnd = int(sys.argv[1])
user.GetParent.argtypes = [wintypes.HWND]
user.GetParent.restype = wintypes.HWND
user.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
user.GetWindow.restype = wintypes.HWND
user.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
user.GetWindowLongPtrW.restype = ctypes.c_ssize_t
user.WindowFromPoint.argtypes = [wintypes.POINT]
user.WindowFromPoint.restype = wintypes.HWND
user.GetForegroundWindow.restype = wintypes.HWND
user.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
user.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
user.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
user.mouse_event.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.c_size_t]
user.keybd_event.argtypes = [wintypes.BYTE, wintypes.BYTE, wintypes.DWORD, ctypes.c_size_t]
user.MapVirtualKeyW.argtypes = [wintypes.UINT, wintypes.UINT]
user.MapVirtualKeyW.restype = wintypes.UINT
user.IsWindowVisible.argtypes = [wintypes.HWND]
user.IsWindowEnabled.argtypes = [wintypes.HWND]
user.IsWindow.argtypes = [wintypes.HWND]
user.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user.SetForegroundWindow.argtypes = [wintypes.HWND]
user.SetActiveWindow.argtypes = [wintypes.HWND]
user.SetFocus.argtypes = [wintypes.HWND]
user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user.GetWindowThreadProcessId.restype = wintypes.DWORD
user.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
user.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
kernel = ctypes.WinDLL("kernel32")
kernel.GetCurrentThreadId.restype = wintypes.DWORD
def focus_target():
    if not user.IsWindow(hwnd) or not user.IsWindowEnabled(hwnd):
        raise RuntimeError("Requested input window is gone or disabled: " + str(hwnd))
    user.SetForegroundWindow(hwnd)
    for attempt in range(12):
        if user.GetForegroundWindow() == hwnd: return
        if attempt == 3:
            # The helper is short lived and may not own the foreground input
            # queue. Attach only while focusing our known test window.
            current = kernel.GetCurrentThreadId()
            targets = {user.GetWindowThreadProcessId(user.GetForegroundWindow(), None), user.GetWindowThreadProcessId(hwnd, None)} - {0, current}
            attached = []
            try:
                for target in targets:
                    if user.AttachThreadInput(current, target, True): attached.append(target)
                user.SetForegroundWindow(hwnd)
                user.SetActiveWindow(hwnd)
                user.SetFocus(hwnd)
            finally:
                for target in reversed(attached): user.AttachThreadInput(current, target, False)
        time.sleep(0.06)
    foreground = user.GetForegroundWindow()
    classname = ctypes.create_unicode_buffer(256)
    user.GetClassNameW(foreground, classname, 256)
    raise RuntimeError("Refusing input to another window: " + json.dumps(dict(command=sys.argv[2], requested=hwnd, foreground=foreground, foregroundClass=classname.value, exists=bool(user.IsWindow(hwnd)), enabled=bool(user.IsWindowEnabled(hwnd)), visible=bool(user.IsWindowVisible(hwnd)))))
rect, client = wintypes.RECT(), wintypes.RECT()
user.GetWindowRect(hwnd, ctypes.byref(rect))
user.GetClientRect(hwnd, ctypes.byref(client))
if sys.argv[2] == "focus":
    user.ShowWindow(hwnd, 9)
    focus_target()
if sys.argv[2] == "wake":
    # SetForegroundWindow alone does not wake a sleeping display. A modifier
    # tap in our verified window gives pixel checks an active desktop.
    focus_target()
    user.keybd_event(0x10, user.MapVirtualKeyW(0x10, 0), 0, 0)
    time.sleep(0.08)
    user.keybd_event(0x10, user.MapVirtualKeyW(0x10, 0), 2, 0)
if sys.argv[2] == "click":
    x, y = round(float(sys.argv[3]) * client.right), round(float(sys.argv[4]) * client.bottom)
    user.SetForegroundWindow(hwnd)
    point, previous = wintypes.POINT(x, y), wintypes.POINT()
    user.ClientToScreen(hwnd, ctypes.byref(point))
    if user.WindowFromPoint(point) != hwnd: raise RuntimeError("Another window covers the game click target")
    user.GetCursorPos(ctypes.byref(previous))
    user.SetCursorPos(point.x, point.y)
    time.sleep(0.12)
    user.mouse_event(0x0002, 0, 0, 0, 0)
    time.sleep(0.08)
    user.mouse_event(0x0004, 0, 0, 0, 0)
    time.sleep(0.15)
    user.SetCursorPos(previous.x, previous.y)
if sys.argv[2].startswith("key-"):
    focus_target()
    shifted = "shift" in sys.argv[2]
    key = 0x74 if "f5" in sys.argv[2] else 0x70 if "f1" in sys.argv[2] else 0x75
    if shifted: user.keybd_event(0x10, user.MapVirtualKeyW(0x10, 0), 0, 0)
    user.keybd_event(key, user.MapVirtualKeyW(key, 0), 0, 0)
    time.sleep(0.08)
    user.keybd_event(key, user.MapVirtualKeyW(key, 0), 2, 0)
    if shifted: user.keybd_event(0x10, user.MapVirtualKeyW(0x10, 0), 2, 0)
center = wintypes.POINT((rect.left + rect.right) // 2, (rect.top + rect.bottom) // 2)
print(json.dumps(dict(exists=bool(user.IsWindow(hwnd)), visible=bool(user.IsWindowVisible(hwnd)), enabled=bool(user.IsWindowEnabled(hwnd)), parent=str(user.GetParent(hwnd) or ""), owner=str(user.GetWindow(hwnd, 4) or ""), isChild=bool(user.GetWindowLongPtrW(hwnd, -16) & 0x40000000), foreground=str(user.GetForegroundWindow() or ""), atCenter=str(user.WindowFromPoint(center) or ""), bounds=[rect.left, rect.top, rect.right, rect.bottom], client=[client.right, client.bottom])))

