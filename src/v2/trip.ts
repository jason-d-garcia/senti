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
export const dist = (a: Pt, b: Pt) =>
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

/** What the trip looks at in a song: where it sits, and (when known) its year and artist. */
export type Stop = Pt & { year?: number; artist?: string };

/** How many of the nearest songs each waypoint chooses between. */
const CANDIDATES = 24;
/**
 * What a trip is scored on, in map units. Each song should sit near its waypoint; each step between songs should
 * look like the step between their waypoints (so the trip doesn't double back or zigzag); and neighbours should
 * not be decades apart or by the same artist.
 */
export const WEIGHTS = { place: 1, step: 0.7, era: 0.15, sameArtist: 0.2 };
const ERA_SPAN = 30;

/** The cost of playing `b` straight after `a`, when the waypoints moved by `ideal` between them. */
function stepCost(a: Stop, b: Stop, ideal: Pt): number {
  const off = Math.hypot(((b.valence - a.valence) - ideal.valence) / EXTENT.valence, ((b.arousal - a.arousal) - ideal.arousal) / EXTENT.arousal);
  const era = a.year && b.year ? Math.min(1, Math.abs(a.year - b.year) / ERA_SPAN) : 0.5;
  const artist = a.artist && a.artist === b.artist ? 1 : 0;
  return WEIGHTS.step * off + WEIGHTS.era * era + WEIGHTS.sameArtist * artist;
}

/** The old way, kept as a fallback and for comparison: each waypoint takes its nearest song not already taken. */
export function greedyTrip<T extends Pt>(songs: T[], points: Pt[], score: (s: T, i: number, p: Pt) => number): T[] {
  const taken = new Set<number>();
  return points.map((p) => {
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

/**
 * The trip as a whole, not one stop at a time: each waypoint offers its nearest songs, and a shortest-path pass
 * (Viterbi) picks one per waypoint so that the total of place and step costs is smallest. The pass only sees
 * neighbours, so a song can still come back two stops later; when it does, it is barred from the later stop and
 * the pass runs again.
 */
function smoothTrip<T extends Stop>(songs: T[], points: Pt[], score: (s: T, i: number, p: Pt) => number): T[] | null {
  const k = Math.min(CANDIDATES, songs.length);
  const pools = points.map((p) => {
    const d = songs.map((s, i) => score(s, i, p));
    return Array.from(d.keys()).sort((a, b) => d[a] - d[b]).slice(0, k).map((i) => ({ i, place: WEIGHTS.place * d[i] }));
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (pools.some((pool) => !pool.length)) return null;
    let cost = pools[0].map((c) => c.place);
    const back: number[][] = [];
    for (let s = 1; s < pools.length; s++) {
      const ideal = { valence: points[s].valence - points[s - 1].valence, arousal: points[s].arousal - points[s - 1].arousal };
      const next: number[] = [], from: number[] = [];
      for (const c of pools[s]) {
        let best = Infinity, arg = 0;
        pools[s - 1].forEach((prev, j) => {
          if (prev.i === c.i) return;
          const v = cost[j] + stepCost(songs[prev.i], songs[c.i], ideal);
          if (v < best) { best = v; arg = j; }
        });
        next.push(best + c.place); from.push(arg);
      }
      cost = next; back.push(from);
    }
    let at = cost.indexOf(Math.min(...cost));
    if (!Number.isFinite(cost[at])) return null;
    const path = [at];
    for (let s = back.length - 1; s >= 0; s--) { at = back[s][at]; path.unshift(at); }
    const picked = path.map((j, s) => pools[s][j].i);
    const repeat = picked.findIndex((i, s) => picked.indexOf(i) < s);
    if (repeat < 0) return picked.map((i) => songs[i]);
    pools[repeat] = pools[repeat].filter((c) => c.i !== picked[repeat]);
  }
  return null;
}

/**
 * The songs to play. With no destination: the `n` songs nearest the feeling (the next `n` after `skip`).
 * With one: one song per waypoint, chosen together so the trip moves steadily (see smoothTrip). A shuffle seed
 * above 0 loosens "nearest" a little so another press gives another set.
 */
export function buildQueue<T extends Stop>(songs: T[], from: Pt, to: Pt | null, seed = 0, n = STOPS, skip = 0): T[] {
  if (!songs.length) return [];
  const loose = seed > 0 ? 0.12 : 0;
  const score = (s: T, i: number, p: Pt) => dist(s, p) + loose * jitter(i, seed);
  if (!to) {
    const ranked = songs.map((s, i) => ({ s, d: score(s, i, from) })).sort((a, b) => a.d - b.d);
    const start = ranked.length > n ? skip % (ranked.length - n + 1) : 0;
    return ranked.slice(start, start + n).map((x) => x.s);
  }
  const points = waypoints(from, to, Math.min(n, songs.length));
  return smoothTrip(songs, points, score) ?? greedyTrip(songs, points, score);
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
