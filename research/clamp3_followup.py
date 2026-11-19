"""CLaMP 3 follow-up: is the song-specific lyrics<->audio shared content (clamp3_tests.py, Test 2b) emotional, or is it
artist / genre / era / style?

Reuses the cached CLaMP 3 embeddings (/vol/clamp3/emb.npz from research/clamp3_tests.py) and MERGE's own metadata
(merge_audio_complete_metadata.csv inside /vol/merge/MERGE_Audio_Complete.zip: Artist, Year/ActualYear, Genres, ...).
CPU only; nothing is re-embedded. Each gap = cos(lyrics_i, audio_i) - mean cos(lyrics_i, audio_j) over a comparison
set; 95% CIs bootstrap over songs.

  1. artist control        comparison = other songs by the same artist
  2. genre + emotion       5 nearest by (valence, arousal) among songs with the same main genre and year within
                           +/-5, excluding the same artist
  3. emotion subspace      gap vs the 5 nearest-label songs, computed separately in the 2-d prompt subspace
                           (valence, arousal pos-neg directions, orthonormalised) and its orthogonal complement,
                           against random 2-d subspaces
  4. emotion-ladenness     Spearman of each song's gap with |zero-shot lyrics valence / arousal score|

    modal run research/clamp3_followup.py
"""

import modal

image = modal.Image.debian_slim(python_version="3.11").pip_install("numpy==1.26.4", "pandas", "scipy")
app = modal.App("senti-clamp3-followup", image=image)
vol = modal.Volume.from_name("senti-finetune")


@app.function(volumes={"/vol": vol}, cpu=4, memory=8192, timeout=1800)
def analyse() -> dict:
    import io
    import json
    import re
    import zipfile
    import numpy as np
    import pandas as pd
    from scipy.stats import spearmanr
    rng = np.random.default_rng(0)
    E = dict(np.load("/vol/clamp3/emb.npz")); meta = json.load(open("/vol/clamp3/emb_meta.json"))
    S = ["train", "val", "test"]
    unit = lambda X: X / np.linalg.norm(X, axis=-1, keepdims=True)
    rows = [r for s in S for r in meta[s]]
    is_test = np.array([s == "test" for s in S for _ in meta[s]])
    Lx = unit(np.concatenate([E[f"{s}_lyrics"] for s in S])); Ax = unit(np.concatenate([E[f"{s}_audio"] for s in S]))
    Y = np.array([[r["valence"], r["arousal"]] for r in rows])

    # ---- MERGE metadata
    z = zipfile.ZipFile("/vol/merge/MERGE_Audio_Complete.zip")
    md = pd.read_csv(io.BytesIO(z.read("MERGE_Audio_Complete/merge_audio_complete_metadata.csv")))
    norm = lambda s: re.sub(r"\s+", " ", str(s).strip().lower())
    md["key"] = md["Title"].map(norm) + "|" + md["Artist"].map(norm)
    md = md.drop_duplicates("key").set_index("key")

    def year(r):
        for c in ["ActualYear", "Year", "LowestYear"]:
            m = re.search(r"(19|20)\d\d", str(r.get(c, "")))
            if m: return int(m.group(0))
        return None
    keys = [norm(r["title"]) + "|" + norm(r["artist"]) for r in rows]
    found = [k in md.index for k in keys]
    artist = np.array([norm(r["artist"]) for r in rows])
    genre = np.array([str(md.loc[k, "Genres"]).split(",")[0].strip() if f and pd.notna(md.loc[k, "Genres"]) else ""
                      for k, f in zip(keys, found)])
    yr = np.array([year(md.loc[k]) if f else None for k, f in zip(keys, found)], dtype=object)
    coverage = {"songs": len(rows), "matched_to_metadata": int(sum(found)), "with_genre": int((genre != "").sum()),
                "with_year": int(sum(y is not None for y in yr)),
                "main_genre_counts": pd.Series(genre[genre != ""]).value_counts().head(12).to_dict(),
                "metadata_columns": list(md.columns)}

    def boot_mean(x, n=2000):
        x = np.asarray(x, float)
        m = [x[rng.integers(0, len(x), len(x))].mean() for _ in range(n)]
        return {"n": int(len(x)), "mean": float(x.mean()), "ci": [float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))]}

    def nearest_label(idx, i, k=5, cand=None):
        c = idx[idx != i] if cand is None else cand
        if len(c) < k: return None
        d = np.linalg.norm(Y[c] - Y[i], axis=1)
        return c[np.argsort(d)[:k]]

    # prompt subspace
    P = {k[7:]: unit(unit(E[k]).mean(0)) for k in E if k.startswith("prompt_")}
    dv, da = P["valence_pos"] - P["valence_neg"], P["arousal_pos"] - P["arousal_neg"]
    B = np.linalg.qr(np.stack([dv, da], 1))[0]                                   # [768, 2] orthonormal
    zs_v, zs_a = Lx @ dv, Lx @ da

    res = {"coverage": coverage}
    for pool_name, pool in [("all", np.arange(len(rows))), ("test", np.where(is_test)[0])]:
        sim = Lx[pool] @ Ax[pool].T; own = np.diag(sim); loc = {g: j for j, g in enumerate(pool)}
        out = {}
        # baseline (as in clamp3_tests Test 2b): 5 nearest by label
        nl = {i: nearest_label(pool, i) for i in pool}
        i_to_loc = lambda c: np.array([loc[j] for j in c])
        base = np.array([own[loc[i]] - sim[loc[i], i_to_loc(nl[i])].mean() for i in pool])
        out["baseline: vs 5 nearest-label"] = boot_mean(base)
        # 1. artist
        g1 = []
        for i in pool:
            c = pool[(artist[pool] == artist[i]) & (pool != i)]
            if len(c): g1.append(own[loc[i]] - sim[loc[i], i_to_loc(c)].mean())
        out["1. vs same-artist songs"] = boot_mean(g1) if g1 else None
        # 2. genre + year + emotion, excluding same artist
        g2 = []
        for i in pool:
            if not genre[i]: continue
            m = (genre[pool] == genre[i]) & (artist[pool] != artist[i]) & (pool != i)
            if yr[i] is not None:
                m &= np.array([y is not None and abs(y - yr[i]) <= 5 for y in yr[pool]])
            c = nearest_label(pool, i, cand=pool[m])
            if c is not None: g2.append(own[loc[i]] - sim[loc[i], i_to_loc(c)].mean())
        out["2. vs 5 nearest-label, same main genre, year ±5, other artists"] = boot_mean(g2) if g2 else None
        # 3. subspace split of the baseline gap
        def split_gap(Bm):
            Ls, As = Lx[pool] @ Bm, Ax[pool] @ Bm
            ss = Ls @ As.T; sc = sim - ss
            f = lambda M: np.array([M[loc[i], loc[i]] - M[loc[i], i_to_loc(nl[i])].mean() for i in pool])
            return f(ss), f(sc)
        es, ec = split_gap(B)
        out["3a. emotion subspace (2-d prompt dirs)"] = boot_mean(es)
        out["3b. orthogonal complement"] = boot_mean(ec)
        rs = []
        for _ in range(20):
            Rm = np.linalg.qr(rng.normal(size=(B.shape[0], 2)))[0]
            rs.append(split_gap(Rm)[0].mean())
        out["3c. random 2-d subspace (20 draws): mean gap"] = {"mean": float(np.mean(rs)),
                                                             "range": [float(np.min(rs)), float(np.max(rs))]}
        out["3d. share of baseline gap in emotion subspace"] = float(es.mean() / base.mean())
        # 4. emotion-ladenness
        for nm, zsc in [("valence", zs_v), ("arousal", zs_a)]:
            x = np.abs(zsc[pool] - np.median(zsc[pool]))
            rho = spearmanr(x, base).correlation
            bs = []
            for _ in range(1000):
                b = rng.integers(0, len(pool), len(pool)); bs.append(spearmanr(x[b], base[b]).correlation)
            out[f"4. Spearman(gap, |zero-shot lyrics {nm}|)"] = {"n": int(len(pool)), "rho": float(rho),
                "ci": [float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))]}
        res[pool_name] = out
    return res


