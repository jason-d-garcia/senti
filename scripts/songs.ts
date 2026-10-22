/**
 * The song catalogue the mood map loads, split by emotion so the site only fetches the part of the map in view.
 *
 *   npx vite-node scripts/songs.ts prefetch   # look up each song's 30-second preview and cover once (slow, resumable)
 *   npx vite-node scripts/songs.ts shards     # write public/songs/<emotion>.json from the catalogue + looked-up previews
 *
 * prefetch asks the iTunes Search API politely (about 15 lookups a minute, under its ~20/minute limit) and appends
 * every answer to data/previews.jsonl, so it can be stopped and restarted at any time and picks up where it left off.
 * Songs whose preview is stored need no lookup in the browser: they play at once and never hit the limit.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emotionAt, EMOTIONS } from "../src/mood";
import { isMatch } from "../src/preview";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "data", "previews.jsonl");
const OUT = join(ROOT, "public", "songs");
const GAP_MS = 4000;

/** One catalogue row: [title, artist, valence, arousal, year?, peak rank?]. */
type Row = [string, string, number, number, number?, number?];
/** A stored preview: [audio URL, Apple Music page, 600 px cover] — or null when iTunes has no matching track. */
type Stored = [string, string, string] | null;

export const sectionSlug = (name: string) => name.toLowerCase();
export const SECTIONS = [...EMOTIONS.map((e) => e.name), "Mixed"];
const keyOf = (title: string, artist: string) => `${title}\u0000${artist}`;

function catalogue(): Row[] {
  const hits = JSON.parse(readFileSync(join(ROOT, "src", "data", "billboard.json"), "utf8")).songs as
    [number, number, string, string, number, number][];
  const rows: Row[] = hits.map(([year, peak, title, artist, v, a]) => [title, artist, v, a, year, peak]);
  // Later catalogues (e.g. the 100k Genius scores) go in data/extra_songs.json as [title, artist, valence, arousal] rows.
  const extra = join(ROOT, "data", "extra_songs.json");
  if (existsSync(extra)) rows.push(...(JSON.parse(readFileSync(extra, "utf8")) as Row[]));
  const seen = new Set<string>();
  return rows.filter(([t, ar]) => { const k = keyOf(t, ar).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

function loadCache(): Map<string, Stored> {
  const m = new Map<string, Stored>();
  if (!existsSync(CACHE)) return m;
  for (const line of readFileSync(CACHE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const { k, p } = JSON.parse(line) as { k: string; p: Stored };
    m.set(k, p);
  }
  return m;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function prefetch() {
  mkdirSync(dirname(CACHE), { recursive: true });
  const cache = loadCache();
  const todo = catalogue().filter(([t, a]) => !cache.has(keyOf(t, a)));
  console.log(`${cache.size} looked up already, ${todo.length} to go (~${Math.round((todo.length * GAP_MS) / 3.6e6 * 10) / 10} h)`);
  let done = 0, found = 0;
  for (const [title, artist] of todo) {
    const term = encodeURIComponent(`${artist} ${title.replace(/\(.*?\)/g, "")}`);
    for (let wait = 60_000; ; wait = Math.min(wait * 2, 15 * 60_000)) {
      try {
        const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=15&country=US`);
        if (!r.ok) throw new Error(`iTunes ${r.status}`);
        const { results } = (await r.json()) as { results: Parameters<typeof isMatch>[1][] };
        const t = results.find((x) => isMatch({ title, artist }, x)) as
          { previewUrl: string; trackViewUrl?: string; artworkUrl100?: string } | undefined;
        const p: Stored = t ? [t.previewUrl, t.trackViewUrl ?? "", (t.artworkUrl100 ?? "").replace(/100x100bb/, "600x600bb")] : null;
        appendFileSync(CACHE, JSON.stringify({ k: keyOf(title, artist), p }) + "\n");
        if (p) found++;
        break;
      } catch (e) {
        // Over the limit or offline: back off and retry the same song; never record a failure as "no preview".
        console.log(`${new Date().toISOString()} ${String(e)}; waiting ${wait / 1000}s`);
        await sleep(wait);
      }
    }
    if (++done % 50 === 0) console.log(`${new Date().toISOString()} ${done}/${todo.length} (${found} with previews)`);
    await sleep(GAP_MS);
  }
  console.log(`finished: ${done} looked up, ${found} with previews`);
}

function shards() {
  const cache = loadCache();
  const by = new Map<string, unknown[][]>(SECTIONS.map((s) => [s, []]));
  catalogue().forEach(([title, artist, v, a, year, peak], i) => {
    const sec = emotionAt(v, a)?.name ?? "Mixed";
    const p = cache.get(keyOf(title, artist));
    // [index, title, artist, valence, arousal, year, peak, preview?]; the index keeps song ids stable.
    by.get(sec)!.push([i, title, artist, +v.toFixed(4), +a.toFixed(4), year ?? 0, peak ?? 0, ...(p ? [p] : [])]);
  });
  mkdirSync(OUT, { recursive: true });
  for (const [sec, rows] of by) writeFileSync(join(OUT, `${sectionSlug(sec)}.json`), JSON.stringify({ songs: rows }));
  const withPreview = [...cache.values()].filter(Boolean).length;
  console.log(`wrote ${by.size} files to public/songs (${[...by.values()].reduce((n, r) => n + r.length, 0)} songs, ${withPreview} stored previews)`);
}

const cmd = process.argv[2];
if (cmd === "prefetch") await prefetch();
else if (cmd === "shards") shards();
else console.log("usage: vite-node scripts/songs.ts prefetch|shards");
