/** Share links: ?s=<song key> opens Moodify on that song. */
import { songKey } from "./feedback";

export const SHARE_PARAM = "s";

export function songLink(song: { title: string; artist: string }): string {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set(SHARE_PARAM, songKey(song));
  return url.toString();
}

/** The song key from the page's own URL, if it was opened from a share link. */
export function sharedSongKey(): string | null {
  return new URLSearchParams(window.location.search).get(SHARE_PARAM);
}

/** Native share sheet where there is one (phones), otherwise copy the link. */
export async function share(data: { title: string; text: string; url: string }): Promise<"shared" | "copied" | "failed"> {
  if (navigator.share) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return "failed";
    }
  }
  try {
    await navigator.clipboard.writeText(`${data.text} ${data.url}`);
    return "copied";
  } catch {
    return "failed";
  }
}
