"""CLaMP 3 SAE feature matching and lyrics<-audio feature transplant.

Same CLaMP 3 setup as research/clamp3_tests.py (MIT code and weights, pinned commit, their MERT feature recipe) and
the same seed-42 MERGE split (train songs for fitting, test songs for evaluation; validation songs are not used).

1. Activations. Text tower (XLM-R) hidden states after layers 6 and 10 for every lyric token (CLaMP 3's 128-token
   segments, at most 4 segments = 512 tokens per song); audio tower (12-layer BERT over 5 s MERT windows) hidden
   states after layers 6 and 10 for every window (the zero pad vectors at both ends are excluded). Stored fp16 on the
   Modal volume (/vol/clamp3_sae), with the final CLaMP 3 embeddings.
2. One TopK SAE per layer, trained on train-split tokens/frames (inputs scaled to unit mean squared norm per dim).
   Text: 4,096 features, k = 32. Audio: there are only ~6 windows per song (~12k train frames), so 1,024 features,
   k = 16. Reports fraction of variance unexplained (test tokens/frames) and dead-feature fraction.
3. Song-level feature activation = mean over tokens/frames. Text features are matched to audio features by Pearson r
   across train songs (paired), among features active in >= 5% of train songs. Null threshold = max |r| over all
   pairs after shuffling the song pairing (5 shuffles). Emotion relevance of a pair = max over axes of
   min(|r(text, axis)|, |r(audio, axis)|); "emotion-relevant" if >= 0.2. Beyond-label control: partial r after
   regressing both features on (valence, arousal, quadrant one-hot), against a null threshold computed the same way.
4. Transplant on test songs: for a pair (text j, audio m), fit text_j = a + b * audio_m on train songs; for each test
   song add (a + b * audio_m(song) - text_j(song)) * decoder_j to every token at text layer L, run the rest of the
   tower, and measure the change in the lyrics-only predictions: zero-shot prompt score and a ridge probe on the final
   lyrics embedding (fit on train). "Signed shift" = change x sign(r(text_j, axis)) x sign(injected amount): positive
   means the prediction moved the way the feature's label correlation says it should. Baseline: 20 random alive text
   features at the same layer with the same per-song injection amounts. Boost test: +/- 2 sd of the top
   valence-matched text feature.
5. Conflict songs (top quartile of |zero-shot lyrics valence - zero-shot audio valence| among test songs): transplant
   the top emotion pairs together and compare valence MAE and r of the lyrics probe before/after, against 20 random
   5-feature transplants with the same amounts.

    modal run research/clamp3_sae.py --lyrics ~/taildrop-in/va_lyrics.csv [--trial]

Lyrics are read in memory only. Written: activations/SAEs on the Modal volume; numbers to research/results/.
"""

import modal

SEED = 42
SR, WIN = 24000, 5
CLAMP3_COMMIT = "9016d2b0c8d12d1aa79c2e0ab201e6822bdc83a8"
CKPT = ("weights_clamp3_saas_h_size_768_t_model_FacebookAI_xlm-roberta-base_t_length_128_a_size_768_a_layers_12_"
        "a_length_128_s_size_768_s_layers_12_p_size_64_p_length_512.pth")
OUT = "/vol/clamp3_sae"
TL, AL = [6, 10], [6, 10]           # text / audio tower layers (hidden_states index = output of that layer)
MAX_SEGS = 4

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
app = modal.App("senti-clamp3-sae", image=image)
vol = modal.Volume.from_name("senti-finetune")


def split_lyrics(lyrics_csv: bytes):
    import io
    import pandas as pd
    from sklearn.model_selection import train_test_split
    df = pd.read_csv(io.BytesIO(lyrics_csv)).dropna(subset=["lyrics", "valence", "arousal"])
    train_df, temp_df = train_test_split(df, test_size=0.2, random_state=SEED, stratify=df["quadrant"])
    val_df, test_df = train_test_split(temp_df, test_size=0.5, random_state=SEED, stratify=temp_df["quadrant"])
    return {"train": train_df, "val": val_df, "test": test_df}


