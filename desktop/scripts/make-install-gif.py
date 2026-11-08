"""Builds desktop/assets/install.gif: the Squirrel installer's loading animation.

App icon, the name, and the overlay pill with a moving waveform, on the site's off-white.
Drawn at 2x and scaled down for smooth edges. Usage, from desktop/: python -I scripts/make-install-gif.py .
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DESKTOP = Path(sys.argv[1])
W, H, S = 480, 300, 2  # output size, supersampling
BG = (250, 250, 251)
INK = (20, 21, 26)
MUTED = (107, 114, 128)
PILL = (23, 23, 23)
ACCENT = (141, 144, 255)  # --accent (dark theme), reads well on the dark pill
FRAMES, MS = 30, 50
BARS = 22

FONTS = Path("C:/Windows/Fonts")
title_font = ImageFont.truetype(str(FONTS / "seguisb.ttf"), 26 * S)
caption_font = ImageFont.truetype(str(FONTS / "segoeui.ttf"), 14 * S)

icon = Image.open(DESKTOP / "assets" / "icon.png").convert("RGBA").resize((84 * S, 84 * S), Image.LANCZOS)


def level(i: int, t: float) -> float:
    """A voice-like envelope: two travelling waves, louder in the middle of the pill."""
    x = i / (BARS - 1)
    shape = 0.35 + 0.65 * math.sin(math.pi * x)
    wave = 0.5 + 0.5 * math.sin(2 * math.pi * (t - x * 1.3)) * math.cos(2 * math.pi * (0.5 * t + x * 0.7))
    return max(0.12, shape * (0.25 + 0.75 * abs(wave)))


def centered_text(d: ImageDraw.ImageDraw, y: int, text: str, font, fill) -> None:
    w = d.textlength(text, font=font)
    d.text(((W * S - w) / 2, y), text, font=font, fill=fill)


frames = []
for f in range(FRAMES):
    t = f / FRAMES
    im = Image.new("RGB", (W * S, H * S), BG)
    im.paste(icon, ((W * S - icon.width) // 2, 34 * S), icon)
    d = ImageDraw.Draw(im)
    centered_text(d, 128 * S, "Voice Notes", title_font, INK)

    pw, ph = 168 * S, 40 * S
    px, py = (W * S - pw) // 2, 184 * S
    d.rounded_rectangle((px, py, px + pw, py + ph), radius=ph // 2, fill=PILL)
    bw, gap = 3 * S, 3 * S
    total = BARS * bw + (BARS - 1) * gap
    x0, cy, maxh = (W * S - total) // 2, py + ph // 2, 28 * S
    for i in range(BARS):
        h = max(bw, int(maxh * level(i, t)))
        x = x0 + i * (bw + gap)
        d.rounded_rectangle((x, cy - h // 2, x + bw, cy + h // 2), radius=bw // 2, fill=ACCENT)

    dots = "." * (1 + (f * 3 // FRAMES))
    centered_text(d, 244 * S, f"Installing{dots}", caption_font, MUTED)
    frames.append(im.resize((W, H), Image.LANCZOS))

out = DESKTOP / "assets" / "install.gif"
# One shared palette from the busiest frame keeps colours steady across frames.
palette = frames[0].quantize(colors=128, method=Image.Quantize.MEDIANCUT)
pal_frames = [fr.quantize(palette=palette, dither=Image.Dither.NONE) for fr in frames]
pal_frames[0].save(out, save_all=True, append_images=pal_frames[1:], duration=MS, loop=0, optimize=True, disposal=1)
print(out, out.stat().st_size, "bytes")
