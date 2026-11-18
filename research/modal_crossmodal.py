"""Phase 1: do lyrics and audio share an emotion representation inside a music-emotion model?

Three arms, all on MERGE (the same seed-42 split and clips as scripts/modal_finetune.py):
  * late fusion  - Senti as it is live: the fine-tuned BERT lyrics model and frozen MERT never share weights.
  * mid fusion   - a small 2-layer transformer that attends jointly over frozen BERT token states (lyrics) and
                   frozen MERT layer-6 slice embeddings (audio), trained on valence/arousal with modality dropout,
                   so lyrics-only and audio-only inputs are in distribution.
  * random init  - the same mid-fusion network, untrained (control).

Main measure, per layer: cross-modal probe transfer. Fit a linear (ridge) valence probe on activations from
lyrics-only inputs and test it on activations from audio-only inputs, and the reverse. Transfer r divided by the
within-modality r is the layer's modality-independence score. Late fusion has no shared space, so it is only
measured after a label-free CCA alignment fitted on the training songs (also reported for the fusion layers).
Controls: shuffled-label probes, the untrained network, random directions. Intervention: project out (or add) the
shared valence direction after fusion layer 1 and measure the effect on predictions, against random directions.

Steps, all on Modal; the Mac only launches them and saves numbers:
  1. extract   (T4) read lyrics in memory, cache BERT + MERT activations to the volume (once).
  2. late      (CPU) CCA-aligned probe transfer between BERT and MERT layers.
  3. fuse      (T4, one per seed) train the mid-fusion model, run probes, controls and interventions.
  4. summarise (CPU) aggregate seeds, conflict-song comparison, markdown report.

    modal run research/modal_crossmodal.py --lyrics ~/Downloads/va_lyrics.csv [--trial]

--trial: 1 seed, 2 epochs, fewer bootstrap samples: a cheap end-to-end check once activations are cached.
Writes research/results/: phase1_results.json, phase1_report.md, phase1_test_predictions.csv.
No lyrics or audio are written anywhere; only activations (on the Modal volume) and numbers.
"""

import modal

SR, SLICE, HOP = 24000, 5.0, 2.5
SEED = 42
MERT = "m-a-p/MERT-v1-95M"
MAXT, MAXA = 160, 12          # lyric tokens (first 160-token window), audio slices (30 s clip, 5 s / 2.5 s hop)
AUDIO_SEQ_LAYER = 6           # the MERT layer the live audio head uses
OUT = "/vol/xmodal"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("torch==2.4.1", "transformers==4.45.2", "nnAudio", "scikit-learn==1.6.1",
                 "numpy<2", "pandas", "scipy")
    .env({"HF_HOME": "/root/hf"})
    .run_commands("python -c \"from huggingface_hub import snapshot_download as s; "
                  "s('m-a-p/MERT-v1-95M', allow_patterns=['*.json', '*.py', '*.txt', '*.bin', '*.safetensors']); "
                  "s('bert-base-cased', allow_patterns=['*.json', '*.txt', 'model.safetensors'])\"")
)
app = modal.App("senti-crossmodal", image=image)
vol = modal.Volume.from_name("senti-finetune")
V = {"/vol": vol}


# ================================================================ analysis helpers (pure numpy / sklearn)

def pearson(a, b):
    import numpy as np
    a, b = np.asarray(a, float), np.asarray(b, float)
    if a.std() < 1e-12 or b.std() < 1e-12: return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def fit_probe(X, y):
    from sklearn.linear_model import RidgeCV
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    import numpy as np
    return make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(-1, 5, 13))).fit(X, y)


def boot_ci(pred, y, n_boot, rng):
    import numpy as np
    if n_boot <= 0: return None
    n = len(y); rs = []
    for _ in range(n_boot):
        i = rng.integers(0, n, n); rs.append(pearson(pred[i], y[i]))
    return [float(np.percentile(rs, 2.5)), float(np.percentile(rs, 97.5))]


