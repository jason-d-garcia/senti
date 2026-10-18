import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import catalogJson from "../data/catalog.json";
import { loadHits } from "../catalog";
import { EMOTIONS, MIXED_EMOJI, emotionAt, placeSong, spotifySearchUrl } from "../mood";
import type { Mood, PlacedSong, Song } from "../mood";
import { findPreview } from "../preview";
import type { Preview } from "../preview";
import { sendVote, songKey, votedSongs } from "../feedback";
import { Field } from "./Field";
import type { FieldSong, Pt } from "./Field";
import { AppleMusicLogo, GitHubLogo, SpotifyLogo } from "./logos";
import { VibePicker } from "./VibePicker";
import { share, sharedSongKey, songLink } from "../share";
import "./minimal.css";

/** Emotion colours, the same as the classic map's quadrants. */
const COLOR: Record<Mood | "mixed", string> = {
  happy: "#f6b93b", angry: "#f0604d", sad: "#5b8cff", relaxed: "#31c9a3", mixed: "#b8c4e8",
};
const PREVIEW_VOLUME = 0.4;
/** Discover view: zoom range, how many nearby songs get cover art, and their size in pixels. */
const MIN_ZOOM = 3, MAX_ZOOM = 40;
const FEATURED = 14;
const COVER_PX = 46;
const OTHERS = 160;
/** Songs tried before giving up on finding one with a preview. */
const TRIES = 6;

type Step = "listen" | "ask" | "thanks" | "place" | "placed";
interface Pick { song: PlacedSong; preview: Preview; step: Step }

const testSongs = (catalogJson as unknown as { songs: Song[] }).songs.map(placeSong);
const sectionOf = (p: { valence: number; arousal: number }) => emotionAt(p.valence, p.arousal)?.name ?? "Mixed";

function shuffle<T>(xs: T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Wheel order: the 16 emotions around the circle, then Mixed, repeated so it can spin either way. */
const WHEEL = [...EMOTIONS.map((e) => ({ name: e.name, emoji: e.emoji, color: COLOR[e.mood] })),
  { name: "Mixed", emoji: MIXED_EMOJI, color: COLOR.mixed }];
const COPIES = 5;

/** "I'm feeling …", with the emotion on a vertical picker wheel that turns to follow the light. */
const Feeling = memo(function Feeling({ idx }: { idx: number }) {
  // Continuous wheel position: move to the nearest copy of the new emotion so the wheel takes the short way round.
  const [pos, setPos] = useState(idx + WHEEL.length * Math.floor(COPIES / 2));
  const [animate, setAnimate] = useState(true);
  // Neighbouring entries show only while the wheel is turning.
  const [turning, setTurning] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setTurning(true);
    const t = setTimeout(() => setTurning(false), 650);
    return () => clearTimeout(t);
  }, [idx]);
  useEffect(() => {
    setPos((cur) => {
      const n = WHEEL.length;
      const base = Math.round((cur - idx) / n) * n + idx;
      const next = [base - n, base, base + n].reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a));
      return next;
    });
  }, [idx]);
  // Drifted towards either end: jump back to the middle copy without animating.
  useEffect(() => {
    const n = WHEEL.length, mid = n * Math.floor(COPIES / 2);
    if (pos < n || pos >= n * (COPIES - 1)) {
      const t = setTimeout(() => { setAnimate(false); setPos(mid + idx); }, 320);
      return () => clearTimeout(t);
    }
    if (!animate) { const r = requestAnimationFrame(() => setAnimate(true)); return () => cancelAnimationFrame(r); }
  }, [pos, idx, animate]);
  const items = Array.from({ length: WHEEL.length * COPIES }, (_, i) => WHEEL[i % WHEEL.length]);
  return (
    <h1 className="feeling" aria-live="polite">
      <span className="feeling-lead">I’m feeling</span>
      <span className="wheel">
        <span className={`wheel-track${animate ? "" : " no-anim"}`} style={{ transform: `translateY(${-pos * 1.35}em)` }}>
          {items.map((w, i) => {
            const d = i - pos;
            // Only the current entry is real text; neighbours exist only while the wheel turns, so the
            // heading reads "I'm feeling elated" to screen readers and search engines.
            if (d !== 0 && (!turning || Math.abs(d) > 2)) return <span key={i} className="wheel-item" aria-hidden="true" />;
            return (
              <span key={i} className="wheel-item" aria-hidden={d !== 0 ? true : undefined} style={{
                color: w.color,
                opacity: d === 0 ? 1 : turning ? Math.max(0, 0.32 - (Math.abs(d) - 1) * 0.2) : 0,
                transform: `perspective(300px) rotateX(${-d * 28}deg) scale(${1 - Math.abs(d) * 0.08})`,
              }}>
                <span className="wheel-emoji" aria-hidden="true">{w.emoji}</span>{w.name.toLowerCase()}
              </span>
            );
          })}
        </span>
      </span>
    </h1>
  );
});

