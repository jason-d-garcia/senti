import { EMOTIONS, emotionAt, placeSong } from "./mood";
import type { PlacedSong } from "./mood";
import type { Preview } from "./preview";
import type { Fusion, Sources } from "./explain";

/**
 * The catalogue comes in one file per emotion (public/songs/<emotion>.json, written by scripts/songs.ts), so the
 * page only downloads the part of the map in view. Each file is fetched once and kept.
 */
export const SECTIONS = [...EMOTIONS.map((e) => e.name), "Mixed"];
export const sectionOf = (p: { valence: number; arousal: number }) => emotionAt(p.valence, p.arousal)?.name ?? "Mixed";

/** A song with its preview looked up ahead of time (no iTunes lookup needed to play it), and what placed it. */
export type CatalogSong = PlacedSong & { preview?: Preview; sources?: Sources };

type Row = [i: number, title: string, artist: string, valence: number, arousal: number, year: number, peak: number,
  preview?: [audioUrl: string, pageUrl: string, artworkUrl: string] | null,
  scores?: [lyricsV: number, lyricsA: number, audioV: number, audioA: number]];

const loaded = new Map<string, Promise<CatalogSong[]>>();

/** The songs in one emotion's section (or "Mixed", the centre). Failed downloads are retried on the next call. */
export function loadSection(name: string): Promise<CatalogSong[]> {
  let p = loaded.get(name);
  if (p) return p;
  p = fetch(`/songs/${name.toLowerCase()}.json`)
    .then((r) => { if (!r.ok) throw new Error(`songs ${r.status}`); return r.json(); })
    .then(({ songs, fusion }: { songs: Row[]; fusion?: Fusion }) => songs.map(([i, title, artist, valence, arousal, year, peak, pv, sc]) => {
      const s: CatalogSong = placeSong({ title, artist, valence, arousal, year: year || undefined, peak_rank: peak || undefined }, i);
      if (pv) s.preview = { audioUrl: pv[0], pageUrl: pv[1] || "https://music.apple.com", artworkUrl: pv[2] || undefined };
      // Without audio scores the song sits where its lyrics put it.
      s.sources = sc && fusion
        ? { lyrics: { valence: sc[0], arousal: sc[1] }, audio: { valence: sc[2], arousal: sc[3] }, fusion }
        : { lyrics: { valence, arousal } };
      return s;
    }))
    .catch((e) => { loaded.delete(name); throw e; });
  loaded.set(name, p);
  return p;
}

/** A section and the ones either side of it, so moving the light one step over finds its songs already there. */
export function around(name: string): string[] {
  const i = EMOTIONS.findIndex((e) => e.name === name);
  if (i < 0) return ["Mixed"];
  return [name, EMOTIONS[(i + 15) % 16].name, EMOTIONS[(i + 1) % 16].name];
}
