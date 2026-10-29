"""Fine-tune MERT end to end on MERGE audio, on Modal, and compare it with the frozen-embedding audio head.

The live audio head (colab_audio_fusion, audio_head.joblib) is a ridge regression on frozen MERT-v1-95M layer-6
embeddings. This script trains the whole of MERT instead: a learned mix of all its layers, averaged over time, into a
linear valence/arousal head, on random 5-second crops of the MERGE training clips. Everything else matches the
fusion notebook: the seed-42 split of va_lyrics.csv, the same labels, best epoch chosen on the validation songs,
5-second slices with a 2.5-second hop when reading a whole clip, and a lyrics + audio blend fitted on validation.

Steps, all on Modal (the Mac only launches them and saves the numbers):
  1. Split va_lyrics.csv as the notebooks do and score the validation songs with the live BERT (lyrics are sent to
     the worker in memory and never stored). Test-song lyrics scores come from data/merge_test_scores_wholesong.csv.
  2. Download MERGE's audio from Zenodo (CC BY-NC check first) into a Modal volume and decode the matched clips.
  3. Score the val/test clips with the frozen head too, so both models are compared on exactly the same songs.
  4. Fine-tune one model per seed in parallel (L4 GPUs).
  5. Score every catalogue preview with the fine-tuned models (mean over seeds) and blend with the lyrics score.

    pip install modal
    modal run scripts/modal_finetune.py --lyrics va_lyrics.csv --bert va_model_state.bin \
        --head audio_head.joblib --previews catalog_previews.csv [--trial]

--trial trains one seed for one epoch on a slice of the songs and scores 20 previews: a cheap end-to-end check.
Writes data/finetune/ (metrics and per-song MERGE test predictions) and data/catalog_audio_scores_ft.csv, which has
the same columns as data/catalog_audio_scores.csv, so `python scripts/compare_study.py --audio` reads it as is.
No lyrics or audio are written anywhere; only numbers, titles and artists.
"""

import modal

SR, SLICE, HOP = 24000, 5.0, 2.5             # as in the fusion notebook
CLIP_S = 30.0
SEED = 42
ZENODO_RECORD = "13939205"
MERT = "m-a-p/MERT-v1-95M"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    # Pins match modal_catalog.py: MERT's own model code needs transformers 4.45.2, and audio_head.joblib was pickled
    # with scikit-learn 1.6.1.
    .pip_install("torch==2.4.1", "transformers==4.45.2", "nnAudio", "scikit-learn==1.6.1", "joblib",
                 "numpy<2", "pandas", "openpyxl", "requests")
    # Bake the pretrained weights into the image, so parallel workers don't all download them at start-up.
    .env({"HF_HOME": "/root/hf"})
    .run_commands("python -c \"from huggingface_hub import snapshot_download as s; "
                  "s('m-a-p/MERT-v1-95M', allow_patterns=['*.json', '*.py', '*.txt', '*.bin', '*.safetensors']); "
                  "s('bert-base-cased', allow_patterns=['*.json', '*.txt', 'model.safetensors'])\"")
)
app = modal.App("senti-finetune", image=image)
vol = modal.Volume.from_name("senti-finetune", create_if_missing=True)
V = {"/vol": vol}


# ---------------------------------------------------------------- 1. split + lyrics scores for the validation songs

