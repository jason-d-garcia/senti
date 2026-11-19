"""Linear-map stitching of audio into the lyrics representation, scored on conflict songs against MERGE's labels.

Question: when lyrics and audio disagree, does writing audio information into the lyrics activations (through a
linear map fitted on train pairs) predict MERGE's valence/arousal better than lyrics alone, audio alone and simple
late fusion?

Reuses the cached CLaMP 3 activations from research/clamp3_sae.py (/vol/clamp3_sae/full_acts.npz: song-mean text
tower layers 6/10 and audio tower layers 6/10, train 1,734 + test 206) and the CLaMP 3 final embeddings / prompt
embeddings from research/clamp3_tests.py (/vol/clamp3/emb.npz) for the label-free conflict definition. CPU only, no
lyrics or audio read.

Deviation from the brief: the cache has no validation-split activations (clamp3_sae.py skipped them), so
hyperparameters (layer pair, alpha, fusion weight, ridge alphas inside RidgeCV) are chosen on an inner held-out 219
train songs (stratified by quadrant, seed 42); final models are refit on all train songs.

Note on stitching variants (a) and (b): the lyrics probe is linear, so adding alpha * (mapped - lyrics) or only its
projection onto the probe's valence/arousal directions gives identical predictions: (1 - alpha) * probe(lyrics) +
alpha * probe(mapped audio). Both are reported under one row. Variant (c) retrains the probe on mixed train
activations lyrics + alpha * (cross-fitted mapped audio - lyrics).

    modal run research/clamp3_stitch.py
"""

import modal

image = modal.Image.debian_slim(python_version="3.11").pip_install("numpy==1.26.4", "scikit-learn==1.5.1", "pandas")
app = modal.App("senti-clamp3-stitch", image=image)
vol = modal.Volume.from_name("senti-finetune")
LAYERS = [6, 10]


