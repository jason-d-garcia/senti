/** 30-second previews from the iTunes Search API, looked up when someone presses play. */

export interface Preview {
  audioUrl: string;
  /** Apple Music page for the track, linked next to the preview as Apple's terms ask. */
  pageUrl: string;
  /** Album or single cover, 600 px. */
  artworkUrl?: string;
}

interface ItunesTrack { trackName?: string; artistName?: string; previewUrl?: string; trackViewUrl?: string; artworkUrl100?: string }

/** Lowercase, drop bracketed parts and "feat." credits, strip accents and punctuation. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\s(feat\.?|featuring|ft\.?|with)\s.*$/, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const words = (s: string) => new Set(normalize(s).split(" ").filter((w) => w && w !== "the" && w !== "and"));

/** The title must match after normalising; the artist must share a word (covers "X & Y", "X featuring Y"). */
export function isMatch(song: { title: string; artist: string }, t: ItunesTrack): boolean {
  if (!t.trackName || !t.artistName || !t.previewUrl) return false;
  if (normalize(t.trackName) !== normalize(song.title)) return false;
  const a = words(song.artist), b = words(t.artistName);
  return [...a].some((w) => b.has(w));
}

// The iTunes search allows roughly 20 lookups a minute per visitor. Going over it makes every lookup fail for a
// while, which used to read as "no playable song here" and stuck: failures were cached as misses. Now lookups
// are counted, covers leave room for play presses, failures are never cached, and answers are remembered.
const PER_MINUTE = 18;
const recent: number[] = [];
let blockedUntil = 0;
const prune = () => { const t = Date.now() - 60_000; while (recent.length && recent[0] < t) recent.shift(); };

/** True while iTunes is refusing lookups (we went over its limit); clears itself after a minute. */
export const isRateLimited = () => Date.now() < blockedUntil;

/** Resolves once a lookup can go out while still leaving `reserve` of the minute's budget unused. */
export async function waitForBudget(reserve = 0, cancelled: () => boolean = () => false): Promise<boolean> {
  for (;;) {
    if (cancelled()) return false;
    prune();
    if (!isRateLimited() && recent.length < PER_MINUTE - reserve) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

const STORE = "senti:preview:";
const WEEK = 7 * 24 * 3600 * 1000;
function remembered(key: string): Preview | null | undefined {
  try {
    const raw = localStorage.getItem(STORE + key);
    if (!raw) return undefined;
    const { at, p } = JSON.parse(raw) as { at: number; p: Preview | null };
    return Date.now() - at < WEEK ? p : undefined;
  } catch { return undefined; }
}
function remember(key: string, p: Preview | null) {
  try { localStorage.setItem(STORE + key, JSON.stringify({ at: Date.now(), p })); } catch { /* storage full or blocked */ }
}

const cache = new Map<string, Promise<Preview | null>>();

export function findPreview(song: { title: string; artist: string }): Promise<Preview | null> {
  const key = `${song.title}\u0000${song.artist}`;
  let hit = cache.get(key);
  if (hit) return hit;
  const saved = remembered(key);
  if (saved !== undefined) { hit = Promise.resolve(saved); cache.set(key, hit); return hit; }
  if (isRateLimited()) return Promise.resolve(null);
  prune(); recent.push(Date.now());
  const term = encodeURIComponent(`${song.artist} ${song.title.replace(/\(.*?\)/g, "")}`);
  hit = fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=15&country=US`)
    .then((r) => {
      if (!r.ok) throw new Error(`iTunes ${r.status}`);
      return r.json();
    })
    .then(({ results }: { results: ItunesTrack[] }) => {
      const t = results.find((r) => isMatch(song, r));
      const p = t ? { audioUrl: t.previewUrl!, pageUrl: t.trackViewUrl ?? "https://music.apple.com",
        artworkUrl: t.artworkUrl100?.replace(/100x100bb/, "600x600bb") } : null;
      remember(key, p);
      return p;
    })
    .catch(() => {
      // Refused or offline (an over-limit reply also fails CORS): not a real miss, so don't keep it.
      cache.delete(key);
      // A lookup cut off because the page went to the background (e.g. the share sheet) isn't a refusal.
      if (typeof document === "undefined" || document.visibilityState === "visible") blockedUntil = Date.now() + 60_000;
      return null;
    });
  cache.set(key, hit);
  return hit;
}
