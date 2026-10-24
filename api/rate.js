// Listening-study ratings from the unlisted /rate/ page, stored in the same Upstash Redis as listener votes.
// POST saves one rating; GET gives counts (and raters per half); GET ?format=csv downloads every rating
// (anonymous rater codes, no names).

const URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const MAX_PER_MINUTE = 40; // per IP

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

const COLUMNS = ["rater", "half", "trial", "song", "repeat", "v", "a", "skipped", "listened_s", "with_lyrics", "consent", "known", "t"];
const csvCell = (x) => (typeof x === "string" && /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x ?? "");

export async function GET(request) {
  if (!URL || !TOKEN) return json({ error: "no database" }, 503);
  const [items] = await redis([["LRANGE", "rate:log", 0, -1]]);
  const rows = items.map((s) => JSON.parse(s));
  if (new globalThis.URL(request.url).searchParams.get("format") === "csv") {
    const body = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\n");
    return new Response(body, { headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=senti_ratings.csv",
      "cache-control": "no-store" } });
  }
  const raters = new Set(rows.map((r) => r.rater));
  // Raters started on each half of the songs, so a new rater can be given the half with fewer.
  const halves = [0, 1].map((h) => new Set(rows.filter((r) => r.half === h).map((r) => r.rater)).size);
  return json({ ratings: rows.length, raters: raters.size, halves }, 200);
}

export async function POST(request) {
  if (!URL || !TOKEN) return json({ error: "no database" }, 503);
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const inRange = (x) => typeof x === "number" && Number.isFinite(x) && x >= -1 && x <= 1;
  const skipped = b?.skipped === true;
  if (typeof b?.rater !== "string" || !/^[a-z0-9]{6,16}$/.test(b.rater) || typeof b.song !== "string" || b.song.length > 300
      || !Number.isInteger(b.trial) || b.trial < 0 || b.trial > 200 || (!skipped && !(inRange(b.v) && inRange(b.a)))) {
    return json({ error: "bad rating" }, 400);
  }
  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const minute = Math.floor(Date.now() / 60000);
  const [count] = await redis([["INCR", `rate:rl:${ip}:${minute}`], ["EXPIRE", `rate:rl:${ip}:${minute}`, 120]]);
  if (count > MAX_PER_MINUTE) return json({ error: "slow down" }, 429);
  // One answer per rater per trial, so a double tap or a resend doesn't count twice.
  const [fresh] = await redis([["SET", `rate:seen:${b.rater}:${b.trial}`, "1", "NX", "EX", 60 * 60 * 24 * 365]]);
  if (fresh !== "OK") return json({ ok: true, duplicate: true });
  const row = {
    rater: b.rater, half: b.half === 0 || b.half === 1 ? b.half : null, trial: b.trial, song: b.song, repeat: !!b.repeat, skipped,
    v: skipped ? null : +b.v.toFixed(3), a: skipped ? null : +b.a.toFixed(3),
    listened_s: typeof b.listened === "number" ? Math.round(b.listened) : null, with_lyrics: false, consent: b.consent === true, known: b.known === true, t: Date.now(),
  };
  await redis([["RPUSH", "rate:log", JSON.stringify(row)]]);
  return json({ ok: true });
}
