"""
Best-effort *real* background blur ("Acrylic") for the HUD window, Windows 10/11 only.

`-alpha` on a Tk window only dims the whole window uniformly — it does not
blur whatever is behind it, so it can't produce an actual glass effect.
True blur-behind requires talking to the Desktop Window Manager directly via
`SetWindowCompositionAttribute` — an undocumented but long-stable and widely
used Windows API (the same mechanism many blur-effect apps and toolkits build
on). This degrades silently everywhere else: non-Windows platforms, or if the
API call fails for any reason, `apply_acrylic` just returns False and the HUD
keeps using its existing flat-alpha translucency as a fallback.
"""
import sys
import ctypes


def apply_acrylic(root, color_hex: str = "#0d1527", opacity: int = 200) -> bool:
    """
    Enable acrylic blur-behind on a Tk root window.

    color_hex: tint color blended into the blur (usually your card/bg color).
    opacity:   0-255, how strongly `color_hex` tints the blurred content
               behind the window. Lower = more see-through, higher = more tint.
    Returns True if acrylic was applied, False if unavailable (safe to ignore).
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
        r, g, b = (int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16))
        opacity = max(0, min(255, opacity))
        # Win32 wants 0xAABBGGRR, not the usual 0xRRGGBB
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