@app.function(volumes={"/vol": vol}, cpu=4, memory=16384, timeout=3600)
def analyse() -> dict:
    import json
    import numpy as np
    from sklearn.linear_model import RidgeCV
    from sklearn.model_selection import KFold, train_test_split
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    rng = np.random.default_rng(0)

    Z = np.load("/vol/clamp3_sae/full_acts.npz"); meta = json.load(open("/vol/clamp3_sae/full_meta.json"))

    def song_mean(split, mod, L):
        X = Z[f"{split}_{mod}_L{L}"]; off = Z[f"{split}_{mod}_off"]
        return np.stack([X[a:b].astype(np.float32).mean(0) for a, b in zip(off[:-1], off[1:])])
    H = {(s, L): song_mean(s, "text", L) for s in ["train", "test"] for L in LAYERS}
    G = {(s, L): song_mean(s, "audio", L) for s in ["train", "test"] for L in LAYERS}
    Y = {s: np.array([[r["valence"], r["arousal"]] for r in meta[s]]) for s in ["train", "test"]}
    Q = {s: np.array([r["quadrant"] for r in meta[s]]) for s in ["train", "test"]}
    lo = Y["train"].min(); thr = 0.0 if lo < 0 else 0.5

    # label-free conflict definition (as in clamp3_tests / clamp3_sae): zero-shot valence from CLaMP 3 embeddings
    E = np.load("/vol/clamp3/emb.npz"); em = json.load(open("/vol/clamp3/emb_meta.json"))
    assert [(r["title"], r["artist"]) for r in em["test"]] == [(r["title"], r["artist"]) for r in meta["test"]]
    unit = lambda X: X / np.linalg.norm(X, axis=-1, keepdims=True)
    P = {k: unit(unit(E[f"prompt_{k}"]).mean(0)) for k in ["valence_pos", "valence_neg"]}
    dv = P["valence_pos"] - P["valence_neg"]
    zsL, zsA = unit(E["test_lyrics"]) @ dv, unit(E["test_audio"]) @ dv
    gap = np.abs(zsL - zsA); conflict = gap >= np.quantile(gap, 0.75)

    probe = lambda: make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(-1, 5, 13)))
    ridge_map = lambda: make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(-1, 5, 13)))

    def fit_axes(X, Yx):
        return [probe().fit(X, Yx[:, j]) for j in range(2)]

    def pred(ms, X):
        return np.stack([m.predict(X) for m in ms], 1)

    def crossfit_map(Gx, Hx, k=5):
        out = np.zeros_like(Hx)
        for tr, te in KFold(k, shuffle=True, random_state=0).split(Gx):
            out[te] = ridge_map().fit(Gx[tr], Hx[tr]).predict(Gx[te])
        return out

    # ---------------------------------------------------------------- inner split for model selection
    itr, iva = train_test_split(np.arange(len(Y["train"])), test_size=219, random_state=42, stratify=Q["train"])
    alphas = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    mae = lambda p, y: float(np.abs(p - y).mean())

    def select(Lt, La):
        Htr, Hva, Gtr, Gva = H[("train", Lt)][itr], H[("train", Lt)][iva], G[("train", La)][itr], G[("train", La)][iva]
        ytr, yva = Y["train"][itr], Y["train"][iva]
        lp = fit_axes(Htr, ytr); ap = fit_axes(Gtr, ytr); mp = ridge_map().fit(Gtr, Htr)
        pl, pa, pm = pred(lp, Hva), pred(ap, Gva), pred(lp, mp.predict(Gva))
        best = {}
        best["fusion_w"] = [min(alphas, key=lambda w: mae(w * pl[:, j] + (1 - w) * pa[:, j], yva[:, j])) for j in range(2)]
        best["stitch_alpha"] = [min(alphas, key=lambda a: mae((1 - a) * pl[:, j] + a * pm[:, j], yva[:, j])) for j in range(2)]
        Mtr = crossfit_map(Gtr, Htr)
        def mix_score(a):
            ms = fit_axes(Htr + a * (Mtr - Htr), ytr); pv = pred(ms, Hva + a * (mp.predict(Gva) - Hva))
            return np.mean([mae(pv[:, j], yva[:, j]) for j in range(2)])
        best["mix_alpha"] = min(alphas[1:], key=mix_score)
        st = sum(mae((1 - best["stitch_alpha"][j]) * pl[:, j] + best["stitch_alpha"][j] * pm[:, j], yva[:, j]) for j in range(2))
        return best, st
    sel = {(Lt, La): select(Lt, La) for Lt in LAYERS for La in LAYERS}
    Lt, La = min(sel, key=lambda k: sel[k][1]); hp = sel[(Lt, La)][0]

    # ---------------------------------------------------------------- final fit on all train, evaluate on test
    Htr, Hte, Gtr, Gte, ytr, yte = H[("train", Lt)], H[("test", Lt)], G[("train", La)], G[("test", La)], Y["train"], Y["test"]
    lp, ap = fit_axes(Htr, ytr), fit_axes(Gtr, ytr)
    cp = fit_axes(np.c_[Htr, Gtr], ytr)
    mp = ridge_map().fit(Gtr, Htr)
    map_r2 = float(mp.score(Gte, Hte))
    M = mp.predict(Gte)
    pl, pa, pc, pm = pred(lp, Hte), pred(ap, Gte), pred(cp, np.c_[Hte, Gte]), pred(lp, M)
    fw, sa = np.array(hp["fusion_w"]), np.array(hp["stitch_alpha"])
    preds = {"lyrics only": pl, "audio only": pa, "late fusion (w tuned)": fw * pl + (1 - fw) * pa,
             "concatenation probe": pc, "stitch (a/b): lyrics + α·(mapped − lyrics)": (1 - sa) * pl + sa * pm}
    Mtr = crossfit_map(Gtr, Htr); a_mix = hp["mix_alpha"]
    mix = fit_axes(Htr + a_mix * (Mtr - Htr), ytr)
    preds["stitch (c): probe retrained on mixed activations"] = pred(mix, Hte + a_mix * (M - Hte))
    # controls (same α as stitch a/b)
    n = len(yte)
    perm = rng.permutation(n)
    while (perm == np.arange(n)).any(): perm = rng.permutation(n)
    preds["control: wrong-song audio"] = (1 - sa) * pl + sa * pred(lp, M[perm])
    sq = np.array([rng.choice(np.where((Q["test"] == Q["test"][i]) & (np.arange(n) != i))[0]) for i in range(n)])
    preds["control: same-quadrant other song's audio"] = (1 - sa) * pl + sa * pred(lp, M[sq])
    D = M - Hte; R_ = rng.normal(size=D.shape); R_ *= (np.linalg.norm(D, axis=1) / np.linalg.norm(R_, axis=1))[:, None]
    # random direction at equal norm, through the lyrics probe, per-axis α
    pr = pred(lp, Hte + R_)
    preds["control: random direction, equal norm"] = (1 - sa) * pl + sa * pr

    def quad(p):
        v, a = p[:, 0] > thr, p[:, 1] > thr
        return np.where(v & a, "Q1", np.where(~v & a, "Q2", np.where(~v & ~a, "Q3", "Q4")))

    # label-based secondary subset: lyrics-only and audio-only valence predictions straddle the true value
    straddle = (pl[:, 0] - yte[:, 0]) * (pa[:, 0] - yte[:, 0]) < 0
    subsets = {"all test": np.ones(n, bool), "conflict (label-free, top quartile zero-shot gap)": conflict,
               "non-conflict": ~conflict, "[label-based, secondary] lyrics/audio straddle true valence": straddle}

    def metrics(p, m):
        return {"valence_mae": mae(p[m, 0], yte[m, 0]), "arousal_mae": mae(p[m, 1], yte[m, 1]),
                "valence_r": float(np.corrcoef(p[m, 0], yte[m, 0])[0, 1]),
                "arousal_r": float(np.corrcoef(p[m, 1], yte[m, 1])[0, 1]),
                "quadrant_acc": float((quad(p[m]) == Q["test"][m]).mean())}

    def paired(p, ref, m, nb=1000):
        idx = np.where(m)[0]; out = {}
        for j, ax in enumerate(["valence", "arousal"]):
            dm, dr = [], []
            for _ in range(nb):
                b = rng.choice(idx, len(idx))
                dm.append(np.abs(p[b, j] - yte[b, j]).mean() - np.abs(ref[b, j] - yte[b, j]).mean())
                dr.append(np.corrcoef(p[b, j], yte[b, j])[0, 1] - np.corrcoef(ref[b, j], yte[b, j])[0, 1])
            pm_ = np.abs(p[idx, j] - yte[idx, j]).mean() - np.abs(ref[idx, j] - yte[idx, j]).mean()
            out[f"{ax}_dMAE"] = [float(pm_), float(np.percentile(dm, 2.5)), float(np.percentile(dm, 97.5))]
            out[f"{ax}_dr"] = [float(np.corrcoef(p[idx, j], yte[idx, j])[0, 1] - np.corrcoef(ref[idx, j], yte[idx, j])[0, 1]),
                               float(np.percentile(dr, 2.5)), float(np.percentile(dr, 97.5))]
        return out

    res = {"layers": {"text": Lt, "audio": La}, "hyperparameters": hp, "map_test_r2": map_r2,
           "selection_inner_val_mae_sum": {f"text{k[0]}_audio{k[1]}": v[1] for k, v in sel.items()},
           "n": {k: int(m.sum()) for k, m in subsets.items()}, "quadrant_threshold": thr, "subsets": {}}
    ref_lf, ref_ly = preds["late fusion (w tuned)"], preds["lyrics only"]
    for sn, m in subsets.items():
        res["subsets"][sn] = {nm: {"metrics": metrics(p, m), "vs_late_fusion": paired(p, ref_lf, m),
                                   "vs_lyrics_only": paired(p, ref_ly, m)} for nm, p in preds.items()}
    # positive criterion on the label-free conflict subset
    c = res["subsets"]["conflict (label-free, top quartile zero-shot gap)"]
    best_stitch = min([k for k in preds if k.startswith("stitch")],
                      key=lambda k: c[k]["metrics"]["valence_mae"] + c[k]["metrics"]["arousal_mae"])
    beats_lf = any(c[best_stitch]["vs_late_fusion"][f"{ax}_dMAE"][2] < 0 for ax in ["valence", "arousal"])
    beats_ctrl = all(c[best_stitch]["metrics"][f"{ax}_mae"] < c[k]["metrics"][f"{ax}_mae"]
                     for k in preds if k.startswith("control") for ax in ["valence", "arousal"])
    res["positive_criterion"] = {"best_stitch_variant": best_stitch,
                                 "beats_late_fusion_on_conflict_CI_excludes_0_(any_axis)": bool(beats_lf),
                                 "beats_all_controls_on_conflict_MAE_(both_axes)": bool(beats_ctrl)}
    return res


