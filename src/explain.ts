import { emotionAt } from "./mood";

/**
 * "Why is this song here?" A song placed by lyrics + audio sits at
 *   valence = w_lyrics · lyrics_v + w_audio · audio_v + bias   (and likewise for arousal),
 * so each axis splits exactly into a lyrics part and a sound part. The weights come with the catalogue
 * (scripts/songs.ts fits them back from data/catalog_audio_scores.csv). Lyrics are never stored or shown:
 * only the two scores the lyrics and the audio models gave.
 */

export interface Pt { valence: number; arousal: number }
export interface Weights { lyrics: number; audio: number; bias: number }
export interface Fusion { valence: Weights; arousal: Weights }
/** What a song was placed from: the lyrics model's spot and, when its preview was scored, the audio model's. */
export interface Sources { lyrics: Pt; audio?: Pt; fusion?: Fusion }

export interface AxisParts {
  lyrics: number;
  audio: number;
  bias: number;
  /** Where the song ends up on this axis (clipped to [-1, 1] like the map). */
  total: number;
  /** How much of the push on this axis came from the lyrics, 0 to 1. */
  lyricsShare: number;
}

/** How the two pushes on one axis played out. */
export type Verdict = "agree" | "conflict" | "lyrics" | "sound" | "still";

export interface Explanation {
  lyrics: Pt;
  audio: Pt | null;
  final: Pt;
  valence: AxisParts | null;
  arousal: AxisParts | null;
  /** MERGE test songs: where the dataset's mood tags put it. */
  tagged?: Pt;
  summary: string;
}

/** True of every song by construction (arousal weights 0.14 vs 1.02), so it's said once rather than found per song. */
export const ENERGY_NOTE = "Energy leans on the sound for every song: the blend gives the sound about 7 times the lyrics' weight.";

/** Below this total push an axis barely moved; a conflict needs both pushes at least CONFLICT; "mostly" is a 70% share. */
const STILL = 0.1, CONFLICT = 0.05, MOSTLY = 0.7;
/** Each axis's ends, as the map labels them. */
export const ENDS = { valence: ["feels bad", "feels good"], arousal: ["low energy", "energetic"] } as const;

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
export const sectionName = (p: Pt) => emotionAt(p.valence, p.arousal)?.name.toLowerCase() ?? "mixed";

export function axisParts(lyrics: number, audio: number, w: Weights): AxisParts {
  const l = w.lyrics * lyrics, a = w.audio * audio, sum = Math.abs(l) + Math.abs(a);
  return { lyrics: l, audio: a, bias: w.bias, total: clamp(l + a + w.bias), lyricsShare: sum ? Math.abs(l) / sum : 0.5 };
}

export function verdict({ lyrics: l, audio: a, lyricsShare }: AxisParts): Verdict {
  if (Math.abs(l) + Math.abs(a) < STILL) return "still";
  if (l * a < 0) {
    if (Math.abs(l) >= CONFLICT && Math.abs(a) >= CONFLICT) return "conflict";
    // A small push the other way doesn't count as agreeing: the bigger one placed it.
    return Math.abs(l) > Math.abs(a) ? "lyrics" : "sound";
  }
  return lyricsShare >= MOSTLY ? "lyrics" : lyricsShare <= 1 - MOSTLY ? "sound" : "agree";
}

/** One axis's verdict as a sentence. */
export function verdictText(axis: keyof typeof ENDS, p: AxisParts, v = verdict(p)): string {
  if (v === "still") return "Neither pushed it far: it sits near the middle.";
  if (v === "lyrics") return "Mostly the lyrics.";
  if (v === "sound") return "Mostly the sound.";
  if (v === "agree") return "Lyrics and sound agree.";
  const lyricsWon = Math.abs(p.lyrics) >= Math.abs(p.audio);
  const toward = ENDS[axis][(lyricsWon ? p.lyrics : p.audio) > 0 ? 1 : 0];
  return `The ${lyricsWon ? "lyrics" : "sound"} pulled it toward ${toward}; the ${lyricsWon ? "sound" : "lyrics"} pulled it back.`;
}

type Explainable = Pt & { sources?: Sources; true_valence?: number; true_arousal?: number };

export function explain(song: Explainable): Explanation {
  const final = { valence: song.valence, arousal: song.arousal };
  const tagged = song.true_valence !== undefined && song.true_arousal !== undefined
    ? { valence: song.true_valence, arousal: song.true_arousal } : undefined;
  const tags = tagged
    ? sectionName(tagged) === sectionName(final)
      ? ` MERGE's mood tags put it in ${sectionName(tagged)} too.`
      : ` MERGE's mood tags put it in ${sectionName(tagged)}; our model put it in ${sectionName(final)}.`
    : "";
  const src = song.sources;
  if (!src?.audio || !src.fusion) {
    const lyrics = src?.lyrics ?? final;
    return { lyrics, audio: null, final, valence: null, arousal: null, ...(tagged && { tagged }),
      summary: `Placed by its lyrics alone, which read as ${sectionName(lyrics)}. There's no audio score for this one.${tags}` };
  }
  const { lyrics, audio, fusion } = src;
  const valence = axisParts(lyrics.valence, audio.valence, fusion.valence);
  const arousal = axisParts(lyrics.arousal, audio.arousal, fusion.arousal);
  const ls = sectionName(lyrics), as = sectionName(audio);
  const summary = ls === as ? `The lyrics and the sound both read as ${ls}.` : `The lyrics read as ${ls}; the sound reads as ${as}.`;
  return { lyrics, audio, final, valence, arousal, ...(tagged && { tagged }), summary: summary + tags };
}

/** The n songs nearest to this one by their lyrics (or sound) score alone, leaving out songs without that score. */
export function nearestBy<S extends { id: string; sources?: Sources }>(song: S, songs: S[], key: "lyrics" | "audio", n: number): S[] {
  const p = song.sources?.[key];
  if (!p) return [];
  const best: [number, S][] = [];
  for (const s of songs) {
    const q = s.sources?.[key];
    if (!q || s.id === song.id) continue;
    const d = Math.hypot(q.valence - p.valence, q.arousal - p.arousal);
    if (best.length === n && d >= best[n - 1][0]) continue;
    const i = best.findIndex(([e]) => e > d);
    best.splice(i < 0 ? best.length : i, 0, [d, s]);
    if (best.length > n) best.pop();
  }
  return best.map(([, s]) => s);
}

/** Least-squares fit of y = w_l · l + w_a · a + b, for recovering the fusion weights from scored rows. */
export function fitWeights(rows: [l: number, a: number, y: number][]): Weights {
  // Normal equations for three unknowns, solved by Gaussian elimination.
  const m = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (const [l, a, y] of rows) {
    const x = [l, a, 1];
    for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) m[i][j] += x[i] * x[j]; m[i][3] += x[i] * y; }
  }
  for (let c = 0; c < 3; c++) {
    const p = m.slice(c).reduce((best, r, k) => (Math.abs(r[c]) > Math.abs(m[best][c]) ? c + k : best), c);
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) if (r !== c) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  const [lyrics, audio, bias] = [0, 1, 2].map((i) => m[i][3] / m[i][i]);
  return { lyrics, audio, bias };
}
