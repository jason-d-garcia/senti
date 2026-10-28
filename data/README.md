# Moodify score data

Valence and arousal predicted from song lyrics by the Moodify lyrics model (BERT-base regressor
trained on the MERGE lyrics dataset). Values are on a -1 to 1 scale; each song's score is the
average over overlapping 160-token windows covering the whole lyric. No lyrics are included.

## billboard_va_scores_wholesong.csv

Billboard year-end Hot 100, 1960-2025: `year, rank, title, artist, pred_valence, pred_arousal`.

- 5,717 of 6,601 chart entries. The rest had no lyrics on Genius (instrumentals, some older or
  non-English songs) or matched the wrong Genius page.
- Songs that charted in two years appear once per year.
- The chart list comes from Wikipedia's "Billboard Year-End Hot 100 singles of YYYY" pages.
- These are model predictions, not human ratings. On held-out MERGE songs the model's predictions
  correlate 0.72 (valence) and 0.60 (arousal) with human scores, so individual songs can be off;
  averages over many songs are more reliable.

## merge_test_scores_wholesong.csv

The 256 held-out MERGE test songs: `title, artist, quadrant, valence, arousal, in_cls_data,
pred_valence, pred_arousal`.

- `valence`, `arousal` and `quadrant` are MERGE's human annotations, rescaled from [0, 1] to
  [-1, 1]. `pred_*` are the model's predictions.
- `in_cls_data` is 1 for the 5 songs that also appear in the training data of the earlier 4-class
  model.
- Titles and artists are as given in MERGE, including its misspellings.
- One title containing a racial slur is masked (`Run, N*****` by The Last Poets), and three
  artist names garbled in MERGE's export are restored (Céline Dion, Hüsker Dü, Sinéad O'Connor).

MERGE dataset: Louro et al., "MERGE — A Bimodal Dataset for Static Music Emotion Recognition",
Zenodo, https://doi.org/10.5281/zenodo.13939205. Licensed CC BY-NC 4.0
(https://creativecommons.org/licenses/by-nc/4.0/). The MERGE annotations in this file are
redistributed under that licence, for non-commercial use, with the values rescaled as described
above.

## model_comparison.csv: BERT vs RoBERTa vs DeBERTa-v3

Three encoders compared on the same 256 held-out MERGE test songs, to decide whether a larger or newer
model should replace the live BERT model.

**Setup.** Same seed-42 MERGE split for every model (2,044 train / 256 val / 256 test, stratified by
quadrant). "Whole song" training cuts each lyric into 160-token windows (stride 120, at most 8 per
song); each window carries the song's labels, and a song's prediction is the mean over its windows.
All models: 5 epochs, batch size 8, learning rate 2e-5 with 10% linear warm-up, gradient clipping 1.0,
best epoch chosen on validation song MSE. Each encoder feeds a dropout + linear + tanh head. DeBERTa
and RoBERTa were trained on a Colab T4 with [`notebooks/colab_va_compare.ipynb`](../notebooks/colab_va_compare.ipynb);
the notebook checks its test split is the same 256 songs, in the same order, as the BERT runs.

**Results (Pearson correlation with human ratings; MAE on the -1 to 1 scale).**

| Model | Valence r | Valence MAE | Arousal r | Arousal MAE |
|---|---|---|---|---|
| BERT-base (live: trained on first 160 tokens, read over whole song) | 0.724 | 0.227 | **0.605** | **0.180** |
| BERT-base, whole-song trained | 0.713 | 0.233 | 0.582 | 0.182 |
| DeBERTa-v3-base, whole-song trained | **0.751** | **0.216** | 0.523 | 0.190 |
| RoBERTa-base, whole-song trained | 0.718 | 0.235 | 0.570 | 0.189 |
| Mean baseline | n/a | 0.452 | n/a | 0.246 |

**Is any difference real?** Paired bootstrap over the test songs (2,000 resamples), change in Pearson
r against the live model, with 95% intervals:

| Model | Valence Δr | Arousal Δr |
|---|---|---|
| BERT-base, whole-song trained | -0.012 [-0.046, +0.022] | -0.022 [-0.060, +0.017] |
| DeBERTa-v3-base | +0.027 [-0.019, +0.075] | **-0.082 [-0.160, -0.007]** |
| RoBERTa-base | -0.006 [-0.051, +0.038] | -0.035 [-0.086, +0.017] |

**Conclusion.** No model is reliably better than the live BERT on either axis. DeBERTa's valence gain
is within noise, and it is significantly worse at arousal, so the live model stays. Reading the whole
song rather than only the first window helped each new model (DeBERTa valence r 0.730 → 0.751,
RoBERTa 0.674 → 0.718). Picking DeBERTa for valence and BERT for arousal was ruled out: it would be
choosing models on the test set.

## Does audio help? Lyrics vs audio vs lyrics + audio

Run with [`notebooks/colab_audio_fusion.ipynb`](../notebooks/colab_audio_fusion.ipynb) on the same seed-42 MERGE
split. Audio is MERGE's 30-second clips, embedded by a frozen music model; the audio head is a ridge regression on
those embeddings, with the feature set chosen on validation (MERT-v1-95M, layer 6, mean over 5-second slices).
Lyrics + audio is a linear blend of the live BERT score and the audio score, fitted on the training songs. 1,734
training and 206 test songs had audio (the rest had no clip in MERGE's audio set).

| Model (206 test songs) | Valence r | Valence MAE | Arousal r | Arousal MAE |
|---|---|---|---|---|
| Lyrics only (live BERT) | 0.716 | 0.223 | 0.611 | 0.162 |
| Audio only (MERT layer 6) | 0.683 | 0.276 | 0.750 | 0.136 |
| **Lyrics + audio** | **0.770** | **0.219** | **0.765** | **0.134** |

**Is the gain real?** Paired bootstrap over the test songs, change in Pearson r of lyrics + audio against lyrics
only: valence **+0.054 [+0.017, +0.095]**, arousal **+0.154 [+0.081, +0.235]**. Both intervals exclude zero.

**Conclusion.** Audio helps on both axes, most of all for energy (arousal), where audio alone already beats the
lyrics model. The fitted blend leans on audio for arousal (weights: lyrics 0.14, audio 1.02) and uses both for
valence (lyrics 0.65, audio 0.61). Next: score the catalogue's Apple previews with this head
([`notebooks/colab_audio_catalog.ipynb`](../notebooks/colab_audio_catalog.ipynb)) and check the blended scores
against listener placements from the study.