def transfer_block(Xt_tr, Xa_tr, Xt_te, Xa_te, y_tr, y_te, n_boot, rng):
    """Within-modality and cross-modal probe r for one target (valence or arousal) in one activation space."""
    import numpy as np
    pt, pa = fit_probe(Xt_tr, y_tr), fit_probe(Xa_tr, y_tr)
    within_t, within_a = pearson(pt.predict(Xt_te), y_te), pearson(pa.predict(Xa_te), y_te)
    t2a_pred, a2t_pred = pt.predict(Xa_te), pa.predict(Xt_te)
    t2a, a2t = pearson(t2a_pred, y_te), pearson(a2t_pred, y_te)
    shuf = fit_probe(Xt_tr, rng.permutation(y_tr))
    ratio = lambda num, den: float(num / den) if den > 0.1 else None   # undefined when the modality can't predict
    r1, r2 = ratio(t2a, within_a), ratio(a2t, within_t)
    return {"within_text": within_t, "within_audio": within_a, "text_to_audio": t2a, "audio_to_text": a2t,
            "text_to_audio_ci": boot_ci(t2a_pred, y_te, n_boot, rng),
            "audio_to_text_ci": boot_ci(a2t_pred, y_te, n_boot, rng),
            "shuffled_text_to_audio": pearson(shuf.predict(Xa_te), y_te),
            "independence": None if r1 is None or r2 is None else (r1 + r2) / 2}


def cca_align(Xt_tr, Xa_tr, Xt_te, Xa_te, n_pca=64, n_cca=16, perm=None):
    """Label-free alignment: PCA each side, then CCA fitted on paired training songs.
    perm: mismatched-pair control. The CCA is fitted on lyrics of song i against audio of song perm[i]; the
    probes are then fitted and tested on correctly paired songs as usual. A real shared space should lose
    transfer under this control; if it doesn't, the alignment alone manufactures the transfer."""
    from sklearn.cross_decomposition import CCA
    from sklearn.decomposition import PCA
    from sklearn.preprocessing import StandardScaler
    st, sa = StandardScaler().fit(Xt_tr), StandardScaler().fit(Xa_tr)
    k = min(n_pca, Xt_tr.shape[1], Xa_tr.shape[1], len(Xt_tr) - 1)
    pt, pa = PCA(k, random_state=0).fit(st.transform(Xt_tr)), PCA(k, random_state=0).fit(sa.transform(Xa_tr))
    T_tr, A_tr = pt.transform(st.transform(Xt_tr)), pa.transform(sa.transform(Xa_tr))
    cca = CCA(n_components=min(n_cca, k), max_iter=2000).fit(T_tr, A_tr if perm is None else A_tr[perm])
    Tc_tr, Ac_tr = cca.transform(T_tr, A_tr)
    Tc_te, Ac_te = cca.transform(pt.transform(st.transform(Xt_te)), pa.transform(sa.transform(Xa_te)))
    return Tc_tr, Ac_tr, Tc_te, Ac_te


def layer_analysis(Xt_tr, Xa_tr, Xt_te, Xa_te, Y_tr, Y_te, n_boot, rng, shared_space=True):
    out = {}
    if shared_space:
        out["raw"] = {t: transfer_block(Xt_tr, Xa_tr, Xt_te, Xa_te, Y_tr[:, j], Y_te[:, j], n_boot, rng)
                      for j, t in enumerate(["valence", "arousal"])}
    c = cca_align(Xt_tr, Xa_tr, Xt_te, Xa_te)
    out["cca"] = {t: transfer_block(*c, Y_tr[:, j], Y_te[:, j], n_boot, rng)
                  for j, t in enumerate(["valence", "arousal"])}
    c = cca_align(Xt_tr, Xa_tr, Xt_te, Xa_te, perm=rng.permutation(len(Xt_tr)))
    out["cca_mismatch"] = {t: transfer_block(*c, Y_tr[:, j], Y_te[:, j], n_boot, rng)
                           for j, t in enumerate(["valence", "arousal"])}
    return out


def split_lyrics(lyrics_csv: bytes):
    import io
    import pandas as pd
    from sklearn.model_selection import train_test_split
    df = pd.read_csv(io.BytesIO(lyrics_csv)).dropna(subset=["lyrics", "valence", "arousal"])
    train_df, temp_df = train_test_split(df, test_size=0.2, random_state=SEED, stratify=df["quadrant"])
    val_df, test_df = train_test_split(temp_df, test_size=0.5, random_state=SEED, stratify=temp_df["quadrant"])
    return {"train": train_df, "val": val_df, "test": test_df}


def slice_starts(n: int) -> list[int]:
    w, h = int(SLICE * SR), int(HOP * SR)
    return [0] if n <= w else list(range(0, n - w + 1, h))


# ================================================================ mid-fusion model

