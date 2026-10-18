# Roadmap

Ideas for future versions of Moodify. Nothing here is built yet.

## Features

### Click an emotion to see finer-grained moods

Clicking one of the 16 emotion names on the map would open it into more specific moods inside that
section. For example, *Contented* might open into *cozy*, *nostalgic* and *grateful*, each placed
where its songs sit.

- **Where the finer moods come from:** listener vibe tags (`vibes:log`, exported with
  `node scripts/export_votes.mjs --vibes`), possibly seeded with Last.fm track tags. A tag becomes a
  sub-mood once enough songs carry it and those songs cluster tightly inside one section.
- **Depends on** enough tag data, synonym merging (e.g. text embeddings, so "chill" and "laid back"
  count as one), and a clustering pass over tag positions in valence/arousal space.
- **Open questions:**
  - how many tags make a sub-mood reliable;
  - what to do with tags that spread across sections (possible evidence for a third dimension);
  - whether sub-moods show as labels, regions or filters in the zoomed view.

## Also discussed

- **Bigger catalog:** score about 100k popular English songs from 2013–2022 with
  `notebooks/colab_score_genius_100k.ipynb` (not in the repo yet).
- **Audio:** fuse lyrics with pretrained audio embeddings from 30-second previews. An early CLAP
  test improved arousal correlation from 0.60 to 0.64.
- **Contrast features:** embed several slices of each preview and use their spread as well as
  their mean.
- **Retraining from listener votes and placements:** see Listener ratings in the README.
- **First-visit hint:** a prompt to click and drop the light, if testers don't find it.
- **Imports:** Last.fm import of a listener's top tracks, and Spotify for allow-listed testers only.