def fmt(v):
    if v is None: return "n/a (no eligible songs)"
    if isinstance(v, float): return f"{v:.2f}"
    if "rho" in v: return f"ρ = {v['rho']:.3f} [{v['ci'][0]:.3f}, {v['ci'][1]:.3f}] (n = {v['n']})"
    if "range" in v: return f"{v['mean']:.4f} (range {v['range'][0]:.4f} to {v['range'][1]:.4f})"
    return f"{v['mean']:.4f} [{v['ci'][0]:.4f}, {v['ci'][1]:.4f}] (n = {v['n']})"


def report_md(R: dict) -> str:
    c = R["coverage"]
    L = ["# CLaMP 3 follow-up: is the song-specific lyrics↔audio content emotional?\n",
         "Reuses the CLaMP 3 embeddings from research/clamp3_tests.py. Each gap = cos(lyrics_i, audio_i) − mean "
         "cos(lyrics_i, audio_j) over the comparison set; 95% bootstrap CIs over songs.\n",
         f"Metadata (MERGE's merge_audio_complete_metadata.csv): {c['matched_to_metadata']} of {c['songs']} songs "
         f"matched by title + artist; {c['with_genre']} with a genre, {c['with_year']} with a year. Main genre = "
         f"first listed AllMusic genre. Top main genres: {c['main_genre_counts']}.\n",
         "Other per-song metadata available but not used here: " +
         ", ".join(x for x in c["metadata_columns"] if x in ("Moods", "MoodsAll", "Themes", "Styles")) + ".\n"]
    for pool in ["all", "test"]:
        L.append(f"\n## {pool} songs\n\n| analysis | result |\n|---|---|")
        for k, v in R[pool].items():
            L.append(f"| {k} | {fmt(v)} |")
    return "\n".join(L) + "\n"


@app.local_entrypoint()
def main(out: str = "research/results"):
    import json
    R = analyse.remote()
    json.dump(R, open(f"{out}/clamp3_followup.json", "w"), indent=1, default=str)
    md = report_md(R)
    open(f"{out}/clamp3_followup.md", "w").write(md)
    print(md)