def build_fusion(d=256, n_layers=2):
    import torch
    from torch import nn

    class Fusion(nn.Module):
        def __init__(self):
            super().__init__()
            self.pt, self.pa = nn.Linear(768, d), nn.Linear(768, d)
            self.mt, self.ma = nn.Parameter(torch.randn(d) * .02), nn.Parameter(torch.randn(d) * .02)
            self.post, self.posa = nn.Parameter(torch.zeros(1, MAXT, d)), nn.Parameter(torch.zeros(1, MAXA, d))
            self.cls = nn.Parameter(torch.randn(1, 1, d) * .02)
            self.layers = nn.ModuleList([nn.TransformerEncoderLayer(d, 4, 2 * d, 0.1, batch_first=True,
                                                                    norm_first=True) for _ in range(n_layers)])
            self.norm, self.head = nn.LayerNorm(d), nn.Linear(d, 2)

        def forward(self, T, Tm, A, Am, use_t, use_a, edit=None):
            """edit = (layer_index, fn): fn(x) rewrites the residual stream after that fusion layer.
            Returns predictions and activations: [layer 0 = mean of projected input tokens (pre-fusion),
            then the CLS state after each fusion layer]."""
            B = T.shape[0]
            t = self.pt(T) + self.mt + self.post[:, :T.shape[1]]
            a = self.pa(A) + self.ma + self.posa[:, :A.shape[1]]
            x = torch.cat([self.cls.expand(B, -1, -1), t, a], 1)
            keep = torch.cat([torch.ones(B, 1, dtype=torch.bool, device=T.device),
                              Tm & use_t[:, None], Am & use_a[:, None]], 1)
            k = keep.clone(); k[:, 0] = False
            acts = [(x * k[..., None]).sum(1) / k.sum(1, keepdim=True).clamp(min=1)]
            for li, layer in enumerate(self.layers):
                x = layer(x, src_key_padding_mask=~keep)
                if edit is not None and edit[0] == li: x = edit[1](x)
                acts.append(x[:, 0])
            return self.head(self.norm(x[:, 0])), acts

    return Fusion()


