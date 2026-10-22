/** Cover art looked up ahead of time (scripts/fetch_covers.ts), split into tiles by area of the map so
 *  Explore only downloads the covers around where you're looking. Songs not in a tile yet fall back to a
 *  live lookup. */

/** The map is cut into TILES × TILES squares. */
export const TILES = 8;

/** Entries are the artwork URL without "https://" and its "100x100bb.jpg" ending; "" means Apple has no match. */
export type CoverTile = Record<string, string>;

const cell = (x: number) => Math.min(TILES - 1, Math.max(0, Math.floor(((x + 1) / 2) * TILES)));
export const tileOf = (valence: number, arousal: number) => `${cell(valence)}-${cell(arousal)}`;
export const coverKey = (song: { title: string; artist: string }) => `${song.title}\u0000${song.artist}`;

/** "" stays "" (no cover); anything else becomes a full URL at the given size. */
export const coverUrl = (entry: string, size = 600) => (entry ? `https://${entry}${size}x${size}bb.jpg` : "");

/** Tiles covering the square centred on (valence, arousal) reaching `reach` in each direction. */
export function tilesAround(valence: number, arousal: number, reach: number): string[] {
  const out: string[] = [];
  for (let i = cell(valence - reach); i <= cell(valence + reach); i++)
    for (let j = cell(arousal - reach); j <= cell(arousal + reach); j++) out.push(`${i}-${j}`);
  return out;
}

const loaded = new Map<string, Promise<CoverTile>>();
export function loadTile(id: string): Promise<CoverTile> {
  let t = loaded.get(id);
  if (!t) {
    t = fetch(`/covers/${id}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => {
      loaded.delete(id);
      return {};
    });
    loaded.set(id, t);
  }
  return t;
}

/** The pre-fetched cover for a song: a URL, "" for no cover, or undefined when it isn't in a tile yet. */
export async function storedCover(song: { title: string; artist: string; valence: number; arousal: number }): Promise<string | undefined> {
  const entry = (await loadTile(tileOf(song.valence, song.arousal)))[coverKey(song)];
  return entry === undefined ? undefined : coverUrl(entry);
}