@app.function(gpu="T4", volumes=V, timeout=1800)
def split_and_lyrics(lyrics_csv: bytes, published_test_csv: bytes) -> list[dict]:
    """Rows (no lyrics) for train/val/test with labels; val rows carry the live BERT's whole-song scores."""
    import io
    import numpy as np
    import pandas as pd
    import torch
    from sklearn.model_selection import train_test_split
    from torch import nn
    from transformers import BertModel, BertTokenizer

    df = pd.read_csv(io.BytesIO(lyrics_csv)).dropna(subset=["lyrics", "valence", "arousal"])
    train_df, temp_df = train_test_split(df, test_size=0.2, random_state=SEED, stratify=df["quadrant"])
    val_df, test_df = train_test_split(temp_df, test_size=0.5, random_state=SEED, stratify=temp_df["quadrant"])
    pub = pd.read_csv(io.BytesIO(published_test_csv))
    assert len(pub) == len(test_df) and np.allclose(pub["valence"], test_df["valence"], atol=1e-3), \
        "test split differs from the published one"

    class VARegressor(nn.Module):
        def __init__(self):
            super().__init__()
            self.bert = BertModel.from_pretrained("bert-base-cased")
            self.drop = nn.Dropout(p=0.3)
            self.out = nn.Linear(self.bert.config.hidden_size, 2)

        def forward(self, input_ids, attention_mask):
            pooled = self.bert(input_ids=input_ids, attention_mask=attention_mask)["pooler_output"]
            return torch.tanh(self.out(self.drop(pooled)))

    dev = torch.device("cuda")
    tok = BertTokenizer.from_pretrained("bert-base-cased")
    bert = VARegressor()
    bert.load_state_dict(torch.load("/vol/va_model_state.bin", map_location="cpu"))
    bert.to(dev).eval()

    def bert_predict(texts, max_len=160, stride=120, max_windows=8, batch=32):   # live BERT, whole-song read
        body = max_len - 2; ids_all, owner = [], []
        for k, t in enumerate(texts):
            ids = tok(str(t), add_special_tokens=False, truncation=False, verbose=False)["input_ids"]
            starts = list(range(0, max(len(ids) - body, 0) + 1, stride))
            if starts[-1] + body < len(ids): starts.append(len(ids) - body)
            for s in starts[:max_windows]:
                c = [tok.cls_token_id] + ids[s:s + body] + [tok.sep_token_id]
                ids_all.append(c + [tok.pad_token_id] * (max_len - len(c))); owner.append(k)
        ids_all = torch.tensor(ids_all); mask = (ids_all != tok.pad_token_id).long(); out = []
        with torch.no_grad():
            for i in range(0, len(ids_all), batch):
                out.append(bert(ids_all[i:i + batch].to(dev), mask[i:i + batch].to(dev)).float().cpu())
        p = torch.cat(out).numpy(); owner = np.array(owner)
        sums = np.zeros((len(texts), 2)); np.add.at(sums, owner, p)
        return sums / np.bincount(owner, minlength=len(texts))[:, None]

    bert_val = bert_predict(val_df["lyrics"].to_numpy())
    bert_test = bert_predict(test_df["lyrics"].to_numpy())
    gap = np.abs(bert_test - pub[["pred_valence", "pred_arousal"]].to_numpy()).max()
    assert gap < 0.02, f"BERT predictions don't match the live model (gap {gap:.4f}); check va_model_state.bin"

    rows = []
    for name, d, pred in [("train", train_df, None), ("val", val_df, bert_val), ("test", test_df, bert_test)]:
        for j, (_, r) in enumerate(d.iterrows()):
            rows.append({"split": name, "title": r["title"], "artist": r["artist"], "quadrant": r["quadrant"],
                         "valence": float(r["valence"]), "arousal": float(r["arousal"]),
                         "lyrics_v": None if pred is None else float(pred[j, 0]),
                         "lyrics_a": None if pred is None else float(pred[j, 1])})
    print(f"split {len(train_df)}/{len(val_df)}/{len(test_df)}; BERT gap vs published {gap:.4f}")
    return rows


# ---------------------------------------------------------------- 2. MERGE audio into the volume

