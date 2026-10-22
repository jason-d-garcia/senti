import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import catalogJson from "../data/catalog.json";
import { around, loadSection, SECTIONS } from "../songs";
import type { CatalogSong } from "../songs";
import { EMOTIONS, MIXED_EMOJI, emotionAt, placeSong, spotifySearchUrl } from "../mood";
import type { Mood, PlacedSong, Song } from "../mood";
import { findPreview, isRateLimited, waitForBudget } from "../preview";
import { loadTile, storedCover, tilesAround } from "../covers";
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
const OTHERS = 260;
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
  // Neighbouring entries show only while the wheel is turning, then fade out (kept rendered until they have).
  const [turning, setTurning] = useState(false);
  const [fading, setFading] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setTurning(true); setFading(true);
    const t = setTimeout(() => setTurning(false), 650);
    const f = setTimeout(() => setFading(false), 650 + 500);
    return () => { clearTimeout(t); clearTimeout(f); };
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
    <h1 className="feeling">
      <span className="feeling-lead">I’m feeling</span>
      <span className="wheel">
        <span className={`wheel-track${animate ? "" : " no-anim"}`} style={{ transform: `translateY(${-pos * 1.35}em)` }}>
          {items.map((w, i) => {
            const d = i - pos;
            // Only the current entry is real text; neighbours exist only while the wheel turns, so the
            // heading reads "I'm feeling elated" to screen readers and search engines.
            if (d !== 0 && (!fading || Math.abs(d) > 2)) return <span key={i} className="wheel-item" aria-hidden="true" />;
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

const REPO = "https://github.com/jason-d-garcia/senti";

export default function Minimal() {
  // The catalogue arrives one emotion at a time, for the part of the map in view (see ../songs.ts).
  const [shards, setShards] = useState<Record<string, CatalogSong[]>>({});
  const need = useCallback((names: string[]) => Promise.all(names.map((n) => loadSection(n).then((list) => {
    setShards((s) => (s[n] ? s : { ...s, [n]: list }));
    return list;
  }).catch(() => [] as CatalogSong[]))).then((lists) => lists.flat()), []);
  const songs = useMemo(() => {
    const seen = new Set<string>();
    return [...Object.values(shards).flat(), ...testSongs].filter((s) => { const k = songKey(s); if (seen.has(k)) return false; seen.add(k); return true; });
  }, [shards]);
  /** Every song in one section, downloading that section first if it isn't here yet. */
  const songsIn = async (sec: string): Promise<CatalogSong[]> => {
    const list = await need([sec]);
    const seen = new Set(list.map(songKey));
    return [...list, ...testSongs.filter((s) => sectionOf(s) === sec && !seen.has(songKey(s)))];
  };

  const [dot, setDot] = useState<Pt>({ valence: 0.55, arousal: 0.45 });
  const emotion = emotionAt(dot.valence, dot.arousal);
  const color = COLOR[emotion?.mood ?? "mixed"];
  const section = sectionOf(dot);
  // Keep the light's section and its neighbours loaded, so songs are ready wherever it moves next.
  useEffect(() => { void need(around(section)); }, [section, need]);

  const [pick, setPick] = useState<Pick | null>(null);
  const [finding, setFinding] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [placeAt, setPlaceAt] = useState<Pt>(dot);
  const [pinned, setPinned] = useState(false);
  const [placePinned, setPlacePinned] = useState(false);
  /** Zoomed-in view: where it's centred, which emotion's songs get covers, and the zoom (fixed once opened). */
  const [discover, setDiscover] = useState<{ center: Pt; section: string; near: string | null; scale: number } | null>(null);
  // Zoomed in, the view can reach into the sections either side: load those too.
  useEffect(() => { if (discover) void need(around(discover.section)); }, [discover?.section, need]); // eslint-disable-line react-hooks/exhaustive-deps
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
    if (finding) return;
    // From the card's "Another one": the card is about to go, so hand focus to the play button meanwhile.
    if (card.current?.contains(document.activeElement) && !discover) findBtn.current?.focus({ preventScroll: true });
    setFinding(true); setNotFound(false); setPick(null);
    audio.current?.pause();
    const done = votedSongs();
    const inSection = await songsIn(section);
    const fresh = inSection.filter((s) => !done.has(songKey(s)));
    const queue = shuffle(fresh.length ? fresh : inSection);
    for (let i = 0, tries = 0; i < queue.length && tries < TRIES; i++) {
      const s = queue[i];
      // Over iTunes' per-minute limit: wait it out (still "Finding a song…") instead of failing.
      if (!s.preview) { setWaiting(isRateLimited()); await waitForBudget(); setWaiting(false); }
      const p = await findPreview(s);
      if (!p && isRateLimited()) { i--; continue; } // refused, not a miss: retry this song once allowed
      tries++;
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

  // Radio: when a preview ends, the next song from the same part of the map starts by itself.
  const [radio, setRadio] = useState(() => { try { return localStorage.getItem("senti:radio") !== "off"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem("senti:radio", radio ? "on" : "off"); } catch { /* blocked */ } }, [radio]);
  const played = useRef(new Set<string>());
  const advancing = useRef(false);
  useEffect(() => { if (pick) played.current.add(pick.song.id); }, [pick]);
  /** Nearest unplayed songs in the same emotion, a little shuffled so the radio doesn't always run one way. */
  const radioQueue = async (from: PlacedSong) => {
    const d = (s: PlacedSong) => Math.hypot(s.valence - from.valence, s.arousal - from.arousal);
    const all = await songsIn(sectionOf(from));
    let pool = all.filter((s) => !played.current.has(s.id));
    if (!pool.length) { played.current.clear(); played.current.add(from.id); pool = all.filter((s) => s.id !== from.id); }
    return shuffle(pool.sort((a, b) => d(a) - d(b)).slice(0, 12));
  };
  const playNext = async () => {
    const from = pick?.song;
    if (!from || advancing.current) return;
    advancing.current = true;
    audio.current?.pause();
    for (const s of (await radioQueue(from)).slice(0, TRIES)) {
      if (!s.preview) await waitForBudget();
      const p = await findPreview(s);
      if (!p) continue;
      setPick({ song: s, preview: p, step: "listen" }); setProgress(0);
      const el = audio.current;
      if (el) { el.src = p.audioUrl; el.volume = PREVIEW_VOLUME; el.play().catch(() => setPlaying(false)); }
      break;
    }
    advancing.current = false;
  };
  const onEnded = () => {
    setPlaying(false); setProgress(0);
    if (radio && pick && pick.step !== "place") void playNext();
  };
  // Lock-screen and headphone controls.
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!ms || !pick) return;
    try {
      ms.metadata = new MediaMetadata({ title: pick.song.title, artist: pick.song.artist, album: "senti",
        artwork: pick.preview.artworkUrl ? [{ src: pick.preview.artworkUrl, sizes: "600x600", type: "image/jpeg" }] : [] });
      ms.setActionHandler("nexttrack", () => void playNext());
    } catch { /* not supported */ }
  });

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
  // The panel fades out in Discover; inert keeps Tab and screen readers out of it too.
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => { dock.current?.toggleAttribute("inert", !!discover); }, [discover]);
  const close = () => { audio.current?.pause(); setPick(null); findBtn.current?.focus({ preventScroll: true }); };
  // A new song card takes focus, so keyboard and screen-reader users land on it.
  const cardSong = pick && pick.step !== "place" ? pick.song.id : null;
  useEffect(() => {
    if (cardSong && !card.current?.contains(document.activeElement)) card.current?.focus({ preventScroll: true });
  }, [cardSong]);
  // Tab cycles within the card while it's open; Escape or × closes it.
  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !card.current) return;
    const items = [...card.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled)")];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || at === card.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };

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
    if (opened.current || !key) return;
    opened.current = true;
    // The link doesn't say which section the song is in, so look through all of them (small files, cached after).
    void need(SECTIONS).then((all) => {
      const s = [...all, ...testSongs].find((x) => songKey(x) === key);
      if (!s) return;
      setDot({ valence: s.valence, arousal: s.arousal });
      setPinned(true);
      findPreview(s).then((p) => { if (p) { setPick({ song: s, preview: p, step: "listen" }); setProgress(0); } });
    });
  }, [need]);

  const placing = pick?.step === "place";

  // Discover: zoom in around the song, far enough that its nearest neighbours in the same emotion spread
  // across the view (songs cluster tightly), and show what else is nearby.
  // The centre while a drag is in progress, so the page glow and the small dots move with the map.
  const [livePan, setLivePan] = useState<Pt | null>(null);
  const panAt = useDeferredValue(livePan);
  const featuredView = useMemo(() => {
    if (!discover) return null;
    const { center } = discover;
    const d = (s: PlacedSong) => Math.hypot(s.valence - center.valence, s.arousal - center.arousal);
    const featured = songs.filter((s) => sectionOf(s) === discover.section).sort((a, b) => d(a) - d(b)).slice(0, FEATURED);
    const { scale } = discover;
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
    return { scale, featured: featured.map((s, i) => ({ song: s, featured: true, v: at[i].v, a: at[i].a })) };
  }, [discover, songs, boardHalf]);
  // The small dots follow the drag as it happens, from a window a little wider than the view so the edges are
  // already filled in; covers wait for the drag to end.
  const view = useMemo(() => {
    if (!discover || !featuredView) return null;
    const { scale } = featuredView, center = panAt ?? discover.center, reach = 1.6 / scale;
    const ids = new Set(featuredView.featured.map((f) => f.song.id));
    const d = (s: PlacedSong) => Math.hypot(s.valence - center.valence, s.arousal - center.arousal);
    const others = songs.filter((s) => !ids.has(s.id) && Math.abs(s.valence - center.valence) < reach
      && Math.abs(s.arousal - center.arousal) < reach).sort((a, b) => d(a) - d(b)).slice(0, OTHERS);
    return { scale, items: [
      ...others.map((s) => ({ song: s, featured: false, v: s.valence, a: s.arousal })),
      ...featuredView.featured,
    ] };
  }, [discover, featuredView, panAt, songs]);
  // Start downloading the cover tiles around the view (and a little beyond) before they're needed.
  useEffect(() => {
    if (!discover || !featuredView) return;
    const c = panAt ?? discover.center;
    tilesAround(c.valence, c.arousal, 1.6 / featuredView.scale).forEach((t) => void loadTile(t));
  }, [discover, featuredView, panAt]);
  const nearby = view?.items ?? [];

  // Covers come from the pre-fetched tiles around where you're looking; songs not in a tile yet are looked up
  // a few at a time (the iTunes search allows about 20 lookups a minute).
  useEffect(() => {
    if (!discover) return;
    let cancelled = false;
    const todo = (featuredView?.featured ?? []).filter((n) => !(n.song.id in covers)).map((n) => n.song);
    (async () => {
      const stored = await Promise.all(todo.map(storedCover));
      if (cancelled) return;
      const found = Object.fromEntries(todo.flatMap((s, i) => (stored[i] === undefined ? [] : [[s.id, stored[i] || null]])));
      if (Object.keys(found).length) setCovers((c) => ({ ...c, ...found }));
      for (const s of todo.filter((_, i) => stored[i] === undefined)) {
        // Covers leave a few lookups a minute free, so pressing play never hits the limit.
        if (!(s as CatalogSong).preview && !(await waitForBudget(6, () => cancelled))) return;
        const p = await findPreview(s);
        if (!p && isRateLimited()) continue;
        if (cancelled) return;
        setCovers((c) => ({ ...c, [s.id]: p?.artworkUrl ?? null }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discover, featuredView]);

  const fieldSongs: FieldSong[] = nearby.map(({ song, featured, v, a }) => ({
    id: song.id, valence: v, arousal: a, title: `${song.title} · ${song.artist}`, featured,
    color: COLOR[emotionAt(song.valence, song.arousal)?.mood ?? "mixed"], // Covers are tiny on the map, so ask for a small image (the card uses the large one).
    artwork: covers[song.id]?.replace(/\d+x\d+bb/, "120x120bb") ?? undefined,
  }));

  const openDiscover = () => {
    if (!pick) return;
    // Zoom far enough that the song's nearest neighbours in the same emotion spread across the view.
    const center = { valence: pick.song.valence, arousal: pick.song.arousal }, section = sectionOf(pick.song);
    const d = (s: PlacedSong) => Math.hypot(s.valence - center.valence, s.arousal - center.arousal);
    const nearest = songs.filter((s) => sectionOf(s) === section).map(d).sort((a, b) => a - b).slice(0, FEATURED);
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, 0.6 / Math.max(...nearest, 0.01)));
    setDiscover({ center, section, near: pick.song.title, scale });
    // On phones the card would cover the zoomed map, so close it; tap a cover to bring a song back up.
    if (window.matchMedia("(max-aspect-ratio: 4/5)").matches) { audio.current?.pause(); setPick(null); }
  };
  const closeDiscover = () => setDiscover(null);
  // Dragging the zoomed map recentres it; covers follow whichever emotion is now in the middle.
  const panTo = (center: Pt) => setDiscover((d) => d && { ...d, center, section: sectionOf(center), near: null });
  // Escape closes the song card first, then the zoomed view.
  const escape = useRef(() => {});
  escape.current = () => { if (pick && !placing) close(); else if (discover) closeDiscover(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape while typing a tag clears the field, not the whole card.
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) escape.current();
    };
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
        <span className="brand" translate="no" tabIndex={0} aria-label="senti"><span className="logo-s" aria-hidden="true">s</span><span className="logo-rest" aria-hidden="true"><span>enti</span></span><svg className="logo-dots" viewBox="0 -2.5 6 27" aria-hidden="true"><circle cx="3" cy="2.64" r="2.22" fill="#eef1f8"/><circle cx="3" cy="7.92" r="2.22" fill="#eef1f8"/><circle cx="3" cy="14.08" r="2.22" fill="#eef1f8"/><circle cx="3" cy="19.36" r="2.22" fill="#eef1f8"/></svg></span>
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
          <span className="axis-end end-bottom">↓ Low energy</span>
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
            surface={stage}
            zoom={discover && view ? { center: discover.center, scale: view.scale, songs: fieldSongs, onSong: playNearby, onPan: panTo, onPanLive: setLivePan } : null}
          />

          {discover && (
            <div className="discover-bar">
              <p><span style={{ color: COLOR[EMOTIONS.find((e) => e.name === discover.section)?.mood ?? "mixed"] }}>{discover.section}</span> songs {discover.near ? <>near <b>{discover.near}</b></> : "here"} <span className="pan-hint">· {TOUCH ? "drag the screen to explore" : "drag or use arrow keys to explore"}</span></p>
              <button type="button" className="minimize" onClick={closeDiscover} aria-label="Back to the full map" title="Back to the full map">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
                </svg>
              </button>
            </div>
          )}

          <div className={`dock${!pinned && !placing ? " is-collapsed" : ""}`} ref={dock} aria-hidden={discover ? true : undefined}>
            {placing ? (
              <div className="place-bar">
                <p>{TOUCH ? "Tap" : "Click"} where <b>{pick!.song.title}</b> belongs: <span style={{ color: COLOR[emotionAt(placeAt.valence, placeAt.arousal)?.mood ?? "mixed"] }}>{sectionOf(placeAt)}</span></p>
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
                  <button type="button" className="find" ref={findBtn} onClick={findSong} disabled={!songs.length} aria-disabled={finding || undefined} tabIndex={pinned ? 0 : -1}>
                    <span className="find-icon" aria-hidden="true">▶</span>
                    {finding ? "Finding a song…" : `Play me something ${section.toLowerCase()}`}
                  </button>
                  <p className="hint">{waiting ? "Lots of lookups just now; trying again in a moment…" : notFound ? "Couldn’t find a playable song here. Try another spot."
                    : TOUCH ? "Tap anywhere to move the light." : "Click anywhere to move the light."}</p>
                </div>
              </>
            )}
          </div>

        </div>

        {pick && !placing && (
          <div className="card" ref={card} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="card-title" onKeyDown={trapTab}>
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
                  <button type="button" className="share-btn radio-btn" aria-pressed={radio} onClick={() => setRadio((r) => !r)}
                    title={radio ? "Radio on: the next song plays when this one ends" : "Radio off"}>
                    <span aria-hidden="true">📻</span> Radio
                  </button>
                  {radio && (
                    <button type="button" className="share-btn" onClick={() => void playNext()} aria-label="Next song">
                      <span aria-hidden="true">⏭</span> Next
                    </button>
                  )}
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

      {shareNote && <div className="toast" aria-hidden="true">{shareNote}</div>}
      {/* Always mounted, so screen readers announce changes to it. */}
      <p className="sr-only" role="status">
        {shareNote ?? (finding ? "Finding a song…" : notFound ? "Couldn’t find a playable song here. Try another spot."
          : pinned && !pick ? `I’m feeling ${section.toLowerCase()}` : "")}
      </p>

      <audio
        ref={audio}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={onEnded}
        onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
      />
    </div>
  );
}
