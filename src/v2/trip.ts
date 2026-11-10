/**
 * senti 2: the queue is either the songs around one feeling, or a short trip from one feeling to another
 * (match the mood you're in, then move a step at a time: the "iso principle" from music therapy).
 */
import { emotionAt } from "../mood";

export interface Pt { valence: number; arousal: number }

/** The part of the map that is drawn. The catalogue's scores sit well inside [-1, 1], more so for energy. */
export const EXTENT = { valence: 0.92, arousal: 0.56 };
export const STOPS = 6;

export const clampPt = (p: Pt): Pt => ({
  valence: Math.max(-EXTENT.valence, Math.min(EXTENT.valence, p.valence)),
  arousal: Math.max(-EXTENT.arousal, Math.min(EXTENT.arousal, p.arousal)),
});

export const feelingAt = (p: Pt) => (emotionAt(p.valence, p.arousal)?.name ?? "Mixed").toLowerCase();

/** Distances are taken on the map as drawn, so "near" matches what the eye sees. */
const dist = (a: Pt, b: Pt) =>
  Math.hypot((a.valence - b.valence) / EXTENT.valence, (a.arousal - b.arousal) / EXTENT.arousal);

/** A repeatable number in [0, 1) for a song and a shuffle count. */
function jitter(i: number, seed: number): number {
  let h = (i + 1) * 374761393 + seed * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Evenly spaced points from one feeling to the other, both ends included. */
export function waypoints(from: Pt, to: Pt, n = STOPS): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    return { valence: from.valence + (to.valence - from.valence) * t, arousal: from.arousal + (to.arousal - from.arousal) * t };
  });
}

/**
 * The songs to play. With no destination: the `n` songs nearest the feeling (the next `n` after `skip`).
 * With one: for each waypoint, the nearest song not already taken. A shuffle seed above 0 loosens "nearest"
 * a little so another press gives another set.
 */
export function buildQueue<T extends Pt>(songs: T[], from: Pt, to: Pt | null, seed = 0, n = STOPS, skip = 0): T[] {
  if (!songs.length) return [];
  const loose = seed > 0 ? 0.12 : 0;
  const score = (s: T, i: number, p: Pt) => dist(s, p) + loose * jitter(i, seed);
  if (!to) {
    const ranked = songs.map((s, i) => ({ s, d: score(s, i, from) })).sort((a, b) => a.d - b.d);
    const start = ranked.length > n ? skip % (ranked.length - n + 1) : 0;
    return ranked.slice(start, start + n).map((x) => x.s);
  }
  const taken = new Set<number>();
  return waypoints(from, to, Math.min(n, songs.length)).map((p) => {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < songs.length; i++) {
      if (taken.has(i)) continue;
      const d = score(songs[i], i, p);
      if (d < bestD) { bestD = d; best = i; }
    }
    taken.add(best);
    return songs[best];
  });
}

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

const PAPER = hex("#ece8df");
/** One flat colour per corner of the map; the page takes the colour of wherever the light is. */
const CORNERS = { happy: hex("#f8c63d"), angry: hex("#f26a45"), sad: hex("#86a4f6"), relaxed: hex("#4fd0a8") };

/** The page colour for a feeling: paper at the centre, the corner colours towards the edges. Always flat. */
export function groundAt(p: Pt): string {
  const x = Math.max(-1, Math.min(1, p.valence / EXTENT.valence)), y = Math.max(-1, Math.min(1, p.arousal / EXTENT.arousal));
  // Push the weights apart so each quadrant keeps its own colour instead of sliding to an even mix.
  const sx = 0.5 + 0.5 * Math.tanh(3 * x) / Math.tanh(3), sy = 0.5 + 0.5 * Math.tanh(3 * y) / Math.tanh(3);
  const w = { happy: sx * sy, angry: (1 - sx) * sy, sad: (1 - sx) * (1 - sy), relaxed: sx * (1 - sy) };
  const strength = Math.min(1, Math.hypot(x, y) / 0.7);
  const out = [0, 1, 2].map((k) => {
    let lin = 0;
    for (const m of ["happy", "angry", "sad", "relaxed"] as const) lin += w[m] * toLinear(CORNERS[m][k]);
    lin = toLinear(PAPER[k]) * (1 - strength) + lin * strength;
    return Math.round(toSrgb(lin) * 255);
  });
  return `rgb(${out[0]} ${out[1]} ${out[2]})`;
}

/** "0.52,-0.31" in a share link. */
export const encodePt = (p: Pt) => `${p.valence.toFixed(2)},${p.arousal.toFixed(2)}`;
export function decodePt(s: string | null): Pt | null {
  if (!s) return null;
  const [v, a] = s.split(",").map(Number);
  return Number.isFinite(v) && Number.isFinite(a) ? clampPt({ valence: v, arousal: a }) : null;
}
