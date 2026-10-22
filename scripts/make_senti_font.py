"""senti: a monoline typeface grown from the logo's s.

Every glyph is a centre-line drawing (straight lines and quarter curves that all share one corner
radius) stroked at one weight with round ends. `build()` expands the strokes into outlines and writes
a TrueType font plus WOFF2; `svg()` draws text straight from the centre lines for logos and previews.

Design units: y grows downward, the baseline is y = XH, the x-height top is y = 0, capitals and
ascenders reach y = -ASC, descenders y = XH + DESC.
"""
from __future__ import annotations

import math

XH, ASC, DESC = 22, 10, 8          # compact: wide, low letters
R = 7                              # one corner radius everywhere
SW = 5.0                           # stroke weight
GAP = 3.2                          # space between letters (on top of the stroke)
T, B, A, D = 0, XH, -ASC, XH + DESC
M = XH / 2
CM = (A + B) / 2                   # middle of a capital
W = 22                             # standard lowercase width
CW = 24                            # standard capital width


# --- centre-line helpers (SVG path strings with M/H/V/L/Q/Z only) ---------------------------------
def c_shape(x, w, top, bot, r=R):          # top bar, left side, bottom bar (open right)
    return f"M{x+w} {top} H{x+r} Q{x} {top} {x} {top+r} V{bot-r} Q{x} {bot} {x+r} {bot} H{x+w}"

def rev_c(x, w, top, bot, r=R):            # open left
    return f"M{x} {top} H{x+w-r} Q{x+w} {top} {x+w} {top+r} V{bot-r} Q{x+w} {bot} {x+w-r} {bot} H{x}"

def arch(x, w, top, bot, r=R):             # rounded arch, both legs down to bot
    return f"M{x} {bot} V{top+r} Q{x} {top} {x+r} {top} H{x+w-r} Q{x+w} {top} {x+w} {top+r} V{bot}"

def cup(x, w, top, bot, r=R):              # rounded cup, both legs up to top
    return f"M{x} {top} V{bot-r} Q{x} {bot} {x+r} {bot} H{x+w-r} Q{x+w} {bot} {x+w} {bot-r} V{top}"

def ring(x, w, top, bot, r=R):             # closed rounded rectangle
    return (f"M{x+r} {top} H{x+w-r} Q{x+w} {top} {x+w} {top+r} V{bot-r} Q{x+w} {bot} {x+w-r} {bot} "
            f"H{x+r} Q{x} {bot} {x} {bot-r} V{top+r} Q{x} {top} {x+r} {top} Z")

def s_shape(x, w, top, bot, r=R):
    m = (top + bot) / 2
    rr = min(r, (bot - top) / 4)
    return (f"M{x+w} {top} H{x+rr} Q{x} {top} {x} {top+rr} V{m-rr} Q{x} {m} {x+rr} {m} "
            f"H{x+w-rr} Q{x+w} {m} {x+w} {m+rr} V{bot-rr} Q{x+w} {bot} {x+w-rr} {bot} H{x}")

def line(*pts):
    return "M" + " L".join(f"{x} {y}" for x, y in pts)