@app.function(volumes=V, cpu=8, memory=16384, timeout=3600)
def prepare(rows: list[dict]) -> dict:
    """Download MERGE audio (once), match clips to the split's songs, decode to 24 kHz mono float16 per split."""
    import glob
    import json
    import os
    import re
    import subprocess
    import unicodedata
    import zipfile
    from concurrent.futures import ThreadPoolExecutor
    import numpy as np
    import pandas as pd
    import requests

    if os.path.exists("/vol/audio/index.json"):
        idx = json.load(open("/vol/audio/index.json"))
        print("audio already prepared:", {k: len(v) for k, v in idx.items()})
        return {k: len(v) for k, v in idx.items()}

    rec = requests.get(f"https://zenodo.org/api/records/{ZENODO_RECORD}", timeout=60).json()
    lic = rec.get("metadata", {}).get("license") or {}
    lic_id = (lic.get("id") if isinstance(lic, dict) else str(lic)) or ""
    assert "by-nc" in lic_id.lower(), f"Stopping: the record's licence is {lic_id!r}, not CC BY-NC."
    files = [(f["key"], f["size"], f["links"]["self"]) for f in rec["files"]]
    audio = [f for f in files if re.search(r"audio", f[0], re.I) and f[0].lower().endswith(".zip")]
    # Prefer the complete audio set, as the fusion notebook did.
    pick = ([f for f in audio if re.search(r"complete", f[0], re.I)]
            or [f for f in audio if not re.search(r"balanced", f[0], re.I)] or audio)
    assert pick, f"No audio archive in the record: {[k for k, _, _ in files]}"
    key, size, url = pick[0]
    os.makedirs("/vol/merge", exist_ok=True)
    dest = f"/vol/merge/{key}"
    if not os.path.exists(dest) or os.path.getsize(dest) != size:
        print(f"downloading {key} ({size / 1e6:.0f} MB)")
        with requests.get(url, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(dest, "wb") as fh:
                for chunk in r.iter_content(1 << 22): fh.write(chunk)
        vol.commit()
    adir = "/tmp/merge_audio"
    with zipfile.ZipFile(dest) as z: z.extractall(adir)
    clips = {os.path.splitext(os.path.basename(p))[0]: p for p in glob.glob(f"{adir}/**/*", recursive=True)
             if p.lower().endswith((".mp3", ".wav", ".flac", ".ogg", ".m4a"))}

    def norm(s):
        s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
        s = re.sub(r"\(.*?\)|\[.*?\]", " ", s)
        return re.sub(r"[^a-z0-9]+", " ", s).strip()

    meta = None   # MERGE's metadata file: artist, title and a song ID column whose values name the audio files
    for p in glob.glob(f"{adir}/**/*.csv", recursive=True) + glob.glob(f"{adir}/**/*.xlsx", recursive=True):
        try:
            m = pd.read_csv(p) if p.endswith(".csv") else pd.read_excel(p)
        except Exception:
            continue
        cols = {c.lower(): c for c in m.columns}
        if "artist" in cols and "title" in cols:
            idcol = next((c for c in m.columns if m[c].astype(str).isin(clips.keys()).mean() > 0.5), None)
            if idcol:
                meta = m.rename(columns={cols["artist"]: "artist", cols["title"]: "title", idcol: "clip_id"}); break
    assert meta is not None, "Couldn't find MERGE's metadata file with artist, title and a clip ID column"
    meta["key"] = meta["artist"].map(norm) + "|" + meta["title"].map(norm)
    clip_of = dict(zip(meta.drop_duplicates("key")["key"], meta.drop_duplicates("key")["clip_id"].astype(str)))

    def decode(path):
        pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR),
                              "pipe:1"], capture_output=True, check=True).stdout
        return np.frombuffer(pcm, dtype=np.float32)

    n_max = int(CLIP_S * SR)
    os.makedirs("/vol/audio", exist_ok=True)
    index = {}
    for split in ["train", "val", "test"]:
        items = []
        for k, r in enumerate(x for x in rows if x["split"] == split):
            c = clip_of.get(norm(r["artist"]) + "|" + norm(r["title"]))
            if c in clips: items.append({**r, "pos": k, "clip": c})
        with ThreadPoolExecutor(16) as pool:
            waves = list(pool.map(lambda it: decode(clips[it["clip"]]), items))
        arr = np.zeros((len(items), n_max), dtype=np.float16)
        for i, (it, y) in enumerate(zip(items, waves)):
            y = y[:n_max]; arr[i, :len(y)] = y; it["n"] = int(len(y))
        np.save(f"/vol/audio/{split}.npy", arr)
        index[split] = items
        print(f"{split}: {len(items)} of {sum(x['split'] == split for x in rows)} songs have audio")
    json.dump(index, open("/vol/audio/index.json", "w"))
    vol.commit()
    return {k: len(v) for k, v in index.items()}


