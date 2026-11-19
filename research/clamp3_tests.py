"""CLaMP 3 tests: does a music-text contrastive model's shared space carry emotion, and does it help explain Senti?

CLaMP 3 (Wu et al. 2025, github.com/sanderwood/clamp3, MIT licence for code and weights) maps MERT-v1-95M audio
features and XLM-R text into one 768-d space. This script uses its own model code and checkpoint (pinned commit) and
its audio recipe: waveform normalised over the clip, non-overlapping 5 s windows (last dropped if < 1 s), MERT hidden
states averaged over time and over all 13 layers per window, zero vectors at both ends, then the CLaMP 3 audio encoder
with global average pooling. Text: lines joined with the tokenizer's separator, 128-token segments, length-weighted
average of the global features (as in their extract_clamp3.py; lines are deduplicated in order rather than via set()).

All MERGE songs with audio, same seed-42 split as research/modal_crossmodal.py.
  Test 1  zero-shot emotion from text prompts (audio and lyrics embeddings), against ridge probes.
  Test 2  lyrics and audio in one space: retrieval, song-specific similarity gap vs label-matched songs, probe transfer.
  Test 3  CLaMP 3 prompt directions pulled back into Senti's MERT layer-6 space: alignment with Senti's ridge head and
          ablation against random directions.

    modal run research/clamp3_tests.py --lyrics ~/taildrop-in/va_lyrics.csv [--trial]

--trial embeds 20/10/20 songs per split to a separate file; the analysis then runs on those (numbers meaningless).
Lyrics are read in memory only; only embeddings (Modal volume) and numbers (research/results/) are written.
"""

import modal

SEED = 42
SR, WIN = 24000, 5
CLAMP3_COMMIT = "9016d2b0c8d12d1aa79c2e0ab201e6822bdc83a8"
CKPT = ("weights_clamp3_saas_h_size_768_t_model_FacebookAI_xlm-roberta-base_t_length_128_a_size_768_a_layers_12_"
        "a_length_128_s_size_768_s_layers_12_p_size_64_p_length_512.pth")
OUT = "/vol/clamp3"

PROMPTS = {
    "valence_pos": ["a happy, joyful, uplifting song", "cheerful and bright music", "a song full of joy and optimism",
                    "positive, upbeat, feel-good music"],
    "valence_neg": ["a sad, gloomy, melancholic song", "dark and depressing music", "a song full of sorrow and grief",
                    "negative, mournful, heartbroken music"],
    "arousal_pos": ["an energetic, intense, loud song", "fast, powerful, high-energy music",
                    "an aggressive, exciting, driving song", "loud and intense music with strong beats"],
    "arousal_neg": ["a calm, gentle, quiet song", "slow, soft, relaxing music", "a peaceful, tender, mellow song",
                    "quiet and soothing music"],
}

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install("torch==2.4.1", "transformers==4.40.0", "nnAudio==0.3.3", "scikit-learn==1.5.1", "numpy==1.26.4",
                 "pandas", "scipy", "samplings==0.1.7", "unidecode==1.3.6", "requests")
    .env({"HF_HOME": "/root/hf"})
    .run_commands(
        f"git clone https://github.com/sanderwood/clamp3.git /clamp3 && cd /clamp3 && git checkout {CLAMP3_COMMIT}",
        f"cd /clamp3/code && python -c \"import requests; r = requests.get('https://huggingface.co/sander-wood/clamp3/"
        f"resolve/main/{CKPT}', stream=True); r.raise_for_status(); f = open('{CKPT}', 'wb'); "
        f"[f.write(c) for c in r.iter_content(1 << 20)]; f.close()\"",
        "python -c \"from huggingface_hub import snapshot_download as s; s('FacebookAI/xlm-roberta-base'); "
        "s('m-a-p/MERT-v1-95M')\"",
    )
)
app = modal.App("senti-clamp3", image=image)
vol = modal.Volume.from_name("senti-finetune")
V = {"/vol": vol}