def run_fusion(data: dict, seed: int, cfg: dict, dev, conflict_keys: list[str]) -> dict:
    """Train one seed, then probes, controls and interventions. data[split] = dict of numpy arrays + rows."""
    import copy
    import numpy as np
    import torch
    torch.manual_seed(seed); rng = np.random.default_rng(seed)
    tens = {s: {k: torch.from_numpy(np.asarray(v)) for k, v in data[s].items() if k != "rows"} for s in data}
    Y = {s: np.array([[r["valence"], r["arousal"]] for r in data[s]["rows"]], np.float32) for s in data}

    def batches(s, idx, bs):
        for i in range(0, len(idx), bs):
            j = idx[i:i + bs]
            yield (tens[s]["text_tok"][j].float().to(dev), tens[s]["text_mask"][j].to(dev),
                   tens[s]["audio_seq"][j].float().to(dev), tens[s]["audio_mask"][j].to(dev), j)

    def run(model, s, mode, edit=None, bs=128):
        model.eval(); preds, acts = [], None
        n = len(Y[s]); idx = np.arange(n)
        with torch.no_grad():
            for T, Tm, A, Am, j in batches(s, idx, bs):
                B = len(j)
                ut = torch.full((B,), mode in ("both", "text"), device=dev)
                ua = torch.full((B,), mode in ("both", "audio"), device=dev)
                p, a = model(T, Tm, A, Am, ut, ua, edit)
                preds.append(p.cpu().numpy())
                a = [x.cpu().numpy() for x in a]
                acts = a if acts is None else [np.concatenate([u, v]) for u, v in zip(acts, a)]
        return np.concatenate(preds), acts

    def score(p, y): return (pearson(p[:, 0], y[:, 0]) + pearson(p[:, 1], y[:, 1])) / 2

    model = build_fusion(cfg["d"], cfg["layers"]).to(dev)
    untrained = copy.deepcopy(model)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg["lr"], weight_decay=0.01)
    ytr = torch.from_numpy(Y["train"]).to(dev)
    best, best_state, curve = -9, None, []
    for ep in range(cfg["epochs"]):
        model.train(); perm = rng.permutation(len(Y["train"]))
        for T, Tm, A, Am, j in batches("train", perm, 32):
            r = torch.rand(len(j), device=dev)
            ut, ua = ~(r < cfg["p_drop"]), ~((r >= cfg["p_drop"]) & (r < 2 * cfg["p_drop"]))
            p, _ = model(T, Tm, A, Am, ut, ua)
            loss = torch.nn.functional.mse_loss(p, ytr[j])
            opt.zero_grad(); loss.backward(); opt.step()
        v = score(run(model, "val", "both")[0], Y["val"]); curve.append(v)
        if v > best: best, best_state = v, copy.deepcopy(model.state_dict())
    model.load_state_dict(best_state)
    n_boot = cfg["n_boot"]

    # ---- predictions under each input condition
    preds = {m: run(model, "test", m)[0] for m in ["both", "text", "audio"]}
    perf = {m: {"valence_r": pearson(p[:, 0], Y["test"][:, 0]), "arousal_r": pearson(p[:, 1], Y["test"][:, 1]),
                "valence_mae": float(np.abs(p[:, 0] - Y["test"][:, 0]).mean()),
                "arousal_mae": float(np.abs(p[:, 1] - Y["test"][:, 1]).mean())} for m, p in preds.items()}

    # ---- probe transfer per layer, trained vs untrained network
    probes = {}
    for name, net in [("trained", model), ("untrained", untrained)]:
        acts = {(s, m): run(net, s, m)[1] for s in ["train", "test"] for m in ["text", "audio"]}
        probes[name] = [layer_analysis(acts[("train", "text")][l], acts[("train", "audio")][l],
                                       acts[("test", "text")][l], acts[("test", "audio")][l],
                                       Y["train"], Y["test"], n_boot if name == "trained" else 0, rng)
                        for l in range(len(acts[("train", "text")]))]

    # ---- intervention on the shared valence direction after fusion layer 1 (index 0), all token positions
    L = cfg["edit_layer"]
    tr_t, tr_a = run(model, "train", "text")[1][L + 1], run(model, "train", "audio")[1][L + 1]
    Xs = np.concatenate([tr_t, tr_a]); ys = np.concatenate([Y["train"][:, 0], Y["train"][:, 0]])
    from sklearn.linear_model import RidgeCV
    w = RidgeCV(alphas=np.logspace(-1, 5, 13)).fit(Xs, ys).coef_
    d_val = torch.tensor(w / np.linalg.norm(w), dtype=torch.float32, device=dev)
    sd = float((Xs @ (w / np.linalg.norm(w))).std())

    def ablate(u): return lambda x: x - (x @ u)[..., None] * u
    def steer(u, alpha): return lambda x: x + alpha * sd * u

    def effect(edit_fn, mode):
        p, _ = run(model, "test", mode, (L, edit_fn)); b = preds[mode]; y = Y["test"]
        return {"valence_r": pearson(p[:, 0], y[:, 0]), "arousal_r": pearson(p[:, 1], y[:, 1]),
                "mean_abs_dv": float(np.abs(p[:, 0] - b[:, 0]).mean()),
                "mean_abs_da": float(np.abs(p[:, 1] - b[:, 1]).mean()),
                "mean_dv": float((p[:, 0] - b[:, 0]).mean()), "mean_da": float((p[:, 1] - b[:, 1]).mean())}

    g = torch.Generator().manual_seed(seed)
    rand_dirs = [(lambda r: r / r.norm())(torch.randn(cfg["d"], generator=g)).to(dev) for _ in range(cfg["n_rand"])]
    interv = {}
    for mode in ["both", "text", "audio"]:
        rnd = [effect(ablate(u), mode) for u in rand_dirs]
        interv[mode] = {"ablate_valence_dir": effect(ablate(d_val), mode),
                        "ablate_random_mean": {k: float(np.mean([r[k] for r in rnd])) for k in rnd[0]},
                        "steer_plus2": effect(steer(d_val, 2.0), mode),
                        "steer_minus2": effect(steer(d_val, -2.0), mode)}
    # ablation on conflict songs only (both modalities)
    keys = [f'{r["title"]}|{r["artist"]}' for r in data["test"]["rows"]]
    conf = np.array([k in set(conflict_keys) for k in keys])
    p_abl, _ = run(model, "test", "both", (L, ablate(d_val)))
    conflict = None
    if conf.sum() >= 10:
        y = Y["test"][conf]
        conflict = {"n": int(conf.sum()),
                    "valence_r": pearson(preds["both"][conf, 0], y[:, 0]),
                    "valence_mae": float(np.abs(preds["both"][conf, 0] - y[:, 0]).mean()),
                    "ablated_valence_r": pearson(p_abl[conf, 0], y[:, 0]),
                    "ablated_mean_abs_dv": float(np.abs(p_abl[conf, 0] - preds["both"][conf, 0]).mean())}

    return {"seed": seed, "val_curve": curve, "best_val": best, "performance": perf, "probes": probes,
            "intervention": interv, "edit_layer": L, "conflict_ablation": conflict,
            "test_preds": {m: p.tolist() for m, p in preds.items()}, "test_keys": keys}


