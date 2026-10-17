/**
 * Listener feedback: people confirm a song's spot (👍) or drag it to where it belongs (👎).
 * Each song's shown position blends the model's prediction with the median listener placement.
 */

export interface Agg {
  /** Number of listener placements. */
  n: number;
  /** Median placement. */
  v: number;
  a: number;
  /** Median distance of placements from the median point; small when listeners agree. */
  spread: number;
}

export interface Vote {
  song: string;
  v: number;
  a: number;
  /** Placed before the model's spot was shown. */
  blind: boolean;
  /** 👍 on the shown spot rather than a correction. */
  agree: boolean;
  /** False for a 👎 where the listener skipped placing the song; v and a are then the model's spot. */
  placed?: boolean;
  /** The model's position for the song, kept with the vote for retraining. */
  model?: { v: number; a: number };
  /** Which page the vote came from. */
  source?: "minimal" | "classic";
}

/** The model's prediction counts like this many listener placements. */
export const PRIOR_VOTES = 3;
/** A spread this large (or larger) means listeners don't agree at all. */
const NO_AGREEMENT = 0.6;

export const songKey = (s: { title: string; artist: string }) =>
  `${s.title.trim().toLowerCase()}|${s.artist.trim().toLowerCase()}`;

const median = (xs: number[]) => {
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Median point and spread of a song's placements. */
export function aggregate(points: { v: number; a: number }[]): Agg | null {
  if (!points.length) return null;
  const v = median(points.map((p) => p.v));
  const a = median(points.map((p) => p.a));
  const spread = median(points.map((p) => Math.hypot(p.v - v, p.a - a)));
  return { n: points.length, v, a, spread };
}

/** Shown position: the model's spot pulled toward listeners as they add up. */
export function blend(model: { valence: number; arousal: number }, agg: Agg | undefined) {
  if (!agg) return { valence: model.valence, arousal: model.arousal };
  const w = agg.n / (agg.n + PRIOR_VOTES);
  return {
    valence: model.valence + w * (agg.v - model.valence),
    arousal: model.arousal + w * (agg.a - model.arousal),
  };
}

/** 0 for model only, rising toward 1 with more listeners who agree with each other. */
export function listenerConfidence(agg: Agg | undefined): number {
  if (!agg) return 0;
  return (agg.n / (agg.n + PRIOR_VOTES)) * Math.max(0, 1 - agg.spread / NO_AGREEMENT);
}

export function confidenceLabel(agg: Agg | undefined): string {
  if (!agg) return "model only";
  const c = listenerConfidence(agg);
  const who = `${agg.n} ${agg.n === 1 ? "listener" : "listeners"}`;
  return `${who}, ${c >= 0.6 ? "high" : c >= 0.3 ? "medium" : "low"} agreement`;
}

// ---- Storage -------------------------------------------------------------

const LOCAL_VOTES = "moodify-votes";

function readLocal(): Vote[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_VOTES) ?? "[]");
  } catch {
    return [];
  }
}

export function voterId(): string {
  try {
    let id = localStorage.getItem("moodify-voter");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("moodify-voter", id);
    }
    return id;
  } catch {
    return "anon";
  }
}

/** Songs this browser has already placed, so it isn't asked about them again. */
export function votedSongs(): Set<string> {
  return new Set(readLocal().map((x) => x.song));
}

/** Shared aggregates from the server, or this browser's own votes when no database is connected. */
export async function loadFeedback(): Promise<{ shared: boolean; aggs: Record<string, Agg> }> {
  try {
    const r = await fetch("/api/feedback");
    if (r.ok) return { shared: true, aggs: await r.json() };
  } catch {
    /* fall through to local */
  }
  const bySong: Record<string, { v: number; a: number }[]> = {};
  for (const x of readLocal()) (bySong[x.song] ??= []).push(x);
  const aggs: Record<string, Agg> = {};
  for (const [k, pts] of Object.entries(bySong)) aggs[k] = aggregate(pts)!;
  return { shared: false, aggs };
}

/** Saves a vote locally and, when a database is connected, to the server. Returns true when shared. */
export async function sendVote(vote: Vote): Promise<boolean> {
  try {
    localStorage.setItem(LOCAL_VOTES, JSON.stringify([...readLocal().filter((x) => x.song !== vote.song), vote]));
  } catch {
    /* private mode: the server copy still counts */
  }
  try {
    const r = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...vote, voter: voterId() }),
    });
    return r.ok || r.status === 409;
  } catch {
    return false;
  }
}