def f(x, nd=3):
    if isinstance(x, list): return f"{x[0]:+.{nd}f} [{x[1]:+.{nd}f}, {x[2]:+.{nd}f}]"
    return f"{x:.{nd}f}"


def report_md(R: dict) -> str:
    L = ["# Linear-map stitching of audio into lyrics (CLaMP 3), scored on MERGE labels\n",
         f"Layers chosen on an inner held-out 219 train songs: text tower L{R['layers']['text']}, audio tower "
         f"L{R['layers']['audio']} (song-mean activations). Hyperparameters: {R['hyperparameters']} "
         "(fusion_w / stitch_alpha per axis [valence, arousal]). Map audio→text held-out R² on test: "
         f"{R['map_test_r2']:.3f}. Quadrant threshold {R['quadrant_threshold']}. Subset sizes: {R['n']}.\n",
         "Stitch (a) (probe-direction projection) and (b) (full mapped difference) give identical predictions with a "
         "linear probe: (1 − α)·probe(lyrics) + α·probe(mapped audio). The validation split was not cached, so "
         "selection used an inner held-out part of train (see script docstring). Paired differences are method minus "
         "reference (negative ΔMAE / positive Δr = better), 1,000 bootstrap resamples paired by song.\n",
         f"**Positive criterion (label-free conflict songs):** {R['positive_criterion']}\n"]
    for sn, rows in R["subsets"].items():
        L += [f"\n## {sn} (n = {R['n'][sn]})\n",
              "| method | V MAE | A MAE | V r | A r | quadrant acc | ΔMAE V vs late fusion | ΔMAE A vs late fusion | "
              "ΔMAE V vs lyrics | ΔMAE A vs lyrics | Δr V vs late fusion |",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
        for nm, v in rows.items():
            m, lf, ly = v["metrics"], v["vs_late_fusion"], v["vs_lyrics_only"]
            L.append(f"| {nm} | {f(m['valence_mae'])} | {f(m['arousal_mae'])} | {f(m['valence_r'], 2)} | "
                     f"{f(m['arousal_r'], 2)} | {f(m['quadrant_acc'], 2)} | {f(lf['valence_dMAE'])} | "
                     f"{f(lf['arousal_dMAE'])} | {f(ly['valence_dMAE'])} | {f(ly['arousal_dMAE'])} | {f(lf['valence_dr'], 2)} |")
    return "\n".join(L) + "\n"


@app.local_entrypoint()
def main(out: str = "research/results"):
    import json
    R = analyse.remote()
    json.dump(R, open(f"{out}/clamp3_stitch.json", "w"), indent=1)
    md = report_md(R)
    open(f"{out}/clamp3_stitch.md", "w").write(md)
    print(md)
