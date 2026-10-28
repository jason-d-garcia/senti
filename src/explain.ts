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

export interface Explanation {
  lyrics: Pt;
  audio: Pt | null;
  final: Pt;
  valence: AxisParts | null;
  arousal: AxisParts | null;
  summary: string;
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
const sectionName = (p: Pt) => emotionAt(p.valence, p.arousal)?.name.toLowerCase() ?? "mixed";

export function axisParts(lyrics: number, audio: number, w: Weights): AxisParts {
  const l = w.lyrics * lyrics, a = w.audio * audio, sum = Math.abs(l) + Math.abs(a);
  return { lyrics: l, audio: a, bias: w.bias, total: clamp(l + a + w.bias), lyricsShare: sum ? Math.abs(l) / sum : 0.5 };
}

/** Where one axis's push came from, for a lyrics share on that axis. */
export function driver(share: number): string {
  if (share >= 0.7) return "mostly from the lyrics";
  if (share <= 0.3) return "mostly from the sound";
  return "from the lyrics and the sound about equally";
}

export function explain(song: Pt & { sources?: Sources }): Explanation {
  const final = { valence: song.valence, arousal: song.arousal };
  const src = song.sources;
  if (!src?.audio || !src.fusion) {
    const lyrics = src?.lyrics ?? final;
    return { lyrics, audio: null, final, valence: null, arousal: null,
      summary: `Placed by its lyrics alone, which read as ${sectionName(lyrics)}. There was no preview for the audio model to hear.` };
  }
  const { lyrics, audio, fusion } = src;
  const valence = axisParts(lyrics.valence, audio.valence, fusion.valence);
  const arousal = axisParts(lyrics.arousal, audio.arousal, fusion.arousal);
  const ls = sectionName(lyrics), as = sectionName(audio);
  const first = ls === as ? `The lyrics and the sound both read as ${ls}.` : `The lyrics read as ${ls}; the sound reads as ${as}.`;
  const dv = driver(valence.lyricsShare), da = driver(arousal.lyricsShare);
  const second = dv === da
    ? `How good it feels and how much energy it has both come ${dv}.`
    : `How good it feels comes ${dv}; its energy comes ${da}.`;
  return { lyrics, audio, final, valence, arousal, summary: `${first} ${second}` };
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