# --- glyphs: char -> (centre-line paths, dots, advance width of the drawing) -----------------------
def glyphs() -> dict[str, tuple[list[str], list[tuple[float, float]], float]]:
    w, cw, r = W, CW, R
    g: dict[str, tuple[list[str], list[tuple[float, float]], float]] = {}
    # lowercase
    g["a"] = ([f"M2 {T} H{w-r} Q{w} {T} {w} {T+r} V{B}", f"M{w} {M} H{r*0.7} Q0 {M} 0 {M+r*0.7} V{B-r*0.7} Q0 {B} {r*0.7} {B} H{w}"], [], w)
    g["b"] = ([line((0, A), (0, B)), rev_c(0, w, T, B)], [], w)
    g["c"] = ([c_shape(0, w - 2, T, B)], [], w - 2)
    g["d"] = ([line((w, A), (w, B)), c_shape(0, w, T, B)], [], w)
    g["e"] = ([f"M0 {M} H{w} V{T+r*0.8} Q{w} {T} {w-r*0.8} {T} H{r} Q0 {T} 0 {T+r} V{B-r} Q0 {B} {r} {B} H{w}"], [], w)
    g["f"] = ([f"M{w-5} {A} H{5+r} Q5 {A} 5 {A+r} V{B}", line((0, T), (w - 8, T))], [], w - 5)
    g["g"] = ([c_shape(0, w, T, B), f"M{w} {T} V{D-r} Q{w} {D} {w-r} {D} H2"], [], w)
    g["h"] = ([line((0, A), (0, B)), arch(0, w, T, B)], [], w)
    g["i"] = ([line((0, T), (0, B))], [(0, A + 3)], 0)
    g["j"] = ([f"M7 {T} V{D-r} Q7 {D} {7-r} {D} H-3"], [(7, A + 3)], 7)
    g["k"] = ([line((0, A), (0, B)), line((w - 3, T), (1, M + 1)), line((7, M - 1), (w - 2, B))], [], w - 2)
    g["l"] = ([f"M1 {A} V{B-r} Q1 {B} {1+r} {B} H{1+r+1}"], [], 10)
    g["m"] = ([line((0, T), (0, B)), arch(0, 16, T, B, 6), arch(16, 16, T, B, 6)], [], 32)
    g["n"] = ([line((0, T), (0, B)), arch(0, w, T, B)], [], w)
    g["o"] = ([ring(0, w, T, B)], [], w)
    g["p"] = ([line((0, T), (0, D)), rev_c(0, w, T, B)], [], w)
    g["q"] = ([line((w, T), (w, D)), c_shape(0, w, T, B)], [], w)
    g["r"] = ([line((0, T), (0, B)), f"M0 {T+r} Q0 {T} {r} {T} H{w-6}"], [], w - 6)
    g["s"] = ([s_shape(0, w - 2, T, B)], [], w - 2)
    g["t"] = ([f"M5 {A+2} V{B-r} Q5 {B} {5+r} {B} H{w-6}", line((0, T), (w - 8, T))], [], w - 6)
    g["u"] = ([cup(0, w, T, B), line((w, T), (w, B))], [], w)
    g["v"] = ([line((0, T), (w / 2, B), (w, T))], [], w)
    g["w"] = ([line((0, T), (8, B), (16, T + 7), (24, B), (32, T))], [], 32)
    g["x"] = ([line((0, T), (w, B)), line((w, T), (0, B))], [], w)
    g["y"] = ([cup(0, w, T, B), f"M{w} {T} V{D-r} Q{w} {D} {w-r} {D} H2"], [], w)
    g["z"] = ([line((0, T), (w, T), (0, B), (w, B))], [], w)
    # capitals: the same parts at cap height
    g["A"] = ([arch(0, cw, A, B), line((0, CM + 2), (cw, CM + 2))], [], cw)
    g["B"] = ([line((0, A), (0, B)), rev_c(0, cw - 3, A, CM), rev_c(0, cw, CM, B)], [], cw)
    g["C"] = ([c_shape(0, cw, A, B)], [], cw)
    g["D"] = ([line((0, A), (0, B)), rev_c(0, cw, A, B, 10)], [], cw)
    g["E"] = ([c_shape(0, cw, A, B, r), line((0, CM), (cw - 5, CM))], [], cw)
    g["F"] = ([f"M{cw} {A} H{r} Q0 {A} 0 {A+r} V{B}", line((0, CM), (cw - 5, CM))], [], cw)
    g["G"] = ([c_shape(0, cw, A, B), f"M{cw} {B} V{CM} H{cw/2}"], [], cw)
    g["H"] = ([line((0, A), (0, B)), line((cw, A), (cw, B)), line((0, CM), (cw, CM))], [], cw)
    g["I"] = ([line((0, A), (0, B))], [], 0)
    g["J"] = ([f"M{cw-4} {A} V{B-r} Q{cw-4} {B} {cw-4-r} {B} H{r} Q0 {B} 0 {B-r} V{B-9}"], [], cw - 4)
    g["K"] = ([line((0, A), (0, B)), line((cw - 2, A), (1, CM + 2)), line((8, CM - 1), (cw, B))], [], cw)
    g["L"] = ([f"M0 {A} V{B-r} Q0 {B} {r} {B} H{cw-2}"], [], cw - 2)
    g["M"] = ([line((0, B), (0, A), (15, CM + 4), (30, A), (30, B))], [], 30)
    g["N"] = ([line((0, B), (0, A), (cw, B), (cw, A))], [], cw)
    g["O"] = ([ring(0, cw + 2, A, B, 9)], [], cw + 2)
    g["P"] = ([line((0, A), (0, B)), rev_c(0, cw, A, CM + 2)], [], cw)
    g["Q"] = ([ring(0, cw + 2, A, B, 9), line((cw - 6, B - 6), (cw + 4, B + 4))], [], cw + 2)
    g["R"] = ([line((0, A), (0, B)), rev_c(0, cw, A, CM + 2), line((10, CM + 2), (cw, B))], [], cw)
    g["S"] = ([s_shape(0, cw, A, B)], [], cw)
    g["T"] = ([line((0, A), (cw, A)), line((cw / 2, A), (cw / 2, B))], [], cw)
    g["U"] = ([cup(0, cw, A, B)], [], cw)
    g["V"] = ([line((0, A), (cw / 2, B), (cw, A))], [], cw)
    g["W"] = ([line((0, A), (9, B), (17, A + 12), (25, B), (34, A))], [], 34)
    g["X"] = ([line((0, A), (cw, B)), line((cw, A), (0, B))], [], cw)
    g["Y"] = ([cup(0, cw, A, CM, r), line((cw / 2, CM), (cw / 2, B))], [], cw)
    g["Z"] = ([line((0, A), (cw, A), (0, B), (cw, B))], [], cw)
    # figures (cap height, slightly narrower)
    fw = 20
    g["0"] = ([ring(0, fw, A, B, 8)], [], fw)
    g["1"] = ([line((2, A + 6), (10, A), (10, B)), line((2, B), (18, B))], [], 18)
    g["2"] = ([f"M0 {A} H{fw-r} Q{fw} {A} {fw} {A+r} V{CM-r} Q{fw} {CM} {fw-r} {CM} H{r} Q0 {CM} 0 {CM+r} V{B} H{fw}"], [], fw)
    g["3"] = ([rev_c(0, fw, A, CM), rev_c(0, fw, CM, B), line((6, CM), (fw - r, CM))], [], fw)
    g["4"] = ([line((0, A), (0, CM + 2), (fw, CM + 2)), line((fw - 5, A + 8), (fw - 5, B))], [], fw)
    g["5"] = ([f"M{fw} {A} H0 V{CM} H{fw-r} Q{fw} {CM} {fw} {CM+r} V{B-r} Q{fw} {B} {fw-r} {B} H0"], [], fw)
    g["6"] = ([f"M{fw} {A} H{r} Q0 {A} 0 {A+r} V{B-r} Q0 {B} {r} {B} H{fw-r} Q{fw} {B} {fw} {B-r} V{CM+r} Q{fw} {CM} {fw-r} {CM} H0"], [], fw)
    g["7"] = ([line((0, A), (fw, A), (6, B))], [], fw)
    g["8"] = ([ring(1, fw - 2, A, CM, 6), ring(0, fw, CM, B, 7)], [], fw)
    g["9"] = ([f"M0 {B} H{fw-r} Q{fw} {B} {fw} {B-r} V{A+r} Q{fw} {A} {fw-r} {A} H{r} Q0 {A} 0 {A+r} V{CM-r} Q0 {CM} {r} {CM} H{fw}"], [], fw)
    # punctuation and symbols
    g["."] = ([], [(0, B)], 0)
    g[","] = ([line((1, B), (-1, B + 5))], [], 1)
    g[":"] = ([], [(0, T + 3), (0, B)], 0)
    g[";"] = ([line((1, B), (-1, B + 5))], [(1, T + 3)], 1)
    g["!"] = ([line((0, A), (0, B - 8))], [(0, B)], 0)
    g["?"] = ([f"M0 {A} H{16-r} Q16 {A} 16 {A+r} V{CM-r+2} Q16 {CM+2} {16-r} {CM+2} H8 V{B-8}"], [(8, B)], 16)
    g["'"] = ([line((0, A + 1), (0, A + 9))], [], 0)
    g["’"] = g["'"]
    g["‘"] = g["'"]
    g['"'] = ([line((0, A + 1), (0, A + 9)), line((6, A + 1), (6, A + 9))], [], 6)
    g["“"] = g['"']
    g["”"] = g['"']
    g["-"] = ([line((0, M), (12, M))], [], 12)
    g["–"] = ([line((0, M), (20, M))], [], 20)
    g["—"] = ([line((0, M), (30, M))], [], 30)
    g["("] = ([f"M8 {A} Q0 {A} 0 {A+8} V{D-8} Q0 {D} 8 {D}"], [], 8)
    g[")"] = ([f"M0 {A} Q8 {A} 8 {A+8} V{D-8} Q8 {D} 0 {D}"], [], 8)
    g["/"] = ([line((14, A), (0, D))], [], 14)
    g["&"] = ([f"M{w} {B} L4 {CM-1} Q0 {CM-5} 0 {A+6} Q0 {A} 7 {A} Q14 {A} 14 {A+6} Q14 {CM-4} 6 {CM+2} Q0 {CM+6} 0 {B-6} Q0 {B} 7 {B} H{w-8} L{w} {CM+3}"], [], w)
    g["+"] = ([line((0, M), (16, M)), line((8, M - 8), (8, M + 8))], [], 16)
    g["="] = ([line((0, M - 4), (16, M - 4)), line((0, M + 4), (16, M + 4))], [], 16)
    g["·"] = ([], [(0, M)], 0)
    g["•"] = ([], [(0, M)], 0)
    g["…"] = ([], [(0, B), (7, B), (14, B)], 14)
    g["#"] = ([line((6, A + 4), (4, B)), line((15, A + 4), (13, B)), line((0, M - 5), (19, M - 5)), line((0, M + 5), (19, M + 5))], [], 19)
    g["%"] = ([line((20, A + 2), (0, B))], [(3, A + 5), (17, B - 3)], 20)
    g["@"] = ([ring(6, 14, T - 2, B - 4, 5), f"M20 {M} V{B-2} Q20 {B+1} 23 {B+1} Q27 {B+1} 27 {B-6} V{T+2} Q27 {A+2} 17 {A+2} H8 Q0 {A+2} 0 {T+4} V{B-2} Q0 {D} 8 {D} H24"], [], 27)
    # arrows used by the axis titles
    g["←"] = ([line((0, M), (22, M)), line((7, M - 7), (0, M), (7, M + 7))], [], 22)
    g["→"] = ([line((0, M), (22, M)), line((15, M - 7), (22, M), (15, M + 7))], [], 22)
    g["↑"] = ([line((7, A + 2), (7, B)), line((0, A + 9), (7, A + 2), (14, A + 9))], [], 14)
    g["↓"] = ([line((7, A + 2), (7, B)), line((0, B - 7), (7, B), (14, B - 7))], [], 14)
    g["▶"] = ([line((0, T - 2), (0, B + 2), (16, M), (0, T - 2))], [], 16)
    g[" "] = ([], [], 9)
    g[" "] = g[" "]
    return g


