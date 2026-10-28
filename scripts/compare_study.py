"""Check the model's song positions against where listening-study raters placed the songs.

For each study song, the listeners' answer is the median of their placements (first listens only: no hidden
repeats, no skips). Each score source is compared with it by Pearson r per axis, with a paired bootstrap over songs
for the gain of the blended lyrics + audio score over lyrics alone. Hidden repeats give each rater's test-retest
agreement, the ceiling a model can reasonably reach.

    python scripts/compare_study.py --ratings senti_ratings.csv [--audio data/catalog_audio_scores.csv]

senti_ratings.csv is the study export (/api/rate?format=csv). Without --audio only the lyrics scores are checked.
listened_s is not used, so ratings saved before the timer fix (26 Oct 2026) count the same as later ones.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
MIN_RATERS = 3


def load_ratings(path: Path) -> pd.DataFrame:
    r = pd.read_csv(path)
    for c in ["repeat", "skipped"]:
        r[c] = r[c].astype(str).str.lower().isin(["1", "true"])
    r["v"], r["a"] = pd.to_numeric(r["v"], errors="coerce"), pd.to_numeric(r["a"], errors="coerce")
    return r


def listener_medians(r: pd.DataFrame) -> pd.DataFrame:
    first = r[~r["repeat"] & ~r["skipped"]].dropna(subset=["v", "a"])
    g = first.groupby("song")
    out = pd.DataFrame({"listener_v": g["v"].median(), "listener_a": g["a"].median(), "raters": g["rater"].nunique()})
    return out[out["raters"] >= MIN_RATERS]


def test_retest(r: pd.DataFrame) -> dict[str, float]:
    """Correlation between a rater's first placement of a song and their hidden repeat of it."""
    ok = r[~r["skipped"]].dropna(subset=["v", "a"])
    pairs = ok[~ok["repeat"]].merge(ok[ok["repeat"]], on=["rater", "song"], suffixes=("", "_rep"))
    if len(pairs) < 5:
        return {"pairs": len(pairs)}
    return {"pairs": len(pairs), "valence r": float(np.corrcoef(pairs["v"], pairs["v_rep"])[0, 1]),
            "arousal r": float(np.corrcoef(pairs["a"], pairs["a_rep"])[0, 1])}


def model_scores(audio_path: Path | None) -> pd.DataFrame:
    songs = json.loads((ROOT / "public" / "rate" / "songs.json").read_text())["songs"]
    m = pd.DataFrame({"song": [s["id"] for s in songs], "lyrics_v": [s["v"] for s in songs],
                      "lyrics_a": [s["a"] for s in songs]}).set_index("song")
    if audio_path and audio_path.exists():
        a = pd.read_csv(audio_path)
        a["song"] = a["title"] + "|" + a["artist"]
        m = m.join(a.set_index("song")[["audio_v", "audio_a", "fused_v", "fused_a"]])
    return m


def bootstrap_gain(t: np.ndarray, base: np.ndarray, new: np.ndarray, n: int = 2000, seed: int = 42) -> tuple[float, float, float]:
    rng = np.random.default_rng(seed)
    corr = lambda idx, p: np.corrcoef(p[idx], t[idx])[0, 1]
    idx = np.arange(len(t))
    gains = [corr(s, new) - corr(s, base) for s in (rng.choice(idx, len(idx)) for _ in range(n))]
    return corr(idx, new) - corr(idx, base), *np.percentile(gains, [2.5, 97.5])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ratings", type=Path, required=True)
    ap.add_argument("--audio", type=Path, default=ROOT / "data" / "catalog_audio_scores.csv")
    args = ap.parse_args()

    r = load_ratings(args.ratings)
    d = listener_medians(r).join(model_scores(args.audio), how="inner")
    print(f"{r['rater'].nunique()} raters, {len(d)} songs with at least {MIN_RATERS} raters")
    print("test-retest:", test_retest(r))

    # Audio scores exist only for songs with an Apple preview, so every source is compared on those same songs.
    if "fused_v" in d:
        missing = d["fused_v"].isna().sum()
        d = d.dropna(subset=["fused_v"])
        print(f"compared on {len(d)} songs with audio scores ({missing} study songs have none)")
    sources = [s for s in ["lyrics", "audio", "fused"] if f"{s}_v" in d]
    rows = []
    for s in sources:
        row = {"scores": s}
        for ax in ["v", "a"]:
            p, t = d[f"{s}_{ax}"].to_numpy(), d[f"listener_{ax}"].to_numpy()
            row[f"{ax} r"], row[f"{ax} MAE"] = np.corrcoef(p, t)[0, 1], np.abs(p - t).mean()
        rows.append(row)
    print(pd.DataFrame(rows).round(3).to_string(index=False))

    if "fused" in sources:
        for ax, name in [("v", "valence"), ("a", "arousal")]:
            t = d[f"listener_{ax}"].to_numpy()
            dr, lo, hi = bootstrap_gain(t, d[f"lyrics_{ax}"].to_numpy(), d[f"fused_{ax}"].to_numpy())
            print(f"{name}: fused vs lyrics Δr {dr:+.3f} [{lo:+.3f}, {hi:+.3f}]")
    else:
        print("No audio scores yet; run notebooks/colab_audio_catalog.ipynb first.")


if __name__ == "__main__":
    main()
