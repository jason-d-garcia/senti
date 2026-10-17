import { placeSong } from "./mood";
import type { PlacedSong, Song } from "./mood";

type HitRow = [year: number, peakRank: number, title: string, artist: string, valence: number, arousal: number];

/** The Billboard list is about 300 KB, so it loads after the page is up. */
export const loadHits = (): Promise<PlacedSong[]> =>
  import("./data/billboard.json").then((m) =>
    (m.default as unknown as { songs: HitRow[] }).songs.map(
      ([year, peak_rank, title, artist, valence, arousal]): Song => ({ title, artist, valence, arousal, year, peak_rank }),
    ).map(placeSong),
  );