# ---------------------------------------------------------------- shared model code

def slice_starts(n: int) -> list[int]:
    w, h = int(SLICE * SR), int(HOP * SR)
    return [0] if n <= w else list(range(0, n - w + 1, h))


def build_model():
    import torch
    from torch import nn
    from transformers import AutoModel

    class Regressor(nn.Module):
        """MERT -> learned softmax mix of every hidden layer, mean over time -> dropout -> linear (valence, arousal)."""
        def __init__(self):
            super().__init__()
            self.mert = AutoModel.from_pretrained(MERT, trust_remote_code=True)
            n_layers = self.mert.config.num_hidden_layers + 1
            self.layer_w = nn.Parameter(torch.zeros(n_layers))
            self.drop = nn.Dropout(0.1)
            self.out = nn.Linear(self.mert.config.hidden_size, 2)

        def forward(self, x):
            hs = self.mert(x, output_hidden_states=True).hidden_states
            h = torch.stack([s.mean(1) for s in hs], 1)                     # [batch, layers, 768]
            z = (torch.softmax(self.layer_w, 0)[None, :, None] * h).sum(1)
            return self.out(self.drop(z))

    return Regressor()


def normalise(x, on: bool):
    """Per-crop zero mean / unit variance, as MERT's Wav2Vec2FeatureExtractor does when do_normalize is set."""
    import torch
    if not on: return x
    m, v = x.mean(1, keepdim=True), x.var(1, keepdim=True, unbiased=False)
    return (x - m) / torch.sqrt(v + 1e-7)


def predict_clips(model, waves, lengths, dev, do_norm, batch=64):
    """Whole-clip prediction: mean of the model's outputs over 5-second slices with a 2.5-second hop."""
    import numpy as np
    import torch
    w = int(SLICE * SR)
    sl, owner = [], []
    for i, (y, n) in enumerate(zip(waves, lengths)):
        for s in slice_starts(n):
            seg = np.zeros(w, dtype=np.float32); part = y[s:s + w][:max(n - s, 0)]; seg[:len(part)] = part
            sl.append(seg); owner.append(i)
    out = []
    model.eval()
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16):
        for k in range(0, len(sl), batch):
            x = normalise(torch.from_numpy(np.stack(sl[k:k + batch])).to(dev), do_norm)
            out.append(model(x).float().cpu())
    p, owner = torch.cat(out).numpy(), np.array(owner)
    sums = np.zeros((len(waves), 2)); np.add.at(sums, owner, p)
    return np.clip(sums / np.bincount(owner, minlength=len(waves))[:, None], -1, 1)


# ---------------------------------------------------------------- 3. frozen baseline on the same clips

@app.function(gpu="T4", volumes=V, memory=16384, timeout=1800)
def frozen_baseline(head_bytes: bytes) -> dict:
    """The live frozen head (MERT layer N mean + scaler + ridge) on the prepared val/test clips."""
    import io
    import json
    import re
    import joblib
    import numpy as np
    import torch
    from transformers import AutoModel, Wav2Vec2FeatureExtractor

    head = joblib.load(io.BytesIO(head_bytes))
    layer = int(re.fullmatch(r"MERT layer (\d+) mean", head["features"]).group(1))
    dev = torch.device("cuda")
    proc = Wav2Vec2FeatureExtractor.from_pretrained(MERT, trust_remote_code=True)
    mert = AutoModel.from_pretrained(MERT, trust_remote_code=True).to(dev).eval()
    index = json.load(open("/vol/audio/index.json"))
    out = {}
    w = int(SLICE * SR)
    for split in ["val", "test"]:
        arr = np.load(f"/vol/audio/{split}.npy", mmap_mode="r")
        feats = []
        for i, it in enumerate(index[split]):
            y = arr[i, :it["n"]].astype(np.float32)
            sl = [np.pad(y[s:s + w], (0, max(0, w - len(y[s:s + w])))) for s in slice_starts(it["n"])]
            x = proc(sl, sampling_rate=SR, return_tensors="pt", padding=True)["input_values"]
            with torch.no_grad():                                           # fp32, as the fusion notebook embedded
                hs = mert(x.to(dev), output_hidden_states=True).hidden_states
            feats.append(hs[layer].mean(1).float().cpu().numpy().mean(0))
        p = np.clip(head["ridge"].predict(head["scaler"].transform(np.stack(feats))), -1, 1)
        out[split] = p.tolist()
    return {"preds": out, "features": head["features"], "fusion_weights": head["fusion_weights"]}


