import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadSection, SECTIONS } from "../songs";
import type { CatalogSong } from "../songs";
import { EMOTIONS, spotifySearchUrl } from "../mood";
import { sendVote, songKey } from "../feedback";
import { share } from "../share";
import { buildQueue, clampPt, decodePt, encodePt, EXTENT, feelingAt, groundAt, STOPS } from "./trip";
import type { Pt } from "./trip";

/** A song that can be played straight away: its preview was looked up when the catalogue was built. */
type Track = CatalogSong & { preview: NonNullable<CatalogSong["preview"]> };
type Handle = "from" | "to";

const VOLUME = 0.5;
const START: Pt = { valence: 0.55, arousal: 0.3 };
const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six"];

/** Where a feeling sits on the drawn map, as percentages of its width and height. */
const left = (p: Pt) => `${((p.valence / EXTENT.valence + 1) / 2) * 100}%`;
const top = (p: Pt) => `${((1 - p.arousal / EXTENT.arousal) / 2) * 100}%`;
const artAt = (url: string | undefined, px: number) => url?.replace(/\d+x\d+bb/, `${px}x${px}bb`);

/** The 16 feelings, each set on the edge of the map in the direction it lies. */
const EDGE = 0.86;
const LABELS = EMOTIONS.map((e) => {
  const t = (((e.from + e.to) / 2) * Math.PI) / 180;
  const x = Math.cos(t) / EXTENT.valence, y = Math.sin(t) / EXTENT.arousal;
  const k = EDGE / Math.max(Math.abs(x), Math.abs(y));
  return { name: e.name.toLowerCase(), at: { valence: x * k * EXTENT.valence, arousal: y * k * EXTENT.arousal } };
});

function initial(): { from: Pt; to: Pt | null } {
  const q = new URLSearchParams(window.location.search);
  return { from: decodePt(q.get("f")) ?? START, to: decodePt(q.get("t")) };
}

/** Somewhere worth going from here: the calm, pleasant corner, or the bright one if that's where you already are. */
function suggestDestination(from: Pt): Pt {
  const calm = { valence: 0.5, arousal: -0.34 }, bright = { valence: 0.62, arousal: 0.3 };
  return Math.hypot(from.valence - calm.valence, (from.arousal - calm.arousal) * 1.6) > 0.35 ? calm : bright;
}

