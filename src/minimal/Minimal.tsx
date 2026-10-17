import { useEffect, useMemo, useRef, useState } from "react";
import catalogJson from "../data/catalog.json";
import { loadHits } from "../catalog";
import { EMOTIONS, MIXED_EMOJI, emotionAt, placeSong, spotifySearchUrl } from "../mood";
import type { Mood, PlacedSong, Song } from "../mood";
import { findPreview } from "../preview";
import type { Preview } from "../preview";
import { sendVote, songKey, votedSongs } from "../feedback";
import { Field } from "./Field";
import type { Pt } from "./Field";
import { AppleMusicLogo, SpotifyLogo } from "./logos";
import "./minimal.css";

/** Emotion colours, the same as the classic map's quadrants. */
const COLOR: Record<Mood | "mixed", string> = {
  happy: "#f6b93b", angry: "#f0604d", sad: "#5b8cff", relaxed: "#31c9a3", mixed: "#b8c4e8",
};
const PREVIEW_VOLUME = 0.4;
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
function Feeling({ dot }: { dot: Pt }) {
  const e = emotionAt(dot.valence, dot.arousal);
  const idx = e ? EMOTIONS.indexOf(e) : WHEEL.length - 1;
  // Continuous wheel position: move to the nearest copy of the new emotion so the wheel takes the short way round.
  const [pos, setPos] = useState(idx + WHEEL.length * Math.floor(COPIES / 2));
  const [animate, setAnimate] = useState(true);
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
  const current = WHEEL[idx];
  return (
    <h1 className="feeling">
      <span className="feeling-lead">I'm feeling</span>
      <span className="wheel" aria-live="polite">
        <span className="sr-only">{current.name}</span>
        <span className={`wheel-track${animate ? "" : " no-anim"}`} style={{ transform: `translateY(${-pos * 1.35}em)` }} aria-hidden="true">
          {items.map((w, i) => {
            const d = i - pos;
            if (Math.abs(d) > 3) return <span key={i} className="wheel-item" />;
            return (
              <span key={i} className="wheel-item" style={{
                color: w.color,
                opacity: d === 0 ? 1 : Math.max(0, 0.32 - (Math.abs(d) - 1) * 0.2),
                transform: `perspective(300px) rotateX(${-d * 28}deg) scale(${1 - Math.abs(d) * 0.08})`,
              }}>
                <span className="wheel-emoji">{w.emoji}</span>{w.name.toLowerCase()}
              </span>
            );
          })}
        </span>
      </span>
    </h1>
  );
}

const LINKS = [
  { label: "How it works", href: "?classic" },
  { label: "Data & model", href: "https://github.com/jason-d-garcia/moodify/blob/main/data/README.md" },
  { label: "Code", href: "https://github.com/jason-d-garcia/moodify" },
];

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
  const thumbsDown = () => { setPlaceAt(dot); setPlacePinned(false); setPick((p) => p && { ...p, step: "place" }); };
  const savePlace = () => { vote(false, placeAt); setPick((p) => p && { ...p, step: "placed" }); };
  const skipPlace = () => { vote(false); setPick((p) => p && { ...p, step: "placed" }); };
  const close = () => { audio.current?.pause(); setPick(null); };

  const placing = pick?.step === "place";
  return (
    <div className="minimal" style={{ "--glow": color } as React.CSSProperties}>
      <header className="banner">
        <span className="brand"><span className="brand-dot" aria-hidden="true" />Moodify</span>
        <nav aria-label="About Moodify">
          {LINKS.map((l) => (
            <a key={l.label} href={l.href} {...(l.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>{l.label}</a>
          ))}
        </nav>
      </header>

      <main className="stage">
        <div className="board">
          <Field
            dot={dot}
            onMove={setDot}
            color={color}
            pinned={placing ? placePinned : pinned}
            onPin={placing ? setPlacePinned : setPinned}
            placing={placing ? { at: placeAt, artwork: pick!.preview.artworkUrl, onMove: setPlaceAt } : undefined}
          />

          <div className="dock">
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
                <Feeling dot={dot} />
                <button type="button" className="find" onClick={findSong} disabled={finding || !songs.length}>
                  <span className="find-icon" aria-hidden="true">▶</span>
                  {finding ? "Finding a song…" : `Play me something ${section.toLowerCase()}`}
                </button>
                <p className="hint">{notFound ? "Couldn't find a playable song here. Try another spot."
                  : pinned ? "Light dropped. Click anywhere to move it." : "Move to explore, click to drop the light."}</p>
              </>
            )}
          </div>

      {pick && !placing && (
        <div className="card" role="dialog" aria-label={`${pick.song.title} by ${pick.song.artist}`}>
          <button type="button" className="close" onClick={close} aria-label="Close">×</button>
          <div className="card-top">
            <button type="button" className="cover" onClick={togglePlay} aria-label={playing ? "Pause preview" : "Play 30-second preview"}>
              {pick.preview.artworkUrl ? <img src={pick.preview.artworkUrl} alt="" /> : <span className="cover-blank">♪</span>}
              <span className="cover-play" aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
              <svg className="ring" viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r="16" pathLength="1" style={{ strokeDashoffset: 1 - progress }} />
              </svg>
            </button>
            <div className="meta">
              <div className="title">{pick.song.title}</div>
              <div className="artist">{pick.song.artist}{pick.song.year ? ` · ${pick.song.year}` : ""}</div>
              <div className="links">
                <a href={spotifySearchUrl(pick.song)} target="_blank" rel="noreferrer" onClick={touched}><SpotifyLogo /> Spotify</a>
                <a href={pick.preview.pageUrl} target="_blank" rel="noreferrer" onClick={touched}><AppleMusicLogo /> Apple Music</a>
              </div>
            </div>
          </div>

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
              <div className="row"><button type="button" className="ghost" onClick={findSong}>Another one</button></div>
            </div>
          )}
        </div>
      )}

        </div>
      </main>

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
