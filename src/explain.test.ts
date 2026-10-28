import { describe, expect, it } from "vitest";
import { axisParts, driver, explain, fitWeights } from "./explain";
import type { Fusion } from "./explain";

// The weights the live catalogue was blended with (see public/songs/*.json).
const FUSION: Fusion = {
  valence: { lyrics: 0.6465, audio: 0.6114, bias: 0.0039 },
  arousal: { lyrics: 0.1402, audio: 1.0184, bias: -0.0194 },
};

describe("axisParts", () => {
  it("splits the blended score into lyrics and sound parts that add back up", () => {
    const p = axisParts(0.5, -0.2, FUSION.valence);
    expect(p.lyrics + p.audio + p.bias).toBeCloseTo(p.total, 10);
    expect(p.lyricsShare).toBeCloseTo(0.32325 / (0.32325 + 0.12228), 5);
  });
  it("clips the total to the map, like the catalogue does", () => {
    expect(axisParts(1, 1, FUSION.valence).total).toBe(1);
  });
  it("calls it even when neither source pushes", () => {
    expect(axisParts(0, 0, FUSION.valence).lyricsShare).toBe(0.5);
  });
});

describe("explain", () => {
  it("names both readings and who drove each axis", () => {
    // Happy-sounding lyrics, a calm low-energy track.
    const e = explain({ valence: 0.33, arousal: -0.35,
      sources: { lyrics: { valence: 0.7, arousal: 0.1 }, audio: { valence: -0.2, arousal: -0.35 }, fusion: FUSION } });
    expect(e.summary).toMatch(/^The lyrics read as happy; the sound reads as /);
    expect(e.summary).toContain("energy comes mostly from the sound");
    expect(e.summary).toContain("feels comes mostly from the lyrics");
  });
  it("says so when lyrics and sound agree", () => {
    const e = explain({ valence: 0.6, arousal: 0.05,
      sources: { lyrics: { valence: 0.6, arousal: 0.05 }, audio: { valence: 0.6, arousal: 0.05 }, fusion: FUSION } });
    expect(e.summary).toMatch(/^The lyrics and the sound both read as happy\./);
  });
  it("falls back to lyrics only without audio scores", () => {
    const e = explain({ valence: -0.5, arousal: -0.5 });
    expect(e.audio).toBeNull();
    expect(e.valence).toBeNull();
    expect(e.summary).toMatch(/lyrics alone, which read as lethargic/);
  });
});

describe("driver", () => {
  it("has a middle band", () => {
    expect(driver(0.9)).toBe("mostly from the lyrics");
    expect(driver(0.1)).toBe("mostly from the sound");
    expect(driver(0.5)).toMatch(/about equally/);
  });
});

describe("fitWeights", () => {
  it("recovers the weights a blend was made with", () => {
    const rows: [number, number, number][] = [];
    for (let i = 0; i < 40; i++) {
      const l = Math.sin(i), a = Math.cos(i * 1.7);
      rows.push([l, a, 0.65 * l + 0.61 * a + 0.004]);
    }
    const w = fitWeights(rows);
    expect(w.lyrics).toBeCloseTo(0.65, 6);
    expect(w.audio).toBeCloseTo(0.61, 6);
    expect(w.bias).toBeCloseTo(0.004, 6);
  });
});