# ---------------------------------------------------------------- 4. fine-tune

@app.function(gpu="L4", volumes=V, memory=24576, timeout=3 * 3600)
def train(seed: int, cfg: dict) -> dict:
    import copy
    import json
    import math
    import os
    import time
    import numpy as np
    import torch
    from transformers import Wav2Vec2FeatureExtractor, get_linear_schedule_with_warmup

    torch.manual_seed(seed); rng = np.random.default_rng(seed)
    dev = torch.device("cuda")
    do_norm = bool(getattr(Wav2Vec2FeatureExtractor.from_pretrained(MERT, trust_remote_code=True), "do_normalize", True))
    index = json.load(open("/vol/audio/index.json"))
    data = {s: np.load(f"/vol/audio/{s}.npy") for s in ["train", "val", "test"]}
    tr = index["train"]
    if cfg.get("limit"): tr = tr[:cfg["limit"]]
    ytr = np.array([[it["valence"], it["arousal"]] for it in tr], dtype=np.float32)
    lens = np.array([it["n"] for it in tr])

    model = build_model().to(dev)
    for n, p in model.mert.named_parameters():        # keep the waveform conv front end fixed, as wav2vec2 recipes do
        if n.startswith("feature_extractor"): p.requires_grad = False
    enc = [p for n, p in model.mert.named_parameters() if p.requires_grad]
    head = [model.layer_w] + list(model.out.parameters())
    opt = torch.optim.AdamW([{"params": enc, "lr": cfg["lr_encoder"]}, {"params": head, "lr": cfg["lr_head"]}],
                            weight_decay=0.01)
    w = int(SLICE * SR)
    steps_per_epoch = math.ceil(len(tr) * cfg["crops_per_clip"] / cfg["batch"])
    total = steps_per_epoch * cfg["epochs"]
    sched = get_linear_schedule_with_warmup(opt, int(0.1 * total), total)

    def evaluate(split):
        items = index[split][:cfg["limit"]] if cfg.get("limit") else index[split]
        p = predict_clips(model, [data[split][i, :it["n"]].astype(np.float32) for i, it in enumerate(items)],
                          [it["n"] for it in items], dev, do_norm)
        y = np.array([[it["valence"], it["arousal"]] for it in items])
        return p, float(((p - y) ** 2).mean()), [float(np.corrcoef(p[:, j], y[:, j])[0, 1]) for j in range(2)]

    history, best, bad = [], None, 0
    for epoch in range(cfg["epochs"]):
        model.train(); t0 = time.time(); losses = []
        order = rng.permutation(np.repeat(np.arange(len(tr)), cfg["crops_per_clip"]))
        for k in range(0, len(order), cfg["batch"]):
            b = order[k:k + cfg["batch"]]
            offs = [int(rng.integers(0, max(lens[i] - w, 0) + 1)) for i in b]
            x = np.stack([data["train"][i, o:o + w] for i, o in zip(b, offs)]).astype(np.float32)
            x = normalise(torch.from_numpy(x).to(dev), do_norm)
            with torch.autocast("cuda", dtype=torch.bfloat16):
                pred = model(x).float()
            loss = torch.nn.functional.mse_loss(pred, torch.from_numpy(ytr[b]).to(dev))
            opt.zero_grad(set_to_none=True); loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step(); sched.step()
            losses.append(loss.item())
        _, val_mse, val_r = evaluate("val")
        history.append({"epoch": epoch + 1, "train_mse": float(np.mean(losses)), "val_mse": val_mse,
                        "val_r_valence": val_r[0], "val_r_arousal": val_r[1], "minutes": (time.time() - t0) / 60})
        print(f"seed {seed} epoch {epoch + 1}: {history[-1]}")
        if best is None or val_mse < best[0]:
            best, bad = (val_mse, epoch + 1, copy.deepcopy({k: v.cpu() for k, v in model.state_dict().items()})), 0
        else:
            bad += 1
            if bad >= cfg["patience"]: break

    model.load_state_dict(best[2])
    val_p, _, _ = evaluate("val"); test_p, _, _ = evaluate("test")
    os.makedirs("/vol/ckpt", exist_ok=True)
    tag = cfg.get("tag", "full")
    torch.save(best[2], f"/vol/ckpt/{tag}_seed{seed}.pt"); vol.commit()
    return {"seed": seed, "best_epoch": best[1], "history": history, "val": val_p.tolist(), "test": test_p.tolist(),
            "layer_weights": torch.softmax(model.layer_w.detach().float().cpu(), 0).tolist(),
            "ckpt": f"/vol/ckpt/{tag}_seed{seed}.pt"}


