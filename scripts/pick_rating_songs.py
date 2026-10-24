"""Picks the 100 songs for the listening study (rate/), spread evenly over the part of the map that has songs.

The occupied area is cut into 0.105 x 0.105 squares; each square with songs gives the song nearest its centre
(preferring one whose preview is already stored, so it plays without a lookup). The squares with the fewest songs
are dropped to land on 100. The songs are then split into two halves of 50 that each cover the whole map
(alternating along a snake path through the squares); each rater hears one half. Writes public/rate/songs.json:
title, artist, half, the model's placement, and the stored preview when there is one.

    python3 scripts/pick_rating_songs.py
"""
import glob, json, math

CELL, N = 0.105, 100
# Known instrumentals: marked so they are never used as a hidden repeat (repeats should test songs with lyrics).
INSTRUMENTALS = {"San Antonio Rose|Floyd Cramer", "Tuff|Ace Cannon", "Wonderland by Night|Bert Kaempfert"}
rows = [r for f in sorted(glob.glob("public/songs/*.json")) for r in json.load(open(f))["songs"]]
cells = {}
for r in rows:
    cells.setdefault((math.floor(r[3] / CELL), math.floor(r[4] / CELL)), []).append(r)
keep = sorted(cells, key=lambda k: (-len(cells[k]), k))[:N]

picked = []
# Snake through the squares (column by column, alternating direction) so neighbours land in different halves.
snake = sorted(keep, key=lambda k: (k[0], k[1] if k[0] % 2 == 0 else -k[1]))
for n, (i, j) in enumerate(snake):
    cx, cy = (i + 0.5) * CELL, (j + 0.5) * CELL
    near = lambda r: math.hypot(r[3] - cx, r[4] - cy)
    has_preview = [r for r in cells[(i, j)] if len(r) > 7 and r[7]]
    best = min(has_preview or cells[(i, j)], key=near)
    s = {"id": f"{best[1]}|{best[2]}", "title": best[1], "artist": best[2], "half": n % 2, "v": best[3], "a": best[4]}
    if len(best) > 7 and best[7]:
        s["preview"] = best[7]
    if s["id"] in INSTRUMENTALS:
        s["instrumental"] = True
    picked.append(s)

json.dump({"cell": CELL, "songs": picked}, open("public/rate/songs.json", "w"), ensure_ascii=False, indent=0)
print(f"{len(picked)} songs, {sum('preview' in s for s in picked)} with a stored preview, "
      f"from {len(cells)} occupied squares")
