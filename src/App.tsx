import { useEffect, useMemo, useRef, useState } from "react";
import catalogJson from "./data/catalog.json";
import { MoodGrid } from "./MoodGrid";
import { MIXED_EMOJI, MOODS, emotionAt, quadrantOf, nearest, placeSong, spotifySearchUrl } from "./mood";
import type { Mood, PlacedSong, Song } from "./mood";
import { findPreview } from "./preview";
import { loadHits } from "./catalog";
import type { Preview } from "./preview";
import { confidenceLabel, loadFeedback, sendVote, songKey, votedSongs } from "./feedback";
import type { Agg } from "./feedback";

const MATCH_COUNT = 8;
const PREVIEW_VOLUME = 0.4;
type ListMode = "closest" | "random" | "rate";
/** Share of rating prompts that ask for a spot before showing the model's, to avoid anchoring. */
const BLIND_SHARE = 0.3;
type RateStep = "ask" | "place" | "blind" | "done";

/** Up to n items drawn at random without replacement. */
function sample<T>(items: T[], n: number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
const UNCERTAIN_BELOW = 0.5;
const LABEL: Record<Mood, string> = { happy: "Happy", angry: "Angry", sad: "Sad", relaxed: "Relaxed" };

interface Metric { pearson: number; r2: number; mae: number }
interface Catalog {
  source: "illustrative" | "bert" | "bert-va";
  songs: Song[];
  /** Held-out test metrics for the valence/arousal model and the 4-class baseline. */
  metrics?: { valence: Metric; arousal: Metric; baseline_pearson: { valence: number; arousal: number }; n_train: number };
}
const catalog = catalogJson as unknown as Catalog;

const HIT_COUNT = 5411;
const DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020];
type Collection = "test" | "hits";
const regression = catalog.source === "bert-va";

const embed =
  new URLSearchParams(window.location.search).has("embed") || window.location.hash === "#embed";