@app.function(gpu="T4", volumes={"/vol": vol}, memory=49152, timeout=3 * 3600)
def run(lyrics_csv: bytes, trial: bool) -> dict:
    import io
    import json
    import os
    import re
    import sys
    import zipfile
    import numpy as np
    import pandas as pd
    import torch
    from torch import nn
    from sklearn.linear_model import RidgeCV
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    torch.manual_seed(0); rng = np.random.default_rng(0)
    tag = "trial" if trial else "full"
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
    model.load_state_dict(torch.load(CKPT, map_location="cpu", weights_only=True)["model"])
    model = model.to(dev).eval()
    tok = AutoTokenizer.from_pretrained(TEXT_MODEL_NAME)
    T = MAX_TEXT_LENGTH

    # ------------------------------------------------------------------ text segments (their segmentation)
    def segments(text: str):
        lines = list(dict.fromkeys(l for l in text.split("\n") if l.strip()))
        ids = tok(tok.sep_token.join(lines), return_tensors="pt")["input_ids"].squeeze(0)
        segs = [ids[i:i + T] for i in range(0, len(ids), T)]
        segs[-1] = ids[-T:]
        full, rem = len(ids) // T, len(ids) % T
        w = [T] * full + ([rem] if rem else [])
        segs, w = segs[:MAX_SEGS], w[:MAX_SEGS]
        X = torch.full((len(segs), T), tok.pad_token_id, dtype=torch.long); M = torch.zeros(len(segs), T)
        for i, s in enumerate(segs): X[i, :len(s)] = s; M[i, :len(s)] = 1
        return X, M, torch.tensor(w, dtype=torch.float)

    hooks_state = {"add": {}}                         # layer -> tensor [B, 768] added to every token of that layer

    def make_hook(layer):
        def hook(mod, inp, out):
            v = hooks_state["add"].get(layer)
            if v is None: return out
            return (out[0] + v[:, None, :].to(out[0].dtype),) + tuple(out[1:])
        return hook
    for L in TL:
        model.text_model.encoder.layer[L - 1].register_forward_hook(make_hook(L))

    @torch.no_grad()
    def text_forward(X, M, want_hidden=False):
        o = model.text_model(X.to(dev), attention_mask=M.to(dev), output_hidden_states=want_hidden)
        h = o["last_hidden_state"]; m = M.to(dev)[..., None]
        g = model.text_proj((h * m).sum(1) / m.sum(1))
        return g, (o["hidden_states"] if want_hidden else None)

    def pooled(g, w):                                  # length-weighted mean over a song's segments
        return (g * w.to(dev)[:, None]).sum(0) / w.sum()

    # ------------------------------------------------------------------ 1. collect activations
    splits = split_lyrics(lyrics_csv)
    index = json.load(open("/vol/audio/index.json"))
    lim = {"train": 60, "test": 30} if trial else {}
    os.makedirs(OUT, exist_ok=True)
    cache = f"{OUT}/{tag}_acts.npz"
    seg_store = {}                                    # split -> list of (X, M, w) per song (in memory only)
    for split in ["train", "test"]:
        d = splits[split]; items = index[split][:lim.get(split, len(index[split]))]
        seg_store[split] = [segments(str(d.iloc[it["pos"]]["lyrics"])) for it in items]
        for it in items:
            r = d.iloc[it["pos"]]
            assert r["title"] == it["title"] and r["artist"] == it["artist"]
    if os.path.exists(cache):
        C = dict(np.load(cache, allow_pickle=True)); meta = json.load(open(f"{OUT}/{tag}_meta.json"))
    else:
        mert = HuBERTFeature("m-a-p/MERT-v1-95M", SR, force_half=False, processor_normalize=True).to(dev).eval()
        C, meta = {}, {}
        for split in ["train", "test"]:
            items = index[split][:lim.get(split, len(index[split]))]
            arr = np.load(f"/vol/audio/{split}.npy", mmap_mode="r")
            tok_acts = {L: [] for L in TL}; t_off = [0]; aud_acts = {L: [] for L in AL}; a_off = [0]
            emb_l, emb_a, rows = [], [], []
            for i, it in enumerate(items):
                X, M, w = seg_store[split][i]
                g, hs = text_forward(X, M, want_hidden=True)
                emb_l.append(pooled(g, w).cpu().numpy())
                mb = M.bool()
                for L in TL: tok_acts[L].append(hs[L][mb.to(dev)].half().cpu().numpy())
                t_off.append(t_off[-1] + int(mb.sum()))
                # audio
                y = torch.from_numpy(np.asarray(arr[i, :it["n"]], np.float32))
                y = (y - y.mean()) / torch.sqrt(y.var(unbiased=False) + 1e-7)
                ch = [y[j:j + SR * WIN] for j in range(0, len(y), SR * WIN)]
                if len(ch) > 1 and len(ch[-1]) < SR: ch = ch[:-1]
                with torch.no_grad():
                    f = torch.cat([mert(c[None].to(dev), layer=None, reduction="mean") for c in ch], 1).mean(0)
                    f = torch.cat([torch.zeros(1, 768, device=dev), f, torch.zeros(1, 768, device=dev)], 0)[:MAX_AUDIO_LENGTH]
                    am = torch.ones(1, len(f), device=dev)
                    oa = model.audio_model(inputs_embeds=f[None], attention_mask=am, output_hidden_states=True)
                    emb_a.append(model.audio_proj(oa["last_hidden_state"].mean(1))[0].cpu().numpy())
                for L in AL: aud_acts[L].append(oa["hidden_states"][L][0, 1:-1].half().cpu().numpy())
                a_off.append(a_off[-1] + len(f) - 2)
                rows.append({k: it[k] for k in ("title", "artist", "quadrant")} |
                            {"valence": float(it["valence"]), "arousal": float(it["arousal"])})
            for L in TL: C[f"{split}_text_L{L}"] = np.concatenate(tok_acts[L])
            for L in AL: C[f"{split}_audio_L{L}"] = np.concatenate(aud_acts[L])
            C[f"{split}_text_off"], C[f"{split}_audio_off"] = np.array(t_off), np.array(a_off)
            C[f"{split}_emb_lyrics"], C[f"{split}_emb_audio"] = np.stack(emb_l), np.stack(emb_a)
            meta[split] = rows
            print(f"{split}: {len(rows)} songs, {t_off[-1]} tokens, {a_off[-1]} audio frames", flush=True)
        np.savez(cache, **C); json.dump(meta, open(f"{OUT}/{tag}_meta.json", "w")); vol.commit()
        del mert; torch.cuda.empty_cache()

    # ------------------------------------------------------------------ 2. TopK SAEs
    class SAE(nn.Module):
        def __init__(self, d, n, k, mean, scale):
            super().__init__()
            self.k, self.scale = k, scale
            self.b_dec = nn.Parameter(torch.tensor(mean / scale, dtype=torch.float))
            Wd = torch.randn(d, n); Wd /= Wd.norm(dim=0, keepdim=True)
            self.W_dec = nn.Parameter(Wd); self.W_enc = nn.Parameter(Wd.T.clone()); self.b_enc = nn.Parameter(torch.zeros(n))

        def encode(self, x):                          # x raw activations -> sparse codes
            pre = (x / self.scale - self.b_dec) @ self.W_enc.T + self.b_enc
            v, i = pre.topk(self.k, dim=-1)
            return torch.zeros_like(pre).scatter_(-1, i, v.relu())

        def decode(self, z):
            return (z @ self.W_dec.T + self.b_dec) * self.scale

    def train_sae(Xtr, Xte, n, k, steps, bs):
        Xtr_t = torch.from_numpy(Xtr).to(dev)          # fp16 on GPU
        mean = Xtr.astype(np.float32).mean(0)
        scale = float(np.sqrt(((Xtr[:200000].astype(np.float32) - mean) ** 2).sum(1).mean() / Xtr.shape[1]))
        sae = SAE(Xtr.shape[1], n, k, mean, scale).to(dev)
        opt = torch.optim.Adam(sae.parameters(), lr=4e-4)
        for s in range(steps):
            x = Xtr_t[torch.randint(0, len(Xtr_t), (bs,), device=dev)].float()
            loss = ((sae.decode(sae.encode(x)) - x) ** 2).sum(1).mean() / scale ** 2
            opt.zero_grad(); loss.backward(); opt.step()
            with torch.no_grad(): sae.W_dec /= sae.W_dec.norm(dim=0, keepdim=True)
        with torch.no_grad():
            xe = torch.from_numpy(Xte[:100000]).to(dev).float()
            z = torch.cat([sae.encode(xe[j:j + 8192]) for j in range(0, len(xe), 8192)])
            rec = torch.cat([sae.decode(z[j:j + 8192]) for j in range(0, len(z), 8192)])
            fvu = float(((rec - xe) ** 2).sum() / ((xe - xe.mean(0)) ** 2).sum())
            dead = float(((z > 0).sum(0) == 0).float().mean())
        del Xtr_t; torch.cuda.empty_cache()
        return sae.eval(), {"fvu_test": fvu, "dead_frac_test": dead, "n_features": n, "k": k, "steps": steps,
                            "train_rows": int(len(Xtr)), "scale": scale}

    steps = 300 if trial else 4000
    saes, sae_stats = {}, {}
    sae_cache = f"{OUT}/{tag}_saes.pt"
    if os.path.exists(sae_cache):
        ck = torch.load(sae_cache, map_location="cpu")
        sae_stats = ck["stats"]
        for key, sd in ck["state"].items():
            mod, L = key.split("_L"); L = int(L); st = sae_stats[key]
            s_ = SAE(768, st["n_features"], st["k"], np.zeros(768, np.float32), st["scale"])
            s_.load_state_dict(sd); saes[(mod, L)] = s_.to(dev).eval()
    else:
        for L in TL:
            saes[("text", L)], sae_stats[f"text_L{L}"] = train_sae(C[f"train_text_L{L}"], C[f"test_text_L{L}"], 4096, 32, steps, 4096)
            print("SAE", L, "text", sae_stats[f"text_L{L}"], flush=True)
        for L in AL:
            saes[("audio", L)], sae_stats[f"audio_L{L}"] = train_sae(C[f"train_audio_L{L}"], C[f"test_audio_L{L}"], 1024, 16, steps, 1024)
            print("SAE", L, "audio", sae_stats[f"audio_L{L}"], flush=True)
        torch.save({"stats": sae_stats, "state": {f"{m}_L{L}": s_.state_dict() for (m, L), s_ in saes.items()}}, sae_cache)
        vol.commit()

    @torch.no_grad()
    def song_feats(split, mod, L):
        X = C[f"{split}_{mod}_L{L}"]; off = C[f"{split}_{mod}_off"]; sae = saes[(mod, L)]
        out = []
        for a, b in zip(off[:-1], off[1:]):
            out.append(sae.encode(torch.from_numpy(X[a:b]).to(dev).float()).mean(0).cpu().numpy())
        return np.stack(out)

    F = {(s, m, L): song_feats(s, m, L) for s in ["train", "test"] for m, Ls in [("text", TL), ("audio", AL)] for L in Ls}
    Y = {s: np.array([[r["valence"], r["arousal"]] for r in meta[s]]) for s in ["train", "test"]}
    Qd = {s: pd.get_dummies(pd.Series([r["quadrant"] for r in meta[s]])).reindex(columns=["Q1", "Q2", "Q3", "Q4"],
                                                                                   fill_value=0).values[:, 1:].astype(float)
          for s in ["train", "test"]}

    # ------------------------------------------------------------------ 3. matching
    def concat(mod, Ls, split):
        mats = [F[(split, mod, L)] for L in Ls]
        ids = [(L, j) for L, m_ in zip(Ls, mats) for j in range(m_.shape[1])]
        return np.concatenate(mats, 1), ids
    Ttr, tid = concat("text", TL, "train"); Atr, aid = concat("audio", AL, "train")
    alive_t = ((Ttr > 0).mean(0) >= 0.05); alive_a = ((Atr > 0).mean(0) >= 0.05)
    ti, ai = np.where(alive_t)[0], np.where(alive_a)[0]
    z = lambda M_: (M_ - M_.mean(0)) / (M_.std(0) + 1e-9)
    Zt, Za = z(Ttr[:, ti]), z(Atr[:, ai]); n = len(Zt)
    R = Zt.T @ Za / n
    null = max(np.abs(Zt.T @ Za[rng.permutation(n)] / n).max() for _ in range(5))
    D = np.c_[np.ones(n), Y["train"], Qd["train"]]
    resid = lambda M_: M_ - D @ np.linalg.lstsq(D, M_, rcond=None)[0]
    Zt_r, Za_r = z(resid(Ttr[:, ti])), z(resid(Atr[:, ai]))
    Rp = Zt_r.T @ Za_r / n
    null_p = max(np.abs(Zt_r.T @ Za_r[rng.permutation(n)] / n).max() for _ in range(5))
    Yz = z(Y["train"])
    rt_lab, ra_lab = Zt.T @ Yz / n, Za.T @ Yz / n          # [nt, 2], [na, 2]
    above = np.abs(R) > null
    emo = np.maximum(np.minimum(np.abs(rt_lab[:, None, 0]), np.abs(ra_lab[None, :, 0])),
                     np.minimum(np.abs(rt_lab[:, None, 1]), np.abs(ra_lab[None, :, 1])))
    survive = np.abs(Rp) > null_p
    match = {"alive_text": int(len(ti)), "alive_audio": int(len(ai)), "null_threshold_r": float(null),
             "null_threshold_partial_r": float(null_p), "pairs_above_null": int(above.sum()),
             "pairs_above_null_emotion_relevant": int((above & (emo >= 0.2)).sum()),
             "pairs_above_null_surviving_beyond_label": int((above & survive).sum()),
             "pairs_above_null_emotion_relevant_and_surviving": int((above & (emo >= 0.2) & survive).sum()),
             "text_features_with_a_match_above_null": int(above.any(1).sum())}

    # best audio match per text feature, ranked
    best_a = np.abs(R).argmax(1); best_r = R[np.arange(len(ti)), best_a]
    pairs = []
    for u in np.argsort(-np.abs(best_r)):
        v = best_a[u]
        if abs(best_r[u]) <= (0.0 if trial else null): break      # trial: exercise the code paths anyway
        pairs.append({"text": tid[ti[u]], "audio": aid[ai[v]], "u": int(u), "v": int(v), "r": float(R[u, v]),
                      "partial_r": float(Rp[u, v]), "survives_beyond_label": bool(survive[u, v]),
                      "emotion_relevance": float(emo[u, v]),
                      "r_text_valence": float(rt_lab[u, 0]), "r_text_arousal": float(rt_lab[u, 1]),
                      "r_audio_valence": float(ra_lab[v, 0]), "r_audio_arousal": float(ra_lab[v, 1])})

    # tags for top pairs from MERGE metadata
    zf = zipfile.ZipFile("/vol/merge/MERGE_Audio_Complete.zip")
    md = pd.read_csv(io.BytesIO(zf.read("MERGE_Audio_Complete/merge_audio_complete_metadata.csv")))
    norm = lambda s: re.sub(r"\s+", " ", str(s).strip().lower())
    md["key"] = md["Title"].map(norm) + "|" + md["Artist"].map(norm); md = md.drop_duplicates("key").set_index("key")
    keys = [norm(r["title"]) + "|" + norm(r["artist"]) for r in meta["train"]]
    tags = {c: [set(t.strip() for t in str(md.loc[k, c]).split(",") if t.strip() and t.strip() != "nan")
                if k in md.index else set() for k in keys] for c in ["Moods", "Themes", "Styles", "Genres"]}
    train_artists = np.array([norm(r["artist"]) for r in meta["train"]])

    def top_tags(col_vals, kmax=3, top=40):
        idx = np.argsort(-col_vals)[:top]; out = {}
        for c, sets in tags.items():
            base = pd.Series([t for s in sets for t in s]).value_counts() / len(sets)
            hit = pd.Series([t for i in idx for t in sets[i]]).value_counts() / len(idx)
            lift = (hit / base).dropna()
            lift = lift[hit.reindex(lift.index) * len(idx) >= 4].sort_values(ascending=False)
            out[c] = [f"{t} ({lift[t]:.1f}x)" for t in lift.index[:kmax]]
        vc = pd.Series(train_artists[idx]).value_counts()
        out["Artist"] = [f"top artist {vc.iloc[0]}/{top} songs, {len(vc)} distinct artists"]
        return out
    for p in pairs[:15]:
        p["text_top_tags"] = top_tags(Ttr[:, ti[p["u"]]])

    # ------------------------------------------------------------------ 4. transplant on test songs
    prompt_emb = {}
    for k, ps in PROMPTS.items():
        e = []
        for p in ps:
            X, M, w = segments(p); g, _ = text_forward(X, M); e.append(pooled(g, w).cpu().numpy())
        e = np.stack(e); e /= np.linalg.norm(e, axis=1, keepdims=True); m_ = e.mean(0); prompt_emb[k] = m_ / np.linalg.norm(m_)
    Dzs = np.stack([prompt_emb["valence_pos"] - prompt_emb["valence_neg"], prompt_emb["arousal_pos"] - prompt_emb["arousal_neg"]], 1)
    unit = lambda E_: E_ / np.linalg.norm(E_, axis=-1, keepdims=True)
    probes = [make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(-1, 5, 13))).fit(unit(C["train_emb_lyrics"]), Y["train"][:, j])
              for j in range(2)]

    def predict(E_):
        U = unit(E_)
        return {"probe": np.stack([p.predict(U) for p in probes], 1), "zeroshot": U @ Dzs}

    test_segs = seg_store["test"]; nte = len(test_segs)
    seg_X = torch.cat([s[0] for s in test_segs]); seg_M = torch.cat([s[1] for s in test_segs])
    seg_song = np.concatenate([[i] * len(s[0]) for i, s in enumerate(test_segs)])
    seg_w = torch.cat([s[2] for s in test_segs])

    @torch.no_grad()
    def lyrics_pass(add_per_song):
        """add_per_song: {layer: np.array [n_test, 768]} added to every token of that layer."""
        G = []
        for a in range(0, len(seg_X), 64):
            sl = slice(a, a + 64)
            hooks_state["add"] = {L: torch.from_numpy(v[seg_song[sl]]).float().to(dev) for L, v in add_per_song.items()}
            g, _ = text_forward(seg_X[sl], seg_M[sl]); G.append(g)
        hooks_state["add"] = {}
        G = torch.cat(G); out = np.zeros((nte, G.shape[1]), np.float32)
        for i in range(nte):
            m_ = seg_song == i; out[i] = pooled(G[torch.from_numpy(m_).to(dev)], seg_w[torch.from_numpy(m_)]).cpu().numpy()
        return predict(out)

    base = lyrics_pass({})
    Tte = {L: F[("test", "text", L)] for L in TL}; Ate = {L: F[("test", "audio", L)] for L in AL}

    def dec_dir(L, j):
        s = saes[("text", L)]
        return (s.W_dec[:, j] * s.scale).detach().cpu().numpy()

    def boot_ci(x, nb=2000):
        x = np.asarray(x); m = [x[rng.integers(0, len(x), len(x))].mean() for _ in range(nb)]
        return [float(x.mean()), float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))]

    def effect(pred, delta, sgn):
        """mean |Δ| per axis/readout and signed shift (Δ * sign of feature-label r * sign of injected amount)."""
        out = {}
        for ro in ["probe", "zeroshot"]:
            d = pred[ro] - base[ro]
            for j, ax in enumerate(["valence", "arousal"]):
                out[f"{ro}_{ax}_abs"] = float(np.abs(d[:, j]).mean())
                out[f"{ro}_{ax}_signed"] = boot_ci(d[:, j] * sgn[j] * np.sign(delta))
        return out

    def transplant_amounts(p):
        (Lt, jt), (La, ja) = p["text"], p["audio"]
        xa, xt = F[("train", "audio", La)][:, ja], F[("train", "text", Lt)][:, jt]
        b, a = np.polyfit(xa, xt, 1)
        return (a + b * Ate[La][:, ja]) - Tte[Lt][:, jt]

    n_rand = 3 if trial else 20
    emo_pairs = sorted([p for p in pairs if p["emotion_relevance"] >= 0.2], key=lambda p: -p["emotion_relevance"])
    non_pairs = [p for p in pairs if p["emotion_relevance"] < 0.1]
    if trial:
        emo_pairs = sorted(pairs, key=lambda p: -p["emotion_relevance"])[:2]
        non_pairs = sorted(pairs, key=lambda p: p["emotion_relevance"])[:2]
    sel = [("emotion", p) for p in emo_pairs[:5]] + [("non-emotion", p) for p in non_pairs[:5]]
    alive_by_layer = {L: [tid[x][1] for x in ti if tid[x][0] == L] for L in TL}
    lab_r_text = {tid[x]: rt_lab[k] for k, x in enumerate(ti)}
    trans = []
    for kind, p in sel:
        Lt, jt = p["text"]; delta = transplant_amounts(p)
        sgn = np.sign(lab_r_text[(Lt, jt)])
        pred = lyrics_pass({Lt: delta[:, None] * dec_dir(Lt, jt)[None]})
        eff = effect(pred, delta, sgn)
        rnd = []
        for jr in rng.choice(alive_by_layer[Lt], n_rand, replace=False):
            pr = lyrics_pass({Lt: delta[:, None] * dec_dir(Lt, jr)[None]})
            rnd.append(effect(pr, delta, np.sign(lab_r_text[(Lt, jr)])))
        rs = {}
        for key in eff:
            vals = [r_[key] if isinstance(r_[key], float) else r_[key][0] for r_ in rnd]
            rs[key] = {"mean": float(np.mean(vals)), "p95": float(np.percentile(vals, 95)), "p5": float(np.percentile(vals, 5))}
        trans.append({"kind": kind, "text": p["text"], "audio": p["audio"], "r": p["r"],
                      "survives_beyond_label": p["survives_beyond_label"], "emotion_relevance": p["emotion_relevance"],
                      "mean_abs_injection": float(np.abs(delta).mean()), "effect": eff, "random": rs})
        print("transplant", kind, p["text"], flush=True)

    # boost: top valence-matched text feature
    boost = None
    val_pairs = sorted(emo_pairs, key=lambda p: -abs(p["r_text_valence"]))
    if val_pairs:
        p = val_pairs[0]; Lt, jt = p["text"]; sd = float(F[("train", "text", Lt)][:, jt].std())
        boost = {"text": p["text"], "r_text_valence": p["r_text_valence"], "r_text_arousal": p["r_text_arousal"], "sd": sd}
        for sgn_, nm in [(2, "+2sd"), (-2, "-2sd")]:
            pr = lyrics_pass({Lt: np.tile(sgn_ * sd * dec_dir(Lt, jt), (nte, 1))})
            boost[nm] = {f"{ro}_{ax}_mean_delta": float((pr[ro] - base[ro])[:, j].mean())
                         for ro in ["probe", "zeroshot"] for j, ax in enumerate(["valence", "arousal"])}

    # ------------------------------------------------------------------ 4b. controls on the top emotion pair
    controls = None
    cp = (emo_pairs or pairs or [None])[0]
    if cp is not None:
        Lt, jt = cp["text"]; La, ja = cp["audio"]
        def song_mean(split, mod, L):
            X = C[f"{split}_{mod}_L{L}"]; off = C[f"{split}_{mod}_off"]
            return np.stack([X[a:b].astype(np.float32).mean(0) for a, b in zip(off[:-1], off[1:])])
        Htr, Hte = song_mean("train", "text", Lt), song_mean("test", "text", Lt)
        Gtr, Gte = song_mean("train", "audio", La), song_mean("test", "audio", La)
        delta = transplant_amounts(cp); dvec = dec_dir(Lt, jt)
        sV = np.sign(delta) * np.sign(cp["r_text_valence"])           # expected valence direction per song
        v_sae = delta[:, None] * dvec[None]
        # wrong-song: the audio-implied amount from a random other test song
        perm = rng.permutation(nte)
        while (perm == np.arange(nte)).any(): perm = rng.permutation(nte)
        xa, xt = F[("train", "audio", La)][:, ja], F[("train", "text", Lt)][:, jt]
        b_, a_ = np.polyfit(xa, xt, 1)
        delta_w = (a_ + b_ * Ate[La][perm, ja]) - Tte[Lt][:, jt]
        v_wrong = delta_w[:, None] * dvec[None]
        # linear-map stitching: ridge from song-mean audio (layer La) to song-mean text (layer Lt), train pairs
        sc = StandardScaler().fit(Gtr)
        mp = RidgeCV(alphas=np.logspace(-1, 5, 13)).fit(sc.transform(Gtr), Htr)
        map_r2 = float(mp.score(sc.transform(Gte), Hte))
        diff = mp.predict(sc.transform(Gte)) - Hte                    # audio-implied minus actual, text space
        vp = RidgeCV(alphas=np.logspace(-1, 5, 13)).fit(Htr - Htr.mean(0), Y["train"][:, 0])
        uV = vp.coef_ / np.linalg.norm(vp.coef_)                      # valence direction in text-layer space
        v_map_val = (diff @ uV)[:, None] * uV[None]
        v_map_full = diff
        # mean-difference: happy minus sad prompts, song-mean activation at layer Lt, equal per-song norm to SAE
        def prompt_mean(ps):
            out = []
            for p_ in ps:
                X, M, w = segments(p_); _, hs = text_forward(X, M, want_hidden=True)
                out.append(hs[Lt][M.bool().to(dev)].float().mean(0).cpu().numpy())
            return np.mean(out, 0)
        mdir = prompt_mean(PROMPTS["valence_pos"]) - prompt_mean(PROMPTS["valence_neg"]); mdir /= np.linalg.norm(mdir)
        norm_sae = np.linalg.norm(v_sae, axis=1)
        v_md = (sV * norm_sae)[:, None] * mdir[None]
        # map-valence also signed against the same expected direction, for comparability we keep its own amounts
        zsA = unit(C["test_emb_audio"]) @ Dzs[:, 0]; zsL = base["zeroshot"][:, 0]; gapAL = zsA - zsL
        def summarise(v, sign=sV):
            pr = lyrics_pass({Lt: v}); dV = pr["probe"][:, 0] - base["probe"][:, 0]; dA = pr["probe"][:, 1] - base["probe"][:, 1]
            idx = [rng.integers(0, nte, nte) for _ in range(1000)]
            tw = [float(np.corrcoef(dV[i], gapAL[i])[0, 1]) for i in idx]
            return {"signed_dV": boot_ci(dV * sign), "signed_dA_same_sign": boot_ci(dA * sign),
                    "abs_dV": float(np.abs(dV).mean()), "abs_dA": float(np.abs(dA).mean()),
                    "toward_audio_r": [float(np.corrcoef(dV, gapAL)[0, 1]), float(np.percentile(tw, 2.5)), float(np.percentile(tw, 97.5))],
                    "mean_injection_norm": float(np.linalg.norm(v, axis=1).mean())}
        meth = {"SAE transplant": (v_sae, sV), "wrong-song SAE transplant": (v_wrong, np.sign(delta_w) * np.sign(cp["r_text_valence"])),
                "linear map, valence component": (v_map_val, np.sign(diff @ uV)),
                "linear map, full difference": (v_map_full, np.sign(diff @ uV)),
                "linear map, valence component (equal norm to SAE)": ((np.sign(diff @ uV) * norm_sae)[:, None] * uV[None], np.sign(diff @ uV)),
                "mean-diff prompt direction (equal norm)": (v_md, sV)}
        controls = {"pair": {"text": cp["text"], "audio": cp["audio"], "r": cp["r"]}, "map_test_r2": map_r2,
                    "alpha1": {k: summarise(v, sg) for k, (v, sg) in meth.items()}, "dose": {}}
        rnd_tab = []
        for jr in rng.choice(alive_by_layer[Lt], n_rand, replace=False):
            r_ = summarise(delta[:, None] * dec_dir(Lt, jr)[None], np.sign(delta) * np.sign(lab_r_text[(Lt, jr)][0]))
            rnd_tab.append(r_)
        controls["alpha1"]["random features, same amounts (mean over draws)"] = {
            "signed_dV": [float(np.mean([r_["signed_dV"][0] for r_ in rnd_tab])), float(np.percentile([r_["signed_dV"][0] for r_ in rnd_tab], 5)), float(np.percentile([r_["signed_dV"][0] for r_ in rnd_tab], 95))],
            "signed_dA_same_sign": [float(np.mean([r_["signed_dA_same_sign"][0] for r_ in rnd_tab])), float(np.percentile([r_["signed_dA_same_sign"][0] for r_ in rnd_tab], 5)), float(np.percentile([r_["signed_dA_same_sign"][0] for r_ in rnd_tab], 95))],
            "abs_dV": float(np.mean([r_["abs_dV"] for r_ in rnd_tab])), "abs_dA": float(np.mean([r_["abs_dA"] for r_ in rnd_tab])),
            "toward_audio_r": [float(np.mean([r_["toward_audio_r"][0] for r_ in rnd_tab])), float(np.percentile([r_["toward_audio_r"][0] for r_ in rnd_tab], 5)), float(np.percentile([r_["toward_audio_r"][0] for r_ in rnd_tab], 95))],
            "mean_injection_norm": float(np.mean([r_["mean_injection_norm"] for r_ in rnd_tab]))}
        for alpha in [0.5, 1, 2, 4]:
            controls["dose"][str(alpha)] = {k: summarise(alpha * meth[k][0], meth[k][1])
                                            for k in ["SAE transplant", "linear map, valence component", "linear map, valence component (equal norm to SAE)", "mean-diff prompt direction (equal norm)"]}
        print("controls done", flush=True)

    # ------------------------------------------------------------------ 5. conflict songs
    Ute = unit(C["test_emb_audio"]); zs_a = Ute @ Dzs[:, 0]; zs_l = base["zeroshot"][:, 0]
    gap = np.abs(zs_l - zs_a); conf = gap >= np.quantile(gap, 0.75)
    yv = Y["test"][:, 0]

    def conf_stats(pred):
        pv = pred["probe"][conf, 0]
        return float(np.abs(pv - yv[conf]).mean()), float(np.corrcoef(pv, yv[conf])[0, 1])
    b_mae, b_r = conf_stats(base)
    topk = [p for _, p in sel if _ == "emotion"][:5]
    conflict = {"n": int(conf.sum()), "base_mae": b_mae, "base_r": b_r, "k": len(topk)}
    if topk:
        adds, deltas = {}, []
        for p in topk:
            Lt, jt = p["text"]; dl = transplant_amounts(p); deltas.append((Lt, dl))
            adds[Lt] = adds.get(Lt, 0) + dl[:, None] * dec_dir(Lt, jt)[None]
        m1, r1 = conf_stats(lyrics_pass(adds))
        conflict |= {"transplant_mae": m1, "transplant_r": r1}
        rnd = []
        for _ in range(n_rand):
            adds_r = {}
            for Lt, dl in deltas:
                jr = rng.choice(alive_by_layer[Lt]); adds_r[Lt] = adds_r.get(Lt, 0) + dl[:, None] * dec_dir(Lt, jr)[None]
            rnd.append(conf_stats(lyrics_pass(adds_r)))
        conflict |= {"random_mae_mean": float(np.mean([a for a, _ in rnd])), "random_mae_p5": float(np.percentile([a for a, _ in rnd], 5)),
                     "random_r_mean": float(np.mean([b for _, b in rnd])), "random_r_p95": float(np.percentile([b for _, b in rnd], 95))}

    for p in pairs: p.pop("u"), p.pop("v")
    return {"trial": trial, "n": {s: len(meta[s]) for s in meta}, "sae": sae_stats, "matching": match,
            "top_pairs": pairs[:15], "n_emotion_pairs": len(emo_pairs), "n_non_emotion_pairs": len(non_pairs),
            "transplant": trans, "boost": boost, "conflict": conflict, "controls": controls,
            "base_lyrics_probe_r_test": [float(np.corrcoef(base["probe"][:, j], Y["test"][:, j])[0, 1]) for j in range(2)]}