export default function V2() {
  const [songs, setSongs] = useState<Track[]>([]);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    Promise.all(SECTIONS.map((n) => loadSection(n)))
      .then((lists) => setSongs(lists.flat().filter((s): s is Track => !!s.preview)))
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const [{ from, to }, setEnds] = useState(initial);
  const [seed, setSeed] = useState(0);
  /** With no destination, the queue moves on to the next nearest songs once it has played through. */
  const [skip, setSkip] = useState(0);
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState<Handle | null>(null);
  const [arrived, setArrived] = useState(false);

  const feeling = feelingAt(from), wish = to ? feelingAt(to) : null;
  const queue = useMemo(() => buildQueue(songs, from, to, seed, STOPS, skip), [songs, from, to, seed, skip]);
  const current: Track | undefined = queue[Math.min(index, queue.length - 1)];

  // The whole page takes the colour of the feeling under the light.
  const ground = groundAt(from);
  useEffect(() => {
    document.documentElement.style.setProperty("--ground", ground);
    document.documentElement.style.backgroundColor = ground;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", ground);
  }, [ground]);

  // Keep the address shareable: it always says where the two lights are.
  useEffect(() => {
    if (drag) return;
    const url = new URL(window.location.href);
    url.searchParams.set("f", encodePt(from));
    if (to) url.searchParams.set("t", encodePt(to)); else url.searchParams.delete("t");
    window.history.replaceState(null, "", url);
  }, [from, to, drag]);

  // ---- Playing ------------------------------------------------------------
  const audio = useRef<HTMLAudioElement>(null);
  /** Whether music should be on: set by pressing play, so moving the light retunes instead of going quiet. */
  const wantPlay = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const cue = (s: Track, play: boolean) => {
    const el = audio.current;
    if (!el) return;
    if (el.dataset.song !== s.id) { el.dataset.song = s.id; el.src = s.preview.audioUrl; setProgress(0); }
    el.volume = VOLUME;
    if (play) el.play().catch(() => { wantPlay.current = false; setPlaying(false); });
  };
  // A new song under the light: cue it once the drag has settled, and keep playing if music was on.
  const settled = drag ? undefined : current;
  useEffect(() => { if (settled) cue(settled, wantPlay.current); }, [settled?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    if (!current) return;
    if (playing) { wantPlay.current = false; audio.current?.pause(); return; }
    wantPlay.current = true; setArrived(false);
    cue(current, true);
  };
  const playAt = (i: number) => { wantPlay.current = true; setArrived(false); setIndex(i); cue(queue[i], true); };
  /** On to the next song. A trip stops at its last one; around a single feeling the songs keep coming. */
  const advance = (byHand: boolean) => {
    if (index < queue.length - 1) { setIndex(index + 1); return; }
    if (!to) { setSkip((s) => s + STOPS); setIndex(0); return; }
    if (byHand) { setIndex(0); return; }
    wantPlay.current = false; setPlaying(false); setArrived(true);
  };

  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!ms || !current) return;
    try {
      ms.metadata = new MediaMetadata({ title: current.title, artist: current.artist, album: "senti",
        artwork: current.preview.artworkUrl ? [{ src: current.preview.artworkUrl, sizes: "600x600", type: "image/jpeg" }] : [] });
      ms.setActionHandler("nexttrack", () => advance(true));
    } catch { /* not supported */ }
  });

  // ---- Moving the lights --------------------------------------------------
  const map = useRef<HTMLDivElement>(null);
  const move = (which: Handle, p: Pt) => {
    setEnds((e) => ({ ...e, [which]: clampPt(p) }));
    setIndex(0); setSkip(0); setArrived(false);
  };
  const pointAt = (e: React.PointerEvent): Pt => {
    const r = map.current!.getBoundingClientRect();
    return { valence: (((e.clientX - r.left) / r.width) * 2 - 1) * EXTENT.valence, arousal: (1 - ((e.clientY - r.top) / r.height) * 2) * EXTENT.arousal };
  };
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = pointAt(e);
    const d = (q: Pt) => Math.hypot((p.valence - q.valence) / EXTENT.valence, (p.arousal - q.arousal) / EXTENT.arousal);
    const which: Handle = to && d(to) < d(from) ? "to" : "from";
    map.current!.setPointerCapture(e.pointerId);
    setDrag(which); move(which, p);
  };
  const onMove = (e: React.PointerEvent) => { if (drag) move(drag, pointAt(e)); };
  const onUp = () => setDrag(null);
  const nudge = (which: Handle) => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.04;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const p = which === "from" ? from : to!;
    move(which, { valence: p.valence + d[0], arousal: p.arousal + d[1] * (EXTENT.arousal / EXTENT.valence) });
  };

  const setOff = () => { setEnds((e) => ({ ...e, to: suggestDestination(e.from) })); setIndex(0); setSkip(0); };
  const stay = () => { setEnds((e) => ({ ...e, to: null })); setIndex(0); setArrived(false); };
  const shuffle = () => { setSeed((s) => s + 1); setIndex(0); setSkip(0); setArrived(false); };

  // ---- Every song as a dot ------------------------------------------------
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const draw = () => {
      const w = c.clientWidth, h = c.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = w * dpr; c.height = h * dpr;
      const g = c.getContext("2d");
      if (!g) return;
      g.scale(dpr, dpr);
      g.fillStyle = "rgba(21, 19, 14, 0.3)";
      const r = w < 500 ? 1.3 : 1.8;
      for (const s of songs) {
        g.beginPath();
        g.arc(((s.valence / EXTENT.valence + 1) / 2) * w, ((1 - s.arousal / EXTENT.arousal) / 2) * h, r, 0, 6.2832);
        g.fill();
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [songs]);

  // ---- Sharing and rating -------------------------------------------------
  const [note, setNote] = useState<string | null>(null);
  const flash = (msg: string) => { setNote(msg); setTimeout(() => setNote(null), 2200); };
  const shareTrip = async () => {
    const r = await share({ title: "senti", url: window.location.href,
      text: wish ? `I feel ${feeling}. Take me to ${wish}.` : `I feel ${feeling}.` });
    if (r === "copied") flash("Link copied");
  };
  const [votes, setVotes] = useState<Record<string, boolean>>({});
  const vote = (agree: boolean) => {
    if (!current) return;
    const model = { v: current.valence, a: current.arousal };
    void sendVote({ song: songKey(current), ...model, blind: false, agree, placed: agree, model, source: "v2" });
    setVotes((v) => ({ ...v, [current.id]: agree }));
  };

  const heading = wish ? `${COUNT_WORDS[queue.length] ?? queue.length} songs from ${feeling} to ${wish}` : `Songs that feel ${feeling}`;
  const art = artAt(current?.preview.artworkUrl, 200);

  return (
    <div className="v2">
      <header className="bar">
        <a className="mark" href="/v2" aria-label="senti 2">senti<span aria-hidden="true"> 2</span></a>
        <nav aria-label="Site">
          <a href="/">Original</a>
          <a href="/about.html">About</a>
          <button type="button" className="btn" onClick={shareTrip}>Share</button>
        </nav>
      </header>

      <main>
        <div className="say">
          {wish ? (
            <h1>I feel {feeling},<br />take me to {wish}.</h1>
          ) : (
            <>
              <h1>I feel {feeling}.</h1>
              <button type="button" className="invite" onClick={setOff}>Take me somewhere else</button>
            </>
          )}
        </div>

        <div className="work">
          <section className="chart" aria-label="Mood map">
            <div className={`map${drag ? " dragging" : ""}`} ref={map}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              <canvas ref={canvas} aria-hidden="true" />
              <div className="labels" aria-hidden="true">
                {LABELS.map((l) => (
                  <span key={l.name} className={l.name === feeling || l.name === wish ? "on" : undefined}
                    style={{ left: left(l.at), top: top(l.at) }}>{l.name}</span>
                ))}
              </div>
              {to && (
                <svg className="path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <line x1={parseFloat(left(from))} y1={parseFloat(top(from))} x2={parseFloat(left(to))} y2={parseFloat(top(to))} />
                </svg>
              )}
              {to && queue.map((s) => (
                <span key={s.id} className={`stop${s === current ? " now" : ""}`} aria-hidden="true"
                  style={{ left: left(s), top: top(s) }} />
              ))}
              <button type="button" className="handle from" style={{ left: left(from), top: top(from) }} onKeyDown={nudge("from")}
                aria-label={`How you feel: ${feeling}. Arrow keys move it.`}><span>Now</span></button>
              {to && (
                <button type="button" className="handle to" style={{ left: left(to), top: top(to) }} onKeyDown={nudge("to")}
                  aria-label={`Where you want to end up: ${wish}. Arrow keys move it.`}><span>Then</span></button>
              )}
            </div>
            <p className="key">Left to right, songs go from feeling bad to feeling good. Bottom to top, from low energy to high. Drag the dot to how you feel.</p>
          </section>

          <section className="list" aria-label="Songs">
            <div className="list-head">
              <h2>{heading}</h2>
              <div className="list-acts">
                <button type="button" className="btn" onClick={shuffle} disabled={!queue.length}>Shuffle</button>
                {to && <button type="button" className="btn" onClick={stay}>Just stay here</button>}
              </div>
            </div>
            {failed ? (
              <p className="status">The songs didn’t load. <button type="button" className="btn" onClick={load}>Try again</button></p>
            ) : !songs.length ? (
              <p className="status">Loading songs…</p>
            ) : (
              <ol>
                {queue.map((s, i) => (
                  <li key={s.id}>
                    <button type="button" className={`row${s === current ? " now" : ""}`} onClick={() => playAt(i)}
                      aria-current={s === current ? "true" : undefined}>
                      <img src={artAt(s.preview.artworkUrl, 100)} alt="" width="44" height="44" loading="lazy" />
                      <span className="row-text">
                        <span className="row-title">{s.title}</span>
                        <span className="row-artist">{s.artist}{s.year ? `, ${s.year}` : ""}</span>
                      </span>
                      <span className="row-feel">{feelingAt(s)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <p className="status" role="status">{arrived && wish ? `You’ve arrived at ${wish}.` : ""}</p>
            <p className="about">
              {songs.length ? `${songs.length.toLocaleString("en-US")} Billboard hits, each` : "Each song is"} placed by two models: one reads
              the lyrics, one listens to the sound. <a href="/about.html">How it works</a>
            </p>
          </section>
        </div>
      </main>

      <footer className="player" aria-label="Player">
        <div className="progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></div>
        <button type="button" className="play" onClick={toggle} disabled={!current} aria-label={playing ? "Pause" : "Play"}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{playing ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="M7 4l13 8-13 8z" />}</svg>
        </button>
        <div className="np">
          {art && <img src={art} alt="" width="52" height="52" />}
          <div className="np-text" aria-live="polite">
            <span className="np-title">{current ? current.title : failed ? "No songs" : "Loading…"}</span>
            <span className="np-artist">{current?.artist}</span>
          </div>
        </div>
        <button type="button" className="next" onClick={() => advance(true)} disabled={!current} aria-label="Next song">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l11 8-11 8zM17 4h3v16h-3z" /></svg>
        </button>
        {current && (
          <div className="extras">
            <a href={current.preview.pageUrl} target="_blank" rel="noreferrer">Apple Music</a>
            <a href={spotifySearchUrl(current)} target="_blank" rel="noreferrer">Spotify</a>
            {current.id in votes ? (
              <span className="thanks">{votes[current.id] ? "Noted, it fits." : "Noted, thanks."}</span>
            ) : (
              <>
                <button type="button" onClick={() => vote(true)}>Fits</button>
                <button type="button" onClick={() => vote(false)}>Doesn’t fit</button>
              </>
            )}
          </div>
        )}
        <audio ref={audio} preload="none"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => { const el = e.currentTarget; setProgress(el.duration ? el.currentTime / el.duration : 0); }}
          onEnded={() => { setProgress(0); advance(false); }} />
      </footer>

      <div className={`toast${note ? " show" : ""}`} role="status">{note}</div>
    </div>
  );
}
