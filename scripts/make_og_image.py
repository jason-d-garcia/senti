"""Draw public/og.png, the 1200x630 link-preview image (uses macOS system fonts).

    python scripts/make_og_image.py public/og.png
"""
import math, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
out = sys.argv[1]
bg = Image.new("RGB", (W, H), (5, 6, 11))

# Quadrant glow around a map centred on the right half.
cx, cy, R = 860, 315, 250
glow = Image.new("RGB", (W, H), (0, 0, 0))
g = ImageDraw.Draw(glow)
for (dx, dy, col) in [(1, -1, (246, 185, 59)), (-1, -1, (240, 96, 77)), (-1, 1, (91, 140, 255)), (1, 1, (49, 201, 163))]:
    x, y = cx + dx * R * 0.55, cy + dy * R * 0.55
    g.ellipse([x - 150, y - 150, x + 150, y + 150], fill=col)
glow = glow.filter(ImageFilter.GaussianBlur(90))
bg = Image.blend(bg, glow, 0.35)

d = ImageDraw.Draw(bg)
axis = (120, 130, 160)
d.line([(cx - 330, cy), (cx + 330, cy)], fill=axis, width=1)
d.line([(cx, cy - 290), (cx, cy + 290)], fill=axis, width=1)
for k in range(16):
    if k % 4 == 0: continue
    a = math.radians(k * 22.5)
    d.line([(cx, cy), (cx + 300 * math.cos(a), cy - 300 * math.sin(a))], fill=(40, 46, 66), width=1)

# The light, in the Elated section, with a soft amber halo.
lx, ly = cx + 150, cy - 120
halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(halo).ellipse([lx - 46, ly - 46, lx + 46, ly + 46], fill=(246, 185, 59, 170))
halo = halo.filter(ImageFilter.GaussianBlur(18))
bg = Image.alpha_composite(bg.convert("RGBA"), halo)
d = ImageDraw.Draw(bg)
d.ellipse([lx - 12, ly - 12, lx + 12, ly + 12], fill=(255, 255, 255))
for (sx, sy, r) in [(lx - 40, ly + 22, 4), (lx + 34, ly - 30, 3), (lx - 18, ly - 44, 2), (lx + 46, ly + 18, 2)]:
    d.polygon([(sx, sy - 2.2 * r), (sx + .5 * r, sy - .5 * r), (sx + 2.2 * r, sy), (sx + .5 * r, sy + .5 * r),
               (sx, sy + 2.2 * r), (sx - .5 * r, sy + .5 * r), (sx - 2.2 * r, sy), (sx - .5 * r, sy - .5 * r)], fill=(255, 225, 160))

def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)
heavy = font("/System/Library/Fonts/Avenir Next.ttc", 92, 8)
mid = font("/System/Library/Fonts/Avenir Next.ttc", 40, 5)
small = font("/System/Library/Fonts/Avenir Next.ttc", 26, 5)
d.text((80, 190), "Senti", font=heavy, fill=(240, 243, 250))
d.text((82, 312), "I'm feeling", font=mid, fill=(130, 140, 170))
w = d.textlength("I'm feeling ", font=mid)
d.text((82 + w, 312), "elated", font=mid, fill=(246, 185, 59))
d.text((82, 380), "Pick a feeling on the mood map.", font=small, fill=(170, 178, 205))
d.text((82, 416), "Get a song that fits it. Free, no sign-in.", font=small, fill=(170, 178, 205))
bg.convert("RGB").save(out, optimize=True)
print("saved", out, bg.size)