def split_lyrics(lyrics_csv: bytes):
    import io
    import pandas as pd
    from sklearn.model_selection import train_test_split
    df = pd.read_csv(io.BytesIO(lyrics_csv)).dropna(subset=["lyrics", "valence", "arousal"])
    train_df, temp_df = train_test_split(df, test_size=0.2, random_state=SEED, stratify=df["quadrant"])
    val_df, test_df = train_test_split(temp_df, test_size=0.5, random_state=SEED, stratify=temp_df["quadrant"])
    return {"train": train_df, "val": val_df, "test": test_df}


@app.function(gpu="T4", volumes=V, memory=32768, timeout=3600)
def embed(lyrics_csv: bytes, trial: bool) -> dict:
    import json
    import os
    import sys
    import numpy as np
    import torch
    name = "emb_trial" if trial else "emb"
    if os.path.exists(f"{OUT}/{name}.npz"):
        return json.load(open(f"{OUT}/{name}_meta.json"))
    os.chdir("/clamp3/code"); sys.path[:0] = ["/clamp3/code", "/clamp3/preprocessing/audio"]
    from config import AUDIO_HIDDEN_SIZE, AUDIO_NUM_LAYERS, CLAMP3_HIDDEN_SIZE, M3_HIDDEN_SIZE, MAX_AUDIO_LENGTH, \
        MAX_TEXT_LENGTH, PATCH_LENGTH, PATCH_NUM_LAYERS, TEXT_MODEL_NAME
    from utils import CLaMP3Model
    from hf_pretrains import HuBERTFeature
    from transformers import AutoTokenizer, BertConfig

    dev = torch.device("cuda")
    audio_cfg = BertConfig(vocab_size=1, hidden_size=AUDIO_HIDDEN_SIZE, num_hidden_layers=AUDIO_NUM_LAYERS,
                           num_attention_heads=AUDIO_HIDDEN_SIZE // 64, intermediate_size=AUDIO_HIDDEN_SIZE * 4,
                           max_position_embeddings=MAX_AUDIO_LENGTH)
    sym_cfg = BertConfig(vocab_size=1, hidden_size=M3_HIDDEN_SIZE, num_hidden_layers=PATCH_NUM_LAYERS,
                         num_attention_heads=M3_HIDDEN_SIZE // 64, intermediate_size=M3_HIDDEN_SIZE * 4,
                         max_position_embeddings=PATCH_LENGTH)
    model = CLaMP3Model(audio_config=audio_cfg, symbolic_config=sym_cfg, text_model_name=TEXT_MODEL_NAME,
                        hidden_size=CLAMP3_HIDDEN_SIZE, load_m3=False)
    ck = torch.load(CKPT, map_location="cpu", weights_only=True)
    model.load_state_dict(ck["model"]); model = model.to(dev).eval()
    tok = AutoTokenizer.from_pretrained(TEXT_MODEL_NAME)
    mert = HuBERTFeature("m-a-p/MERT-v1-95M", SR, force_half=False, processor_normalize=True).to(dev).eval()

    def global_feature(x, max_len, fn):
        """Their extract_feature(): fixed-length segments, last one right-aligned, length-weighted mean."""
        segs = [x[i:i + max_len] for i in range(0, len(x), max_len)]
        segs[-1] = x[-max_len:]
        feats = []
        for s in segs:
            m = torch.cat([torch.ones(len(s)), torch.zeros(max_len - len(s))])
            feats.append(fn(s, m))
        full, rem = len(x) // max_len, len(x) % max_len
        w = torch.tensor([max_len] * full + ([rem] if rem else []), device=dev, dtype=torch.float).view(-1, 1)
        return ((torch.cat(feats, 0) * w).sum(0) / w.sum()).cpu().numpy()

    @torch.no_grad()
    def text_emb(text: str):
        lines = list(dict.fromkeys(l for l in text.split("\n") if l.strip()))
        ids = tok(tok.sep_token.join(lines), return_tensors="pt")["input_ids"].squeeze(0)

        def fn(s, m):
            pad = torch.ones(MAX_TEXT_LENGTH - len(s)).long() * tok.pad_token_id
            return model.get_text_features(torch.cat([s, pad])[None].to(dev), m[None].to(dev), get_global=True)
        return global_feature(ids, MAX_TEXT_LENGTH, fn)

    @torch.no_grad()
    def audio_emb(y):
        x = torch.from_numpy(y).float()
        x = (x - x.mean()) / torch.sqrt(x.var(unbiased=False) + 1e-7)          # processor do_normalize over the clip
        w = SR * WIN
        chunks = [x[i:i + w] for i in range(0, len(x), w)]
        if len(chunks) > 1 and len(chunks[-1]) < SR: chunks = chunks[:-1]
        feats = [mert(c[None].to(dev), layer=None, reduction="mean") for c in chunks]   # each [13, 1, 768]
        f = torch.cat(feats, 1).mean(0).cpu()                                        # [W, 768]
        f = torch.cat([torch.zeros(1, 768), f, torch.zeros(1, 768)], 0)

        def fn(s, m):
            pad = torch.zeros(MAX_AUDIO_LENGTH - len(s), 768)
            return model.get_audio_features(torch.cat([s, pad])[None].to(dev), m[None].to(dev), get_global=True)
        return global_feature(f, MAX_AUDIO_LENGTH, fn)

    splits = split_lyrics(lyrics_csv)
    index = json.load(open("/vol/audio/index.json"))
    lim = {"train": 20, "val": 10, "test": 20} if trial else {}
    out, meta = {}, {}
    for split, items in index.items():
        d = splits[split]; arr = np.load(f"/vol/audio/{split}.npy", mmap_mode="r")
        items = items[:lim.get(split, len(items))]
        A, L, rows = [], [], []
        for i, it in enumerate(items):
            r = d.iloc[it["pos"]]
            assert r["title"] == it["title"] and r["artist"] == it["artist"], f"row mismatch at {split} {i}"
            A.append(audio_emb(np.asarray(arr[i, :it["n"]], np.float32)))
            L.append(text_emb(str(r["lyrics"])))
            rows.append({"title": it["title"], "artist": it["artist"], "quadrant": it["quadrant"],
                         "valence": float(it["valence"]), "arousal": float(it["arousal"])})
        out[f"{split}_audio"], out[f"{split}_lyrics"] = np.stack(A), np.stack(L)
        meta[split] = rows
        print(f"{split}: {len(rows)} songs")
    for k, ps in PROMPTS.items():
        out[f"prompt_{k}"] = np.stack([text_emb(p) for p in ps])
    os.makedirs(OUT, exist_ok=True)
    np.savez(f"{OUT}/{name}.npz", **out)
    json.dump(meta, open(f"{OUT}/{name}_meta.json", "w")); vol.commit()
    return meta


