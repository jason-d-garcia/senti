"""Draws the senti typeface and writes public/fonts/senti.woff2, the logo and the favicon.

Every letter is one rounded stroke built like the logo's s: blocky shapes, soft corners of one radius,
round ends, a squat x-height. Capitals map to the lowercase shapes (the brand is all lowercase);
anything the font doesn't draw falls back to the next font in the CSS stack.

Needs: pip install fonttools skia-pathops brotli
Run:   python scripts/make_font.py
"""
from pathlib import Path

import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000
W = 92                      # stroke weight
R = 92                      # corner radius (centreline)
SB = 38                     # side bearing beyond the stroke
B, X = W / 2, 430 - W / 2   # baseline and x-height, on the stroke's centreline
M = (B + X) / 2             # middle bar
A = 650 - W / 2             # ascender
D = -210 + W / 2            # descender
C = 600 - W / 2             # digit height
CM = (B + C) / 2
N = 240                     # standard letter width (centreline)
DOT = W * 0.56              # dot radius, like the logo's colon dots
DOT_Y = X + 140


def rounded(pts, r=R, closed=False):
    """A polyline with every corner rounded by a quadratic of radius r (shortened to fit short legs)."""
    p = pathops.Path()
    n = len(pts)
    if closed:
        pts = pts + pts[:2]

    def toward(a, b, d):
        (ax, ay), (bx, by) = a, b
        L = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5 or 1
        return ax + (bx - ax) * d / L, ay + (by - ay) * d / L

    def leg(a, b):
        return ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5

    if closed:
        start = toward(pts[0], pts[1], min(r, leg(pts[0], pts[1]) / 2))
        p.moveTo(*start)
        rng = range(1, n + 1)
    else:
        p.moveTo(*pts[0])
        rng = range(1, n - 1)
    for i in rng:
        a, c, b = pts[i - 1], pts[i], pts[i + 1]
        rr = min(r, leg(a, c) / 2 if (closed or i > 1) else leg(a, c), leg(c, b) / 2 if (closed or i < n - 2) else leg(c, b))
        p.lineTo(*toward(c, a, rr))
        p.quadTo(*c, *toward(c, b, rr))
    if closed:
        p.close()
    else:
        p.lineTo(*pts[-1])
    return p


def line(*pts):
    return rounded(list(pts), r=0)


def dot(x, y, r=DOT):
    p = pathops.Path()
    k = 0.5523 * r
    p.moveTo(x + r, y)
    p.cubicTo(x + r, y + k, x + k, y + r, x, y + r)
    p.cubicTo(x - k, y + r, x - r, y + k, x - r, y)
    p.cubicTo(x - r, y - k, x - k, y - r, x, y - r)
    p.cubicTo(x + k, y - r, x + r, y - k, x + r, y)
    p.close()
    return p


