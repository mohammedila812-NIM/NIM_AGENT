"""
HUD Theme & Design Tokens for NIM JARVIS Futuristic Overlay
Based on Stitch Design System (NIM-Agent HUD)
"""

THEME = {
    # Surfaces & Glass
    "bg_dark": "#071425",           # Deep Cyber Navy base
    "bg_glass": "#0d1a2b",          # Frosted acrylic layer
    "card_bg": "#0a1829",           # Main panel background
    "card_bg_soft": "#0f233a",      # Log stream / input surface
    "card_border": "#1e3752",       # Subtle outer border
    "border_neon": "#44788c",       # Neon glowing border
    "glass_highlight": "#3b607e",   # Light-catching top bevel
    "canvas_bg": "#0a1829",

    # Accents (Stitch Design Spec)
    "accent_sage": "#8fb7ab",       # Primary Status Neon (Telemetry, Ready, Verified)
    "accent_teal": "#aad3c6",       # Bright Teal (Active stream)
    "accent_coral": "#df6b48",      # Secondary Alert / Kill-Switch (ESC Cancel, Interrupts)
    "accent_coral_hover": "#c85736",
    "accent_amber": "#d9ab58",      # Thinking / Pending Approval
    "accent_glow": "#62998a",
    "accent_core": "#eafcff",       # Reactor hot-center white

    # Text & Typography
    "text_primary": "#d6e3fb",
    "text_secondary": "#a8c0cc",
    "text_muted": "#5a7a8a",
    "text_dim": "#375060",

    # Font Families (Departure Mono terminal preferred, Consolas/Courier fallback)
    "font_family": "Departure Mono",
    "font_mono": "Departure Mono",
    "font_fallback": "Consolas",

    # Motion & Timings (ms)
    "duration_fast": 100,
    "duration_normal": 200,
    "duration_reveal": 12,
    "period_breathe": 2400,
    "period_pulse": 1300,
    "period_wave_idle": 1600,

    # Layout Spacing
    "radius_card": 12,
    "radius_control": 6,
    "radius_pill": 999,
    "spacing_unit": 4,
}
