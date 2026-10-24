// Listening-study ratings from the unlisted /rate/ page, stored in the same Upstash Redis as listener votes.
// POST saves one rating; GET gives counts (and raters per half); GET ?format=csv downloads every rating
// (anonymous rater codes, no names).
//
// Payment codes: a rater who has finished asks for one (POST { claim: rater }). It is a fresh random code, stored
// only in a set of valid codes, never next to the rater's code, so the code someone puts in a Venmo note can't be
// matched to their answers, not even by the person paying. GET ?pay=CODE says whether a code is valid and unpaid;
// GET ?pay=CODE&paid=1 marks it paid (knowing the code is the permission; codes are long and random).

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

const COLUMNS = ["rater", "half", "trial", "song", "repeat", "v", "a", "skipped", "listened_s", "with_lyrics", "consent", "known", "no_vocals", "active_s", "t"];
const csvCell = (x) => (typeof x === "string" && /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x ?? "");

// Paid spots: at most PAID_SPOTS payment codes ever. Starting the study holds a spot (POST { reserve }), so nobody who
// started while spots were open finds them gone at the end. Each answer keeps the hold alive for another HOLD_MS, so
// only people who stop answering for that long lose it.
// 10 paid places, plus the one payment code already given to Josh's first run before it was marked unpaid.
const PAID_SPOTS = Number(process.env.STUDY_PAID_SPOTS ?? 11);
// Test runs that are saved like any other but never take a paid spot (Josh's first run and Jason's tests).
const UNPAID = new Set(["4md8cce7", "37753gx8", "ns7s3j48", ...(process.env.STUDY_UNPAID ?? "").split(",").filter(Boolean)]);
const HOLD_MS = 3 * 60 * 60 * 1000;
async function spots() {
  const now = Date.now();
  // One-off: the holds open on 24 Oct 2026 were all Jason's test sessions; clear them once.
  const [first] = await redis([["SET", "rate:cleared-test-holds-1", "1", "NX"]]);
  if (first === "OK") await redis([["DEL", "rate:hold"]]);
  const [, , held, open, paid] = await redis([["ZREMRANGEBYSCORE", "rate:hold", 0, now], ["ZREM", "rate:hold", ...UNPAID], ["ZCARD", "rate:hold"],
    ["SCARD", "rate:pay:open"], ["SCARD", "rate:pay:paid"]]);
  const issued = Number(open) + Number(paid);
  return { issued, held: Number(held), left: Math.max(0, PAID_SPOTS - issued - Number(held)) };
}

/** Answers needed before a payment code is given out (each half is 50 songs plus 4 repeats). */
const FINISHED = 50;
const payCode = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (n) => "abcdefghjkmnpqrstuvwxyz23456789"[n % 31]).join("");

export async function GET(request) {
  if (!URL || !TOKEN) return json({ error: "no database" }, 503);
  const params = new globalThis.URL(request.url).searchParams;
  const code = params.get("pay");
  if (code) {
    if (!/^[a-z0-9]{6,20}$/.test(code)) return json({ code, valid: false });
    const [unpaid, paid] = await redis([["SISMEMBER", "rate:pay:open", code], ["SISMEMBER", "rate:pay:paid", code]]);
    if (params.get("paid") === "1" && unpaid) {
      await redis([["SMOVE", "rate:pay:open", "rate:pay:paid", code]]);
      return json({ code, valid: true, paid: true, note: "marked paid" });
    }
    return json({ code, valid: !!(unpaid || paid), paid: !!paid });
  }
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
  const { left, issued, held } = await spots();
  return json({ ratings: rows.length, raters: raters.size, halves, paidSpotsLeft: left, paidSpots: PAID_SPOTS - 1,
    paymentCodesIssued: issued, spotsHeld: held }, 200);
}

export async function POST(request) {
  if (!URL || !TOKEN) return json({ error: "no database" }, 503);
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  if (typeof b?.feedback === "string") return feedback(request, b.feedback);
  if (typeof b?.reserve === "string") {
    // Starting: hold a paid spot if one is free.
    if (!/^[a-z0-9]{6,16}$/.test(b.reserve)) return json({ error: "bad code" }, 400);
    const { left } = await spots();
    if (left <= 0) return json({ reserved: false, left: 0 });
    await redis([["ZADD", "rate:hold", Date.now() + HOLD_MS, b.reserve]]);
    return json({ reserved: true, left: left - 1 });
  }
  if (typeof b?.claim === "string") {
    // A finished rater asks for their payment code. One per rater; the code itself is stored apart from them.
    if (!/^[a-z0-9]{6,16}$/.test(b.claim)) return json({ error: "bad code" }, 400);
    let [n] = await redis([["GET", `rate:count:${b.claim}`]]);
    n = Number(n ?? 0);
    if (n < FINISHED) {
      // Answers saved before the counter existed: count them from the log.
      const [items] = await redis([["LRANGE", "rate:log", 0, -1]]);
      n = Math.max(n, items.filter((s) => s.includes(`"rater":"${b.claim}"`)).length);
    }
    if (n < FINISHED) return json({ error: "not finished", answers: n }, 409);
    if (UNPAID.has(b.claim)) return json({ error: "unpaid run" }, 409);
    // A held spot is honoured while the total stays within the paid spots; without one (or after it lapsed) only a
    // free spot will do.
    const { issued, left } = await spots();
    const [hold] = await redis([["ZSCORE", "rate:hold", b.claim]]);
    if (issued >= PAID_SPOTS || (hold === null && left <= 0)) return json({ error: "spots full" }, 409);
    const [first] = await redis([["SET", `rate:claimed:${b.claim}`, "1", "NX"]]);
    if (first !== "OK") return json({ error: "already claimed" }, 409);
    await redis([["ZREM", "rate:hold", b.claim]]);
    const code = payCode();
    await redis([["SADD", "rate:pay:open", code]]);
    return json({ code });
  }
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
    listened_s: typeof b.listened === "number" ? Math.round(b.listened) : null, with_lyrics: false, consent: b.consent === true, known: b.known === true, no_vocals: b.noVocals === true,
    active_s: typeof b.active === "number" && Number.isFinite(b.active) ? Math.round(Math.min(Math.max(b.active, 0), 600)) : null, t: Date.now(),
  };
  await redis([["RPUSH", "rate:log", JSON.stringify(row)], ["INCR", `rate:count:${b.rater}`],
    ["ZADD", "rate:hold", "XX", Date.now() + HOLD_MS, b.rater]]);
  return json({ ok: true });
}

// End-of-study feedback: anonymous (no rater code), kept in the list rate:feedback (readable in the Upstash data browser),
// and emailed too when RESEND_API_KEY and FEEDBACK_TO are set in Vercel (sent from study@playsenti.com via Resend).
async function feedback(request, text) {
  text = text.trim().slice(0, 2000);
  if (!text) return json({ error: "empty" }, 400);
  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const [n] = await redis([["INCR", `rate:fbrl:${ip}`], ["EXPIRE", `rate:fbrl:${ip}`, 3600]]);
  if (n > 5) return json({ error: "slow down" }, 429);
  await redis([["LPUSH", "rate:feedback", JSON.stringify({ text, t: Date.now() })]]);
  if (process.env.RESEND_API_KEY && process.env.FEEDBACK_TO) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: "senti study <study@playsenti.com>", to: process.env.FEEDBACK_TO,
          subject: "Listening study feedback", text }),
      });
    } catch { /* it's saved either way */ }
  }
  return json({ ok: true });
}
