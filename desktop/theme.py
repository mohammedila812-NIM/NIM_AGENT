"""
HUD Theme & Design Tokens for NIM JARVIS Futuristic Overlay
"""

THEME = {
    # Surfaces
    "bg_dark": "#070b14",
    "card_bg": "#0d1527",
    "card_bg_soft": "#101b31",      # thought-ticker / input surfaces
    "card_border": "#1a2942",
    "glass_highlight": "#33507d",   # faint top-edge line that sells the "glass" read
    "canvas_bg": "#0d1527",         # must match whatever frame a Canvas sits inside

    # Accents
    "accent_cyan": "#00f0ff",
    "accent_glow": "#00a8ff",
    "accent_green": "#00ff9d",
    "accent_amber": "#ffb800",
    "accent_magenta": "#ff007f",
    "accent_core": "#eafcff",       # near-white — the hot centre of the reactor glow

    # Text
    "text_primary": "#ffffff",
    "text_secondary": "#8da2c0",
    "text_muted": "#506380",

    # Type
    "font_family": "Segoe UI",
    "font_mono": "Consolas",

    # Motion (ms) — reuse these everywhere so the HUD feels choreographed as
    # one system, rather than a pile of separately-tuned widgets.
    "duration_fast": 120,       # button flashes, dispatch acknowledgement
    "duration_normal": 220,     # expand/collapse
    "duration_reveal": 14,      # per-character typewriter reveal for new thoughts
    "period_breathe": 2600,     # reactor glow breathing cycle
    "period_pulse": 1400,       # status dot pulse cycle
    "period_wave_idle": 1800,   # idle waveform sway cycle

    # Layout
    "radius_card": 16,
    "radius_control": 8,
    "spacing_unit": 4,
}
