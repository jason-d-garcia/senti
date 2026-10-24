/** The order one rater hears the study songs in: all of them shuffled, plus a few hidden repeats. */

export interface StudySong { id: string; title: string; artist: string; year?: number; half: number; v: number; a: number; preview?: [string, string, string]; instrumental?: boolean }
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

/** `noRepeat`: songs never used as a hidden repeat (instrumentals, so the repeats test songs with lyrics). */
export function makePlan(ids: string[], rand: () => number = Math.random, noRepeat: Set<string> = new Set()): Trial[] {
  const base = shuffle(ids, rand);
  const n = base.length;
  // The repeats go in the second half, one in each of REPEATS equal stretches, so they're spread out and never
  // back to back. Each repeats a song heard at least REPEAT_GAP songs before its slot.
  const span = Math.floor(n / 2) / REPEATS;
  const used = new Set<string>();
  const slots: { at: number; id: string }[] = [];
  for (let k = 0; k < REPEATS; k++) {
    const at = Math.floor(n / 2 + k * span + rand() * Math.max(1, span - 2));
    const pool = base.slice(0, Math.max(0, at - REPEAT_GAP)).filter((id) => !used.has(id) && !noRepeat.has(id));
    if (!pool.length) continue;
    const id = pool[Math.floor(rand() * pool.length)];
    used.add(id);
    slots.push({ at, id });
  }
  const order: Trial[] = base.map((id) => ({ id, repeat: false }));
  for (const { at, id } of slots.sort((x, y) => y.at - x.at)) order.splice(at, 0, { id, repeat: true });
  return order;
}

export const newRaterCode = (rand: () => number = Math.random) =>
  Array.from({ length: 8 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(rand() * 31)]).join("");
