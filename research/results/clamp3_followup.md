# CLaMP 3 follow-up: is the song-specific lyrics↔audio content emotional?

Reuses the CLaMP 3 embeddings from research/clamp3_tests.py. Each gap = cos(lyrics_i, audio_i) − mean cos(lyrics_i, audio_j) over the comparison set; 95% bootstrap CIs over songs.

Metadata (MERGE's merge_audio_complete_metadata.csv): 2153 of 2159 songs matched by title + artist; 2134 with a genre, 2038 with a year. Main genre = first listed AllMusic genre. Top main genres: {'Pop/Rock': 654, 'Electronic': 293, 'Country': 248, 'Rap': 154, 'Blues': 129, 'Jazz': 113, 'R&B': 100, 'International': 63, 'Folk': 59, 'Holiday': 42, 'Reggae': 41, 'Easy Listening': 22}.

Other per-song metadata available but not used here: Moods, MoodsAll, Themes, Styles.


## all songs

| analysis | result |
|---|---|
| baseline: vs 5 nearest-label | 0.0373 [0.0354, 0.0391] (n = 2159) |
| 1. vs same-artist songs | 0.0162 [0.0142, 0.0182] (n = 1448) |
| 2. vs 5 nearest-label, same main genre, year ±5, other artists | 0.0270 [0.0252, 0.0289] (n = 1934) |
| 3a. emotion subspace (2-d prompt dirs) | 0.0021 [0.0017, 0.0024] (n = 2159) |
| 3b. orthogonal complement | 0.0352 [0.0335, 0.0371] (n = 2159) |
| 3c. random 2-d subspace (20 draws): mean gap | 0.0001 (range -0.0000 to 0.0002) |
| 3d. share of baseline gap in emotion subspace | 0.06 |
| 4. Spearman(gap, |zero-shot lyrics valence|) | ρ = -0.007 [-0.050, 0.033] (n = 2159) |
| 4. Spearman(gap, |zero-shot lyrics arousal|) | ρ = 0.015 [-0.027, 0.059] (n = 2159) |

## test songs

| analysis | result |
|---|---|
| baseline: vs 5 nearest-label | 0.0416 [0.0356, 0.0472] (n = 206) |
| 1. vs same-artist songs | 0.0100 [0.0020, 0.0185] (n = 61) |
| 2. vs 5 nearest-label, same main genre, year ±5, other artists | 0.0352 [0.0281, 0.0426] (n = 112) |
| 3a. emotion subspace (2-d prompt dirs) | 0.0017 [0.0007, 0.0028] (n = 206) |
| 3b. orthogonal complement | 0.0398 [0.0338, 0.0454] (n = 206) |
| 3c. random 2-d subspace (20 draws): mean gap | 0.0001 (range -0.0001 to 0.0004) |
| 3d. share of baseline gap in emotion subspace | 0.04 |
| 4. Spearman(gap, |zero-shot lyrics valence|) | ρ = 0.093 [-0.041, 0.230] (n = 206) |
| 4. Spearman(gap, |zero-shot lyrics arousal|) | ρ = 0.066 [-0.086, 0.206] (n = 206) |