# ================================================================ Modal functions

@app.function(gpu="T4", volumes=V, memory=32768, timeout=3600)
def extract(lyrics_csv: bytes) -> dict:
    """Cache, per MERGE song with audio: BERT (Senti's fine-tuned lyrics model) and MERT activations."""
    import json
    import os
    import numpy as np
    import torch
    from torch import nn
    from transformers import AutoModel, BertModel, BertTokenizer, Wav2Vec2FeatureExtractor

    if os.path.exists(f"{OUT}/meta.json"):
        return json.load(open(f"{OUT}/meta.json"))
    splits = split_lyrics(lyrics_csv)
    index = json.load(open("/vol/audio/index.json"))
    dev = torch.device("cuda")

    class VARegressor(nn.Module):
        def __init__(self):
            super().__init__()
            self.bert = BertModel.from_pretrained("bert-base-cased")
            self.drop = nn.Dropout(p=0.3)
            self.out = nn.Linear(self.bert.config.hidden_size, 2)

    tok = BertTokenizer.from_pretrained("bert-base-cased")
    reg = VARegressor(); reg.load_state_dict(torch.load("/vol/va_model_state.bin", map_location="cpu"))
    bert = reg.bert.to(dev).eval()
    proc = Wav2Vec2FeatureExtractor.from_pretrained(MERT, trust_remote_code=True)
    do_norm = bool(getattr(proc, "do_normalize", True))
    mert = AutoModel.from_pretrained(MERT, trust_remote_code=True).to(dev).eval()
    os.makedirs(OUT, exist_ok=True)
    w = int(SLICE * SR); body = MAXT - 2; meta = {}

    for split, items in index.items():
        d = splits[split]; arr = np.load(f"/vol/audio/{split}.npy", mmap_mode="r"); N = len(items)
        text_pool = np.zeros((N, 13, 768), np.float16); audio_pool = np.zeros((N, 13, 768), np.float16)
        text_tok = np.zeros((N, MAXT, 768), np.float16); text_mask = np.zeros((N, MAXT), bool)
        audio_seq = np.zeros((N, MAXA, 768), np.float16); audio_mask = np.zeros((N, MAXA), bool)
        rows = []
        for i, it in enumerate(items):
            r = d.iloc[it["pos"]]
            assert r["title"] == it["title"] and r["artist"] == it["artist"], f"row mismatch at {split} {i}"
            # lyrics: whole song in overlapping 160-token windows (max 8), as the live model reads it
            ids = tok(str(r["lyrics"]), add_special_tokens=False, truncation=False, verbose=False)["input_ids"]
            starts = list(range(0, max(len(ids) - body, 0) + 1, 120))
            if starts[-1] + body < len(ids): starts.append(len(ids) - body)
            win = []
            for s in starts[:8]:
                c = [tok.cls_token_id] + ids[s:s + body] + [tok.sep_token_id]
                win.append(c + [tok.pad_token_id] * (MAXT - len(c)))
            x = torch.tensor(win, device=dev); m = x != tok.pad_token_id
            with torch.no_grad():
                hs = torch.stack(bert(input_ids=x, attention_mask=m.long(), output_hidden_states=True).hidden_states)
            mf = m[None, :, :, None].float()
            text_pool[i] = ((hs * mf).sum(2) / mf.sum(2)).mean(1).cpu().numpy()       # [13, 768]
            n_tok = int(m[0].sum()); text_tok[i, :n_tok] = hs[12, 0, :n_tok].cpu().numpy(); text_mask[i, :n_tok] = True
            # audio: 5 s slices, 2.5 s hop, mean over time within each slice
            y = arr[i, :it["n"]].astype(np.float32)
            sl = [np.pad(y[s:s + w], (0, max(0, w - len(y[s:s + w])))) for s in slice_starts(it["n"])][:MAXA]
            xa = torch.from_numpy(np.stack(sl)).to(dev)
            if do_norm:
                xa = (xa - xa.mean(1, keepdim=True)) / torch.sqrt(xa.var(1, keepdim=True, unbiased=False) + 1e-7)
            with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16):
                ha = torch.stack([s.float().mean(1) for s in mert(xa, output_hidden_states=True).hidden_states])
            if not torch.isfinite(ha).all():                               # fp16 overflow: redo this song in fp32
                with torch.no_grad():
                    ha = torch.stack([s.float().mean(1) for s in mert(xa, output_hidden_states=True).hidden_states])
            assert torch.isfinite(ha).all(), "non-finite MERT activations"
            audio_pool[i] = ha.mean(1).cpu().numpy(); ns = ha.shape[1]
            audio_seq[i, :ns] = ha[AUDIO_SEQ_LAYER].cpu().numpy(); audio_mask[i, :ns] = True
            rows.append({k: (float(it[k]) if k in ("valence", "arousal") else it[k])
                         for k in ("title", "artist", "quadrant", "valence", "arousal")})
        np.savez(f"{OUT}/{split}.npz", text_pool=text_pool, audio_pool=audio_pool, text_tok=text_tok,
                 text_mask=text_mask, audio_seq=audio_seq, audio_mask=audio_mask)
        json.dump(rows, open(f"{OUT}/{split}_rows.json", "w"))
        meta[split] = N
        print(f"{split}: {N} songs")
    json.dump(meta, open(f"{OUT}/meta.json", "w")); vol.commit()
    return meta


