"""Figures for the Senti report. Reads the score CSVs in the senti repo (and, when present, the study export).

    python make_figures.py --repo /path/to/senti [--ratings senti_ratings.csv]

Writes PDFs to figures/. No lyrics are read or written.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
OUT = HERE / "figures"
LYR, AUD, FUS, CROWD = "#2a78d6", "#eb6834", "#1baf7a", "#8a8984"
INK, INK2, GRID = "#0b0b0b", "#52514e", "#e4e3df"

plt.rcParams.update({
    "font.family": "serif", "font.serif": ["Latin Modern Roman", "Computer Modern Roman", "DejaVu Serif"],
    "font.size": 8.5, "axes.titlesize": 9, "axes.labelsize": 8.5, "xtick.labelsize": 7.5, "ytick.labelsize": 7.5,
    "legend.fontsize": 7.5, "axes.edgecolor": INK2, "axes.labelcolor": INK, "xtick.color": INK2, "ytick.color": INK2,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    "axes.axisbelow": True, "legend.frameon": False, "savefig.bbox": "tight", "savefig.pad_inches": 0.02,
    "pdf.fonttype": 42,
})


def save(fig, name: str) -> None:
    fig.savefig(OUT / f"{name}.pdf")
    fig.savefig(OUT / f"{name}.png", dpi=200)
    plt.close(fig)


def pearson(x, y) -> float:
    return float(np.corrcoef(x, y)[0, 1])


def r2(x: float) -> str:
    """Two decimals, rounding half up from the three-decimal value the text quotes (0.845 -> 0.85, not 0.84)."""
    from decimal import Decimal, ROUND_HALF_UP
    return str(Decimal(str(round(x, 3))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def boot_ci(x, y, n=2000, seed=42) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    x, y = np.asarray(x), np.asarray(y)
    rs = [pearson(x[i], y[i]) for i in (rng.integers(0, len(x), len(x)) for _ in range(n))]
    return tuple(np.percentile(rs, [2.5, 97.5]))


def fig_merge_scatter(repo: Path) -> None:
    """Lyrics model on the 256 held-out MERGE songs: predicted vs annotated, per axis."""
    d = pd.read_csv(repo / "data" / "merge_test_scores_wholesong.csv")
    fig, axes = plt.subplots(1, 2, figsize=(5.6, 2.6))
    for ax, (axis, label) in zip(axes, [("valence", "Valence"), ("arousal", "Arousal")]):
        t, p = d[axis], d[f"pred_{axis}"]
        ax.plot([-1, 1], [-1, 1], color=INK2, lw=0.8, ls=(0, (3, 3)), zorder=1)
        ax.scatter(t, p, s=9, color=LYR, alpha=0.65, lw=0.4, edgecolor="white", zorder=2)
        ax.set(xlim=(-1, 1), ylim=(-1, 1), xlabel=f"MERGE {label.lower()} (AllMusic tags)", ylabel=f"Predicted {label.lower()}")
        ax.set_aspect("equal")
        ax.set_title(f"{label}: r = {r2(pearson(t, p))}, MAE = {r2(np.abs(t - p).mean())}", loc="left")
    fig.tight_layout(w_pad=2)
    save(fig, "merge_scatter")


# Pearson r from the fusion notebook (206 MERGE test songs with audio). The study values (100 songs) are the fallback
# when no ratings file is given; with one, fig_study recomputes them and their bootstrap intervals from the export.
MERGE_R = {"valence": (0.716, 0.683, 0.770), "arousal": (0.611, 0.750, 0.765)}
STUDY_R = {"valence": (0.629, 0.347, 0.648), "arousal": (0.570, 0.841, 0.845)}
STUDY_CI = {"valence": [(0.49, 0.74), (0.19, 0.48), (0.53, 0.74)], "arousal": [(0.43, 0.69), (0.78, 0.89), (0.78, 0.89)]}


def fig_r_bars(study_r=STUDY_R, study_ci=STUDY_CI) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(5.6, 2.3), sharey=True)
    w = 0.26
    for ax, axis in zip(axes, ["valence", "arousal"]):
        for j, (name, c) in enumerate([("Lyrics", LYR), ("Audio", AUD), ("Lyrics + audio", FUS)]):
            xs = np.array([0, 1]) + (j - 1) * w
            vals = [MERGE_R[axis][j], study_r[axis][j]]
            ax.bar(xs, vals, w - 0.03, color=c, label=name, zorder=2)
            lo, hi = study_ci[axis][j]
            ax.errorbar(xs[1], vals[1], yerr=[[vals[1] - lo], [hi - vals[1]]], color=INK, lw=0.8, capsize=2, zorder=3)
            for x, v in zip(xs, vals):
                ax.text(x, v + 0.015 if x < 0.5 else hi + 0.015, r2(v), ha="center", va="bottom", fontsize=6.5, color=INK)
        ax.set_xticks([0, 1], ["MERGE test\n(206 songs, tag labels)", "Listener study\n(100 songs, 15 raters)"])
        ax.set_title(axis.capitalize(), loc="left")
        ax.set_ylim(0, 1)
        ax.grid(axis="x", visible=False)
    axes[0].set_ylabel("Pearson r")
    h, l = axes[0].get_legend_handles_labels()
    fig.tight_layout(w_pad=1, rect=(0, 0, 1, 0.9))
    fig.legend(h[:3], l[:3], loc="upper center", ncol=3, bbox_to_anchor=(0.5, 1.0), handlelength=1, columnspacing=1.5)
    save(fig, "r_bars")


def fig_consensus_distance() -> None:
    """Mean distance from the leave-one-out consensus (438 first-listen placements, 100 songs)."""
    rows = [("Average listener", 0.50, 0.35, 0.29, CROWD), ("Lyrics", 0.46, 0.26, 0.33, LYR),
            ("Audio", 0.45, 0.30, 0.29, AUD), ("Lyrics + audio", 0.38, 0.21, 0.27, FUS)]
    fig, axes = plt.subplots(1, 3, figsize=(5.6, 1.9), sharey=True)
    for ax, k, title in zip(axes, [1, 2, 3], ["2-D distance", "Valence |error|", "Arousal |error|"]):
        y = np.arange(len(rows))[::-1]
        ax.barh(y, [r[k] for r in rows], 0.62, color=[r[4] for r in rows], zorder=2)
        for yi, r in zip(y, rows):
            ax.text(r[k] + 0.01, yi, f"{r[k]:.2f}", va="center", fontsize=7, color=INK)
        ax.set_yticks(y, [r[0] for r in rows])
        ax.set_xlim(0, 0.62)
        ax.set_title(title, loc="left")
        ax.grid(axis="y", visible=False)
    fig.tight_layout(w_pad=0.8)
    save(fig, "consensus_distance")


def fig_billboard(repo: Path) -> None:
    """Application: mean predicted valence/arousal of Billboard year-end hits by year (lyrics model, 5,411 songs)."""
    b = pd.read_csv(repo / "data" / "billboard_va_scores_wholesong.csv")
    b = b.sort_values(["year", "rank"]).drop_duplicates(["title", "artist"])
    g = b.groupby("year").agg(v=("pred_valence", "mean"), a=("pred_arousal", "mean"), n=("title", "size"),
                              vs=("pred_valence", "std"), as_=("pred_arousal", "std"))
    fig, ax = plt.subplots(figsize=(5.6, 2.1))
    for col, sd, c, name in [("v", "vs", LYR, "Valence"), ("a", "as_", AUD, "Arousal")]:
        se = g[sd] / np.sqrt(g["n"])
        ax.fill_between(g.index, g[col] - 1.96 * se, g[col] + 1.96 * se, color=c, alpha=0.18, lw=0)
        ax.plot(g.index, g[col], color=c, lw=1.6)
        ax.text(1986, g.loc[1980:1992, col].mean() + (0.09 if col == "v" else -0.08), name, color=INK, ha="center", fontsize=7.5)
    ax.axhline(0, color=INK2, lw=0.6)
    ax.set(xlim=(1959, 2026), xlabel="Chart year", ylabel="Mean predicted score")
    fig.tight_layout()
    save(fig, "billboard_trend")
    print("billboard: first/last 5y valence", g["v"].iloc[:5].mean().round(3), g["v"].iloc[-5:].mean().round(3),
          "arousal", g["a"].iloc[:5].mean().round(3), g["a"].iloc[-5:].mean().round(3), "songs", int(g["n"].sum()))


def fig_study(repo: Path, ratings: Path, audio: Path) -> dict:
    """Fused score vs listener median on the study songs, plus the valence blend-weight curve."""
    r = pd.read_csv(ratings)
    for c in ["repeat", "skipped"]:
        r[c] = r[c].astype(str).str.lower().isin(["1", "true"])
    first = r[~r["repeat"] & ~r["skipped"]].dropna(subset=["v", "a"])
    g = first.groupby("song")
    med = pd.DataFrame({"lv": g["v"].median(), "la": g["a"].median(), "n": g["rater"].nunique()})
    med = med[med["n"] >= 3]
    a = pd.read_csv(audio)
    a["song"] = a["title"] + "|" + a["artist"]
    d = med.join(a.set_index("song"), how="inner")
    stats = {"ratings": len(r), "raters": r["rater"].nunique(), "first_listens": len(first), "songs": len(d),
             "median_listen_s": float(pd.to_numeric(first.get("listened_s"), errors="coerce").median())}

    fig, axes = plt.subplots(1, 2, figsize=(5.6, 2.6))
    for ax, ax_key, label in [(axes[0], "v", "Valence"), (axes[1], "a", "Arousal")]:
        t = d[f"l{ax_key}"]
        ax.plot([-1, 1], [-1, 1], color=INK2, lw=0.8, ls=(0, (3, 3)), zorder=1)
        ax.scatter(t, d[f"lyrics_{ax_key}"], s=9, color=LYR, alpha=0.5, lw=0, label="Lyrics", zorder=2)
        ax.scatter(t, d[f"fused_{ax_key}"], s=11, color=FUS, alpha=0.85, lw=0.4, edgecolor="white", label="Lyrics + audio", zorder=3)
        ax.set(xlim=(-1, 1), ylim=(-1, 1), xlabel=f"Listener median {label.lower()}", ylabel=f"Model {label.lower()}")
        ax.set_aspect("equal")
        ax.set_title(f"{label}: r = {r2(pearson(t, d[f'lyrics_{ax_key}']))} → {r2(pearson(t, d[f'fused_{ax_key}']))}", loc="left")
        stats[f"{ax_key}_r"] = {s: round(pearson(t, d[f"{s}_{ax_key}"]), 3) for s in ["lyrics", "audio", "fused"]}
        stats[f"{ax_key}_ci"] = {s: tuple(round(c, 3) for c in boot_ci(d[f"{s}_{ax_key}"], t)) for s in ["lyrics", "audio", "fused"]}
    axes[0].legend(loc="upper left", handletextpad=0.2)
    fig.tight_layout(w_pad=2)
    save(fig, "study_scatter")
    # Redraw the r-bars panel with the study correlations and intervals computed here rather than the stored fallback.
    fig_r_bars({"valence": tuple(stats["v_r"][s] for s in ["lyrics", "audio", "fused"]),
                "arousal": tuple(stats["a_r"][s] for s in ["lyrics", "audio", "fused"])},
               {"valence": [stats["v_ci"][s] for s in ["lyrics", "audio", "fused"]],
                "arousal": [stats["a_ci"][s] for s in ["lyrics", "audio", "fused"]]})

    # Valence: r with listeners as the audio weight in lyrics + w * audio varies (scale-free, so only the ratio matters).
    ws = np.linspace(0, 2, 81)
    t, L, A = d["lv"].to_numpy(), d["lyrics_v"].to_numpy(), d["audio_v"].to_numpy()
    curve = [pearson(L + w * A, t) for w in ws]
    rng = np.random.default_rng(42)
    best = []
    for _ in range(2000):
        i = rng.integers(0, len(t), len(t))
        best.append(ws[int(np.argmax([pearson(L[i] + w * A[i], t[i]) for w in ws]))])
    lo, hi = np.percentile(best, [2.5, 97.5])
    fig, ax = plt.subplots(figsize=(3.2, 2.1))
    ax.axvspan(lo, hi, color=FUS, alpha=0.12, lw=0)
    ax.plot(ws, curve, color=FUS, lw=1.8)
    ax.axvline(0.95, color=INK2, lw=0.8, ls=(0, (3, 3)))
    ax.text(0.98, min(curve) + 0.004, "MERGE-fitted\nweight", fontsize=6.5, color=INK2, va="bottom")
    ax.set(xlabel="Audio weight relative to lyrics", ylabel="Valence r with listeners", xlim=(0, 2))
    fig.tight_layout()
    save(fig, "valence_weight")
    stats["weight_best"] = float(ws[int(np.argmax(curve))])
    stats["weight_ci"] = (float(lo), float(hi))
    stats["curve_at"] = {w: round(float(np.interp(w, ws, curve)), 3) for w in [0, 0.5, 0.95, 1.5]}
    return stats


SECTIONS = ["Happy", "Elated", "Excited", "Alert", "Tense", "Nervous", "Stressed", "Upset",
            "Sad", "Depressed", "Lethargic", "Fatigued", "Calm", "Relaxed", "Serene", "Contented"]


def fig_map(repo: Path) -> None:
    """The live map: every catalogue song at its position (lyrics + audio where a preview exists, else lyrics)."""
    b = pd.read_csv(repo / "data" / "billboard_va_scores_wholesong.csv").drop_duplicates(["title", "artist"])
    c = pd.read_csv(repo / "data" / "catalog_audio_scores.csv")
    m = b.merge(c[["title", "artist", "fused_v", "fused_a"]], on=["title", "artist"], how="left")
    fused = m["fused_v"].notna()
    v, a = m["fused_v"].fillna(m["pred_valence"]), m["fused_a"].fillna(m["pred_arousal"])
    fig, ax = plt.subplots(figsize=(3.4, 3.4))
    ax.grid(False)
    th = np.linspace(0, 2 * np.pi, 400)
    ax.plot(np.cos(th), np.sin(th), color=GRID, lw=0.8)
    ax.plot(0.2 * np.cos(th), 0.2 * np.sin(th), color=INK2, lw=0.6, ls=(0, (2, 2)))
    for k in range(16):
        t = np.deg2rad(22.5 * k)
        ax.plot([0.2 * np.cos(t), np.cos(t)], [0.2 * np.sin(t), np.sin(t)], color=INK2 if k % 4 == 0 else GRID,
                lw=0.8 if k % 4 == 0 else 0.6, zorder=1)
        tm = np.deg2rad(22.5 * k + 11.25)
        ax.text(1.12 * np.cos(tm), 1.12 * np.sin(tm), SECTIONS[k], ha="center", va="center", fontsize=6.3, color=INK2)
    ax.scatter(v[~fused], a[~fused], s=2.5, color=LYR, alpha=0.35, lw=0, label="Lyrics only", zorder=2)
    ax.scatter(v[fused], a[fused], s=2.5, color=FUS, alpha=0.5, lw=0, label="Lyrics + audio", zorder=3)
    ax.text(0, 0, "Mixed", ha="center", va="center", fontsize=6, color=INK, zorder=5, bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.8))
    ax.set(xlim=(-1.3, 1.3), ylim=(-1.3, 1.3), xticks=[], yticks=[])
    ax.set_aspect("equal")
    for sp in ax.spines.values():
        sp.set_visible(False)
    ax.annotate("", xy=(1.3, -1.28), xytext=(-1.3, -1.28), arrowprops=dict(arrowstyle="->", color=INK2, lw=0.7))
    ax.text(0, -1.36, "valence (feels bad → feels good)", ha="center", va="top", fontsize=7, color=INK)
    ax.annotate("", xy=(-1.28, 1.3), xytext=(-1.28, -1.3), arrowprops=dict(arrowstyle="->", color=INK2, lw=0.7))
    ax.text(-1.36, 0, "arousal (calm → wired)", ha="right", va="center", rotation=90, fontsize=7, color=INK)
    ax.legend(loc="upper left", bbox_to_anchor=(-0.02, 1.08), markerscale=4, handletextpad=0.1, ncol=2)
    save(fig, "catalog_map")
    print("map:", len(m), "songs,", int(fused.sum()), "with audio")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", type=Path, required=True)
    ap.add_argument("--ratings", type=Path)
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    fig_merge_scatter(args.repo)
    fig_r_bars()
    fig_consensus_distance()
    fig_billboard(args.repo)
    fig_map(args.repo)
    if args.ratings and args.ratings.exists():
        print(json.dumps(fig_study(args.repo, args.ratings, args.repo / "data" / "catalog_audio_scores.csv"), indent=1))


if __name__ == "__main__":
    main()
