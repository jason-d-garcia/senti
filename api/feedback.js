// Listener placements, stored in Upstash Redis (add it from the Vercel dashboard: Storage > Upstash).
// Without a database this returns 503 and the site keeps votes in the visitor's own browser.

const URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const MAX_PER_SONG = 200; // keep the most recent placements per song
const MAX_PER_MINUTE = 20; // per IP

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function redis(commands) {
  const r = await fetch(`${URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).map((x) => x.result);
}

const median = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Per-song summaries live in one hash, updated on each vote, so a read is a single command.
export async function GET() {
  if (!URL || !TOKEN) return json({ error: "no database" }, 503);
  const [flat] = await redis([["HGETALL", "fb:agg"]]);
  const out = {};
  for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = JSON.parse(flat[i + 1]);
  return new Response(JSON.stringify(out), {
    headers: { "content-type": "application/json", "cache-control": "s-maxage=60, stale-while-revalidate=600" },
  });
}

function summarize(entries) {
  const pts = entries.map((s) => s.split(",").map(Number));
  const v = median(pts.map((p) => p[0]));
  const a = median(pts.map((p) => p[1]));
  const spread = median(pts.map((p) => Math.hypot(p[0] - v, p[1] - a)));
  return { n: pts.length, v: +v.toFixed(3), a: +a.toFixed(3), spread: +spread.toFixed(3) };
}

export async function POST(request) {
  if (!URL || !TOKEN) return json({ error: "no database" }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { song, v, a, voter, blind, agree } = body ?? {};
  const inRange = (x) => typeof x === "number" && Number.isFinite(x) && x >= -1 && x <= 1;
  if (typeof song !== "string" || song.length > 300 || !song.includes("|") || !inRange(v) || !inRange(a)
      || typeof voter !== "string" || voter.length > 64) {
    return json({ error: "bad vote" }, 400);
  }
  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const minute = Math.floor(Date.now() / 60000);
  const [count] = await redis([["INCR", `fb:rl:${ip}:${minute}`], ["EXPIRE", `fb:rl:${ip}:${minute}`, 120]]);
  if (count > MAX_PER_MINUTE) return json({ error: "slow down" }, 429);
  const [fresh] = await redis([["SET", `fb:seen:${voter}:${song}`, "1", "NX", "EX", 60 * 60 * 24 * 365]]);
  if (fresh !== "OK") return json({ error: "already placed" }, 409);
  const entry = [v.toFixed(3), a.toFixed(3), blind ? 1 : 0, agree ? 1 : 0, Date.now()].join(",");
  const [, , entries] = await redis([
    ["RPUSH", `fb:p:${song}`, entry],
    ["LTRIM", `fb:p:${song}`, -MAX_PER_SONG, -1],
    ["LRANGE", `fb:p:${song}`, 0, -1],
  ]);
  await redis([["HSET", "fb:agg", song, JSON.stringify(summarize(entries))]]);
  return json({ ok: true });
}
