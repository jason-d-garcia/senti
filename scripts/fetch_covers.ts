/**
 * Looks up every Billboard song's cover on the iTunes Search API once and writes them to public/covers/,
 * one file per map tile (see src/covers.ts). Resumable: songs already in a tile are skipped, so it can be
 * run again to pick up where it stopped. Runs at a polite ~17 lookups a minute and stops after --minutes.
 *
 *   node --experimental-strip-types scripts/fetch_covers.ts --minutes 330
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { isMatch } from "../src/preview.ts";
import { coverKey, tileOf } from "../src/covers.ts";

type Row = [number, number, string, string, number, number];
const OUT = "public/covers";
const GAP_MS = Number(process.env.GAP_MS ?? 3500);
const minutes = Number(process.argv[process.argv.indexOf("--minutes") + 1]) || 60;
const stopAt = Date.now() + minutes * 60_000;

const rows = (JSON.parse(readFileSync("src/data/billboard.json", "utf8")) as { songs: Row[] }).songs;
mkdirSync(OUT, { recursive: true });
const tiles = new Map<string, Record<string, string>>();
for (const f of readdirSync(OUT)) if (f.endsWith(".json")) tiles.set(f.slice(0, -5), JSON.parse(readFileSync(`${OUT}/${f}`, "utf8")));
const save = () => {
  for (const [id, t] of tiles) {
    const sorted = Object.fromEntries(Object.entries(t).sort(([a], [b]) => (a < b ? -1 : 1)));
    writeFileSync(`${OUT}/${id}.json`, JSON.stringify(sorted));
  }
};

const todo = rows.filter(([, , title, artist, v, a]) => !(coverKey({ title, artist }) in (tiles.get(tileOf(v, a)) ?? {})));
console.log(`${rows.length - todo.length} done, ${todo.length} to look up`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0, found = 0;
for (const [, , title, artist, v, a] of todo) {
  if (Date.now() > stopAt) break;
  const term = encodeURIComponent(`${artist} ${title.replace(/\(.*?\)/g, "")}`);
  let results: Parameters<typeof isMatch>[1][] | null = null;
  for (let attempt = 0; attempt < 5 && !results && Date.now() < stopAt; attempt++) {
    try {
      const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=15&country=US`);
      if (r.ok) results = (await r.json()).results;
      else { console.log(`HTTP ${r.status}, waiting a minute`); await sleep(60_000); }
    } catch (e) { console.log(`${e}, waiting a minute`); await sleep(60_000); }
  }
  if (!results) continue; // left for the next run
  const t = results.find((r) => isMatch({ title, artist }, r)) as { artworkUrl100?: string } | undefined;
  const art = t?.artworkUrl100?.match(/^https:\/\/(.+\/)100x100bb\.jpg$/)?.[1] ?? "";
  const id = tileOf(v, a);
  if (!tiles.has(id)) tiles.set(id, {});
  tiles.get(id)![coverKey({ title, artist })] = art;
  n++; if (art) found++;
  if (n % 100 === 0) { save(); console.log(`${n} looked up, ${found} with covers`); }
  await sleep(GAP_MS);
}
save();
console.log(`Finished this run: ${n} looked up, ${found} with covers`);