# ====================================================================== report

def f(x, nd=4):
    if x is None: return "n/a"
    if isinstance(x, list): return f"{x[0]:.{nd}f} [{x[1]:.{nd}f}, {x[2]:.{nd}f}]"
    if isinstance(x, float): return f"{x:.{nd}f}"
    return str(x)


def report_md(R: dict) -> str:
    L = [f"# CLaMP 3 SAE feature matching and lyrics←audio transplant{' (TRIAL, numbers meaningless)' if R['trial'] else ''}\n",
         f"Songs: {R['n']}. Text tower = XLM-R layers {TL}; audio tower layers {AL}. Lyrics ridge probe r on test "
         f"(no edit): valence {R['base_lyrics_probe_r_test'][0]:.2f}, arousal {R['base_lyrics_probe_r_test'][1]:.2f}.\n",
         "## SAEs\n", "| SAE | features | k | train rows | FVU (test) | dead fraction (test) |\n|---|---|---|---|---|---|"]
    for k, v in R["sae"].items():
        L.append(f"| {k} | {v['n_features']} | {v['k']} | {v['train_rows']} | {v['fvu_test']:.3f} | {v['dead_frac_test']:.3f} |")
    m = R["matching"]
    L += ["\n## Feature matching (train songs)\n", "| quantity | value |\n|---|---|"]
    L += [f"| {k} | {f(v) if isinstance(v, float) else v} |" for k, v in m.items()]
    L += [f"\nBest-match pairs above null (one per text feature): {R['n_emotion_pairs']} emotion-relevant (≥ 0.2), "
          f"{R['n_non_emotion_pairs']} non-emotion (< 0.1).\n",
          "**Top 15 pairs** (text (layer, feature) ↔ audio (layer, feature)); tags = MERGE tags over-represented among "
          "the 40 train songs where the text feature is most active (lift vs base rate).\n",
          "| text | audio | r | partial r | survives | emotion rel. | r(text,V) | r(text,A) | r(audio,V) | r(audio,A) | top tags |",
          "|---|---|---|---|---|---|---|---|---|---|---|"]
    for p in R["top_pairs"]:
        tg = "; ".join(f"{c}: {', '.join(v)}" for c, v in p.get("text_top_tags", {}).items() if v)
        L.append(f"| {p['text']} | {p['audio']} | {p['r']:.2f} | {p['partial_r']:.2f} | {'yes' if p['survives_beyond_label'] else 'no'} | "
                 f"{p['emotion_relevance']:.2f} | {p['r_text_valence']:.2f} | {p['r_text_arousal']:.2f} | "
                 f"{p['r_audio_valence']:.2f} | {p['r_audio_arousal']:.2f} | {tg} |")
    L += ["\n## Transplant (test songs): audio-implied feature value written into the lyrics pass\n",
          "Signed shift = Δprediction × sign(r(text feature, axis)) × sign(injected amount), mean [95% CI]; positive = "
          "moved the way the feature's label correlation predicts. Random = 20 random alive text features, same layer, "
          "same per-song amounts (mean; 5th–95th percentile).\n",
          "| kind | text | audio | r | survives | readout | signed shift V | random V (mean; p5–p95) | signed shift A | random A | mean abs Δ V / A | random abs Δ V / A |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for t in R["transplant"]:
        e, r = t["effect"], t["random"]
        for ro in ["probe", "zeroshot"]:
            L.append(f"| {t['kind']} | {t['text']} | {t['audio']} | {t['r']:.2f} | {'yes' if t['survives_beyond_label'] else 'no'} | {ro} | "
                     f"{f(e[f'{ro}_valence_signed'])} | {r[f'{ro}_valence_signed']['mean']:.4f}; {r[f'{ro}_valence_signed']['p5']:.4f}–{r[f'{ro}_valence_signed']['p95']:.4f} | "
                     f"{f(e[f'{ro}_arousal_signed'])} | {r[f'{ro}_arousal_signed']['mean']:.4f}; {r[f'{ro}_arousal_signed']['p5']:.4f}–{r[f'{ro}_arousal_signed']['p95']:.4f} | "
                     f"{e[f'{ro}_valence_abs']:.4f} / {e[f'{ro}_arousal_abs']:.4f} | "
                     f"{r[f'{ro}_valence_abs']['mean']:.4f} / {r[f'{ro}_arousal_abs']['mean']:.4f} |")
    b = R["boost"]
    if b:
        L += [f"\n## Boost test: top valence-matched text feature {b['text']} (r with valence {b['r_text_valence']:.2f}, "
              f"arousal {b['r_text_arousal']:.2f}; sd {b['sd']:.3f})\n", "| edit | probe ΔV | probe ΔA | zero-shot ΔV | zero-shot ΔA |\n|---|---|---|---|---|"]
        for nm in ["+2sd", "-2sd"]:
            v = b[nm]
            L.append(f"| {nm} | {v['probe_valence_mean_delta']:.3f} | {v['probe_arousal_mean_delta']:.3f} | "
                     f"{v['zeroshot_valence_mean_delta']:.4f} | {v['zeroshot_arousal_mean_delta']:.4f} |")
    k_ = R.get("controls")
    if k_:
        L += [f"\n## Controls on the top emotion pair {k_['pair']['text']} ↔ {k_['pair']['audio']} (r = {k_['pair']['r']:.2f}), lyrics probe, test songs\n",
              f"Linear map (song-mean audio layer → song-mean text layer, ridge on train pairs): held-out R² = {k_['map_test_r2']:.3f}. "
              "Signed ΔV = Δ valence prediction × the expected sign for that song (positive = moved the intended way); "
              "signed ΔA uses the same sign (cross-axis spill). Toward-audio r = Pearson r across test songs between ΔV and "
              "(zero-shot audio valence − zero-shot lyrics valence): positive = the edit moves each song toward what its own "
              "audio says. Random row: mean over 20 random features with 5th–95th percentile.\n",
              "| method (α = 1) | signed ΔV [95% CI] | signed ΔA (spill) | mean abs ΔV / ΔA | toward-audio r [95% CI] | mean injection norm |",
              "|---|---|---|---|---|---|"]
        for nm, v in k_["alpha1"].items():
            L.append(f"| {nm} | {f(v['signed_dV'])} | {f(v['signed_dA_same_sign'])} | {v['abs_dV']:.4f} / {v['abs_dA']:.4f} | "
                     f"{f(v['toward_audio_r'])} | {v['mean_injection_norm']:.3f} |")
        L += ["\n**Dose-response** (injection vectors scaled by α; the transplant amounts are already converted from audio to text "
              "units by the linear fit on train pairs, and mean-diff is matched to the SAE transplant's per-song norm)\n",
              "| α | method | signed ΔV [95% CI] | signed ΔA | toward-audio r |", "|---|---|---|---|---|"]
        for a, ms in k_["dose"].items():
            for nm, v in ms.items():
                L.append(f"| {a} | {nm} | {f(v['signed_dV'])} | {f(v['signed_dA_same_sign'])} | {f(v['toward_audio_r'])} |")
    c = R["conflict"]
    L += ["\n## Conflict songs (top quartile of |zero-shot lyrics V − zero-shot audio V|, test)\n",
          "| quantity | value |\n|---|---|"] + [f"| {k} | {f(v) if isinstance(v, float) else v} |" for k, v in c.items()]
    return "\n".join(L) + "\n"


@app.local_entrypoint()
def main(lyrics: str, out: str = "research/results", trial: bool = False):
    import json
    import os
    R = run.remote(open(os.path.expanduser(lyrics), "rb").read(), trial)
    t = "_trial" if trial else ""
    json.dump(R, open(f"{out}/clamp3_sae{t}.json", "w"), indent=1, default=str)
    md = report_md(R)
    open(f"{out}/clamp3_sae{t}.md", "w").write(md)
    print(md)