def load_split(s, keys):
    import json
    import numpy as np
    z = np.load(f"{OUT}/{s}.npz")
    out = {k: z[k] for k in keys}; out["rows"] = json.load(open(f"{OUT}/{s}_rows.json"))
    return out


@app.function(volumes=V, cpu=8, memory=16384, timeout=3600)
def late(n_boot: int, bert_layers: list[int], mert_layers: list[int]) -> dict:
    """Senti's late-fusion encoders: CCA-aligned probe transfer between BERT layer b and MERT layer m."""
    import numpy as np
    rng = np.random.default_rng(0)
    tr, te = load_split("train", ["text_pool", "audio_pool"]), load_split("test", ["text_pool", "audio_pool"])
    Y = {s: np.array([[r["valence"], r["arousal"]] for r in d["rows"]]) for s, d in [("train", tr), ("test", te)]}
    grid = {}
    for b in bert_layers:
        for m in mert_layers:
            grid[f"bert{b}_mert{m}"] = layer_analysis(
                tr["text_pool"][:, b].astype(np.float32), tr["audio_pool"][:, m].astype(np.float32),
                te["text_pool"][:, b].astype(np.float32), te["audio_pool"][:, m].astype(np.float32),
                Y["train"], Y["test"], n_boot, rng, shared_space=False)
    return grid


@app.function(gpu="T4", volumes=V, memory=32768, timeout=3600)
def fuse(seed: int, cfg: dict, conflict_keys: list[str]) -> dict:
    import torch
    keys = ["text_tok", "text_mask", "audio_seq", "audio_mask"]
    data = {s: load_split(s, keys) for s in ["train", "val", "test"]}
    return run_fusion(data, seed, cfg, torch.device("cuda"), conflict_keys)