w = N
G = {
    "a": (w, [rounded([(30, X), (w, X), (w, B)]), rounded([(w, M), (0, M), (0, B), (w, B)])]),
    "b": (w, [line((0, A), (0, B)), rounded([(0, X), (w, X), (w, B), (0, B)])]),
    "c": (w, [rounded([(w, X), (0, X), (0, B), (w, B)])]),
    "d": (w, [line((w, A), (w, B)), rounded([(w, X), (0, X), (0, B), (w, B)])]),
    "e": (w, [rounded([(0, M), (w, M), (w, X), (0, X), (0, B), (w, B)])]),
    "f": (170, [rounded([(190, A), (60, A), (60, B)]), line((-20, X), (170, X))]),
    "g": (w, [rounded([(w, X), (0, X), (0, B), (w, B)]), rounded([(w, X), (w, D), (0, D)])]),
    "h": (w, [line((0, A), (0, B)), rounded([(0, X), (w, X), (w, B)])]),
    "i": (0, [line((0, X), (0, B))], [(0, DOT_Y)]),
    "j": (60, [rounded([(60, X), (60, D), (-60, D)])], [(60, DOT_Y)]),
    "k": (210, [line((0, A), (0, B)), line((210, X), (10, M), (210, B))]),
    "l": (110, [rounded([(0, A), (0, B), (110, B)])]),
    "m": (380, [line((0, B), (0, X)), rounded([(0, X), (380, X), (380, B)]), line((190, X), (190, B))]),
    "n": (w, [rounded([(0, B), (0, X), (w, X), (w, B)])]),
    "o": (w, [rounded([(0, B), (0, X), (w, X), (w, B)], closed=True)]),
    "p": (w, [line((0, X), (0, D)), rounded([(0, X), (w, X), (w, B), (0, B)])]),
    "q": (w, [line((w, X), (w, D)), rounded([(w, X), (0, X), (0, B), (w, B)])]),
    "r": (180, [rounded([(0, B), (0, X), (180, X)])]),
    "s": (w, [rounded([(w, X), (0, X), (0, M), (w, M), (w, B), (0, B)], r=min(R, (X - B) / 4))]),
    "t": (170, [rounded([(50, A - 70), (50, B), (170, B)]), line((-30, X), (170, X))]),
    "u": (w, [rounded([(0, X), (0, B), (w, B), (w, X)]), line((w, X), (w, B))]),
    "v": (w, [line((0, X), (w / 2, B), (w, X))]),
    "w": (380, [line((0, X), (95, B), (190, X), (285, B), (380, X))]),
    "x": (w, [line((0, X), (w, B)), line((w, X), (0, B))]),
    "y": (w, [rounded([(0, X), (0, B), (w, B)]), rounded([(w, X), (w, D), (0, D)])]),
    "z": (w, [line((0, X), (w, X), (0, B), (w, B))]),
    # digits
    "0": (w, [rounded([(0, B), (0, C), (w, C), (w, B)], closed=True)]),
    "1": (w, [line((w / 2 - 90, C - 70), (w / 2, C), (w / 2, B))]),
    "2": (w, [rounded([(0, C), (w, C), (w, CM), (0, CM), (0, B), (w, B)])]),
    "3": (w, [rounded([(0, C), (w, C), (w, B), (0, B)]), line((70, CM), (w, CM))]),
    "4": (w, [rounded([(0, C), (0, CM), (w, CM)]), line((w, C), (w, B))]),
    "5": (w, [rounded([(w, C), (0, C), (0, CM), (w, CM), (w, B), (0, B)])]),
    "6": (w, [rounded([(w, C), (0, C), (0, B), (w, B), (w, CM), (0, CM)])]),
    "7": (w, [rounded([(0, C), (w, C), (w, B)])]),
    "8": (w, [rounded([(0, B), (0, C), (w, C), (w, B)], closed=True), line((0, CM), (w, CM))]),
    "9": (w, [rounded([(0, B), (w, B), (w, C), (0, C), (0, CM), (w, CM)])]),
    # punctuation
    "period": (0, [], [(0, B)]),
    "comma": (0, [line((0, B), (-30, B - 110))]),
    "colon": (0, [], [(0, B), (0, X - 20)]),
    "semicolon": (0, [line((0, B), (-30, B - 110))], [(0, X - 20)]),
    "exclam": (0, [line((0, C), (0, B + 170))], [(0, B)]),
    "question": (w, [rounded([(0, C), (w, C), (w, CM + 30), (w / 2, CM + 30), (w / 2, B + 170)])], [(w / 2, B)]),
    "quotesingle": (0, [line((0, C), (0, C - 140))]),
    "quoteright": (0, [line((0, C), (-25, C - 140))]),
    "quoteleft": (0, [line((-25, C), (0, C - 140))]),
    "quotedbl": (110, [line((0, C), (0, C - 140)), line((110, C), (110, C - 140))]),
    "quotedblleft": (110, [line((-25, C), (0, C - 140)), line((85, C), (110, C - 140))]),
    "quotedblright": (110, [line((0, C), (-25, C - 140)), line((110, C), (85, C - 140))]),
    "hyphen": (160, [line((0, M), (160, M))]),
    "endash": (300, [line((0, M), (300, M))]),
    "emdash": (560, [line((0, M), (560, M))]),
    "ellipsis": (300, [], [(0, B), (150, B), (300, B)]),
    "parenleft": (90, [rounded([(90, A), (0, A), (0, D), (90, D)])]),
    "parenright": (90, [rounded([(0, A), (90, A), (90, D), (0, D)])]),
    "slash": (200, [line((0, D), (200, A))]),
    "plus": (240, [line((0, M + 20), (240, M + 20)), line((120, M + 140), (120, M - 100))]),
    "ampersand": (w + 40, [rounded([(w + 40, B), (0, CM), (0, C), (w - 40, C), (w - 40, CM + 20), (0, B + 60), (0, B), (w, B), (w + 40, CM)], r=70)]),
}
UNI = {"period": ".", "comma": ",", "colon": ":", "semicolon": ";", "exclam": "!", "question": "?",
       "quotesingle": "'", "quoteright": "’", "quoteleft": "‘", "quotedbl": '"',
       "quotedblleft": "“", "quotedblright": "”", "hyphen": "-", "endash": "–",
       "emdash": "—", "ellipsis": "…", "parenleft": "(", "parenright": ")", "slash": "/",
       "plus": "+", "ampersand": "&"}


def outline(strokes, dots):
    out = pathops.Path()
    for s in strokes:
        s = pathops.Path(s)
        s.stroke(W, pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4)
        s.convertConicsToQuads()
        out = pathops.op(out, s, pathops.PathOp.UNION)
    for x, y in dots:
        out = pathops.op(out, dot(x, y), pathops.PathOp.UNION)
    out.simplify()
    return out


