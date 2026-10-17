// Listener vibe tags, stored in the same Upstash Redis as /api/feedback. Kept private for analysis:
// nothing here is shown on the site, so free text can't be used to post things publicly.
//   vibes:log            every submission (JSON), for clustering tags in valence/arousal space
//   vibes:song:<song>    tag -> count for one song
//   vibes:all            tag -> count across all songs (sorted set)

const URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const MAX_PER_MINUTE = 20; // per IP
const MAX_TAGS = 3;
const TAG = /^[\p{L}\p{N}][\p{L}\p{N} '&-]{0,27}$/u;

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

export async function POST(request) {
  if (!URL || !TOKEN) return json({ error: "no database" }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { song, tags, voter, v, a } = body ?? {};
  const inRange = (x) => typeof x === "number" && Number.isFinite(x) && x >= -1 && x <= 1;
  const clean = Array.isArray(tags)
    ? [...new Set(tags.filter((t) => typeof t === "string").map((t) => t.toLowerCase().replace(/\s+/g, " ").trim()))]
    : [];
  if (typeof song !== "string" || song.length > 300 || !song.includes("|") || typeof voter !== "string"
      || voter.length > 64 || !inRange(v) || !inRange(a) || clean.length < 1 || clean.length > MAX_TAGS
      || !clean.every((t) => TAG.test(t) && !/(https?|www\.|\.com)/.test(t))) {
    return json({ error: "bad tags" }, 400);
  }
  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const minute = Math.floor(Date.now() / 60000);
  const [count] = await redis([["INCR", `vb:rl:${ip}:${minute}`], ["EXPIRE", `vb:rl:${ip}:${minute}`, 120]]);
  if (count > MAX_PER_MINUTE) return json({ error: "slow down" }, 429);
  const [fresh] = await redis([["SET", `vibes:seen:${voter}:${song}`, "1", "NX", "EX", 60 * 60 * 24 * 365]]);
  if (fresh !== "OK") return json({ error: "already tagged" }, 409);
  await redis([
    ["RPUSH", "vibes:log", JSON.stringify({ song, tags: clean, v, a, t: Date.now() })],
    ...clean.flatMap((t) => [["HINCRBY", `vibes:song:${song}`, t, 1], ["ZINCRBY", "vibes:all", 1, t]]),
  ]);
  return json({ ok: true });
}
