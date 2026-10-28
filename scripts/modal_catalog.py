"""Score the whole catalogue with audio on Modal: the same steps as notebooks/colab_audio_catalog.ipynb.

For every song with an Apple preview, a GPU worker downloads the 30-second clip, embeds it with MERT-v1-95M,
predicts valence and arousal with the audio head from colab_audio_fusion (audio_head.joblib), and blends that with
the lyrics score using the fusion weights saved alongside the head. Audio never leaves the worker; only numbers do.

    pip install modal          # needs MODAL_TOKEN_ID / MODAL_TOKEN_SECRET (or ~/.modal.toml)
    modal run scripts/modal_catalog.py --previews catalog_previews.csv --head audio_head.joblib \
        --out data/catalog_audio_scores.csv [--limit 50]

--limit scores only the first N songs, for a cheap trial run.
"""
from __future__ import annotations

import modal

MERT_SLICE, MERT_HOP, SR = 5.0, 2.5, 24000   # as in the fusion notebook
SONGS_PER_CALL = 64

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    # transformers 4.45.2 and scikit-learn 1.6.1 match the notebooks: MERT's own model code needs the former,
    # and audio_head.joblib was pickled with the latter.
    .pip_install("torch==2.4.1", "transformers==4.45.2", "nnAudio", "scikit-learn==1.6.1", "joblib",
                 "numpy<2", "pandas", "requests")
)
app = modal.App("senti-catalog-audio", image=image)


@app.cls(gpu="T4", timeout=1800, max_containers=4)
class Scorer:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoModel, Wav2Vec2FeatureExtractor
        self.dev = torch.device("cuda")
        self.proc = Wav2Vec2FeatureExtractor.from_pretrained("m-a-p/MERT-v1-95M", trust_remote_code=True)
        self.model = AutoModel.from_pretrained("m-a-p/MERT-v1-95M", trust_remote_code=True).to(self.dev).eval()

    def fetch(self, url):
        import subprocess
        import numpy as np
        import requests
        r = requests.get(url, timeout=30); r.raise_for_status()
        pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", str(SR),
                              "pipe:1"], input=r.content, capture_output=True, check=True).stdout
        return np.frombuffer(pcm, dtype=np.float32)

    @modal.method()
    def embed(self, rows: list[tuple[str, str]], layer: int) -> dict:
        """rows: (key, preview_url). Returns {key: mean over slices of MERT layer `layer` (768 floats)}."""
        from concurrent.futures import ThreadPoolExecutor
        import numpy as np
        import torch

        def slices(y):
            n, h = int(MERT_SLICE * SR), int(MERT_HOP * SR)
            if len(y) <= n: return [np.pad(y, (0, n - len(y)))]
            return [y[s:s + n] for s in range(0, len(y) - n + 1, h)]

        with ThreadPoolExecutor(16) as pool:
            futs = [pool.submit(self.fetch, u) for _, u in rows]
        keys, sl, owner, skipped = [], [], [], []
        for (key, _), f in zip(rows, futs):
            try:
                y = f.result()
            except Exception as e:
                skipped.append((key, repr(e)[:100])); continue
            s = slices(y); keys.append(key); sl += s; owner += [len(keys) - 1] * len(s)
        if not keys:
            return {"features": {}, "skipped": skipped}
        x = self.proc(sl, sampling_rate=SR, return_tensors="pt", padding=True)["input_values"]
        out = []
        with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16):
            for k in range(0, len(x), 64):
                hs = self.model(x[k:k + 64].to(self.dev), output_hidden_states=True).hidden_states
                out.append(hs[layer].mean(1).float().cpu())
        per, owner = torch.cat(out).numpy(), np.array(owner)
        return {"features": {key: per[owner == j].mean(0).tolist() for j, key in enumerate(keys)}, "skipped": skipped}


@app.function()
def score(head_bytes: bytes, keys: list[str], feats: list[list[float]]) -> list[list[float]]:
    """Apply the pickled scaler + ridge here, where scikit-learn matches the version that saved it."""
    import io
    import joblib
    import numpy as np
    head = joblib.load(io.BytesIO(head_bytes))
    return np.clip(head["ridge"].predict(head["scaler"].transform(np.array(feats))), -1, 1).tolist()


@app.local_entrypoint()
def main(previews: str = "catalog_previews.csv", head: str = "audio_head.joblib",
         out: str = "data/catalog_audio_scores.csv", limit: int = 0):
    import csv
    import json
    import re

    head_bytes = open(head, "rb").read()
    # The head's metadata is plain strings/floats in the pickle; read features and weights on the worker side too.
    meta = json.loads(score_meta.remote(head_bytes))
    m = re.fullmatch(r"MERT layer (\d+) mean", meta["features"])
    assert m, f"this script handles 'MERT layer N mean' heads only, got {meta['features']!r}"
    layer, weights = int(m.group(1)), meta["fusion_weights"]

    cat = list(csv.DictReader(open(previews)))
    if limit: cat = cat[:limit]
    rows = [(f"{r['title']}|{r['artist']}", r["preview_url"]) for r in cat]
    print(f"{len(rows)} songs; features {meta['features']}; fusion weights {json.dumps(weights)}")

    chunks = [rows[i:i + SONGS_PER_CALL] for i in range(0, len(rows), SONGS_PER_CALL)]
    feats, skipped = {}, []
    for k, res in enumerate(Scorer().embed.map(chunks, kwargs={"layer": layer})):
        feats.update(res["features"]); skipped += res["skipped"]
        print(f"  {min((k + 1) * SONGS_PER_CALL, len(rows))}/{len(rows)} embedded, {len(skipped)} skipped")

    keys = list(feats)
    audio = dict(zip(keys, score.remote(head_bytes, keys, [feats[k] for k in keys])))
    clip = lambda v: max(-1.0, min(1.0, v))
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
    print(f"scored {n} of {len(cat)} songs -> {out}")
    for key, err in skipped[:10]: print("  skipped", key, err)


@app.function()
def score_meta(head_bytes: bytes) -> str:
    import io
    import json
    import joblib
    head = joblib.load(io.BytesIO(head_bytes))
    return json.dumps({"features": head["features"], "fusion_weights": head["fusion_weights"]})