def build(out_dir: Path):
    glyphs, metrics, cmap = {}, {}, {}
    order = [".notdef", "space"]
    pen = TTGlyphPen(None)
    glyphs[".notdef"] = pen.glyph()
    metrics[".notdef"] = (500, 0)
    glyphs["space"] = TTGlyphPen(None).glyph()
    metrics["space"] = (250, 0)
    cmap[ord(" ")] = "space"
    cmap[0xA0] = "space"
    for name, spec in G.items():
        width, strokes = spec[0], spec[1]
        dots = spec[2] if len(spec) > 2 else []
        path = outline(strokes, dots)
        # Shift so the ink starts at the side bearing.
        xmin = path.bounds[0] if strokes or dots else 0
        shift = SB - xmin
        tt = TTGlyphPen(None)
        moved = pathops.Path()
        path.draw(_Shift(moved, shift))
        moved.draw(Cu2QuPen(tt, 1.0, reverse_direction=True))
        glyphs[name] = tt.glyph()
        ink = moved.bounds[2] if strokes or dots else SB
        metrics[name] = (round(ink + SB), round(SB))
        order.append(name)
        ch = UNI.get(name, name)
        cmap[ord(ch)] = name
        if ch.isalpha():
            cmap[ord(ch.upper())] = name  # capitals use the lowercase shapes
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    for g in order:
        lsb = glyphs[g].xMin if hasattr(glyphs[g], "xMin") and glyphs[g].numberOfContours else 0
        metrics[g] = (metrics[g][0], lsb)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=820, descent=-260)
    fb.setupNameTable({"familyName": "senti", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=820, sTypoDescender=-260, sTypoLineGap=0, usWinAscent=820, usWinDescent=260,
                sxHeight=430, sCapHeight=600)
    fb.setupPost()
    out_dir.mkdir(parents=True, exist_ok=True)
    fb.font.flavor = "woff2"
    fb.save(out_dir / "senti.woff2")


class _Shift:
    """A pen that moves everything right by dx while copying it into a pathops Path."""
    def __init__(self, path, dx):
        self.p, self.dx = path, dx
    def moveTo(self, pt): self.p.moveTo(pt[0] + self.dx, pt[1])
    def lineTo(self, pt): self.p.lineTo(pt[0] + self.dx, pt[1])
    def qCurveTo(self, *pts):
        pts = [(x + self.dx, y) for x, y in pts]
        # Split implied on-curve points.
        for i in range(len(pts) - 1):
            c, e = pts[i], pts[i + 1]
            if i < len(pts) - 2:
                e = ((c[0] + pts[i + 1][0]) / 2, (c[1] + pts[i + 1][1]) / 2)
            self.p.quadTo(*c, *e)
    def curveTo(self, *pts):
        a, b, c = [(x + self.dx, y) for x, y in pts]
        self.p.cubicTo(*a, *b, *c)
    def closePath(self): self.p.close()
    def endPath(self): pass


def write_mark(public: Path):
    """The logo: the font's s with two colons after it, a smile (amber) above a frown (blue)."""
    from fontTools.pens.svgPathPen import SVGPathPen
    path = outline(*G["s"][1:2], [])
    pen = SVGPathPen(None)
    path.draw(pen)
    x0, y0, x1, y1 = path.bounds
    r, cx, k = W * 0.32, x1 + W * 0.8, W * 0.44
    top, bottom = (M + X) / 2, (B + M) / 2
    dots = [(cx, top + k, "#f6b93b"), (cx, top - k, "#f6b93b"), (cx, bottom + k, "#5b8cff"), (cx, bottom - k, "#5b8cff")]
    pad = W * 0.2
    vb = (x0 - pad, -(y1 + pad), cx + r - x0 + 2 * pad, y1 - y0 + 2 * pad)

    def svg(ink, extra="", box=vb):
        body = f'<path d="{pen.getCommands()}" fill="{ink}" transform="scale(1 -1)"/>'
        body += "".join(f'<circle cx="{x:.0f}" cy="{-y:.0f}" r="{r:.0f}" fill="{c}"/>' for x, y, c in dots)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{" ".join(f"{v:.0f}" for v in box)}">'
                f'{extra}{body}</svg>\n')

    (public / "senti-mark.svg").write_text(svg("#e8ecf8"))
    # Tab and home-screen icon: the mark centred on a rounded dark square.
    side = max(vb[2], vb[3]) * 1.45
    box = (vb[0] + vb[2] / 2 - side / 2, vb[1] + vb[3] / 2 - side / 2, side, side)
    bg = f'<rect x="{box[0]:.0f}" y="{box[1]:.0f}" width="{side:.0f}" height="{side:.0f}" rx="{side * 0.23:.0f}" fill="#0c0f1a"/>'
    (public / "favicon.svg").write_text(svg("#e8ecf8", bg, box))


if __name__ == "__main__":
    public = Path(__file__).resolve().parent.parent / "public"
    build(public / "fonts")
    write_mark(public)
    print("wrote public/fonts/senti.woff2, public/senti-mark.svg and public/favicon.svg")