# --- centre-line parsing to point lists ------------------------------------------------------------
def parse(d: str, steps: int = 10) -> list[list[tuple[float, float]]]:
    import re
    toks = re.findall(r"[MHVLQZ]|-?\d+(?:\.\d+)?(?:e-?\d+)?", d)
    out, cur, x, y, i = [], [], 0.0, 0.0, 0
    start = (0.0, 0.0)
    while i < len(toks):
        t = toks[i]; i += 1
        if t == "M":
            if cur: out.append(cur)
            x, y = float(toks[i]), float(toks[i + 1]); i += 2
            cur = [(x, y)]; start = (x, y)
        elif t == "H":
            x = float(toks[i]); i += 1; cur.append((x, y))
        elif t == "V":
            y = float(toks[i]); i += 1; cur.append((x, y))
        elif t == "L":
            # L may be followed by several coordinate pairs
            while i < len(toks) and toks[i] not in "MHVLQZ":
                x, y = float(toks[i]), float(toks[i + 1]); i += 2; cur.append((x, y))
        elif t == "Q":
            cx, cy, ex, ey = (float(v) for v in toks[i:i + 4]); i += 4
            x0, y0 = x, y
            for k in range(1, steps + 1):
                u = k / steps
                cur.append(((1-u)**2*x0 + 2*(1-u)*u*cx + u*u*ex, (1-u)**2*y0 + 2*(1-u)*u*cy + u*u*ey))
            x, y = ex, ey
        elif t == "Z":
            cur.append(start); x, y = start
    if cur: out.append(cur)
    return out