@app.function(cpu=2, timeout=600)
def summarise(late_res: dict, fuse_res: list[dict], senti_preds_csv: bytes, conflict_keys: list[str]) -> dict:
    import io
    import numpy as np
    import pandas as pd

    def ms(vals):
        v = [x for x in vals if x is not None]
        return None if not v else [float(np.mean(v)), float(np.std(v))]

    n_layers = len(fuse_res[0]["probes"]["trained"])
    fusion_tab = {}
    for net in ["trained", "untrained"]:
        for space in ["raw", "cca", "cca_mismatch"]:
            for t in ["valence", "arousal"]:
                for l in range(n_layers):
                    blk = [f["probes"][net][l][space][t] for f in fuse_res]
                    fusion_tab[f"{net}|{space}|{t}|L{l}"] = {k: ms([b[k] for b in blk]) for k in
                        ["within_text", "within_audio", "text_to_audio", "audio_to_text",
                         "shuffled_text_to_audio", "independence"]}
                    if net == "trained" and len(blk) == 1:
                        fusion_tab[f"{net}|{space}|{t}|L{l}"]["ci"] = [blk[0]["text_to_audio_ci"],
                                                                      blk[0]["audio_to_text_ci"]]
    interv = {}
    for mode in ["both", "text", "audio"]:
        for kind in ["ablate_valence_dir", "ablate_random_mean", "steer_plus2", "steer_minus2"]:
            interv[f"{mode}|{kind}"] = {k: ms([f["intervention"][mode][kind][k] for f in fuse_res])
                                        for k in fuse_res[0]["intervention"][mode][kind]}
    perf = {m: {k: ms([f["performance"][m][k] for f in fuse_res]) for k in fuse_res[0]["performance"][m]}
            for m in ["both", "text", "audio"]}

    # mean-over-seeds fusion predictions vs Senti's late fusion on the same test songs
    keys = fuse_res[0]["test_keys"]
    P = {m: np.mean([np.array(f["test_preds"][m]) for f in fuse_res], 0) for m in ["both", "text", "audio"]}
    fp = pd.DataFrame({"key": keys, "mid_v": P["both"][:, 0], "mid_a": P["both"][:, 1],
                       "mid_text_v": P["text"][:, 0], "mid_audio_v": P["audio"][:, 0]})
    sp = pd.read_csv(io.BytesIO(senti_preds_csv)); sp["key"] = sp["title"] + "|" + sp["artist"]
    j = sp.merge(fp, on="key", how="inner")
    j["conflict"] = j["key"].isin(set(conflict_keys))
    cols = {"lyrics only (Senti BERT)": "lyrics_v", "audio only (Senti frozen MERT)": "frozen_v",
            "Senti late fusion (live)": "frozen_fused_v", "mid fusion, both": "mid_v",
            "mid fusion, lyrics only": "mid_text_v", "mid fusion, audio only": "mid_audio_v"}

    def tab(df):
        return {name: {"valence_r": float(np.corrcoef(df[c], df["valence"])[0, 1]),
                       "valence_mae": float((df[c] - df["valence"]).abs().mean())} for name, c in cols.items()}
    compare = {"all_test": {"n": len(j), **tab(j)}, "conflict": {"n": int(j["conflict"].sum()), **tab(j[j["conflict"]])}}
    late_sum = {sp: {k: {t: {kk: v[sp][t][kk] for kk in ["within_text", "within_audio", "text_to_audio",
                                                          "audio_to_text", "shuffled_text_to_audio", "independence"]}
                           for t in ["valence", "arousal"]} for k, v in late_res.items()}
                for sp in ["cca", "cca_mismatch"]}
    preds_csv = j[["title", "artist", "quadrant", "valence", "arousal", "conflict", "lyrics_v", "frozen_v",
                   "frozen_fused_v", "mid_v", "mid_a", "mid_text_v", "mid_audio_v"]].to_csv(index=False)
    return {"fusion": fusion_tab, "intervention": interv, "fusion_performance": perf, "late_cca": late_sum,
            "compare": compare, "conflict_ablation": [f["conflict_ablation"] for f in fuse_res],
            "best_val": [f["best_val"] for f in fuse_res], "preds_csv": preds_csv}


def fmt(x, nd=2):
    if x is None: return "n/a"
    if isinstance(x, list): return f"{x[0]:.{nd}f} ± {x[1]:.{nd}f}"
    return f"{x:.{nd}f}"


