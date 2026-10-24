import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { findPreview } from "../preview";
import { makePlan, newRaterCode } from "./plan";
import type { StudySong, Trial } from "./plan";

/**
 * Unlisted listening study (/rate/): 100 songs in two halves that each cover the map; each person hears one half (the one
 * fewer people have done so far), 50 short clips in their own random order with a few
 * hidden repeats, and places the mood each song expresses on a plain grid with no emotion names, so their answers can be compared with each
 * other and with the model. Progress is kept in the browser, so closing the tab and coming back resumes.
 */

const STORE = "senti:rate";
/** Seconds of a clip to hear before Next unlocks. */
const MIN_LISTEN = 8;

interface Progress {
  rater: string; half: number; plan: Trial[]; done: number; unsent: Rating[];
  /** When they ticked the consent box; practice songs heard (not scored); whether the scored songs have begun. */
  consented?: number; practiced?: number; begun?: boolean;
  /** Code for the Venmo note, issued after finishing and stored apart from the answers on the server. */
  payCode?: string;
}
interface Rating { rater: string; half: number; trial: number; song: string; repeat: boolean; v?: number; a?: number; skipped?: boolean; listened: number; consent?: boolean; known?: boolean }

/** Two unscored warm-up songs (not in the study) with an obvious mood, so people learn the grid before it counts. */
const PRACTICE: StudySong[] = [
  { id: "The Loco-Motion|Little Eva", title: "The Loco-Motion", artist: "Little Eva", half: -1, v: 0, a: 0,
    preview: ["https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/d8/54/d7/d854d77f-7210-f5f5-5d28-c22d2526b295/mzaf_16922533634313490121.plus.aac.p.m4a",
      "https://music.apple.com/us/album/the-loco-motion/432437358?i=432437410&uo=4", ""] },
  { id: "Crying|Roy Orbison", title: "Crying", artist: "Roy Orbison", half: -1, v: 0, a: 0,
    preview: ["https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/91/20/c1/9120c173-6e92-e562-fb17-fb52afe350a5/mzaf_768896915777283170.plus.aac.p.m4a",
      "https://music.apple.com/us/album/crying/388154437?i=388154726&uo=4", ""] },
];
type Pt = { v: number; a: number };

