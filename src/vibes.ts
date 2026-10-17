/** Listener "vibe" tags for songs: short free-text words beyond the 16 emotions. */

export const MAX_TAGS = 3;
const MAX_LEN = 28;

/** Starting suggestions, so tags share a vocabulary. Listeners can type their own. */
export const SUGGESTED_VIBES = [
  "nostalgic", "late-night drive", "hype", "heartbreak", "dreamy", "summer", "rainy day", "empowering",
  "bittersweet", "party", "chill", "angsty", "romantic", "spooky", "triumphant", "lonely",
];

/** Lowercase, single spaces, letters/numbers/space/'-& only. Returns null for anything unusable. */
export function cleanVibe(raw: string): string | null {
  const t = raw.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim().replace(/^#/, "");
  if (!t || t.length > MAX_LEN) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '&-]*$/u.test(t)) return null;
  if (/^\d+$/.test(t) || /(https?|www\.|\.com)/.test(t)) return null;
  return t;
}

/** Cleaned, de-duplicated tags, at most MAX_TAGS. */
export function cleanVibes(raw: string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const t = cleanVibe(r);
    if (t && !out.includes(t)) out.push(t);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

export async function sendVibes(body: { song: string; tags: string[]; voter: string; v: number; a: number }): Promise<boolean> {
  try {
    const r = await fetch("/api/vibes", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return r.ok || r.status === 409;
  } catch {
    return false;
  }
}
