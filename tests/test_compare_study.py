"""Unit tests for the listening-study comparison (scripts/compare_study.py) on tiny fixtures."""
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import compare_study as cs

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def ratings() -> pd.DataFrame:
    return cs.load_ratings(FIXTURES / "ratings.csv")


def test_load_ratings_parses_flags_and_numbers(ratings):
    assert ratings["repeat"].dtype == bool and ratings["skipped"].dtype == bool
    assert ratings["repeat"].sum() == 1
    assert ratings["skipped"].sum() == 2
    assert ratings["v"].isna().sum() == 1


def test_listener_medians_uses_first_listens_only(ratings):
    m = cs.listener_medians(ratings)
    # B|y has only two unskipped raters, below MIN_RATERS, so it is dropped.
    assert list(m.index) == ["A|x", "C|z"]
    # A|x: median of r1-r3's first listens; r1's hidden repeat (0.4, 0.6) is ignored.
    assert m.loc["A|x", "listener_v"] == pytest.approx(0.7)
    assert m.loc["A|x", "listener_a"] == pytest.approx(0.3)
    assert m.loc["A|x", "raters"] == 3
    # C|z: r4 skipped, so the median is over r1-r3.
    assert m.loc["C|z", "listener_v"] == pytest.approx(0.2)
    assert m.loc["C|z", "listener_a"] == pytest.approx(0.1)


def test_test_retest_needs_five_pairs(ratings):
    assert cs.test_retest(ratings) == {"pairs": 1}


def test_test_retest_correlates_first_listen_with_repeat():
    rng = np.random.default_rng(0)
    first = rng.uniform(-1, 1, size=(8, 2))
    rows = []
    for k, (v, a) in enumerate(first):
        rows.append({"rater": "r1", "song": f"s{k}", "v": v, "a": a, "repeat": False, "skipped": False})
        rows.append({"rater": "r1", "song": f"s{k}", "v": v + 0.01, "a": -a, "repeat": True, "skipped": False})
    out = cs.test_retest(pd.DataFrame(rows))
    assert out["pairs"] == 8
    assert out["valence r"] == pytest.approx(1.0, abs=1e-3)
    assert out["arousal r"] == pytest.approx(-1.0, abs=1e-6)


def test_bootstrap_gain_is_zero_for_identical_scores():
    t = np.linspace(-1, 1, 30)
    p = t + np.sin(np.arange(30))
    gain, lo, hi = cs.bootstrap_gain(t, p, p, n=200)
    assert gain == pytest.approx(0.0) and lo == pytest.approx(0.0) and hi == pytest.approx(0.0)


def test_bootstrap_gain_detects_a_better_source():
    rng = np.random.default_rng(1)
    t = rng.uniform(-1, 1, 60)
    base = t + rng.normal(0, 0.8, 60)
    new = t + rng.normal(0, 0.1, 60)
    gain, lo, hi = cs.bootstrap_gain(t, base, new, n=500)
    assert gain > 0
    assert lo <= gain <= hi
    assert lo > 0  # the interval excludes zero for a clearly better source


def test_bootstrap_gain_is_reproducible():
    rng = np.random.default_rng(2)
    t, base, new = rng.normal(size=(3, 40))
    assert cs.bootstrap_gain(t, base, new, n=100) == cs.bootstrap_gain(t, base, new, n=100)


def test_model_scores_reads_the_study_songs():
    m = cs.model_scores(None)
    assert len(m) == 100
    assert list(m.columns) == ["lyrics_v", "lyrics_a"]
    assert m.abs().max().max() <= 1
