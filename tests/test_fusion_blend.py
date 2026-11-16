"""The committed catalogue scores follow the documented lyrics + audio blend.

The blend is fused = clip(w_lyrics * lyrics + w_audio * audio + bias, -1, 1), with weights fitted on the MERGE
validation songs (see data/README.md). These tests refit the weights from the CSV by least squares, check every row
follows them, and check they match the weights quoted in the README. They read only committed numbers.
"""
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
SCORES = ROOT / "data" / "catalog_audio_scores.csv"
COLUMNS = ["title", "artist", "lyrics_v", "lyrics_a", "audio_v", "audio_a", "fused_v", "fused_a"]
# Rounded weights as stated in README.md and data/README.md.
DOCUMENTED = {"v": (0.65, 0.61), "a": (0.14, 1.02)}


def fit_blend(lyrics: np.ndarray, audio: np.ndarray, fused: np.ndarray) -> tuple[np.ndarray, float]:
    """Least-squares (w_lyrics, w_audio, bias) over rows the clip at +-1 did not touch, and the max residual."""
    keep = np.abs(fused) < 0.9999
    x = np.c_[lyrics[keep], audio[keep], np.ones(keep.sum())]
    w, *_ = np.linalg.lstsq(x, fused[keep], rcond=None)
    return w, float(np.abs(x @ w - fused[keep]).max())


def test_fit_blend_recovers_known_weights_on_a_tiny_fixture():
    lyrics = np.array([0.5, -0.2, 0.9, -0.8, 0.1])
    audio = np.array([0.1, 0.4, -0.3, -0.6, 0.0])
    fused = np.clip(0.6 * lyrics + 0.4 * audio + 0.05, -1, 1)
    w, resid = fit_blend(lyrics, audio, fused)
    assert w == pytest.approx([0.6, 0.4, 0.05], abs=1e-9)
    assert resid < 1e-12


@pytest.fixture(scope="module")
def scores() -> pd.DataFrame:
    return pd.read_csv(SCORES)


def test_scores_file_shape(scores):
    assert list(scores.columns) == COLUMNS
    assert len(scores) == 2568  # songs with an audio-scored preview
    assert scores[COLUMNS[2:]].abs().max().max() <= 1


@pytest.mark.parametrize("axis", ["v", "a"])
def test_catalogue_follows_documented_blend(scores, axis):
    w, resid = fit_blend(*(scores[f"{s}_{axis}"].to_numpy() for s in ["lyrics", "audio", "fused"]))
    assert resid < 5e-4  # only CSV rounding (4 decimals) is left
    assert (round(w[0], 2), round(w[1], 2)) == DOCUMENTED[axis]