export default function App() {
  const testSongs = useMemo(() => (catalog.songs as Song[]).map(placeSong), []);
  const [hitSongs, setHitSongs] = useState<PlacedSong[]>([]);
  useEffect(() => { loadHits().then(setHitSongs); }, []);
  const [collection, setCollection] = useState<Collection>("test");
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, Preview | null>>({});

  const togglePreview = async (s: PlacedSong) => {
    const el = audio.current;
    if (!el) return;
    if (playing === s.id) { el.pause(); return; }
    setLoading(s.id);
    const p = await findPreview(s);
    setPreviews((prev) => ({ ...prev, [s.id]: p }));
    setLoading((cur) => (cur === s.id ? null : cur));
    if (!p) return;
    el.src = p.audioUrl;
    el.volume = PREVIEW_VOLUME;
    el.play().then(() => setPlaying(s.id)).catch(() => setPlaying(null));
  };
  const [decade, setDecade] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ shared: boolean; aggs: Record<string, Agg> }>({ shared: false, aggs: {} });
  useEffect(() => { loadFeedback().then(setFeedback); }, []);
  const songs = useMemo(() => {
    const base = collection === "hits"
      ? (decade === null ? hitSongs : hitSongs.filter((s) => Math.floor(s.year! / 10) * 10 === decade))
      : testSongs;
    // Listener placements are stored for retraining but don't move songs yet.
    return base;
  }, [collection, decade, hitSongs, testSongs, feedback]);
  const [pos, setPos] = useState({ valence: 0.55, arousal: 0.45 });
  const [hideUncertain, setHideUncertain] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const [mode, setMode] = useState<ListMode>("closest");
  const [shuffles, setShuffles] = useState(0);
  const [showAll, setShowAll] = useState(true);

  const pool = useMemo(
    () => (hideUncertain ? songs.filter((s) => s.confidence >= UNCERTAIN_BELOW) : songs),
    [hideUncertain, songs],
  );
  const feeling = emotionAt(pos.valence, pos.arousal);
  const section = feeling?.name ?? "Mixed";
  const inSection = useMemo(
    () => pool.filter((s) => (emotionAt(s.valence, s.arousal)?.name ?? "Mixed") === section),
    [pool, section],
  );
  // Redrawn when the dot enters a new section or the list changes, not on every drag step.
  const randomPicks = useMemo(() => sample(inSection, MATCH_COUNT), [inSection, shuffles]);
  const [rateSong, setRateSong] = useState<PlacedSong | null>(null);
  const [rateStep, setRateStep] = useState<RateStep>("ask");
  const [rateBlind, setRateBlind] = useState(false);
  const [saving, setSaving] = useState(false);
  const rated = rateSong ? songs.find((s) => s.id === rateSong.id) ?? rateSong : null;

  const nextRating = () => {
    const done = votedSongs();
    const blind = Math.random() < BLIND_SHARE;
    // Blind prompts draw from the whole list so the dot's position gives no hint.
    const from = (blind ? pool : inSection).filter((s) => !done.has(songKey(s)));
    const fresh = from.filter((s) => !feedback.aggs[songKey(s)]);
    const pick = sample(fresh.length ? fresh : from.length ? from : inSection, 1)[0] ?? null;
    setRateSong(pick);
    setRateBlind(blind);
    setRateStep(blind ? "blind" : "ask");
    if (pick && !blind) setPos({ valence: pick.valence, arousal: pick.arousal });
  };

  const vote = async (agree: boolean) => {
    if (!rated) return;
    setSaving(true);
    const at = agree ? { v: rated.valence, a: rated.arousal } : { v: pos.valence, a: pos.arousal };
    await sendVote({ song: songKey(rated), ...at, blind: rateBlind, agree, model: { v: rated.valence, a: rated.arousal }, source: "classic" });
    setFeedback(await loadFeedback());
    setSaving(false);
    setRateStep("done");
    if (rateBlind) setPos({ valence: rated.valence, arousal: rated.arousal });
  };

  const startRating = () => { setMode("rate"); nextRating(); };

  const hideRated = mode === "rate" && rateStep === "blind";
  const matches = mode === "rate"
    ? (rated && !hideRated ? [rated] : [])
    : mode === "random" ? randomPicks : nearest(pool, pos.valence, pos.arousal, MATCH_COUNT);
  const matchIds = new Set(matches.map((m) => m.id));
  const illustrative = catalog.source === "illustrative";
  const labeled = songs.filter((s) => s.true_mood);
  const accuracy = labeled.length ? labeled.filter((s) => s.true_mood === s.top).length / labeled.length : 0;

  return (
    <div className={`app${embed ? " is-embed" : ""}`}>
      {!embed && (
        <header className="masthead">
          <div className="wordmark">
            <span className="wordmark-glyph" aria-hidden="true" />
            Senti
          </div>
          <p className="tagline">Drag the light to a feeling. Get songs that sound like it.</p>
          <p className="explainer">
            Left to right is how good a song feels, which psychologists call <b>valence</b>. Bottom to
            top is how much energy it carries, called <b>arousal</b>. Together they place 16 everyday
            emotions around a circle.
          </p>
        </header>
      )}

      <main className="stage">
        <section className="map-col" aria-label="Mood map">
          <MoodGrid
            valence={pos.valence}
            arousal={pos.arousal}
            songs={hideRated ? (showAll ? pool.filter((s) => s.id !== rated?.id) : []) : showAll ? pool : matches}
            dense={collection === "hits" && showAll}
            matchIds={matchIds}
            hoveredId={hoveredId}
            onMove={(valence, arousal) => setPos({ valence, arousal })}
            onHover={setHoveredId}
          />
          <dl className="readout">
            <div className="feeling">
              <dt>Feeling</dt>
              <dd className={feeling ? `mood-${feeling.mood}` : ""}>
                <span className="feeling-emoji" aria-hidden="true">{feeling ? feeling.emoji : MIXED_EMOJI}</span>
                {feeling ? feeling.name : "Mixed"}
              </dd>
            </div>
            <div><dt>Feels good</dt><dd>{fmt(pos.valence)}</dd></div>
            <div><dt>Energy</dt><dd>{fmt(pos.arousal)}</dd></div>
          </dl>
        </section>

        <section className="list-col" aria-label="Matching songs">
          <div className="list-head">
            <h2>{mode === "rate" ? "Rate a song" : mode === "random" ? `Random ${section} songs` : "Closest songs"}</h2>
            {!regression && <label className="toggle" htmlFor="hide-uncertain">
              <input
                id="hide-uncertain"
                type="checkbox"
                checked={hideUncertain}
                onChange={(e) => setHideUncertain(e.target.checked)}
              />
              Hide uncertain
            </label>}
          </div>
          <div className="collection" role="group" aria-label="How to pick songs">
            <button type="button" className="chip-btn" aria-pressed={mode === "closest"} onClick={() => setMode("closest")}>
              Closest to the dot
            </button>
            <button type="button" className="chip-btn" aria-pressed={mode === "random"} onClick={() => setMode("random")}>
              Random from {section}
            </button>
            <button type="button" className="chip-btn" aria-pressed={mode === "rate"} onClick={startRating}>
              Rate a song
            </button>
            {mode === "random" && (
              <button type="button" className="chip-btn" onClick={() => setShuffles((n) => n + 1)} disabled={inSection.length <= MATCH_COUNT}>
                <span aria-hidden="true">🎲 </span>Shuffle
              </button>
            )}
          </div>
          <div className="collection" role="group" aria-label="Songs to show">
            <button type="button" className="chip-btn" aria-pressed={collection === "test"} onClick={() => setCollection("test")}>
              Test songs · {testSongs.length}
            </button>
            <button type="button" className="chip-btn" aria-pressed={collection === "hits"} onClick={() => setCollection("hits")}>
              Billboard hits · {(hitSongs.length || HIT_COUNT).toLocaleString()}
            </button>
          </div>
          {collection === "hits" && (
            <div className="decades" role="group" aria-label="Decade">
              <button type="button" className="chip-btn" aria-pressed={decade === null} onClick={() => setDecade(null)}>All years</button>
              {DECADES.map((d) => (
                <button key={d} type="button" className="chip-btn" aria-pressed={decade === d} onClick={() => setDecade(d)}>
                  {`’${String(d).slice(2)}s`}
                </button>
              ))}
            </div>
          )}
          {illustrative && (
            <p className="notice">
              Demo catalog. These mood scores are illustrative placeholders until the BERT model
              scores real lyrics.
            </p>
          )}
          <label className="toggle map-toggle" htmlFor="show-all">
            <input id="show-all" type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show every song on the map
          </label>
          {mode === "random" && (
            <p className="section-count">
              {inSection.length === 0
                ? `No songs land in ${section} yet. Move the dot or pick another list.`
                : `${inSection.length.toLocaleString()} ${inSection.length === 1 ? "song lands" : "songs land"} in ${section}${inSection.length > MATCH_COUNT ? `; showing ${MATCH_COUNT} at random` : ""}.`}
            </p>
          )}
          {mode === "rate" && (
            <div className="rate-card" aria-live="polite">
              {!rated ? (
                <p className="section-count">No songs here yet. Move the dot to another feeling.</p>
              ) : (
                <>
                  <div className="rate-song">
                    <div>
                      <span className="track-title">{rated.title}</span>
                      <span className="track-artist">{rated.artist}{rated.year !== undefined && ` · ${rated.year}`}</span>
                    </div>
                    <button
                      type="button"
                      className={`preview${playing === rated.id ? " is-playing" : ""}`}
                      onClick={() => togglePreview(rated)}
                      aria-label={`${playing === rated.id ? "Pause" : "Play"} preview of ${rated.title}`}
                      disabled={loading === rated.id || previews[rated.id] === null}
                    >
                      <span aria-hidden="true">{loading === rated.id ? "…" : playing === rated.id ? "❚❚" : "▶"}</span>
                    </button>
                  </div>
                  {rateStep === "ask" && (
                    <>
                      <p className="rate-prompt">
                        We placed it at <b>{emotionAt(rated.valence, rated.arousal)?.name ?? "Mixed"}</b>. Does that sound right?
                      </p>
                      <div className="rate-actions">
                        <button type="button" className="chip-btn" disabled={saving} onClick={() => vote(true)}>👍 Sounds right</button>
                        <button type="button" className="chip-btn" disabled={saving} onClick={() => setRateStep("place")}>👎 Not quite</button>
                      </div>
                    </>
                  )}
                  {(rateStep === "place" || rateStep === "blind") && (
                    <>
                      <p className="rate-prompt">
                        {rateStep === "blind"
                          ? "Where would you put this song? Drag the light to its feeling, then save."
                          : "Drag the light to where this song belongs, then save."}
                        {" "}Now: <b>{section}</b>.
                      </p>
                      <div className="rate-actions">
                        <button type="button" className="chip-btn" aria-pressed="true" disabled={saving} onClick={() => vote(false)}>Save spot</button>
                        <button type="button" className="chip-btn" disabled={saving} onClick={nextRating}>Skip</button>
                      </div>
                    </>
                  )}
                  {rateStep === "done" && (
                    <>
                      <p className="rate-prompt">
                        Thanks!{rateBlind && <> We had it at <b>{emotionAt(rated.valence, rated.arousal)?.name ?? "Mixed"}</b>.</>}
                        {" "}This song: {confidenceLabel(feedback.aggs[songKey(rated)])}.
                        {!feedback.shared && " Saved on this device for now."}
                      </p>
                      <div className="rate-actions">
                        <button type="button" className="chip-btn" onClick={nextRating}>Next song</button>
                      </div>
                    </>
                  )}
                </>
              )}
              <p className="rate-privacy">Ratings are anonymous: we keep the song, the spot you chose and a random ID for this browser.</p>
            </div>
          )}
          {mode !== "rate" && <ol className="tracks">
            {matches.map((s, i) => (
              <li
                key={s.id}
                className={`track${hoveredId === s.id ? " is-hovered" : ""}`}
                onPointerEnter={() => setHoveredId(s.id)}
                onPointerLeave={() => setHoveredId(null)}
              >
                <span className="track-rank">{i + 1}</span>
                <div className="track-main">
                  <span className="track-title">{s.title}</span>
                  <span className="track-artist">
                    {s.artist}
                    {" · "}{emotionAt(s.valence, s.arousal)?.name ?? "Mixed"}
                    {s.year !== undefined && <>{" · "}{s.year}, #{s.peak_rank}</>}
                    {s.true_mood && (
                      <span className={s.true_mood === s.top ? "label-ok" : "label-miss"}>
                        {" · labeled "}{LABEL[s.true_mood]}
                      </span>
                    )}
                    {s.true_valence !== undefined && s.true_arousal !== undefined && (
                      <span className={quadrantOf(s.true_valence, s.true_arousal) === s.top ? "label-ok" : "label-miss"}>
                        {" · tagged "}{emotionAt(s.true_valence, s.true_arousal)?.name ?? "Mixed"}
                      </span>
                    )}
                  </span>
                  {s.probs && (
                    <span className="probbar" aria-label={MOODS.map((m) => `${LABEL[m]} ${Math.round(s.probs![m] * 100)}%`).join(", ")}>
                      {MOODS.map((m) => (
                        <span key={m} className={`seg seg-${m}`} style={{ flexGrow: s.probs![m] }} />
                      ))}
                    </span>
                  )}
                </div>
                <div className="track-side">
                  {s.confidence < UNCERTAIN_BELOW && <span className="chip">uncertain</span>}
                  {previews[s.id] === null ? (
                    <span className="chip">no preview</span>
                  ) : (
                    <button
                      type="button"
                      className={`preview${playing === s.id ? " is-playing" : ""}`}
                      onClick={() => togglePreview(s)}
                      aria-label={`${playing === s.id ? "Pause" : "Play"} preview of ${s.title}`}
                      disabled={loading === s.id}
                    >
                      <span aria-hidden="true">{loading === s.id ? "…" : playing === s.id ? "❚❚" : "▶"}</span>
                    </button>
                  )}
                  {previews[s.id] && (
                    <a className="apple" href={previews[s.id]!.pageUrl} target="_blank" rel="noreferrer">
                      Apple Music <span aria-hidden="true">↗</span>
                    </a>
                  )}
                  <a className="play" href={spotifySearchUrl(s)} target="_blank" rel="noreferrer">
                    Spotify <span aria-hidden="true">↗</span>
                  </a>
                </div>
              </li>
            ))}
          </ol>}
          <audio ref={audio} onPause={() => setPlaying(null)} onEnded={() => setPlaying(null)} preload="none" />
          {!regression && (
            <ul className="legend" aria-label="Bar colours">
              {MOODS.map((m) => (
                <li key={m}><span className={`swatch seg-${m}`} />{LABEL[m]}</li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {!embed && (
        <footer className="method">
          <h2>How the map works</h2>
          <p>
            The map follows Russell's circumplex model of affect: valence (how pleasant a feeling is)
            runs left to right and arousal (how activated it is) runs bottom to top. The 16 sections
            are the emotion words from Feldman Barrett and Russell's version of the model, four per
            quadrant, drawn here as equal slices.
          </p>
          {regression && catalog.metrics ? (
            <>
              <p>
                A BERT model reads each song's lyrics and predicts its valence and arousal directly,
                as two numbers between −1 and 1. Long lyrics are read in overlapping chunks and the
                chunks are averaged, so the whole song counts, not just the first verse. Its emotion is the section that point lands in. It
                was fine-tuned on {catalog.metrics.n_train.toLocaleString()} songs from the MERGE
                dataset, whose valence and arousal scores come from the songs' AllMusic mood tags
                rather than from listeners rating each song.
              </p>
              <p>
                Every test song is from the held-out test split, so the model never saw it in
                training. Its predictions correlate with the tagged scores at{" "}
                {catalog.metrics.valence.pearson.toFixed(2)} for valence and{" "}
                {catalog.metrics.arousal.pearson.toFixed(2)} for arousal (R²{" "}
                {catalog.metrics.valence.r2.toFixed(2)} and {catalog.metrics.arousal.r2.toFixed(2)}).
                The earlier approach, a four-class mood classifier mapped onto the circle, managed{" "}
                {catalog.metrics.baseline_pearson.valence.toFixed(2)} and{" "}
                {catalog.metrics.baseline_pearson.arousal.toFixed(2)} on the same songs. Energy is
                harder to read from words than pleasantness, and tempo, key and production are not
                used yet. Each song also shows the section its tags put it in, in red when the
                quadrant differs.
              </p>
              <p>
                The Billboard hits are every song on the year-end Hot 100 from 1960 to 2025 whose
                lyrics could be found, placed by the same model. They have no mood labels to check
                against, so their positions are the model's reading of the words alone: a cheerful
                tune with bleak lyrics lands on the sad side. Songs that charted in more than one
                year appear once, under their first year, with their best rank.
              </p>
              <p className="fine">
                Valence and arousal data from MERGE (Louro et al., 2024), licensed{" "}
                <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noreferrer">CC BY-NC 4.0</a>
                , available on{" "}
                <a href="https://zenodo.org/records/13939205" target="_blank" rel="noreferrer">Zenodo</a>.
              </p>
            </>
          ) : (
            <>
          <p>
            A BERT model fine-tuned on MoodyLyrics reads each song's lyrics and gives probabilities
            for four moods, one per quadrant: happy, angry, sad and relaxed. A song is placed at the
            probability-weighted average of those four corners, and its emotion is the section it
            lands in:
          </p>
          <pre className="formula">{`valence = p(happy) + p(relaxed) − p(angry) − p(sad)
arousal = p(happy) + p(angry) − p(sad) − p(relaxed)`}</pre>
          <p>
            These are not measured valence and arousal scores. A song the model is unsure about
            drifts toward the centre, which is marked <em>Mixed</em>. Because the model only knows
            four moods, a confident song lands near a corner, so most songs fall in the sections
            either side of each diagonal (Elated or Excited, Nervous or Stressed, Depressed or
            Lethargic, Serene or Relaxed). Sections next to the axes, such as Happy, Alert, Sad or Calm, only fill when the model
            splits its vote between two moods. Lyrics only: tempo, key and production are not used yet.
          </p>
          {!illustrative && (
            <p>
              Every song on the map is from the held-out test split, so the model never saw it in
              training. On those {catalog.songs.length} songs it picks the labeled mood{" "}
              {Math.round(accuracy * 1000) / 10}% of the time. The test set is small (about 35 songs
              per mood), and the most common mistake is calling a relaxed song happy. The raw
              model was overconfident, so its scores are softened with temperature scaling fitted on
              separate validation songs. Even so, most songs sit close to a corner: a four-class
              model knows which quadrant a song is in, not where inside it.
            </p>
          )}
            </>
          )}
          <p className="fine">
            Songs open as a Spotify search. No account or login is needed here, and no lyrics are
            stored on this page.
          </p>
        </footer>
      )}
    </div>
  );
}

function fmt(v: number) {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
}
