# CLaMP 3 SAE feature matching and lyrics←audio transplant

Songs: {'train': 1734, 'test': 206}. Text tower = XLM-R layers [6, 10]; audio tower layers [6, 10]. Lyrics ridge probe r on test (no edit): valence 0.75, arousal 0.66.

## SAEs

| SAE | features | k | train rows | FVU (test) | dead fraction (test) |
|---|---|---|---|---|---|
| text_L6 | 4096 | 32 | 533749 | 0.128 | 0.000 |
| text_L10 | 4096 | 32 | 533749 | 0.168 | 0.000 |
| audio_L6 | 1024 | 16 | 10399 | 0.423 | 0.005 |
| audio_L10 | 1024 | 16 | 10399 | 0.396 | 0.028 |

## Feature matching (train songs)

| quantity | value |
|---|---|
| alive_text | 8149 |
| alive_audio | 279 |
| null_threshold_r | 0.6371 |
| null_threshold_partial_r | 0.6296 |
| pairs_above_null | 6 |
| pairs_above_null_emotion_relevant | 2 |
| pairs_above_null_surviving_beyond_label | 4 |
| pairs_above_null_emotion_relevant_and_surviving | 0 |
| text_features_with_a_match_above_null | 6 |

Best-match pairs above null (one per text feature): 2 emotion-relevant (≥ 0.2), 2 non-emotion (< 0.1).

**Top 15 pairs** (text (layer, feature) ↔ audio (layer, feature)); tags = MERGE tags over-represented among the 40 train songs where the text feature is most active (lift vs base rate).

| text | audio | r | partial r | survives | emotion rel. | r(text,V) | r(text,A) | r(audio,V) | r(audio,A) | top tags |
|---|---|---|---|---|---|---|---|---|---|---|
| (10, 1471) | (6, 692) | 0.74 | 0.71 | yes | 0.17 | -0.11 | 0.25 | -0.16 | 0.17 | Moods: Thuggish (15.9x), Hedonistic (10.8x), Reckless (8.8x); Themes: Night Driving (4.6x), Cool & Cocky (4.2x), Guys Night Out (3.9x); Styles: Dirty South (17.0x), Gangsta Rap (16.1x), Southern Rap (15.8x); Genres: Rap (9.9x); Artist: top artist 3/40 songs, 34 distinct artists |
| (10, 3384) | (6, 692) | 0.69 | 0.65 | yes | 0.17 | -0.16 | 0.27 | -0.16 | 0.17 | Moods: Thuggish (10.4x), Irreverent (8.1x), Uncompromising (8.0x); Themes: Day Driving (4.5x), Politics/Society (4.2x), Mischievous (4.1x); Styles: West Coast Rap (14.5x), Southern Rap (14.5x), Golden Age (14.5x); Genres: Rap (9.3x); Artist: top artist 5/40 songs, 32 distinct artists |
| (10, 121) | (10, 57) | 0.65 | 0.65 | yes | 0.05 | 0.03 | -0.05 | 0.02 | -0.10 | Moods: Wintry (12.0x), Spiritual (8.4x), Reverent (7.0x); Themes: Family Gatherings (11.5x), Winter (8.4x), Christmas Party (7.0x); Styles: Traditional Gospel (34.7x), Country Gospel (19.3x), Gospel (15.1x); Genres: Religious (13.3x), Holiday (7.0x), Country (1.9x); Artist: top artist 2/40 songs, 37 distinct artists |
| (10, 1842) | (6, 630) | 0.64 | 0.46 | no | 0.32 | -0.32 | 0.13 | -0.42 | 0.27 | Moods: Negative (7.9x), Nervous/Jittery (7.7x), Nihilistic (5.5x); Themes: Scary Music (5.6x), Late Night (2.2x), Guys Night Out (1.7x); Styles: Scandinavian Metal (36.1x), Death Metal (11.1x), Black Metal (11.0x); Genres: International (5.0x), Electronic (2.9x), Pop/Rock (1.8x); Artist: top artist 9/40 songs, 22 distinct artists |
| (10, 596) | (10, 57) | 0.64 | 0.64 | yes | 0.04 | 0.04 | -0.04 | 0.02 | -0.10 | Moods: Wintry (9.6x), Spiritual (7.9x), Reverent (6.4x); Themes: Winter (8.4x), Christmas Party (7.7x), Holidays (6.5x); Styles: Traditional Gospel (34.7x), Gospel (13.2x), Christmas (7.9x); Genres: Religious (10.0x), Holiday (7.7x), Vocal (1.7x); Artist: top artist 3/40 songs, 36 distinct artists |
| (10, 643) | (6, 630) | 0.64 | 0.46 | no | 0.36 | -0.36 | 0.14 | -0.42 | 0.27 | Moods: Nervous/Jittery (6.7x), Negative (6.5x), Nihilistic (6.0x); Themes: Guys Night Out (2.4x), Freedom (1.7x), Late Night (1.2x); Styles: Speed/Thrash Metal (9.6x), Black Metal (8.8x), Punk Revival (8.7x); Genres: International (5.4x), Electronic (2.3x), Pop/Rock (1.8x); Artist: top artist 8/40 songs, 28 distinct artists |

