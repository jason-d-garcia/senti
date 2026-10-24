/** The order one rater hears the study songs in: all of them shuffled, plus a few hidden repeats. */

export interface StudySong { id: string; title: string; artist: string; v: number; a: number; preview?: [string, string, string] }
export interface Trial { id: string; repeat: boolean }

export const REPEATS = 4;
/** A repeat comes at least this many songs after the first time, so it isn't recognised from a moment ago. */
export const REPEAT_GAP = 10;

export function shuffle<T>(xs: T[], rand: () => number = Math.random): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function makePlan(ids: string[], rand: () => number = Math.random): Trial[] {
  const order: Trial[] = shuffle(ids, rand).map((id) => ({ id, repeat: false }));
  // Repeat songs from the first half, each placed somewhere after the first time plus the gap.
  for (const id of shuffle(order.slice(0, Math.floor(order.length / 2)).map((t) => t.id), rand).slice(0, REPEATS)) {
    const first = order.findIndex((t) => t.id === id);
    const from = first + REPEAT_GAP + 1;
    order.splice(from + Math.floor(rand() * (order.length + 1 - from)), 0, { id, repeat: true });
  }
  return order;
}

export const newRaterCode = (rand: () => number = Math.random) =>
  Array.from({ length: 8 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(rand() * 31)]).join("");