# ================================================================ analysis (CPU)

def pearson(a, b):
    import numpy as np
    a, b = np.asarray(a, float), np.asarray(b, float)
    if a.std() < 1e-12 or b.std() < 1e-12: return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def fit_probe(X, y):
    import numpy as np
    from sklearn.linear_model import RidgeCV
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    return make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(-1, 5, 13))).fit(X, y)


def boot_r(pred, y, rng, n=1000):
    import numpy as np
    rs = [pearson(pred[i], y[i]) for i in (rng.integers(0, len(y), len(y)) for _ in range(n))]
    return [float(np.percentile(rs, 2.5)), float(np.percentile(rs, 97.5))]


def boot_mean(x, rng, n=2000):
    import numpy as np
    m = [x[rng.integers(0, len(x), len(x))].mean() for _ in range(n)]
    return [float(x.mean()), float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))]


@app.function(volumes=V, cpu=8, memory=16384, timeout=3600)
def analyse(trial: bool) -> dict:
    import json
    import numpy as np
    from sklearn.linear_model import RidgeCV
    from sklearn.metrics import r2_score
    from sklearn.preprocessing import StandardScaler
    rng = np.random.default_rng(0)
    name = "emb_trial" if trial else "emb"
    E = dict(np.load(f"{OUT}/{name}.npz")); meta = json.load(open(f"{OUT}/{name}_meta.json"))
    unit = lambda X: X / np.linalg.norm(X, axis=-1, keepdims=True)
    S = ["train", "val", "test"]
    A = {s: unit(E[f"{s}_audio"]) for s in S}; L = {s: unit(E[f"{s}_lyrics"]) for s in S}
    Y = {s: np.array([[r["valence"], r["arousal"]] for r in meta[s]]) for s in S}
    Q = {s: np.array([r["quadrant"] for r in meta[s]]) for s in S}
    # Senti's MERT layer-6 mean-pooled features from the phase 1 cache (same items, same order)
    M = {}
    for s in S:
        z = np.load(f"/vol/xmodal/{s}.npz"); rows = json.load(open(f"/vol/xmodal/{s}_rows.json"))
        n = len(meta[s])
        assert [(r["title"], r["artist"]) for r in rows[:n]] == [(r["title"], r["artist"]) for r in meta[s]]
        M[s] = z["audio_pool"][:n, 6].astype(np.float32)
    P = {k: unit(unit(E[f"prompt_{k}"]).mean(0)) for k in PROMPTS}
    D = {t: P[f"{t}_pos"] - P[f"{t}_neg"] for t in ["valence", "arousal"]}       # zero-shot direction per axis
    allX = lambda d: np.concatenate([d[s] for s in S])
    res = {"n": {s: len(meta[s]) for s in S}}

    # ---- Test 1: zero-shot
    t1 = {}
    for j, t in enumerate(["valence", "arousal"]):
        for mod, X in [("audio", A), ("lyrics", L)]:
            sc_te, sc_all = X["test"] @ D[t], allX(X) @ D[t]
            t1[f"{t}|zero-shot {mod}"] = {"test_r": pearson(sc_te, Y["test"][:, j]),
                                          "test_ci": boot_r(sc_te, Y["test"][:, j], rng),
                                          "all_r": pearson(sc_all, allX(Y)[:, j])}
        for nm, X in [("ridge on CLaMP 3 audio", A), ("ridge on CLaMP 3 lyrics", L), ("ridge on Senti MERT L6", M)]:
            p = fit_probe(X["train"], Y["train"][:, j]).predict(X["test"])
            t1[f"{t}|{nm}"] = {"test_r": pearson(p, Y["test"][:, j]), "test_ci": boot_r(p, Y["test"][:, j], rng),
                               "all_r": None}
    res["test1"] = t1

    # ---- Test 2: lyrics and audio in one space
    def retrieval(Lx, Ax):
        sim = Lx @ Ax.T; n = len(sim)
        rank = np.array([(sim[i] > sim[i, i]).sum() + 1 for i in range(n)])
        return {"n": n, "recall@1": float((rank <= 1).mean()), "recall@10": float((rank <= 10).mean()),
                "median_rank": float(np.median(rank)), "chance_recall@1": 1 / n, "chance_recall@10": min(10 / n, 1),
                "chance_median_rank": (n + 1) / 2}

    def gaps(Lx, Ax, Yx, Qx, k=5):
        sim = Lx @ Ax.T; n = len(sim); own = np.diag(sim)
        g = {"vs_all_other": [], "vs_same_quadrant": [], f"vs_{k}_nearest_label": []}
        for i in range(n):
            o = np.arange(n) != i
            g["vs_all_other"].append(own[i] - sim[i, o].mean())
            sq = o & (Qx == Qx[i]); g["vs_same_quadrant"].append(own[i] - sim[i, sq].mean())
            dist = np.linalg.norm(Yx - Yx[i], axis=1); dist[i] = np.inf
            g[f"vs_{k}_nearest_label"].append(own[i] - sim[i, np.argsort(dist)[:k]].mean())
        out = {kk: boot_mean(np.array(v), rng) for kk, v in g.items()}
        out["mean_own_cos"] = float(own.mean()); out["mean_other_cos"] = float(sim[~np.eye(n, dtype=bool)].mean())
        return out

    t2 = {"retrieval_test": retrieval(L["test"], A["test"]), "retrieval_all": retrieval(allX(L), allX(A)),
          "gap_test": gaps(L["test"], A["test"], Y["test"], Q["test"]),
          "gap_all": gaps(allX(L), allX(A), allX(Y), allX(Q))}
    tr = {}
    for j, t in enumerate(["valence", "arousal"]):
        pl, pa = fit_probe(L["train"], Y["train"][:, j]), fit_probe(A["train"], Y["train"][:, j])
        y = Y["test"][:, j]
        tr[t] = {"lyrics→lyrics": pearson(pl.predict(L["test"]), y), "audio→audio": pearson(pa.predict(A["test"]), y),
                 "lyrics→audio": pearson(pl.predict(A["test"]), y), "audio→lyrics": pearson(pa.predict(L["test"]), y)}
    t2["probe_transfer"] = tr
    res["test2"] = t2

    # ---- Test 3: CLaMP 3 directions in Senti's MERT layer-6 space
    sx = StandardScaler().fit(M["train"]); Xs = {s: sx.transform(M[s]) for s in S}
    ca = A["train"].mean(0)
    mp = RidgeCV(alphas=np.logspace(-1, 5, 13)).fit(Xs["train"], A["train"] - ca)
    W = mp.coef_                                                                   # [768 clamp, 768 mert]
    t3 = {"map_alpha": float(mp.alpha_), "map_test_r2": float(r2_score(A["test"] - ca, mp.predict(Xs["test"]),
                                                                       multioutput="variance_weighted"))}
    for j, t in enumerate(["valence", "arousal"]):
        head = RidgeCV(alphas=np.logspace(-1, 5, 13)).fit(Xs["train"], Y["train"][:, j])
        w = head.coef_ / np.linalg.norm(head.coef_)
        d = W.T @ D[t]; d /= np.linalg.norm(d)
        base = head.predict(Xs["test"]); y = Y["test"][:, j]

        def ablate(u):
            Xa = Xs["test"] - np.outer(Xs["test"] @ u, u); p = head.predict(Xa)
            return float(np.abs(p - base).mean()), pearson(p, y) - pearson(base, y)
        rnd = [ablate(v / np.linalg.norm(v)) for v in rng.normal(size=(20, Xs["test"].shape[1]))]
        rnd_cos = [abs(float(w @ (v / np.linalg.norm(v)))) for v in rng.normal(size=(1000, len(w)))]
        da, dr = ablate(d); ha, hr = ablate(w)
        t3[t] = {"cos(pulled-back prompt dir, Senti head)": float(w @ d),
                 "random |cos| 95th pct": float(np.percentile(rnd_cos, 95)),
                 "base_r": pearson(base, y),
                 "ablate prompt dir: mean |Δpred|": da, "ablate prompt dir: Δr": dr,
                 "ablate random (20): mean |Δpred|": float(np.mean([a for a, _ in rnd])),
                 "ablate random (20): max |Δpred|": float(np.max([a for a, _ in rnd])),
                 "ablate random (20): mean Δr": float(np.mean([b for _, b in rnd])),
                 "ablate head's own dir (reference): mean |Δpred|": ha, "ablate head's own dir: Δr": hr}
    res["test3"] = t3
    return res


