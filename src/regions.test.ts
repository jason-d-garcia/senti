// Mood-region mapping: the 16 circumplex sections, the mixed centre, and the committed song shards.
import { describe, expect, it } from "vitest";
import { EMOTIONS, MIXED_RADIUS, emotionAt, quadrantOf } from "./mood";

const at = (deg: number, r = 1) => {
  const rad = (deg * Math.PI) / 180;
  return emotionAt(r * Math.cos(rad), r * Math.sin(rad))?.name ?? "Mixed";
};

describe("mood regions", () => {
  it("orders the sections counter-clockwise as in the README table", () => {
    expect(EMOTIONS.map((e) => e.name)).toEqual([
      "Happy", "Elated", "Excited", "Alert", // feels good + wired
      "Tense", "Nervous", "Stressed", "Upset", // feels bad + wired
      "Sad", "Depressed", "Lethargic", "Fatigued", // feels bad + calm
      "Calm", "Relaxed", "Serene", "Contented", // feels good + calm
    ]);
  });

  it("gives every section an equal 22.5 degree slice with no gaps", () => {
    EMOTIONS.forEach((e, i) => {
      expect(e.from).toBe(i * 22.5);
      expect(e.to - e.from).toBe(22.5);
    });
    expect(EMOTIONS[15].to).toBe(360);
  });

  it("puts each section's centre in that section and in its quadrant", () => {
    for (const e of EMOTIONS) {
      const mid = (e.from + e.to) / 2;
      expect(at(mid)).toBe(e.name);
      const rad = (mid * Math.PI) / 180;
      expect(quadrantOf(Math.cos(rad), Math.sin(rad))).toBe(e.mood);
    }
  });

  it("assigns a boundary angle to the section that starts there", () => {
    expect(at(0)).toBe("Happy");
    expect(at(22.5)).toBe("Elated");
    expect(at(90)).toBe("Tense");
    expect(at(180)).toBe("Sad");
    expect(at(270)).toBe("Calm");
    expect(at(359.99)).toBe("Contented");
  });

  it("depends on direction, not distance, outside the mixed centre", () => {
    for (const deg of [10, 100, 200, 300]) expect(at(deg, 0.25)).toBe(at(deg, 1));
  });

  it("calls points within the mixed radius Mixed", () => {
    expect(MIXED_RADIUS).toBe(0.2);
    expect(at(45, 0.199)).toBe("Mixed");
    expect(at(45, 0.2)).toBe("Excited");
    expect(emotionAt(0, 0)).toBeNull();
  });
});

describe("committed song shards", () => {
  type Shard = { songs: [number, string, string, number, number][] };
  const files = import.meta.glob<Shard>("../public/songs/*.json", { eager: true, import: "default" });
  const shards = Object.keys(files).map((p) => p.split("/").pop()!);
  const rows = (f: string) => files[`../public/songs/${f}`].songs;

  it("has one shard per section plus mixed, 5,411 songs in all", () => {
    expect(shards.sort()).toEqual([...EMOTIONS.map((e) => e.name.toLowerCase()), "mixed"].map((n) => `${n}.json`).sort());
    expect(shards.reduce((n, f) => n + rows(f).length, 0)).toBe(5411);
  });

  it("files every song under the section its position falls in", () => {
    for (const f of shards) {
      for (const [, , , v, a] of rows(f)) expect((emotionAt(v, a)?.name ?? "Mixed").toLowerCase()).toBe(f.slice(0, -5));
    }
  });
});
