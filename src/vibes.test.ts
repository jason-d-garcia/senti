import { describe, expect, it } from "vitest";
import { cleanVibe, cleanVibes } from "./vibes";

describe("vibe tags", () => {
  it("normalises case, spacing and a leading hash", () => {
    expect(cleanVibe("  Late-Night   DRIVE ")).toBe("late-night drive");
    expect(cleanVibe("#Nostalgic")).toBe("nostalgic");
    expect(cleanVibe("café")).toBe("café");
  });
  it("rejects empty, too long, links, numbers and odd characters", () => {
    expect(cleanVibe("")).toBeNull();
    expect(cleanVibe("x".repeat(40))).toBeNull();
    expect(cleanVibe("www.spam.com")).toBeNull();
    expect(cleanVibe("12345")).toBeNull();
    expect(cleanVibe("<script>")).toBeNull();
  });
  it("de-duplicates and caps at three", () => {
    expect(cleanVibes(["Chill", "chill", "dreamy", "hype", "summer"])).toEqual(["chill", "dreamy", "hype"]);
  });
});