def f(x, nd=2):
    if x is None: return "n/a"
    if isinstance(x, list) and len(x) == 2: return f"[{x[0]:.{nd}f}, {x[1]:.{nd}f}]"
    if isinstance(x, list): return f"{x[0]:.{nd + 1}f} [{x[1]:.{nd + 1}f}, {x[2]:.{nd + 1}f}]"
    return f"{x:.{nd}f}"


def report_md(R: dict, trial: bool) -> str:
    L = [f"# CLaMP 3 tests{' (TRIAL: tiny subset, numbers meaningless)' if trial else ''}\n",
         f"Songs: {R['n']}. CLaMP 3 (MIT licence, code and weights; commit {CLAMP3_COMMIT[:7]}) with its own MERT "
         "feature recipe. Correlations are Pearson r with MERGE's tag-derived labels; 95% bootstrap CIs over songs.\n",
         "## Test 1: zero-shot emotion from text prompts\n",
         "Score = cos(x, mean positive prompt) − cos(x, mean negative prompt), 4 phrasings per pole. Ridge rows are "
         "trained probes (fit on train) for reference.\n",
         "| axis | method | r, test | 95% CI | r, all songs |\n|---|---|---|---|---|"]
    for k, v in R["test1"].items():
        t, m = k.split("|")
        L.append(f"| {t} | {m} | {f(v['test_r'])} | {f(v['test_ci'])} | {f(v['all_r'])} |")
    t2 = R["test2"]
    L += ["\n## Test 2: lyrics and audio in CLaMP 3's shared space\n", "**(a) Retrieval: each song's lyrics as the "
          "query, its own audio as the target**\n", "| pool | n | recall@1 | recall@10 | median rank | chance r@1 | "
          "chance r@10 | chance median |\n|---|---|---|---|---|---|---|---|"]
    for nm in ["retrieval_test", "retrieval_all"]:
        r = t2[nm]
        L.append(f"| {nm.split('_')[1]} | {r['n']} | {f(r['recall@1'], 3)} | {f(r['recall@10'], 3)} | "
                 f"{r['median_rank']:.0f} | {f(r['chance_recall@1'], 3)} | {f(r['chance_recall@10'], 3)} | "
                 f"{r['chance_median_rank']:.0f} |")
    L += ["\n**(b) Song-specific content: cos(lyrics_i, audio_i) minus mean cos(lyrics_i, audio_j) over comparison "
          "songs j.** A gap above zero against the label-matched comparisons means a song's lyrics and its own audio "
          "share something beyond the emotion label.\n",
          "| pool | vs all other songs | vs same-quadrant songs | vs 5 nearest by (valence, arousal) | mean own cos | "
          "mean other cos |\n|---|---|---|---|---|---|"]
    for nm in ["gap_test", "gap_all"]:
        g = t2[nm]
        L.append(f"| {nm.split('_')[1]} | {f(g['vs_all_other'])} | {f(g['vs_same_quadrant'])} | "
                 f"{f(g['vs_5_nearest_label'])} | {f(g['mean_own_cos'], 3)} | {f(g['mean_other_cos'], 3)} |")
    L += ["\n**(c) Probe transfer in the raw shared space (no alignment step), test songs**\n",
          "| axis | lyrics→lyrics | audio→audio | lyrics→audio | audio→lyrics |\n|---|---|---|---|---|"]
    for t, v in t2["probe_transfer"].items():
        L.append(f"| {t} | {f(v['lyrics→lyrics'])} | {f(v['audio→audio'])} | {f(v['lyrics→audio'])} | "
                 f"{f(v['audio→lyrics'])} |")
    t3 = R["test3"]
    L += ["\n## Test 3: CLaMP 3 prompt directions pulled back into Senti's MERT layer-6 space\n",
          f"Ridge map from standardised MERT L6 (mean-pooled 5 s / 2.5 s slices, as Senti) to CLaMP 3 audio "
          f"embeddings: held-out R² = {f(t3['map_test_r2'], 3)} (alpha {t3['map_alpha']:.0f}). Prompt direction "
          "pulled back as Wᵀd. Senti head = ridge refit on train in the same standardised space.\n",
          "| quantity | valence | arousal |\n|---|---|---|"]
    for k in t3["valence"]:
        L.append(f"| {k} | {f(t3['valence'][k], 3)} | {f(t3['arousal'][k], 3)} |")
    return "\n".join(L) + "\n"


@app.local_entrypoint()
def main(lyrics: str, out: str = "research/results", trial: bool = False):
    import json
    import os
    os.makedirs(out, exist_ok=True)
    meta = embed.remote(open(os.path.expanduser(lyrics), "rb").read(), trial)
    print("embedded:", {k: len(v) for k, v in meta.items()})
    R = analyse.remote(trial)
    tag = "_trial" if trial else ""
    json.dump(R, open(f"{out}/clamp3_results{tag}.json", "w"), indent=1)
    md = report_md(R, trial)
    open(f"{out}/clamp3_report{tag}.md", "w").write(md)
    print(md)