# ---------------------------------------------------------------- 5. catalogue previews with the fine-tuned models

@app.cls(gpu="L4", volumes=V, timeout=1800, max_containers=4)
class FTScorer:
    ckpts: str = modal.parameter()                     # comma-separated checkpoint paths in the volume

    @modal.enter()
    def load(self):
        import torch
        from transformers import Wav2Vec2FeatureExtractor
        self.dev = torch.device("cuda")
        self.do_norm = bool(getattr(Wav2Vec2FeatureExtractor.from_pretrained(MERT, trust_remote_code=True),
                                    "do_normalize", True))
        self.models = []
        for path in self.ckpts.split(","):
            m = build_model(); m.load_state_dict(torch.load(path, map_location="cpu")); self.models.append(m.to(self.dev))

    def fetch(self, url):
        import subprocess
        import numpy as np
        import requests
        r = requests.get(url, timeout=30); r.raise_for_status()
        pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", str(SR),
                              "pipe:1"], input=r.content, capture_output=True, check=True).stdout
        return np.frombuffer(pcm, dtype=np.float32)

    @modal.method()
    def score(self, rows: list[tuple[str, str]]) -> dict:
        """rows: (key, preview_url) -> {key: [valence, arousal]}, the mean over seeds of whole-clip predictions."""
        from concurrent.futures import ThreadPoolExecutor
        import numpy as np
        with ThreadPoolExecutor(16) as pool:
            futs = [pool.submit(self.fetch, u) for _, u in rows]
        keys, waves, skipped = [], [], []
        for (key, _), f in zip(rows, futs):
            try:
                waves.append(f.result()); keys.append(key)
            except Exception as e:
                skipped.append((key, repr(e)[:100]))
        if not keys: return {"scores": {}, "skipped": skipped}
        p = np.mean([predict_clips(m, waves, [len(y) for y in waves], self.dev, self.do_norm) for m in self.models], 0)
        return {"scores": {k: v.tolist() for k, v in zip(keys, p)}, "skipped": skipped}


# ---------------------------------------------------------------- report (numpy/pandas live in the image, not on the Mac)