const labelColor = (name: string) => COLOR[EMOTIONS.find((e) => e.name === name)?.mood ?? "mixed"];

/** Phones and tablets: say "tap", not "click". */
const TOUCH = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

const REPO = "https://github.com/jason-d-garcia/moodify";

export default function Minimal() {
  const [hits, setHits] = useState<PlacedSong[]>([]);
  useEffect(() => { loadHits().then(setHits); }, []);
  const songs = useMemo(() => {
    const seen = new Set<string>();
    return [...hits, ...testSongs].filter((s) => { const k = songKey(s); if (seen.has(k)) return false; seen.add(k); return true; });
  }, [hits]);

  const [dot, setDot] = useState<Pt>({ valence: 0.55, arousal: 0.45 });
  const emotion = emotionAt(dot.valence, dot.arousal);
  const color = COLOR[emotion?.mood ?? "mixed"];
  const section = sectionOf(dot);

  const [pick, setPick] = useState<Pick | null>(null);
  const [finding, setFinding] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [placeAt, setPlaceAt] = useState<Pt>(dot);
  const [pinned, setPinned] = useState(false);
  const [placePinned, setPlacePinned] = useState(false);
  /** Zoomed-in view: where it's centred, which emotion's songs get covers, and the zoom (fixed once opened). */
  const [discover, setDiscover] = useState<{ center: Pt; section: string; near: string | null; scale: number } | null>(null);
  const [covers, setCovers] = useState<Record<string, string | null>>({});

  // Page-wide glow and axes are centred on the board, wherever layout puts it.
  const stage = useRef<HTMLElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const [boardHalf, setBoardHalf] = useState(300);
  useLayoutEffect(() => {
    const place = () => {
      const s = stage.current?.getBoundingClientRect(), b = board.current?.getBoundingClientRect();
      if (!s || !b || !stage.current) return;
      stage.current.style.setProperty("--cx", `${b.left - s.left + b.width / 2}px`);
      stage.current.style.setProperty("--cy", `${b.top - s.top + b.height / 2}px`);
      stage.current.style.setProperty("--bh", `${b.height / 2}px`);
      setBoardHalf(b.width / 2);
    };
    place();
    const ro = new ResizeObserver(place);
    if (stage.current) ro.observe(stage.current);
    if (board.current) ro.observe(board.current);
    return () => ro.disconnect();
  }, []);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const findSong = async () => {
    setFinding(true); setNotFound(false); setPick(null);
    audio.current?.pause();
    const done = votedSongs();
    const inSection = songs.filter((s) => sectionOf(s) === section);
    const fresh = inSection.filter((s) => !done.has(songKey(s)));
    for (const s of shuffle(fresh.length ? fresh : inSection).slice(0, TRIES)) {
      const p = await findPreview(s);
      if (p) {
        setPick({ song: s, preview: p, step: "listen" });
        setProgress(0); setPlaying(false); setFinding(false);
        return;
      }
    }
    setFinding(false); setNotFound(true);
  };

  const touched = () => setPick((p) => (p && p.step === "listen" ? { ...p, step: "ask" } : p));
  const togglePlay = () => {
    const el = audio.current;
    if (!el || !pick) return;
    if (playing) { el.pause(); return; }
    if (el.src !== pick.preview.audioUrl) el.src = pick.preview.audioUrl;
    el.volume = PREVIEW_VOLUME;
    el.play().catch(() => setPlaying(false));
    touched();
  };

  const model = pick ? { v: pick.song.valence, a: pick.song.arousal } : null;
  const vote = (agree: boolean, at?: Pt) => {
    if (!pick || !model) return;
    void sendVote({
      song: songKey(pick.song), blind: false, agree, model, source: "minimal",
      ...(at ? { v: at.valence, a: at.arousal, placed: true } : { ...model, placed: agree }),
    });
  };
  const thumbsUp = () => { vote(true); setPick((p) => p && { ...p, step: "thanks" }); };
  const thumbsDown = () => { setDiscover(null); setPlaceAt(dot); setPlacePinned(false); setPick((p) => p && { ...p, step: "place" }); };
  const savePlace = () => { vote(false, placeAt); setPick((p) => p && { ...p, step: "placed" }); };
  const skipPlace = () => { vote(false); setPick((p) => p && { ...p, step: "placed" }); };
  const card = useRef<HTMLDivElement>(null);
  const findBtn = useRef<HTMLButtonElement>(null);
  const close = () => { audio.current?.pause(); setPick(null); findBtn.current?.focus({ preventScroll: true }); };
  // A new song card takes focus, so keyboard and screen-reader users land on it.
  const cardSong = pick && pick.step !== "place" ? pick.song.id : null;
  useEffect(() => { if (cardSong) card.current?.focus({ preventScroll: true }); }, [cardSong]);

  // Sharing: a song link opens the site on that song; the banner shares the site itself.
  const [shareNote, setShareNote] = useState<string | null>(null);
  const flash = (msg: string) => { setShareNote(msg); setTimeout(() => setShareNote(null), 2200); };
  const shareSong = async () => {
    if (!pick) return;
    const e = emotionAt(pick.song.valence, pick.song.arousal);
    const feeling = `I’m feeling ${(e?.name ?? "Mixed").toLowerCase()} ${e?.emoji ?? MIXED_EMOJI}`;
    const r = await share({ title: "senti", url: songLink(pick.song),
      text: `${feeling}\n🎵 ${pick.song.title} by ${pick.song.artist}\n\nFind a song for how you feel on senti:` });
    if (r === "copied") flash("Link copied");
  };
  const shareSite = async () => {
    const r = await share({ title: "senti", url: window.location.origin,
      text: "senti: pick a feeling, get a song that fits it." });
    if (r === "copied") flash("Link copied");
  };

  // Opened from a share link: put the light on that song and show its card.
  const opened = useRef(false);
  useEffect(() => {
    const key = sharedSongKey();
    if (opened.current || !key || !hits.length) return;
    opened.current = true;
    const s = songs.find((x) => songKey(x) === key);
    if (!s) return;
    setDot({ valence: s.valence, arousal: s.arousal });
    setPinned(true);
    findPreview(s).then((p) => { if (p) { setPick({ song: s, preview: p, step: "listen" }); setProgress(0); } });
  }, [hits, songs]);

  const placing = pick?.step === "place";

  // Discover: zoom in around the song, far enough that its nearest neighbours in the same emotion spread
  // across the view (songs cluster tightly), and show what else is nearby.
  const view = useMemo(() => {
    if (!discover) return null;
    const { center } = discover;
    const d = (s: PlacedSong) => Math.hypot(s.valence - center.valence, s.arousal - center.arousal);
    const featured = songs.filter((s) => sectionOf(s) === discover.section).sort((a, b) => d(a) - d(b)).slice(0, FEATURED);
    const { scale } = discover;
    const ids = new Set(featured.map((s) => s.id));
    const others = songs.filter((s) => !ids.has(s.id) && Math.abs(s.valence - center.valence) < 1.1 / scale
      && Math.abs(s.arousal - center.arousal) < 1.1 / scale).sort((a, b) => d(a) - d(b)).slice(0, OTHERS);
    // Nudge covers apart so they don't stack (display positions only; true positions are kept for votes).
    const gap = (COVER_PX + 6) / (boardHalf * scale);
    const at = featured.map((s) => ({ v: s.valence, a: s.arousal }));
    for (let it = 0; it < 60; it++) {
      for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) {
        const dv = at[j].v - at[i].v, da = at[j].a - at[i].a, dist = Math.hypot(dv, da) || 1e-6;
        if (dist >= gap) continue;
        const push = (gap - dist) / 2, ux = dist > 1e-6 ? dv / dist : Math.cos(i + j), uy = dist > 1e-6 ? da / dist : Math.sin(i + j);
        at[i].v -= ux * push; at[i].a -= uy * push; at[j].v += ux * push; at[j].a += uy * push;
      }
    }
    return { scale, items: [
      ...others.map((s) => ({ song: s, featured: false, v: s.valence, a: s.arousal })),
      ...featured.map((s, i) => ({ song: s, featured: true, v: at[i].v, a: at[i].a })),
    ] };
  }, [discover, songs, boardHalf]);
  const nearby = view?.items ?? [];

  // Fetch covers for the featured songs a few at a time (the iTunes search allows about 20 lookups a minute).
  useEffect(() => {
    if (!discover) return;
    let cancelled = false;
    const todo = nearby.filter((n) => n.featured && !(n.song.id in covers)).map((n) => n.song);
    (async () => {
      for (const s of todo) {
        if (cancelled) return;
        const p = await findPreview(s);
        if (cancelled) return;
        setCovers((c) => ({ ...c, [s.id]: p?.artworkUrl ?? null }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discover, nearby]);

  const fieldSongs: FieldSong[] = nearby.map(({ song, featured, v, a }) => ({
    id: song.id, valence: v, arousal: a, title: `${song.title} · ${song.artist}`, featured,
    color: COLOR[emotionAt(song.valence, song.arousal)?.mood ?? "mixed"], artwork: covers[song.id] ?? undefined,
  }));

  const openDiscover = () => {
    if (!pick) return;
    // Zoom far enough that the song's nearest neighbours in the same emotion spread across the view.
    const center = { valence: pick.song.valence, arousal: pick.song.arousal }, section = sectionOf(pick.song);
    const d = (s: PlacedSong) => Math.hypot(s.valence - center.valence, s.arousal - center.arousal);
    const nearest = songs.filter((s) => sectionOf(s) === section).map(d).sort((a, b) => a - b).slice(0, FEATURED);
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, 0.6 / Math.max(...nearest, 0.01)));
    setDiscover({ center, section, near: pick.song.title, scale });
  };
  const closeDiscover = () => setDiscover(null);
  // Dragging the zoomed map recentres it; covers follow whichever emotion is now in the middle.
  const panTo = (center: Pt) => setDiscover((d) => d && { ...d, center, section: sectionOf(center), near: null });
  // The centre while a drag is in progress, so the page glow moves with the map.
  const [livePan, setLivePan] = useState<Pt | null>(null);
  // Escape closes the song card first, then the zoomed view.
  const escape = useRef(() => {});
  escape.current = () => { if (pick && !placing) close(); else if (discover) closeDiscover(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") escape.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const playNearby = async (id: string) => {
    const s = songs.find((x) => x.id === id);
    if (!s) return;
    audio.current?.pause();
    const p = await findPreview(s);
    if (p) { setPick({ song: s, preview: p, step: "listen" }); setProgress(0); setPlaying(false); }
  };

  const idx = emotion ? EMOTIONS.indexOf(emotion) : WHEEL.length - 1;
  return (
    <div className="minimal" style={{ "--glow": color } as React.CSSProperties}>
      <header className="banner">
        <span className="brand" translate="no"><img className="brand-mark" src="/senti-mark.svg" alt="" width="36" height="26" />senti</span>
        <nav aria-label="About senti">
          <a href="about.html">About</a>
          <a href={REPO} target="_blank" rel="noreferrer" className="banner-icon" aria-label="Code on GitHub" title="Code on GitHub"><GitHubLogo /></a>
          <button type="button" className="banner-share" onClick={shareSite} aria-label="Share senti">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
            </svg>
            Share
          </button>
        </nav>
      </header>

      <main
        className={`stage${discover ? " is-discovering" : ""}${livePan ? " is-panning" : ""}`}
        ref={stage}
        style={(discover && view ? {
          "--zv": (livePan ?? discover.center).valence, "--za": (livePan ?? discover.center).arousal, "--zk": view.scale,
        } : {}) as React.CSSProperties}
      >
        <div className="page-glow" aria-hidden="true" />
        <div className="page-axes" aria-hidden="true">
          <span className="axis axis-x" /><span className="axis axis-y" />
          <span className="axis-end end-right">Feels good →</span>
          <span className="axis-end end-left">← Feels bad</span>
          <span className="axis-end end-top">↑ Energetic</span>
          <span className="axis-end end-bottom">↓ Calm</span>
        </div>
        <div className="board" ref={board}>
          <Field
            dot={dot}
            labelColor={labelColor}
            onMove={setDot}
            color={color}
            pinned={placing ? placePinned : pinned}
            onPin={placing ? setPlacePinned : setPinned}
            placing={placing ? { at: placeAt, artwork: pick!.preview.artworkUrl, onMove: setPlaceAt } : undefined}
            zoom={discover && view ? { center: discover.center, scale: view.scale, songs: fieldSongs, onSong: playNearby, onPan: panTo, onPanLive: setLivePan } : null}
          />

          {discover && (
            <div className="discover-bar">
              <p><span style={{ color: COLOR[EMOTIONS.find((e) => e.name === discover.section)?.mood ?? "mixed"] }}>{discover.section}</span> songs {discover.near ? <>near <b>{discover.near}</b></> : "here"} <span className="pan-hint">· drag or use arrow keys to explore</span></p>
              <button type="button" className="minimize" onClick={closeDiscover} aria-label="Back to the full map" title="Back to the full map">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
                </svg>
              </button>
            </div>
          )}

          <div className={`dock${!pinned && !placing ? " is-collapsed" : ""}`} aria-hidden={discover ? true : undefined}>
            {placing ? (
              <div className="place-bar">
                <p>Click where <b>{pick!.song.title}</b> belongs: <span style={{ color: COLOR[emotionAt(placeAt.valence, placeAt.arousal)?.mood ?? "mixed"] }}>{sectionOf(placeAt)}</span></p>
                <div className="row">
                  <button type="button" className="ghost" onClick={skipPlace}>Skip</button>
                  <button type="button" className="solid" onClick={savePlace}>Save</button>
                </div>
              </div>
            ) : (
              <>
                <Feeling idx={idx} />
                {/* Opens once the light is dropped; folds away again when it's picked up. */}
                <div className="dock-more" aria-hidden={!pinned ? true : undefined}>
                  <button type="button" className="find" ref={findBtn} onClick={findSong} disabled={finding || !songs.length} tabIndex={pinned ? 0 : -1}>
                    <span className="find-icon" aria-hidden="true">▶</span>
                    {finding ? "Finding a song…" : `Play me something ${section.toLowerCase()}`}
                  </button>
                  <p className="hint">{notFound ? "Couldn’t find a playable song here. Try another spot."
                    : TOUCH ? "Tap anywhere to move the light." : "Click anywhere to move the light."}</p>
                </div>
              </>
            )}
          </div>

        </div>

        {pick && !placing && (
          <div className="card" ref={card} tabIndex={-1} role="dialog" aria-labelledby="card-title">
            <button type="button" className="close" onClick={close} aria-label="Close">×</button>
            <div className="card-top">
              <button type="button" className="cover" onClick={togglePlay} aria-label={playing ? "Pause preview" : "Play 30-second preview"}>
                {pick.preview.artworkUrl ? <img src={pick.preview.artworkUrl} alt="" width={220} height={220} /> : <span className="cover-blank">♪</span>}
                <span className="cover-play" aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
                <svg className="ring" viewBox="0 0 36 36" aria-hidden="true">
                  <circle cx="18" cy="18" r="16" pathLength="1" style={{ strokeDashoffset: 1 - progress }} />
                </svg>
              </button>
              <div className="meta">
                <h2 className="title" id="card-title">{pick.song.title}</h2>
                <div className="artist">{pick.song.artist}{pick.song.year ? ` · ${pick.song.year}` : ""}</div>
                <div className="links">
                  <a href={spotifySearchUrl(pick.song)} target="_blank" rel="noreferrer" onClick={touched}><SpotifyLogo /> Spotify</a>
                  <a href={pick.preview.pageUrl} target="_blank" rel="noreferrer" onClick={touched}><AppleMusicLogo /> Apple Music</a>
                  <button type="button" className="share-btn" onClick={shareSong} aria-label={`Share ${pick.song.title}`}>
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
                    </svg>
                    Share
                  </button>
                </div>
              </div>
            </div>

            {!discover && (
              <button type="button" className="discover-link" onClick={openDiscover}>
                Discover more {sectionOf(pick.song).toLowerCase()} songs <span aria-hidden="true">→</span>
              </button>
            )}
            {pick.step === "ask" && (
              <div className="ask">
                <p className="ask-q">How did we do?</p>
                <p className="ask-sub">Your answer helps train the next version of the model.</p>
                <div className="row">
                  <button type="button" className="thumb up" onClick={thumbsUp} aria-label="Good match"><span>👍</span></button>
                  <button type="button" className="thumb down" onClick={thumbsDown} aria-label="Not a match"><span>👎</span></button>
                </div>
              </div>
            )}
            {(pick.step === "thanks" || pick.step === "placed") && (
              <div className="ask">
                <p className="ask-q">{pick.step === "thanks" ? "Glad it fit." : "Thanks, noted."}</p>
                <VibePicker key={pick.song.id} song={songKey(pick.song)} at={{ v: pick.song.valence, a: pick.song.arousal }} />
                <div className="row"><button type="button" className="ghost" onClick={findSong}>Another one</button></div>
              </div>
            )}
          </div>
        )}
      </main>

      {shareNote && <div className="toast" role="status">{shareNote}</div>}

      <audio
        ref={audio}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
      />
    </div>
  );
}