## Transplant (test songs): audio-implied feature value written into the lyrics pass

Signed shift = Δprediction × sign(r(text feature, axis)) × sign(injected amount), mean [95% CI]; positive = moved the way the feature's label correlation predicts. Random = 20 random alive text features, same layer, same per-song amounts (mean; 5th–95th percentile).

| kind | text | audio | r | survives | readout | signed shift V | random V (mean; p5–p95) | signed shift A | random A | mean abs Δ V / A | random abs Δ V / A |
|---|---|---|---|---|---|---|---|---|---|---|---|
| emotion | (10, 643) | (6, 630) | 0.64 | no | probe | 0.0021 [0.0006, 0.0036] | 0.0016; -0.0049–0.0108 | 0.0015 [0.0011, 0.0019] | 0.0011; -0.0023–0.0033 | 0.0057 / 0.0018 | 0.0047 / 0.0023 |
| emotion | (10, 643) | (6, 630) | 0.64 | no | zeroshot | 0.0004 [0.0001, 0.0007] | 0.0008; -0.0008–0.0024 | 0.0046 [0.0038, 0.0056] | 0.0005; -0.0025–0.0030 | 0.0012 / 0.0047 | 0.0013 / 0.0016 |
| emotion | (10, 1842) | (6, 630) | 0.64 | no | probe | 0.0103 [0.0083, 0.0125] | 0.0011; -0.0061–0.0087 | 0.0004 [-0.0001, 0.0009] | 0.0006; -0.0017–0.0024 | 0.0104 / 0.0016 | 0.0043 / 0.0017 |
| emotion | (10, 1842) | (6, 630) | 0.64 | no | zeroshot | 0.0045 [0.0037, 0.0054] | 0.0003; -0.0010–0.0014 | 0.0015 [0.0008, 0.0021] | 0.0008; -0.0004–0.0022 | 0.0045 / 0.0024 | 0.0011 / 0.0012 |
| non-emotion | (10, 121) | (10, 57) | 0.65 | yes | probe | 0.0000 [-0.0001, 0.0001] | 0.0001; -0.0003–0.0005 | 0.0000 [0.0000, 0.0001] | 0.0001; -0.0001–0.0002 | 0.0001 / 0.0000 | 0.0003 / 0.0001 |
| non-emotion | (10, 121) | (10, 57) | 0.65 | yes | zeroshot | -0.0000 [-0.0000, -0.0000] | 0.0001; -0.0001–0.0003 | 0.0001 [0.0000, 0.0001] | 0.0000; -0.0000–0.0001 | 0.0000 / 0.0001 | 0.0001 / 0.0000 |
| non-emotion | (10, 596) | (10, 57) | 0.64 | yes | probe | -0.0000 [-0.0000, 0.0000] | 0.0000; -0.0000–0.0001 | -0.0000 [-0.0000, -0.0000] | 0.0000; -0.0000–0.0001 | 0.0000 / 0.0000 | 0.0001 / 0.0000 |
| non-emotion | (10, 596) | (10, 57) | 0.64 | yes | zeroshot | -0.0000 [-0.0000, -0.0000] | 0.0000; -0.0000–0.0000 | -0.0000 [-0.0000, -0.0000] | 0.0000; -0.0000–0.0001 | 0.0000 / 0.0000 | 0.0000 / 0.0000 |

## Boost test: top valence-matched text feature (10, 643) (r with valence -0.36, arousal 0.14; sd 0.797)

| edit | probe ΔV | probe ΔA | zero-shot ΔV | zero-shot ΔA |
|---|---|---|---|---|
| +2sd | -0.022 | 0.006 | -0.0041 | 0.0267 |
| -2sd | 0.024 | -0.006 | 0.0049 | -0.0266 |

## Controls on the top emotion pair (10, 643) ↔ (6, 630) (r = 0.64), lyrics probe, test songs

Linear map (song-mean audio layer → song-mean text layer, ridge on train pairs): held-out R² = 0.269. Signed ΔV = Δ valence prediction × the expected sign for that song (positive = moved the intended way); signed ΔA uses the same sign (cross-axis spill). Toward-audio r = Pearson r across test songs between ΔV and (zero-shot audio valence − zero-shot lyrics valence): positive = the edit moves each song toward what its own audio says. Random row: mean over 20 random features with 5th–95th percentile.