function load(): Progress | null {
  try {
    const p = JSON.parse(localStorage.getItem(STORE) ?? "null");
    // Progress from the first 50-song version (no halves) can't continue: start fresh.
    if (!p || typeof p.half !== "number") return null;
    // People who started before the practice songs existed carry straight on.
    return p.practiced === undefined ? { ...p, practiced: PRACTICE.length, begun: true } : p;
  } catch { return null; }
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

  // Once every answer has arrived, ask for a payment code (a separate code, not linked to the answers).
  const [payError, setPayError] = useState<string | null>(null);
  useEffect(() => {
    if (!progress || progress.done < progress.plan.length || progress.payCode || progress.unsent.length) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/rate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claim: progress.rater }) });
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok && body.code) { setProgress((p) => { if (!p) return p; const n = { ...p, payCode: body.code }; save(n); return n; }); setPayError(null); }
        else setPayError(body.error === "already claimed" ? "claimed" : "failed");
      } catch { if (!cancelled) setPayError("failed"); }
    })();
    return () => { cancelled = true; };
  }, [progress?.done, progress?.unsent.length, progress?.payCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const [starting, setStarting] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [consented, setConsented] = useState(false);
  const start = async () => {
    if (!songs || starting) return;
    setStarting(true);
    // The half fewer people have started; a coin flip if the counts can't be fetched.
    let half = Math.random() < 0.5 ? 0 : 1;
    try {
      const { halves } = await (await fetch("/api/rate", { cache: "no-store" })).json();
      if (Array.isArray(halves) && halves[0] !== halves[1]) half = halves[0] < halves[1] ? 0 : 1;
    } catch { /* keep the coin flip */ }
    const ids = [...songs.values()].filter((s) => s.half === half).map((s) => s.id);
    const p: Progress = { rater: newRaterCode(), half, plan: makePlan(ids), done: 0, unsent: [], consented: Date.now(), practiced: 0, begun: false };
    save(p); setProgress(p);
  };

  const answer = async (r: Omit<Rating, "rater" | "half" | "trial" | "song" | "repeat">) => {
    if (!progress) return;
    const t = progress.plan[progress.done];
    const rating: Rating = { rater: progress.rater, half: progress.half, trial: progress.done, song: t.id, repeat: t.repeat, consent: true, ...r };
    const next: Progress = { ...progress, done: progress.done + 1 };
    if (!(await send(rating))) next.unsent = [...progress.unsent, rating];
    save(next); setProgress(next);
  };

  if (loadError) return <main className="rate"><p className="note">Couldn't load the study. Check your connection and refresh.</p></main>;
  if (!songs) return <main className="rate" aria-busy="true" />;

  // First a consent screen of its own; ticking the box and continuing leads to the instructions.
  if (!progress && !consented) {
    return (
      <main className="rate intro">
        <h1>Before you start</h1>
        <p>This is a short listening study for senti, a music app, to see how people hear the mood of songs
          and how close the app gets. It takes about 20 minutes, and you get $5, paid through Venmo, when you finish.</p>
        <ul>
          <li>Taking part is voluntary. You can stop at any point.</li>
          <li>You must be 18 or older.</li>
          <li>We save only where you place each song and how long you listened, under a random code, never your name.
            Results are only reported as group averages.</li>
          <li>At the end you get a separate payment code for the Venmo request. It isn't linked to your answers, so your Venmo
            name can't be matched to how you rated.</li>
          <li>Questions, or want your answers deleted at any time? Email <a href="mailto:study@playsenti.com">study@playsenti.com</a> with your code.</li>
        </ul>
        <label className="tick">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>I'm 18 or older, I've read this, and I agree to take part.</span>
        </label>
        <button type="button" className="primary" onClick={() => setConsented(true)} disabled={!agreed}>Continue</button>
      </main>
    );
  }

  if (!progress) {
    return (
      <main className="rate intro">
        <h1>How it works</h1>
        <p>You'll hear {songs.size / 2 + 4} short song clips, about 20 minutes in all, after {PRACTICE.length} practice songs that don't count.</p>
        <p>For each one, tap the grid where the <b>song's mood</b> belongs:</p>
        <ul>
          <li><b>Left to right:</b> how negative or positive the mood it expresses is.</li>
          <li><b>Bottom to top:</b> how calm or energetic it is.</li>
        </ul>
        <p>Rate the mood the song puts across, not how it makes you feel. A sad song you love still goes on the negative side.</p>
        <p>There are no right answers. Go with your first instinct, and judge the song as you hear it, not what you know about it. Headphones help.</p>
        <p className="dim">Your progress is saved in this browser, so you can take a break and come back. <b>Don't use a private or incognito tab, and finish on the same phone or computer and the same browser</b>, or you'll lose your place and have to start over.</p>
        <button type="button" className="primary" onClick={start} disabled={starting}>Start</button>
      </main>
    );
  }

  if (progress.done >= progress.plan.length) {
    return (
      <main className="rate intro">
        <h1>All done. Thank you!</h1>
        {progress.payCode ? (
          <>
            <p>Your payment code is <b className="code">{progress.payCode}</b></p>
            <p>You get <b>$5</b> for your time through Venmo: send a request to <b>@jasondgarcia</b> with this payment code in
              the note. The code isn't linked to your answers, so your Venmo name can't be matched to how you rated.</p>
          </>
        ) : progress.unsent.length > 0 ? (
          <p className="note">{progress.unsent.length} answers are still sending. Keep this page open for a moment, and your payment code will appear.</p>
        ) : payError ? (
          <p className="note">Couldn't get your payment code{payError === "claimed" ? " (one was already given out for this run)" : ""}.
            {payError === "failed" ? " Refresh to try again, or e" : " E"}mail <a href="mailto:study@playsenti.com">study@playsenti.com</a> with your answer code below.</p>
        ) : <p className="note">Getting your payment code…</p>}
        <p className="dim">Your answer code is <b className="code">{progress.rater}</b>. Keep it if you might want your answers
          deleted, or have a question: email <a href="mailto:study@playsenti.com">study@playsenti.com</a>.</p>
      </main>
    );
  }

  // Warm-up: the practice songs first (nothing is sent), then a moment to say the real ones start now.
  const practiced = progress.practiced ?? PRACTICE.length;
  if (practiced < PRACTICE.length) {
    const next = () => { const n = { ...progress, practiced: practiced + 1 }; save(n); setProgress(n); };
    return <TrialView key={`practice-${practiced}`} n={practiced} total={PRACTICE.length} practice song={PRACTICE[practiced]} onAnswer={next} />;
  }
  if (!progress.begun) {
    const begin = () => { const n = { ...progress, begun: true }; save(n); setProgress(n); };
    return (
      <main className="rate intro">
        <h1>Practice done</h1>
        <p>That's how it works. Now the {progress.plan.length} songs that count. Same as before: place the mood the song puts
          across, and go with your first instinct.</p>
        <p>Your code is <b className="code">{progress.rater}</b>. It stays at the top of the screen. Jot it down in case you lose
          your place, so you can still claim your $5.</p>
        <button type="button" className="primary" onClick={begin}>Start the real songs</button>
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
  return <TrialView key={progress.done} n={progress.done} total={progress.plan.length} song={song} code={progress.rater} onAnswer={answer} />;
}

function TrialView({ n, total, song, practice = false, code, onAnswer }: {
  n: number; total: number; song: StudySong; practice?: boolean;
  /** Shown throughout, so someone in a private window who closes it can still claim with the code they noted. */
  code?: string;
  onAnswer: (r: { v?: number; a?: number; skipped?: boolean; listened: number; known?: boolean }) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null | undefined>(song.preview?.[0]);
  const [playing, setPlaying] = useState(false);
  const [listened, setListened] = useState(0);
  const [ended, setEnded] = useState(false);
  const [pt, setPt] = useState<Pt | null>(null);
  const [busy, setBusy] = useState(false);
  const [known, setKnown] = useState(false);

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
    onAnswer(skipped ? { skipped: true, listened, known } : { v: pt!.v, a: pt!.a, listened, known });
  };

  return (
    <main className="rate trial">
      <div className="top">
        <span className="count">{practice ? `Practice song ${n + 1} of ${total} · not counted` : `Song ${n + 1} of ${total}`}</span>
        <span className="bar" aria-hidden="true"><span style={{ width: `${(n / total) * 100}%` }} /></span>
        {code && <span className="mycode" title="Your completion code">Code <b className="code">{code}</b></span>}
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

      <label className="known">
        <input type="checkbox" checked={known} onChange={(e) => setKnown(e.target.checked)} /> I already know this song
      </label>
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
