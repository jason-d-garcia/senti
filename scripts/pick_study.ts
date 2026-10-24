/**
 * Picks the 100 songs for the listening study (rate/): spread evenly over the occupied part of the map AND across
 * decades, then looks up any previews they still need so every clip plays at once.
 *
 *   PREVIEWS_CACHE=... npx vite-node scripts/pick_study.ts
 *
 * The map is cut into 0.105 x 0.105 squares and the 100 squares with the most songs are kept. Squares are visited in
 * a random (seeded) order; each takes, from its songs nearest the centre, one from the decade picked least so far, so
 * the set ends up roughly even across the 1960s-2020s instead of following whichever songs happened to have a stored
 * preview (the first version came out 86% 1960s that way). A song whose preview can't be found is replaced by the
 * square's next candidate. Halves of 50 alternate along a snake through the squares, so each covers the whole map.
 *
 * The study goes to church and team group chats, so it is kept clean: each pick's preview is looked up fresh and the
 * clean (radio edit) version is used where Apple has one; songs only available as explicit, or with a profane title,
 * are passed over for the square's next candidate.
 * Writes public/rate/songs.json (title, artist, year, half, the model's placement, the preview).
 */
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMatch } from "../src/preview";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = process.env.PREVIEWS_CACHE ?? join(ROOT, "data", "previews.jsonl");
const CELL = 0.105, N = 100, CANDIDATES = 8, VERSION = 2;
type Preview = [string, string, string];
type Row = [number, string, string, number, number, number, number, Preview?];

const keyOf = (t: string, a: string) => `${t}\u0000${a}`;
const cache = new Map<string, Preview | null>();
if (existsSync(CACHE)) for (const l of readFileSync(CACHE, "utf8").split("\n")) if (l.trim()) { const { k, p } = JSON.parse(l); cache.set(k, p); }

const dir = join(ROOT, "public", "songs");
const rows: Row[] = readdirSync(dir).flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")).songs as Row[]);

// Seeded shuffle, so a re-run gives the same set.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

const cells = new Map<string, Row[]>();
for (const r of rows) {
  const k = `${Math.floor(r[3] / CELL)},${Math.floor(r[4] / CELL)}`;
  (cells.get(k) ?? cells.set(k, []).get(k)!).push(r);
}
const keep = [...cells.keys()].sort((a, b) => cells.get(b)!.length - cells.get(a)!.length || (a < b ? -1 : 1)).slice(0, N);

// Known instrumentals: kept in the study, but never used as a hidden repeat (repeats should have singing).
const INSTRUMENTAL = new Set(["Wonderland by Night|Bert Kaempfert", "San Antonio Rose|Floyd Cramer", "Tuff|Ace Cannon", "Yellow Bird|Arthur Lyman"]);
const PROFANE = /\b(shit|fuck|bitch|nigga|pussy|dick|ass|hoe|damn)\b/i;
const cleanCache = new Map<string, Preview | null>();

/** The song's clean preview (or a non-explicit one); null if Apple only has it as explicit, or not at all. */
async function lookup(title: string, artist: string): Promise<Preview | null> {
  const k = keyOf(title, artist);
  if (cleanCache.has(k)) return cleanCache.get(k)!;
  const term = encodeURIComponent(`${artist} ${title.replace(/\(.*?\)/g, "")}`);
  for (let wait = 30_000; ; wait *= 2) {
    try {
      await new Promise((r) => setTimeout(r, 4000));
      const res = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=15&country=US`);
      if (!res.ok) throw new Error(`iTunes ${res.status}`);
      type T = { previewUrl: string; trackViewUrl?: string; artworkUrl100?: string; trackExplicitness?: string };
      const matches = ((await res.json()).results as T[]).filter((x) => isMatch({ title, artist }, x as Parameters<typeof isMatch>[1]));
      const t = matches.find((x) => x.trackExplicitness !== "explicit");
      const p: Preview | null = t ? [t.previewUrl, t.trackViewUrl ?? "", (t.artworkUrl100 ?? "").replace(/100x100bb/, "600x600bb")] : null;
      cleanCache.set(k, p);
      // The site's own cache keeps the first match it would have found anyway (explicit or not).
      if (!cache.has(k) && matches[0]) {
        const m = matches[0];
        appendFileSync(CACHE, JSON.stringify({ k, p: [m.previewUrl, m.trackViewUrl ?? "", (m.artworkUrl100 ?? "").replace(/100x100bb/, "600x600bb")] }) + "\n");
      }
      return p;
    } catch (e) { console.log(String(e), `waiting ${wait / 1000}s`); await new Promise((r) => setTimeout(r, wait)); }
  }
}

const decade = (y: number) => Math.floor(y / 10) * 10;
const used = new Map<number, number>();
const chosen = new Map<string, { row: Row; preview: Preview }>();
const order = [...keep].sort(() => rand() - 0.5);
for (const k of order) {
  const [i, j] = k.split(",").map(Number);
  const cx = (i + 0.5) * CELL, cy = (j + 0.5) * CELL;
  const near = [...cells.get(k)!].sort((a, b) => Math.hypot(a[3] - cx, a[4] - cy) - Math.hypot(b[3] - cx, b[4] - cy)).slice(0, CANDIDATES);
  // Least-used decade first, then nearest the centre.
  near.sort((a, b) => (used.get(decade(a[5])) ?? 0) - (used.get(decade(b[5])) ?? 0)
    || Math.hypot(a[3] - cx, a[4] - cy) - Math.hypot(b[3] - cx, b[4] - cy));
  for (const r of near) {
    if (PROFANE.test(r[1])) continue;
    const p = await lookup(r[1], r[2]);
    if (!p) continue;
    chosen.set(k, { row: r, preview: p });
    used.set(decade(r[5]), (used.get(decade(r[5])) ?? 0) + 1);
    break;
  }
  if (!chosen.has(k)) console.log("no playable song in square", k);
}

const snake = [...chosen.keys()].map((k) => k.split(",").map(Number)).sort((a, b) => a[0] - b[0] || (a[0] % 2 === 0 ? a[1] - b[1] : b[1] - a[1]));
const songs = snake.map(([i, j], n) => {
  const { row: r, preview } = chosen.get(`${i},${j}`)!;
  const id = `${r[1]}|${r[2]}`;
  return { id, title: r[1], artist: r[2], year: r[5], half: n % 2, v: r[3], a: r[4], preview, ...(INSTRUMENTAL.has(id) ? { instrumental: true } : {}) };
});
writeFileSync(join(ROOT, "public", "rate", "songs.json"), JSON.stringify({ version: VERSION, cell: CELL, songs }, null, 0));
console.log(`${songs.length} songs; by decade:`, Object.fromEntries([...used].sort((a, b) => a[0] - b[0])));
