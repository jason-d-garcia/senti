import { describe, expect, it, vi } from "vitest";
import { findPreview, isMatch, isRateLimited, normalize } from "./preview";

const t = (trackName: string, artistName: string) => ({ trackName, artistName, previewUrl: "https://x/p.m4a" });

describe("normalize", () => {
  it("drops brackets, credits, accents and punctuation", () => {
    expect(normalize("Despacito (Remix) [feat. Justin Bieber]")).toBe("despacito");
    expect(normalize("Señorita")).toBe("senorita");
    expect(normalize("Don't Stop Believin'")).toBe("don t stop believin");
    expect(normalize("Hall & Oates")).toBe("hall and oates");
  });
});

describe("isMatch", () => {
  const song = { title: "Uptown Funk", artist: "Mark Ronson featuring Bruno Mars" };
  it("accepts the same title by an overlapping artist", () => {
    expect(isMatch(song, t("Uptown Funk (feat. Bruno Mars)", "Mark Ronson"))).toBe(true);
  });
  it("rejects a different title or a different artist", () => {
    expect(isMatch(song, t("Uptown Special", "Mark Ronson"))).toBe(false);
    expect(isMatch(song, t("Uptown Funk", "Kidz Bop Kids"))).toBe(false);
  });
  it("rejects tracks without a preview", () => {
    expect(isMatch(song, { trackName: "Uptown Funk", artistName: "Mark Ronson" })).toBe(false);
  });
});

describe("findPreview when iTunes refuses", () => {
  it("doesn't remember a refusal as a miss, and retries once the limit clears", async () => {
    vi.useFakeTimers();
    const song = { title: "Retry Song", artist: "Some Artist" };
    const ok = { results: [{ trackName: "Retry Song", artistName: "Some Artist", previewUrl: "https://x/p.m4a" }] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({ ok: true, json: async () => ok });
    vi.stubGlobal("fetch", fetchMock);
    expect(await findPreview(song)).toBeNull();
    expect(isRateLimited()).toBe(true);
    expect(await findPreview(song)).toBeNull(); // still blocked: no request sent
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    expect(isRateLimited()).toBe(false);
    expect((await findPreview(song))?.audioUrl).toBe("https://x/p.m4a");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