def report_md(S: dict, late_res: dict, cfg: dict, n_seeds: int) -> str:
    L = []
    L.append(f"# Phase 1 results: cross-modal emotion representations\n\n{n_seeds} seed(s); mean ± sd over seeds. "
             f"Probe r on the MERGE test songs. Config: {cfg}\n")
    L.append("## Mid-fusion model: probe transfer by layer (raw shared space)\n")
    L.append("Layer 0 = mean of projected input tokens before any fusion; layers 1-2 = CLS after each fusion layer.\n")
    for t in ["valence", "arousal"]:
        L.append(f"\n**{t}**\n\n| net | layer | lyrics→lyrics | audio→audio | lyrics→audio | audio→lyrics | shuffled | independence |\n|---|---|---|---|---|---|---|---|")
        for net in ["trained", "untrained"]:
            for l in range(3):
                r = S["fusion"].get(f"{net}|raw|{t}|L{l}")
                if r: L.append(f"| {net} | {l} | {fmt(r['within_text'])} | {fmt(r['within_audio'])} | "
                               f"{fmt(r['text_to_audio'])} | {fmt(r['audio_to_text'])} | "
                               f"{fmt(r['shuffled_text_to_audio'])} | {fmt(r['independence'])} |")
    L.append("\n## Same, after label-free CCA alignment (comparable with late fusion)\n")
    L.append("matched = CCA fitted on correctly paired training songs. mismatched = control: CCA fitted on lyrics of one "
             "song against audio of a random other song; probes still fitted and tested on correct pairs. "
             "Within-modality r is measured inside the 16-d CCA space, so it can be lower than in the raw space.\n")
    for t in ["valence", "arousal"]:
        L.append(f"\n**{t}**\n\n| model / layer | pairing | lyrics→lyrics | audio→audio | lyrics→audio | audio→lyrics | independence |\n|---|---|---|---|---|---|---|")
        rows = [(f"mid fusion L{l}", sp, S["fusion"][f"trained|{sp}|{t}|L{l}"]) for l in range(3)
                for sp in ["cca", "cca_mismatch"]]
        rows += [(f"Senti late {k}", sp, S["late_cca"][sp][k][t]) for k in S["late_cca"]["cca"]
                 for sp in ["cca", "cca_mismatch"]]
        for name, sp, r in rows:
            L.append(f"| {name} | {'matched' if sp == 'cca' else 'mismatched'} | {fmt(r['within_text'])} | "
                     f"{fmt(r['within_audio'])} | {fmt(r['text_to_audio'])} | {fmt(r['audio_to_text'])} | "
                     f"{fmt(r['independence'])} |")
    L.append("\n## Intervention on the shared valence direction (after fusion layer 1)\n")
    L.append("| input | edit | valence r | arousal r | mean abs Δvalence | mean abs Δarousal | mean Δvalence |\n|---|---|---|---|---|---|---|")
    for k, v in S["intervention"].items():
        mode, kind = k.split("|")
        L.append(f"| {mode} | {kind} | {fmt(v['valence_r'])} | {fmt(v['arousal_r'])} | {fmt(v['mean_abs_dv'], 3)} | "
                 f"{fmt(v['mean_abs_da'], 3)} | {fmt(v['mean_dv'], 3)} |")
    L.append("\n## Prediction quality and conflict songs (valence)\n")
    for part in ["all_test", "conflict"]:
        c = S["compare"][part]
        L.append(f"\n**{part}** (n = {c['n']})\n\n| model | valence r | valence MAE |\n|---|---|---|")
        for name, v in c.items():
            if name != "n": L.append(f"| {name} | {fmt(v['valence_r'])} | {fmt(v['valence_mae'], 3)} |")
    L.append(f"\nMid-fusion performance by input: {S['fusion_performance']}\n")
    L.append(f"\nConflict-song ablation per seed: {S['conflict_ablation']}\n")
    return "\n".join(L)


@app.local_entrypoint()
def main(lyrics: str, preds: str = "data/finetune/merge_test_predictions.csv", out: str = "research/results",
         trial: bool = False, seeds: int = 3):
    import csv
    import json
    import os
    os.makedirs(out, exist_ok=True)
    print("extract:", extract.remote(open(os.path.expanduser(lyrics), "rb").read()))

    # conflict songs: top quarter of |lyrics-only valence - audio-only valence| among Senti's test predictions
    rows = list(csv.DictReader(open(preds)))
    gaps = sorted(((abs(float(r["lyrics_v"]) - float(r["frozen_v"])), f'{r["title"]}|{r["artist"]}') for r in rows),
                  reverse=True)
    conflict = [k for _, k in gaps[:len(gaps) // 4]]
    print(f"conflict songs: {len(conflict)} (gap ≥ {gaps[len(gaps) // 4 - 1][0]:.2f})")

    cfg = {"d": 256, "layers": 2, "lr": 3e-4, "epochs": 2 if trial else 40, "p_drop": 0.25,
           "n_boot": 100 if trial else 1000, "n_rand": 5 if trial else 20, "edit_layer": 0}
    n = 1 if trial else seeds
    late_call = late.spawn(cfg["n_boot"], [0, 4, 8, 12], [0, 3, 6, 9, 12])
    fuse_res = list(fuse.starmap([(s, cfg, conflict) for s in range(n)]))
    late_res = late_call.get()
    S = summarise.remote(late_res, fuse_res, open(preds, "rb").read(), conflict)
    tag = "_trial" if trial else ""
    open(f"{out}/phase1_test_predictions{tag}.csv", "w").write(S.pop("preds_csv"))
    json.dump({"cfg": cfg, "summary": S, "late_full": late_res,
               "per_seed": [{k: v for k, v in f.items() if k not in ("test_preds", "test_keys")} for f in fuse_res]},
              open(f"{out}/phase1_results{tag}.json", "w"), indent=1)
    md = report_md(S, late_res, cfg, n)
    open(f"{out}/phase1_report{tag}.md", "w").write(md)
    print(md)