| method (α = 1) | signed ΔV [95% CI] | signed ΔA (spill) | mean abs ΔV / ΔA | toward-audio r [95% CI] | mean injection norm |
|---|---|---|---|---|---|
| SAE transplant | 0.0021 [0.0005, 0.0036] | -0.0015 [-0.0019, -0.0011] | 0.0057 / 0.0018 | -0.0883 [-0.2167, 0.0667] | 0.199 |
| wrong-song SAE transplant | 0.0049 [0.0024, 0.0073] | -0.0027 [-0.0034, -0.0021] | 0.0104 / 0.0031 | -0.1062 [-0.2396, 0.0489] | 0.370 |
| linear map, valence component | 0.0833 [0.0749, 0.0927] | 0.0113 [0.0100, 0.0126] | 0.0833 / 0.0113 | 0.6228 [0.5515, 0.6899] | 0.292 |
| linear map, full difference | 0.2287 [0.1982, 0.2615] | 0.0226 [0.0039, 0.0404] | 0.2497 / 0.1092 | 0.5991 [0.5205, 0.6719] | 5.308 |
| linear map, valence component (equal norm to SAE) | 0.0518 [0.0424, 0.0616] | 0.0065 [0.0054, 0.0077] | 0.0518 / 0.0065 | 0.3203 [0.1887, 0.4421] | 0.199 |
| mean-diff prompt direction (equal norm) | 0.0336 [0.0279, 0.0392] | 0.0067 [0.0056, 0.0079] | 0.0336 / 0.0067 | 0.2861 [0.1891, 0.3743] | 0.199 |
| random features, same amounts (mean over draws) | 0.0026 [-0.0040, 0.0081] | 0.0003 [-0.0034, 0.0032] | 0.0049 / 0.0020 | -0.0359 [-0.2634, 0.2712] | 0.199 |

**Dose-response** (injection vectors scaled by α; the transplant amounts are already converted from audio to text units by the linear fit on train pairs, and mean-diff is matched to the SAE transplant's per-song norm)

| α | method | signed ΔV [95% CI] | signed ΔA | toward-audio r |
|---|---|---|---|---|
| 0.5 | SAE transplant | 0.0010 [0.0002, 0.0017] | -0.0007 [-0.0009, -0.0005] | -0.1140 [-0.2373, 0.0510] |
| 0.5 | linear map, valence component | 0.0415 [0.0371, 0.0461] | 0.0056 [0.0050, 0.0063] | 0.6228 [0.5458, 0.6915] |
| 0.5 | linear map, valence component (equal norm to SAE) | 0.0259 [0.0211, 0.0310] | 0.0033 [0.0027, 0.0039] | 0.3181 [0.1886, 0.4421] |
| 0.5 | mean-diff prompt direction (equal norm) | 0.0166 [0.0139, 0.0194] | 0.0034 [0.0028, 0.0039] | 0.2806 [0.1811, 0.3793] |
| 1 | SAE transplant | 0.0021 [0.0006, 0.0036] | -0.0015 [-0.0019, -0.0011] | -0.0883 [-0.2148, 0.0702] |
| 1 | linear map, valence component | 0.0833 [0.0743, 0.0932] | 0.0113 [0.0100, 0.0126] | 0.6228 [0.5508, 0.6913] |
| 1 | linear map, valence component (equal norm to SAE) | 0.0518 [0.0428, 0.0619] | 0.0065 [0.0054, 0.0076] | 0.3203 [0.1992, 0.4464] |
| 1 | mean-diff prompt direction (equal norm) | 0.0336 [0.0279, 0.0396] | 0.0067 [0.0056, 0.0079] | 0.2861 [0.1876, 0.3781] |
| 2 | SAE transplant | 0.0050 [0.0024, 0.0079] | -0.0032 [-0.0042, -0.0023] | -0.0297 [-0.1754, 0.1171] |
| 2 | linear map, valence component | 0.1672 [0.1485, 0.1868] | 0.0227 [0.0202, 0.0252] | 0.6233 [0.5535, 0.6934] |
| 2 | linear map, valence component (equal norm to SAE) | 0.1036 [0.0855, 0.1233] | 0.0126 [0.0105, 0.0149] | 0.3259 [0.2044, 0.4424] |
| 2 | mean-diff prompt direction (equal norm) | 0.0689 [0.0571, 0.0822] | 0.0135 [0.0114, 0.0159] | 0.2961 [0.2001, 0.3876] |
| 4 | SAE transplant | 0.0132 [0.0082, 0.0183] | -0.0067 [-0.0091, -0.0046] | 0.1046 [-0.0282, 0.2173] |
| 4 | linear map, valence component | 0.3317 [0.2971, 0.3672] | 0.0448 [0.0399, 0.0501] | 0.6268 [0.5530, 0.6950] |
| 4 | linear map, valence component (equal norm to SAE) | 0.2025 [0.1676, 0.2422] | 0.0237 [0.0200, 0.0278] | 0.3408 [0.2141, 0.4548] |
| 4 | mean-diff prompt direction (equal norm) | 0.1406 [0.1150, 0.1678] | 0.0268 [0.0226, 0.0315] | 0.3158 [0.2178, 0.4058] |

## Conflict songs (top quartile of |zero-shot lyrics V − zero-shot audio V|, test)

| quantity | value |
|---|---|
| n | 52 |
| base_mae | 0.2350 |
| base_r | 0.7253 |
| k | 2 |
| transplant_mae | 0.2394 |
| transplant_r | 0.7234 |
| random_mae_mean | 0.2345 |
| random_mae_p5 | 0.2294 |
| random_r_mean | 0.7237 |
| random_r_p95 | 0.7267 |
