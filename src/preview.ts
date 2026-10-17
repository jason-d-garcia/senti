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

const cache = new Map<string, Promise<Preview | null>>();

export function findPreview(song: { title: string; artist: string }): Promise<Preview | null> {
  const key = `${song.title}\u0000${song.artist}`;
  let hit = cache.get(key);
  if (!hit) {
    const term = encodeURIComponent(`${song.artist} ${song.title.replace(/\(.*?\)/g, "")}`);
    hit = fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=15&country=US`)
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then(({ results }: { results: ItunesTrack[] }) => {
        const t = results.find((r) => isMatch(song, r));
        return t ? { audioUrl: t.previewUrl!, pageUrl: t.trackViewUrl ?? "https://music.apple.com",
          artworkUrl: t.artworkUrl100?.replace(/100x100bb/, "600x600bb") } : null;
      })
      .catch(() => {
        cache.delete(key); // network error: allow a retry
        return null;
      });
    cache.set(key, hit);
  }
  return hit;
}