@app.function(timeout=600)
def report(rows: list[dict], index: dict, frozen: dict, runs: list[dict]) -> dict:
    """Fusion weights on val, then test metrics for lyrics / frozen / fine-tuned / blends, with paired bootstraps."""
    import numpy as np
    import pandas as pd

    def table(split):
        t = pd.DataFrame(index[split])
        t["frozen_v"], t["frozen_a"] = np.array(frozen["preds"][split]).T
        ft = np.mean([np.array(r[split]) for r in runs], 0)
        t["ft_v"], t["ft_a"] = ft.T
        for r in runs:
            t[f"ft_seed{r['seed']}_v"], t[f"ft_seed{r['seed']}_a"] = np.array(r[split]).T
        return t

    val, test = table("val"), table("test")
    if len(runs[0]["val"]) < len(val): val = val.iloc[:len(runs[0]["val"])]       # --trial uses a slice
    if len(runs[0]["test"]) < len(test): test = test.iloc[:len(runs[0]["test"])]
    weights = {"frozen (live weights)": frozen["fusion_weights"]}
    for name in ["ft"]:
        weights[name] = {}
        for ax, col in [("valence", "v"), ("arousal", "a")]:
            X = np.c_[val[f"lyrics_{col}"], val[f"{name}_{col}"], np.ones(len(val))]
            c = np.linalg.lstsq(X, val[ax].to_numpy(), rcond=None)[0]
            weights[name][ax] = {"lyrics": float(c[0]), "audio": float(c[1]), "bias": float(c[2])}
    for name, wkey in [("frozen", "frozen (live weights)"), ("ft", "ft")]:
        for ax, col in [("valence", "v"), ("arousal", "a")]:
            w = weights[wkey][ax]
            test[f"{name}_fused_{col}"] = np.clip(w["lyrics"] * test[f"lyrics_{col}"] + w["audio"] * test[f"{name}_{col}"]
                                                  + w["bias"], -1, 1)

    def corr(p, t): return float(np.corrcoef(p, t)[0, 1])
    sources = {"lyrics only": "lyrics", "audio, frozen head (live)": "frozen", "audio, fine-tuned (mean of seeds)": "ft",
               **{f"audio, fine-tuned seed {r['seed']}": f"ft_seed{r['seed']}" for r in runs},
               "lyrics + frozen audio (live)": "frozen_fused", "lyrics + fine-tuned audio": "ft_fused"}
    metrics = []
    for label, s in sources.items():
        row = {"model": label}
        for ax, col in [("valence", "v"), ("arousal", "a")]:
            p, t = test[f"{s}_{col}"].to_numpy(), test[ax].to_numpy()
            row[f"{ax} r"], row[f"{ax} MAE"] = corr(p, t), float(np.abs(p - t).mean())
        metrics.append(row)

    rng = np.random.default_rng(SEED); idx = rng.integers(0, len(test), size=(2000, len(test)))
    boot = {}
    for new, base in [("ft", "frozen"), ("ft_fused", "frozen_fused"), ("ft_fused", "lyrics")]:
        for ax, col in [("valence", "v"), ("arousal", "a")]:
            p1, p0, t = test[f"{new}_{col}"].to_numpy(), test[f"{base}_{col}"].to_numpy(), test[ax].to_numpy()
            d = np.array([corr(p1[s], t[s]) - corr(p0[s], t[s]) for s in idx])
            boot[f"{new} vs {base}, {ax}"] = {"delta_r": corr(p1, t) - corr(p0, t),
                                               "ci95": [float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))]}
    keep = ["title", "artist", "quadrant", "valence", "arousal", "lyrics_v", "lyrics_a", "frozen_v", "frozen_a",
            "ft_v", "ft_a", "frozen_fused_v", "frozen_fused_a", "ft_fused_v", "ft_fused_a"]
    return {"n_val": len(val), "n_test": len(test), "metrics": metrics, "bootstrap": boot, "fusion_weights": weights,
            "test_csv": test[keep].round(4).to_csv(index=False)}


# ---------------------------------------------------------------- driver

