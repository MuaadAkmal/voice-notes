"""Render the app icon (white tile + soundwave glyph) to assets/icon.ico, icon.png and tray PNGs.

Geometry mirrors assets/logo.svg (viewBox 0 0 129 120). Run: python scripts/build-icons.py (needs Pillow).
"""
from pathlib import Path
from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent / "assets"
SS = 8  # supersampling factor
GLYPH_W, GLYPH_H = 129, 120
TOP, BOTTOM = (0x4B, 0x55, 0x63), (0x0B, 0x0E, 0x16)  # glyph gradient, slate to near-black


def glyph_mask(scale: float) -> Image.Image:
    m = Image.new("L", (round(GLYPH_W * scale), round(GLYPH_H * scale)), 0)
    d = ImageDraw.Draw(m)
    s = lambda *v: [x * scale for x in v]
    pill = lambda x0, y0, x1, y1, fill=255: d.rounded_rectangle(s(x0, y0, x1, y1), radius=min(x1 - x0, y1 - y0) / 2 * scale, fill=fill)
    # Slot joining the tall and medium bars: two bridges with rounded notches and a pill-shaped hole.
    d.rectangle(s(62, 29.5, 69, 90.5), fill=255)
    d.ellipse(s(62, 26, 69, 33), fill=0)
    d.ellipse(s(62, 87, 69, 94), fill=0)
    pill(62, 43, 69, 77, fill=0)
    for bar in [(0, 46, 16, 74), (23, 32, 39, 88), (46, 0, 62, 120), (69, 18, 85, 102), (92, 42, 108, 78)]:
        pill(*bar)
    d.ellipse(s(115, 53, 129, 67), fill=255)
    return m


def gradient(size) -> Image.Image:
    w, h = size
    g = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(h - 1, 1)
        g.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))
    return g.resize((w, h))


def tile(px: int, margin: float, glyph_h: float) -> Image.Image:
    S = px * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    inset = S * margin
    side = S - 2 * inset
    border = max(SS, S * 0.006)  # faint edge so the white tile holds on light backgrounds
    d.rounded_rectangle([inset, inset, S - inset, S - inset], radius=side * 0.225, fill=(214, 211, 209, 255))
    d.rounded_rectangle([inset + border, inset + border, S - inset - border, S - inset - border], radius=side * 0.225 - border, fill=(255, 255, 255, 255))
    scale = side * glyph_h / GLYPH_H
    mask = glyph_mask(scale)
    img.paste(gradient(mask.size), (round((S - mask.width) / 2), round((S - mask.height) / 2)), mask)
    return img.resize((px, px), Image.LANCZOS)


def main() -> None:
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    # Small sizes drop the margin so the glyph stays legible.
    icons = [tile(n, 0.0 if n <= 32 else 0.04, 0.62) for n in sizes]
    icons[-1].save(ASSETS / "icon.ico", sizes=[(n, n) for n in sizes], append_images=icons[:-1])
    tile(512, 0.04, 0.62).save(ASSETS / "icon.png")
    tile(16, 0.0, 0.62).save(ASSETS / "tray-16.png")
    tile(32, 0.0, 0.62).save(ASSETS / "tray-32.png")


if __name__ == "__main__":
    main()