# --- SVG text (for logo files and previews) --------------------------------------------------------
def svg_parts(text: str, x0=0.0, y0=0.0, ink="#eef1f8", sw=SW, dot=None, tracking=GAP):
    g = glyphs()
    parts, x = [], x0
    for ch in text:
        paths, dots, adv = g.get(ch, g["?"])
        for d in paths:
            parts.append(f'<path transform="translate({x+sw/2:.2f} {y0})" d="{d}" fill="none" stroke="{ink}" '
                         f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>')
        for dx, dy in dots:
            parts.append(f'<circle cx="{x+sw/2+dx:.2f}" cy="{y0+dy}" r="{sw*0.66:.2f}" fill="{dot or ink}"/>')
        x += adv + sw + tracking
    return "".join(parts), x - tracking


# --- the mark -------------------------------------------------------------------------------------
def mark_body(happy, sad, dot, sw=5.2):
    """Compact s, its upper half happy (amber) and lower half sad (blue), split along its middle stroke, with a
    plain colon pair close on its right. Box 0..64 x 0..60."""
    x, top, w, h = 6, 10, 42, 36
    bot = top + h
    cx = x + w + 10
    d = sw * 0.7
    body = (f'<linearGradient id="senti-s" gradientUnits="userSpaceOnUse" x1="0" y1="{top}" x2="0" y2="{bot}">'
            f'<stop offset="0.5" stop-color="{happy}"/><stop offset="0.5" stop-color="{sad}"/></linearGradient>'
            f'<path d="{s_shape(x, w, top, bot, 11)}" fill="none" stroke="url(#senti-s)" stroke-width="{sw}" '
            f'stroke-linecap="round" stroke-linejoin="round"/>')
    dots = [(cx, top + h * f) for f in (0.12, 0.36, 0.64, 0.88)]
    return body + "".join(f'<circle cx="{px:.2f}" cy="{py:.2f}" r="{d:.2f}" fill="{dot}"/>' for px, py in dots)


# --- font building --------------------------------------------------------------------------------
UPM = 1000
SCALE = 520 / XH                   # x-height = 520 units
def to_font(pt, x_off):
    x, y = pt
    return ((x + x_off) * SCALE, (XH - y) * SCALE)

def outline(paths, dots, x_off):
    from shapely.geometry import LineString, Point
    from shapely.ops import unary_union
    half = SW * SCALE / 2
    shapes = []
    for d in paths:
        for pts in parse(d):
            fp = [to_font(p, x_off) for p in pts]
            shapes.append(Point(fp[0]).buffer(half, 16) if len(set(fp)) == 1 else
                          LineString(fp).buffer(half, quad_segs=8, cap_style="round", join_style="round"))
    for dx, dy in dots:
        shapes.append(Point(to_font((dx, dy), x_off)).buffer(SW * 0.66 * SCALE, 16))
    return unary_union(shapes) if shapes else None

def draw(pen, geom):
    from shapely.geometry import Polygon, MultiPolygon
    from shapely.geometry.polygon import orient
    polys = [geom] if isinstance(geom, Polygon) else list(getattr(geom, "geoms", []))
    for poly in polys:
        poly = orient(poly.simplify(1.0), sign=-1.0)          # outer clockwise, holes counter-clockwise
        for ring_ in [poly.exterior, *poly.interiors]:
            pts = [(round(x), round(y)) for x, y in list(ring_.coords)[:-1]]
            dedup = [p for i, p in enumerate(pts) if p != pts[i - 1]]
            if len(dedup) < 3:
                continue
            pen.moveTo(dedup[0])
            for p in dedup[1:]:
                pen.lineTo(p)
            pen.closePath()

def build(out_dir: str, family="Senti"):
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    g = glyphs()
    order, cmap, glyf, metrics = [".notdef"], {}, {}, {}
    side = (SW / 2 + GAP / 2)
    pen = TTGlyphPen(None); glyf[".notdef"] = pen.glyph(); metrics[".notdef"] = (500, 0)
    for ch, (paths, dots, adv) in g.items():
        name = f"uni{ord(ch):04X}"
        if name in glyf:
            cmap[ord(ch)] = name; continue
        geom = outline(paths, dots, side + SW / 2)
        pen = TTGlyphPen(None)
        if geom is not None and not geom.is_empty:
            draw(pen, geom)
        glyf[name] = pen.glyph()
        width = round((adv + SW + 2 * side) * SCALE)
        lsb = round(geom.bounds[0]) if geom is not None and not geom.is_empty else 0
        metrics[name] = (width, lsb)
        order.append(name); cmap[ord(ch)] = name
    asc, desc = round((XH + ASC + 4) * SCALE), round((DESC + 4) * SCALE)
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyf)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=asc, descent=-desc)
    fb.setupNameTable({"familyName": family, "styleName": "Regular",
                       "uniqueFontIdentifier": f"{family}-Regular", "fullName": f"{family} Regular",
                       "psName": f"{family}-Regular", "version": "Version 0.1",
                       "copyright": "senti monoline, drawn for senti"})
    fb.setupOS2(sTypoAscender=asc, sTypoDescender=-desc, sTypoLineGap=0, usWinAscent=asc, usWinDescent=desc,
                sxHeight=round(XH * SCALE), sCapHeight=round((XH + ASC) * SCALE), fsType=0)
    fb.setupPost()
    ttf = f"{out_dir}/{family.lower()}.ttf"
    fb.save(ttf)
    from fontTools.ttLib import TTFont
    f = TTFont(ttf); f.flavor = "woff2"; f.save(f"{out_dir}/{family.lower()}.woff2")
    return ttf, len(cmap)


if __name__ == "__main__":
    import sys
    print(build(sys.argv[1] if len(sys.argv) > 1 else "."))