@app.local_entrypoint()
def main(lyrics: str = "va_lyrics.csv", bert: str = "va_model_state.bin", head: str = "audio_head.joblib",
         previews: str = "catalog_previews.csv", seeds: str = "0,1,2", epochs: int = 10, trial: bool = False,
         out_dir: str = "data/finetune", catalog_out: str = "data/catalog_audio_scores_ft.csv"):
    import csv
    import json
    import os
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    if not any(e.path.strip("/") == "va_model_state.bin" for e in vol.listdir("/")):
        print("uploading the BERT weights to the volume (once)")
        with vol.batch_upload() as up: up.put_file(bert, "/va_model_state.bin")

    rows = split_and_lyrics.remote(open(lyrics, "rb").read(),
                                   (root / "data" / "merge_test_scores_wholesong.csv").read_bytes())
    print("audio clips:", prepare.remote(rows))
    index = json.loads(b"".join(vol.read_file("/audio/index.json")))
    head_bytes = open(head, "rb").read()
    frozen_call = frozen_baseline.spawn(head_bytes)

    cfg = {"epochs": 1 if trial else epochs, "batch": 16, "crops_per_clip": 4, "lr_encoder": 2e-5, "lr_head": 1e-3,
           "patience": 3, "limit": 96 if trial else 0, "tag": "trial" if trial else "full"}
    seed_list = [0] if trial else [int(s) for s in seeds.split(",")]
    print(f"fine-tuning seeds {seed_list} with {json.dumps(cfg)}")
    runs = list(train.map(seed_list, kwargs={"cfg": cfg}))
    frozen = frozen_call.get()
    if trial:
        frozen = {**frozen, "preds": {s: v[:cfg["limit"]] for s, v in frozen["preds"].items()}}
        index = {s: v[:cfg["limit"]] for s, v in index.items()}
    rep = report.remote(rows, index, frozen, runs)

    os.makedirs(out_dir, exist_ok=True)
    suffix = "_trial" if trial else ""
    Path(out_dir, f"merge_test_predictions{suffix}.csv").write_text(rep.pop("test_csv"))
    summary = {**rep, "config": cfg, "seeds": [{k: r[k] for k in ["seed", "best_epoch", "history", "layer_weights"]}
                                               for r in runs], "frozen_features": frozen["features"]}
    Path(out_dir, f"finetune_report{suffix}.json").write_text(json.dumps(summary, indent=1))
    print(f"\nMERGE test songs with audio: {rep['n_test']}")
    for m in rep["metrics"]:
        print(f"  {m['model']:<38} valence r {m['valence r']:.3f}  arousal r {m['arousal r']:.3f}")
    for k, b in rep["bootstrap"].items():
        print(f"  {k}: Δr {b['delta_r']:+.3f} [{b['ci95'][0]:+.3f}, {b['ci95'][1]:+.3f}]")

    # Catalogue previews with the fine-tuned models, blended with the lyrics score by the new fusion weights.
    weights = rep["fusion_weights"]["ft"]
    cat = list(csv.DictReader(open(previews)))
    if trial: cat = cat[:20]
    items = [(f"{r['title']}|{r['artist']}", r["preview_url"]) for r in cat]
    chunks = [items[i:i + 64] for i in range(0, len(items), 64)]
    scorer = FTScorer(ckpts=",".join(r["ckpt"] for r in runs))
    audio, skipped = {}, []
    for k, res in enumerate(scorer.score.map(chunks)):
        audio.update(res["scores"]); skipped += res["skipped"]
        print(f"  {min((k + 1) * 64, len(items))}/{len(items)} previews scored, {len(skipped)} skipped")
    clip = lambda v: max(-1.0, min(1.0, v))
    out = catalog_out.replace(".csv", "_trial.csv") if trial else catalog_out
    n = 0
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["title", "artist", "lyrics_v", "lyrics_a", "audio_v", "audio_a", "fused_v", "fused_a"])
        for r in cat:
            a = audio.get(f"{r['title']}|{r['artist']}")
            if a is None: continue
            lv, la = float(r["lyrics_v"]), float(r["lyrics_a"])
            fv = clip(weights["valence"]["lyrics"] * lv + weights["valence"]["audio"] * a[0] + weights["valence"]["bias"])
            fa = clip(weights["arousal"]["lyrics"] * la + weights["arousal"]["audio"] * a[1] + weights["arousal"]["bias"])
            w.writerow([r["title"], r["artist"], lv, la] + [round(v, 4) for v in (a[0], a[1], fv, fa)]); n += 1
    print(f"scored {n} of {len(cat)} previews -> {out}")
    for key, err in skipped[:10]: print("  skipped", key, err)
