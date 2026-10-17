// Export every listener placement to CSV for retraining.
// Usage: KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/export_votes.mjs [--log] > votes.csv
// (`vercel env pull` writes these to .env.local for the linked project.)

const URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
if (!URL || !TOKEN) {
  console.error("Set KV_REST_API_URL and KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_* names).");
  process.exit(1);
}

async function redis(commands) {
  const r = await fetch(`${URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).map((x) => x.result);
}

// --log: every vote from fb:log as CSV, including 👎 votes where the song wasn't placed.
if (process.argv.includes("--log")) {
  const [rows] = await redis([["LRANGE", "fb:log", 0, -1]]);
  const q = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  console.log("title,artist,valence,arousal,blind,agree,placed,model_valence,model_arousal,source,time");
  for (const r of rows) {
    const x = JSON.parse(r);
    const [title, artist] = x.song.split("|");
    console.log([q(title), q(artist), x.v, x.a, +x.blind, +x.agree, +x.placed, x.model?.v ?? "", x.model?.a ?? "",
      x.source ?? "", new Date(x.t).toISOString()].join(","));
  }
  process.exit(0);
}

const csv = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const [flat] = await redis([["HGETALL", "fb:agg"]]);
const songs = flat.filter((_, i) => i % 2 === 0);
console.log("title,artist,valence,arousal,blind,agree,time");
for (let i = 0; i < songs.length; i += 100) {
  const batch = songs.slice(i, i + 100);
  const lists = await redis(batch.map((k) => ["LRANGE", `fb:p:${k}`, 0, -1]));
  batch.forEach((key, j) => {
    const [title, artist] = key.split("|");
    for (const e of lists[j]) {
      const [v, a, blind, agree, t] = e.split(",");
      console.log([csv(title), csv(artist), v, a, blind, agree, new Date(Number(t)).toISOString()].join(","));
    }
  });
}
