"""Draw senti's brand files from the typeface's own geometry:
public/senti-mark.svg (banner logo), public/favicon.svg, public/apple-touch-icon.png (180 px)
and public/og.png (1200x630 link preview).

    pip install fonttools shapely pillow
    python scripts/make_brand_assets.py
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from shapely.geometry import LineString, Point, box
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(__file__))
import make_senti_font as sf  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
INK, BLUE, AMBER, BG = "#eef1f8", "#5b8cff", "#f6b93b", "#05060b"


def mark_shapes(x0, y0, scale):
    """The mark as filled shapes, placed at (x0, y0) and scaled: [(shape, colour)] for the s's amber upper half,
    its blue lower half (split along the middle stroke, y = 28) and the four white colon dots."""
    sw = 5.2 * scale
    s_line = [(x0 + x * scale, y0 + y * scale) for x, y in sf.parse(sf.s_shape(6, 42, 10, 46, 11))[0]]
    s_geom = LineString(s_line).buffer(sw / 2, quad_segs=12, cap_style="round", join_style="round")
    mid = y0 + 28 * scale
    upper = s_geom.intersection(box(-1e4, -1e4, 1e4, mid))
    lower = s_geom.intersection(box(-1e4, mid, 1e4, 1e4))
    dots = [(58, 14.32), (58, 22.96), (58, 33.04), (58, 41.68)]
    return [(upper, AMBER), (lower, BLUE)] + [(Point(x0 + x * scale, y0 + y * scale).buffer(3.64 * scale, 24), INK) for x, y in dots]


def fill(draw, geom, colour):
    for poly in getattr(geom, "geoms", [geom]):
        draw.polygon([tuple(p) for p in poly.exterior.coords], fill=colour)


def favicon_svg():
    inner = sf.mark_body(AMBER, BLUE, INK)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-11 -12 86 86">'
            f'<rect x="-11" y="-12" width="86" height="86" rx="20" fill="{BG}"/>{inner}</svg>')


def touch_icon(size=180):
    img = Image.new("RGB", (size, size), BG)    # iOS rounds the corners itself
    d = ImageDraw.Draw(img)
    scale = size / 86
    for g, c in mark_shapes(11 * scale, 12 * scale, scale):
        fill(d, g, c)
    return img


def og_image():
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), BG)
    # quadrant glow around a mood map on the right
    cx, cy = 860, 315
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    g = ImageDraw.Draw(glow)
    for dx, dy, col in [(1, -1, (246, 185, 59)), (-1, -1, (240, 96, 77)), (-1, 1, (91, 140, 255)), (1, 1, (49, 201, 163))]:
        x, y = cx + dx * 140, cy + dy * 140
        g.ellipse([x - 150, y - 150, x + 150, y + 150], fill=col)
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(90)), 0.3)
    d = ImageDraw.Draw(img)
    d.line([(cx - 330, cy), (cx + 330, cy)], fill=(120, 130, 160), width=1)
    d.line([(cx, cy - 290), (cx, cy + 290)], fill=(120, 130, 160), width=1)
    for k in range(16):
        if k % 4:
            a = math.radians(k * 22.5)
            d.line([(cx, cy), (cx + 300 * math.cos(a), cy - 300 * math.sin(a))], fill=(40, 46, 66), width=1)
    lx, ly = cx + 150, cy - 120
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(halo).ellipse([lx - 46, ly - 46, lx + 46, ly + 46], fill=(246, 185, 59, 170))
    img = Image.alpha_composite(img.convert("RGBA"), halo.filter(ImageFilter.GaussianBlur(18)))
    d = ImageDraw.Draw(img)
    d.ellipse([lx - 12, ly - 12, lx + 12, ly + 12], fill=(255, 255, 255))
    # mark + wordmark in the senti face
    font_path = os.path.join(ROOT, "public", "fonts", "senti.ttf")
    big, mid, small = (ImageFont.truetype(font_path, s) for s in (118, 44, 28))
    # Size the mark so its s matches the wordmark's s, and sit both on the same baseline.
    tx, ty = 230, 150
    sx0, sy0, sx1, sy1 = d.textbbox((tx, ty), "s", font=big)
    scale = (sy1 - sy0) / 36                      # the mark's s is 36 units tall (y 10..46)
    for gg, c in mark_shapes(tx - 80 * scale, sy0 - 10 * scale, scale):
        fill(d, gg, c)
    d.text((tx, ty), "senti", font=big, fill=INK)
    d.text((84, 300), "I’m feeling ", font=mid, fill=(130, 140, 170))
    w = d.textlength("I’m feeling ", font=mid)
    d.text((84 + w, 300), "elated", font=mid, fill=AMBER)
    d.text((84, 378), "Pick a feeling on the mood map.", font=small, fill=(170, 178, 205))
    d.text((84, 418), "Get a song that fits it. Free, no sign-in.", font=small, fill=(170, 178, 205))
    return img.convert("RGB")


if __name__ == "__main__":
    pub = os.path.join(ROOT, "public")
    open(os.path.join(pub, "senti-mark.svg"), "w").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 2 64 52">{sf.mark_body(AMBER, BLUE, INK)}</svg>')
    open(os.path.join(pub, "favicon.svg"), "w").write(favicon_svg())
    touch_icon().save(os.path.join(pub, "apple-touch-icon.png"), optimize=True)
    og_image().save(os.path.join(pub, "og.png"), optimize=True)
    print("wrote senti-mark.svg, favicon.svg, apple-touch-icon.png, og.png")
