import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { findPreview } from "../preview";
import { makePlan, newRaterCode } from "./plan";
import type { StudySong, Trial } from "./plan";

/**
 * Unlisted listening study (/rate/): each person hears the same 50 short clips in their own random order, with a few
 * hidden repeats, and places the mood each song expresses on a plain grid with no emotion names, so their answers can be compared with each
 * other and with the model. Progress is kept in the browser, so closing the tab and coming back resumes.
 */

const STORE = "senti:rate";
/** Seconds of a clip to hear before Next unlocks. */
const MIN_LISTEN = 8;

interface Progress { rater: string; plan: Trial[]; done: number; unsent: Rating[] }
interface Rating { rater: string; trial: number; song: string; repeat: boolean; v?: number; a?: number; skipped?: boolean; listened: number }
type Pt = { v: number; a: number };

function load(): Progress | null {
  try { return JSON.parse(localStorage.getItem(STORE) ?? "null"); } catch { return null; }
}
function save(p: Progress) {
  try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* private mode: progress lives only in this tab */ }
}
async function send(r: Rating): Promise<boolean> {
  try {
    const res = await fetch("/api/rate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(r) });
    return res.ok;
  } catch { return false; }
}
const clamp = (x: number) => Math.max(-1, Math.min(1, x));

export function Rate() {
  const [songs, setSongs] = useState<Map<string, StudySong> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(load);

  useEffect(() => {
    fetch("/rate/songs.json").then((r) => r.json())
      .then(({ songs }: { songs: StudySong[] }) => setSongs(new Map(songs.map((s) => [s.id, s]))))
      .catch(() => setLoadError(true));
  }, []);

  // Ratings that failed to send (offline for a moment) go again whenever the page is used.
  useEffect(() => {
    if (!progress?.unsent.length) return;
    let cancelled = false;
    (async () => {
      const left: Rating[] = [];
      for (const r of progress.unsent) if (!(await send(r))) left.push(r);
      if (!cancelled && left.length !== progress.unsent.length) {
        setProgress((p) => { if (!p) return p; const n = { ...p, unsent: left }; save(n); return n; });
      }
    })();
    return () => { cancelled = true; };
  }, [progress?.done]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    if (!songs) return;
    const p: Progress = { rater: newRaterCode(), plan: makePlan([...songs.keys()]), done: 0, unsent: [] };
    save(p); setProgress(p);
  };

  const answer = async (r: Omit<Rating, "rater" | "trial" | "song" | "repeat">) => {
    if (!progress) return;
    const t = progress.plan[progress.done];
    const rating: Rating = { rater: progress.rater, trial: progress.done, song: t.id, repeat: t.repeat, ...r };
    const next: Progress = { ...progress, done: progress.done + 1 };
    if (!(await send(rating))) next.unsent = [...progress.unsent, rating];
    save(next); setProgress(next);
  };

  if (loadError) return <main className="rate"><p className="note">Couldn't load the study. Check your connection and refresh.</p></main>;
  if (!songs) return <main className="rate" aria-busy="true" />;

  if (!progress) {
    return (
      <main className="rate intro">
        <h1>senti listening study</h1>
        <p>You'll hear {songs.size + 4} short song clips, about 20 minutes in all.</p>
        <p>For each one, tap the grid where the <b>song's mood</b> belongs:</p>
        <ul>
          <li><b>Left to right:</b> how negative or positive the mood it expresses is.</li>
          <li><b>Bottom to top:</b> how calm or energetic it is.</li>
        </ul>
        <p>Rate the mood the song puts across, not how it makes you feel. A sad song you love still goes on the negative side.</p>
        <p>There are no right answers. Go with your first instinct, and judge the song as you hear it, not what you know about it. Headphones help.</p>
        <p className="dim">Your progress is saved on this device, so you can take a break and come back.</p>
        <button type="button" className="primary" onClick={start}>Start</button>
      </main>
    );
  }

  if (progress.done >= progress.plan.length) {
    return (
      <main className="rate intro">
        <h1>All done. Thank you!</h1>
        <p>Your code is <b className="code">{progress.rater}</b>. Send it to Jason so he knows you finished.</p>
        {progress.unsent.length > 0 && <p className="note">{progress.unsent.length} answers are still sending. Keep this page open for a moment.</p>}
      </main>
    );
  }

  const t = progress.plan[progress.done];
  const song = songs.get(t.id);
  // Only if the song list changed after this person started.
  if (!song) {
    return (
      <main className="rate intro">
        <p>This song is no longer in the study.</p>
        <button type="button" className="primary" onClick={() => answer({ skipped: true, listened: 0 })}>Next</button>
      </main>
    );
  }
  return <TrialView key={progress.done} n={progress.done} total={progress.plan.length} song={song} onAnswer={answer} />;
}

function TrialView({ n, total, song, onAnswer }: {
  n: number; total: number; song: StudySong; onAnswer: (r: { v?: number; a?: number; skipped?: boolean; listened: number }) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null | undefined>(song.preview?.[0]);
  const [playing, setPlaying] = useState(false);
  const [listened, setListened] = useState(0);
  const [ended, setEnded] = useState(false);
  const [pt, setPt] = useState<Pt | null>(null);
  const [busy, setBusy] = useState(false);

  // Songs without a stored preview are looked up when they come up.
  useEffect(() => {
    if (src !== undefined) return;
    let cancelled = false;
    findPreview({ title: song.title, artist: song.artist }).then((p) => { if (!cancelled) setSrc(p?.audioUrl ?? null); });
    return () => { cancelled = true; };
  }, [song, src]);

  // Count only time actually heard.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = setInterval(() => { const now = performance.now(); setListened((s) => s + (now - last) / 1000); last = now; }, 250);
    return () => clearInterval(id);
  }, [playing]);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false)); else el.pause();
  };
  const place = (e: PointerEvent<HTMLDivElement>) => {
    const b = grid.current!.getBoundingClientRect();
    setPt({ v: clamp(((e.clientX - b.left) / b.width) * 2 - 1), a: clamp(1 - ((e.clientY - b.top) / b.height) * 2) });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.2 : 0.05;
    const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] } as Record<string, number[]>)[e.key];
    if (!d) return;
    e.preventDefault();
    setPt((p) => ({ v: clamp((p?.v ?? 0) + d[0]), a: clamp((p?.a ?? 0) + d[1]) }));
  };
  const heardEnough = listened >= MIN_LISTEN || ended;
  const submit = (skipped: boolean) => {
    if (busy) return;
    setBusy(true);
    audio.current?.pause();
    onAnswer(skipped ? { skipped: true, listened } : { v: pt!.v, a: pt!.a, listened });
  };

  return (
    <main className="rate trial">
      <div className="top">
        <span className="count">Song {n + 1} of {total}</span>
        <span className="bar" aria-hidden="true"><span style={{ width: `${(n / total) * 100}%` }} /></span>
      </div>
      <div className="song">
        <button type="button" className="play" onClick={toggle} disabled={!src} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>
            : <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>}
        </button>
        <div className="meta">
          <p className="title">{song.title}</p>
          <p className="artist">{song.artist}</p>
          <p className="status" aria-live="polite">
            {src === undefined ? "Finding the clip…" : src === null ? "This clip won't load. Tap Skip below."
              : heardEnough ? "Place it on the grid when you're ready." : playing ? "Listening…" : "Press play to hear the clip."}
          </p>
        </div>
        {src && <audio ref={audio} src={src} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setEnded(true); }} onError={() => setSrc(null)} />}
      </div>

      <div className="grid-wrap">
        <span className="edge e-top">Energetic</span>
        <span className="edge e-bottom">Calm</span>
        <span className="edge e-left">Negative</span>
        <span className="edge e-right">Positive</span>
        <div ref={grid} className="grid" role="application" tabIndex={0}
          aria-label="Place the song's mood: left to right is how negative or positive it is, bottom to top is how calm or energetic it is. Use the arrow keys."
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); place(e); }}
          onPointerMove={(e) => { if (e.buttons) place(e); }} onKeyDown={onKey}>
          <span className="axis ax-x" /><span className="axis ax-y" />
          {pt && <span className="dot" style={{ left: `${((pt.v + 1) / 2) * 100}%`, top: `${((1 - pt.a) / 2) * 100}%` }} />}
        </div>
      </div>

      <div className="actions">
        {/* Skipping is only for a clip that won't play, so people can't skip songs they find hard to place. */}
        {src === null ? <button type="button" className="link" onClick={() => submit(true)} disabled={busy}>Skip</button> : <span />}
        <button type="button" className="primary" onClick={() => submit(false)} disabled={!pt || !heardEnough || busy}>
          {!heardEnough && src ? `Listen a little longer (${Math.max(1, Math.ceil(MIN_LISTEN - listened))}s)` : "Next"}
        </button>
      </div>
    </main>
  );
}
