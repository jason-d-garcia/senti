# senti

*Formerly Moodify. "senti" is Italian for "you feel" or "listen", from* sentire.

Drag a point around a valence/arousal mood map and get songs that match, each with a
Spotify link. No login.

Song positions come from the four-class BERT lyrics classifier in
[bert-lyrics-sentiment-analysis](https://github.com/jason-d-garcia/bert-lyrics-sentiment-analysis)
(labels `happy=0, sad=1, angry=2, relaxed=3`, from `dataset.py`).

## The map

The map follows Russell's circumplex model of affect: valence (how pleasant, shown as
"Feels bad" to "Feels good") on the x axis and arousal (how activated, "Calm" to "Wired") on
the y axis. It is cut into the 16 emotion words from Feldman Barrett & Russell (1998), as
reproduced in Posner, Russell & Peterson (2005): four per quadrant, drawn as equal 22.5°
slices (the published figure is schematic, so the equal spacing is a simplification).

| Quadrant | Sections, counter-clockwise |
|---|---|
| Feels good + wired | Happy, Elated, Excited, Alert |
| Feels bad + wired | Tense, Nervous, Stressed, Upset |
| Feels bad + calm | Sad, Depressed, Lethargic, Fatigued |
| Feels good + calm | Calm, Relaxed, Serene, Contented |

Points within 0.2 of the centre are labelled *Mixed*. A song's emotion is the section its
position falls in.

## How songs are placed

A BERT regressor (bert-base-cased, pooled output → dropout → linear → tanh) reads each song's
lyrics and predicts valence and arousal directly, each in [−1, 1]. The song's emotion is the
section that point falls in. Code: `scripts/train_va.py`.

Earlier versions used a four-class MoodyLyrics classifier mapped to the circle by expected
quadrant position (`valence = p(happy) + p(relaxed) − p(angry) − p(sad)`, and likewise for
arousal). That placed confident songs near the diagonals and left 6 of the 16 sections empty,
which is why the map now uses the regressor. The classifier catalog is in git history
(commit b2b2547) and the app still renders it if `source` is `"bert"`.

## Data

`src/data/catalog.json` holds **held-out test songs** from MERGE, with predicted
`valence`/`arousal` and the dataset's own scores in `true_valence`/`true_arousal`. The model
never saw any of them in training. 2 of the 256 test songs are left out of the public demo
because of their titles.

MERGE's valence and arousal come from each song's AllMusic mood tags mapped through the
Warriner word norms, not from listeners rating each song, so they are a noisy target.

| Test split (256 songs) | Valence | Arousal |
|---|---|---|
| Pearson r | 0.724 | 0.605 |
| R² | 0.520 | 0.358 |
| MAE | 0.227 | 0.180 |
| Pearson r, four-class classifier mapped to the circle | 0.462 | 0.106 |

Split: 80/10/10 stratified by quadrant, seed 42, 2,044 training songs; 5 epochs, AdamW 2e-5,
10% warmup. Predictions are pulled toward the centre (MERGE arousal has a narrow range), and
the predicted quadrant matches the tagged quadrant for 176 of the 254 test songs. The test songs
leave Nervous and Tense empty; with the Billboard hits, every one of the 16 sections has songs. Lyrics only: tempo, key and production are not used.

**Attribution.** Valence/arousal labels from MERGE: P. L. Louro, H. Redinho, R. Santos,
R. Malheiro, R. Panda, R. P. Paiva (2024), *MERGE: A Bimodal Dataset for Static Music Emotion
Recognition*, [Zenodo 13939205](https://zenodo.org/records/13939205), licensed
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Moodify is non-commercial.
Lyrics were fetched locally for training and inference and are never stored in this repo.

### Billboard hits

`src/data/billboard.json` holds 5,411 songs from the Billboard year-end Hot 100, 1960–2025
(chart lists from Wikipedia), placed by the same model over their whole lyric. Of 6,601 chart
entries, Genius had usable lyrics for 5,717; songs that charted in several years are kept once,
under their first year with their best rank. These are predictions only, with no labels to check
them against. The app loads this file after the page is up.

Each song is scored over its whole lyric: long lyrics are split into overlapping 160-token
windows and the predictions are averaged. On the MERGE test songs this lifts correlation from
0.70 to 0.72 (valence) and 0.56 to 0.60 (arousal) compared with reading only the first window.

### Score files and model comparison

[`data/`](data/README.md) has the whole-song scores as CSV (Billboard hits and the MERGE test
songs) and a comparison of BERT-base against DeBERTa-v3-base and RoBERTa-base trained the same
way. With paired-bootstrap intervals over the 256 test songs, neither larger encoder was reliably
better, and DeBERTa was reliably worse at arousal, so the site keeps BERT-base.
[`notebooks/colab_va_compare.ipynb`](notebooks/colab_va_compare.ipynb) reproduces the comparison
on a Colab GPU from your own copy of the data.

`scripts/score_catalog.py` regenerates a four-class catalog from a checkpoint and a local
`title, artist, lyrics` CSV; lyrics are only read locally and never written to the output.

## Listener ratings

"Rate a song" shows one song from the feeling under the dot. A listener can confirm the spot (👍) or
drag the light to where the song belongs (👎). About a third of prompts are blind: the listener
places the song before seeing the model's spot, so those ratings aren't anchored to it.

A rated song is shown part of the way between the model's prediction and the listeners' median
placement. The model counts like 3 listeners, so the dot moves toward listeners as more of them
agree. Confidence grows with the number of listeners and shrinks with their spread. Medians keep a
few odd ratings from dragging a song across the map. Each browser can rate a song once, and each IP
is limited to 20 ratings a minute.

Ratings are stored by `api/feedback.js` in Upstash Redis. To turn sharing on, add Upstash for Redis
to the Vercel project (Storage > Upstash); it sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
Without it, ratings stay in each visitor's own browser.
`scripts/export_votes.mjs` writes every placement to CSV (song, spot, blind or not, time) for
retraining; titles and artists are lowercased.

## Run

```bash
npm install
npm run dev      # local dev server
npm test         # mapping + nearest-neighbour unit tests
npm run build    # static site in dist/ (relative paths)
```

Add `?embed` (or `#embed`) to the URL to hide the header and method notes, for embedding in
the portfolio site.

## Spotify

Each song links to `open.spotify.com/search/<title artist>`, which works without an API key
or user login. Exact track IDs and in-page playback are a later step and need the Spotify
Web API.

Future ideas are listed in [ROADMAP.md](ROADMAP.md).
