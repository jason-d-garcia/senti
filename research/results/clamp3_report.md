# CLaMP 3 tests

Songs: {'train': 1734, 'val': 219, 'test': 206}. CLaMP 3 (MIT licence, code and weights; commit 9016d2b) with its own MERT feature recipe. Correlations are Pearson r with MERGE's tag-derived labels; 95% bootstrap CIs over songs.

## Test 1: zero-shot emotion from text prompts

Score = cos(x, mean positive prompt) − cos(x, mean negative prompt), 4 phrasings per pole. Ridge rows are trained probes (fit on train) for reference.

| axis | method | r, test | 95% CI | r, all songs |
|---|---|---|---|---|
| valence | zero-shot audio | 0.63 | [0.55, 0.71] | 0.63 |
| valence | zero-shot lyrics | 0.62 | [0.54, 0.70] | 0.61 |
| valence | ridge on CLaMP 3 audio | 0.73 | [0.66, 0.78] | n/a |
| valence | ridge on CLaMP 3 lyrics | 0.75 | [0.69, 0.81] | n/a |
| valence | ridge on Senti MERT L6 | 0.68 | [0.61, 0.75] | n/a |
| arousal | zero-shot audio | 0.55 | [0.47, 0.63] | 0.55 |
| arousal | zero-shot lyrics | 0.54 | [0.45, 0.63] | 0.51 |
| arousal | ridge on CLaMP 3 audio | 0.75 | [0.70, 0.80] | n/a |
| arousal | ridge on CLaMP 3 lyrics | 0.66 | [0.60, 0.72] | n/a |
| arousal | ridge on Senti MERT L6 | 0.75 | [0.71, 0.80] | n/a |

## Test 2: lyrics and audio in CLaMP 3's shared space

**(a) Retrieval: each song's lyrics as the query, its own audio as the target**

| pool | n | recall@1 | recall@10 | median rank | chance r@1 | chance r@10 | chance median |
|---|---|---|---|---|---|---|---|
| test | 206 | 0.097 | 0.413 | 14 | 0.005 | 0.049 | 104 |
| all | 2159 | 0.019 | 0.106 | 141 | 0.000 | 0.005 | 1080 |

**(b) Song-specific content: cos(lyrics_i, audio_i) minus mean cos(lyrics_i, audio_j) over comparison songs j.** A gap above zero against the label-matched comparisons means a song's lyrics and its own audio share something beyond the emotion label.

| pool | vs all other songs | vs same-quadrant songs | vs 5 nearest by (valence, arousal) | mean own cos | mean other cos |
|---|---|---|---|---|---|
| test | 0.068 [0.063, 0.074] | 0.045 [0.039, 0.050] | 0.041 [0.035, 0.047] | 0.121 | 0.053 |
| all | 0.068 [0.066, 0.070] | 0.046 [0.044, 0.048] | 0.037 [0.035, 0.039] | 0.118 | 0.050 |

**(c) Probe transfer in the raw shared space (no alignment step), test songs**

| axis | lyrics→lyrics | audio→audio | lyrics→audio | audio→lyrics |
|---|---|---|---|---|
| valence | 0.75 | 0.73 | 0.43 | 0.65 |
| arousal | 0.66 | 0.75 | 0.63 | 0.49 |

## Test 3: CLaMP 3 prompt directions pulled back into Senti's MERT layer-6 space

Ridge map from standardised MERT L6 (mean-pooled 5 s / 2.5 s slices, as Senti) to CLaMP 3 audio embeddings: held-out R² = 0.661 (alpha 316). Prompt direction pulled back as Wᵀd. Senti head = ridge refit on train in the same standardised space.

| quantity | valence | arousal |
|---|---|---|
| cos(pulled-back prompt dir, Senti head) | 0.566 | 0.165 |
| random |cos| 95th pct | 0.067 | 0.071 |
| base_r | 0.683 | 0.752 |
| ablate prompt dir: mean |Δpred| | 0.140 | 0.038 |
| ablate prompt dir: Δr | -0.092 | -0.010 |
| ablate random (20): mean |Δpred| | 0.003 | 0.002 |
| ablate random (20): max |Δpred| | 0.008 | 0.004 |
| ablate random (20): mean Δr | 0.000 | 0.000 |
| ablate head's own dir (reference): mean |Δpred| | 0.250 | 0.168 |
| ablate head's own dir: Δr | -0.683 | -0.752 |
