import { normalize } from "./preview";

/**
 * Songs whose title and artist together contain every word typed, best first: titles that start with the
 * search, then titles that contain it, then the rest (artist matches). Ties keep the catalogue's order.
 */
export function searchSongs<T extends { title: string; artist: string }>(songs: T[], query: string, limit: number): T[] {
  const q = normalize(query);
  if (!q) return [];
  const words = q.split(" ");
  const scored: { s: T; rank: number; i: number }[] = [];
  songs.forEach((s, i) => {
    const title = normalize(s.title), all = `${title} ${normalize(s.artist)}`;
    if (!words.every((w) => all.includes(w))) return;
    scored.push({ s, i, rank: title.startsWith(q) ? 0 : title.includes(q) ? 1 : 2 });
  });
  return scored.sort((a, b) => a.rank - b.rank || a.i - b.i).slice(0, limit).map((x) => x.s);
}
