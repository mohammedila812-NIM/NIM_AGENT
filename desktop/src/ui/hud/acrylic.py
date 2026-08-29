"""
Best-effort real background blur ("Acrylic") for the HUD window, Windows 10/11 only.

True blur-behind requires talking to the Desktop Window Manager directly via
`SetWindowCompositionAttribute`. This degrades gracefully on non-Windows platforms.
"""
import sys
import ctypes


def apply_acrylic(root, color_hex: str = "#071425", opacity: int = 210) -> bool:
    """
    Enable acrylic blur-behind on a Tk root window.

    color_hex: tint color blended into the blur (Deep Navy base).
    opacity:   0-255, how strongly `color_hex` tints the blurred background.
    Returns True if acrylic was applied, False otherwise.
    """
    if sys.platform != "win32":
        return False

    try:
        root.update_idletasks()
        hwnd = ctypes.windll.user32.GetParent(root.winfo_id())

        class ACCENT_POLICY(ctypes.Structure):
            _fields_ = [
                ("AccentState", ctypes.c_int),
                ("AccentFlags", ctypes.c_int),
                ("GradientColor", ctypes.c_int),
                ("AnimationId", ctypes.c_int),
            ]

        class WINDOWCOMPOSITIONATTRIBDATA(ctypes.Structure):
            _fields_ = [
                ("Attribute", ctypes.c_int),
                ("Data", ctypes.c_void_p),
                ("SizeOfData", ctypes.c_size_t),
            ]

        ACCENT_ENABLE_ACRYLICBLURBEHIND = 4
        WCA_ACCENT_POLICY = 19

        hex_color = color_hex.lstrip("#")
        r = int(hex_color[0:2], 16)
        g = int(hex_color[2:4], 16)
        b = int(hex_color[4:6], 16)
        opacity = max(0, min(255, opacity))
        # Win32 wants 0xAABBGGRR
        gradient_color = (opacity << 24) | (b << 16) | (g << 8) | r

        accent = ACCENT_POLICY()
        accent.AccentState = ACCENT_ENABLE_ACRYLICBLURBEHIND
        accent.GradientColor = gradient_color

        data = WINDOWCOMPOSITIONATTRIBDATA()
        data.Attribute = WCA_ACCENT_POLICY
        data.SizeOfData = ctypes.sizeof(accent)
        data.Data = ctypes.cast(ctypes.pointer(accent), ctypes.c_void_p)

        set_attr = ctypes.windll.user32.SetWindowCompositionAttribute
        set_attr(hwnd, ctypes.byref(data))
        return True
    except Exception:
        return False
