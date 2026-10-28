import { describe, expect, it } from "vitest";
import { axisParts, explain, fitWeights, nearestBy, verdict, verdictText } from "./explain";
import type { Fusion, Sources } from "./explain";
import scoresCsv from "../data/catalog_audio_scores.csv?raw";

// The weights the live catalogue was blended with (see public/songs/*.json).
const FUSION: Fusion = {
  valence: { lyrics: 0.6465, audio: 0.6114, bias: 0.0039 },
  arousal: { lyrics: 0.1402, audio: 1.0184, bias: -0.0194 },
};
const unit = { lyrics: 1, audio: 1, bias: 0 };

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

describe("verdict", () => {
  const v = (l: number, a: number) => verdict(axisParts(l, a, unit));
  it("is still when the pushes add up to less than 0.1", () => {
    expect(v(0.05, 0.0499)).toBe("still");
    expect(v(-0.06, 0.03)).toBe("still");
    expect(v(0.05, 0.05)).not.toBe("still");
  });
  it("is a conflict when they pull opposite ways, each by at least 0.05", () => {
    expect(v(0.3, -0.05)).toBe("conflict");
    expect(v(-0.05, 0.3)).toBe("conflict");
    // A small push the other way goes to the bigger one.
    expect(v(0.3, -0.049)).toBe("lyrics");
    expect(v(-0.049, 0.06)).toBe("sound");
  });
  it("says which one when it has 70% or more of the push", () => {
    expect(v(0.7, 0.3)).toBe("lyrics");
    expect(v(0.69, 0.31)).toBe("agree");
    expect(v(0.3, 0.7)).toBe("sound");
    expect(v(0.31, 0.69)).toBe("agree");
  });
  it("words a conflict by the stronger pull", () => {
    expect(verdictText("valence", axisParts(0.6, -0.2, unit))).toBe("The lyrics pulled it toward feels good; the sound pulled it back.");
    expect(verdictText("arousal", axisParts(0.1, -0.5, unit))).toBe("The sound pulled it toward low energy; the lyrics pulled it back.");
    expect(verdictText("valence", axisParts(0.02, 0.01, unit))).toMatch(/near the middle/);
  });
});

describe("explain", () => {
  it("names both readings", () => {
    const e = explain({ valence: 0.33, arousal: -0.35,
      sources: { lyrics: { valence: 0.7, arousal: 0.1 }, audio: { valence: -0.2, arousal: -0.35 }, fusion: FUSION } });
    expect(e.summary).toMatch(/^The lyrics read as happy; the sound reads as \w+\.$/);
    expect(e.valence && verdict(e.valence)).toBe("conflict");
    expect(e.arousal && verdict(e.arousal)).toBe("sound");
  });
  it("says so when lyrics and sound agree", () => {
    const e = explain({ valence: 0.6, arousal: 0.05,
      sources: { lyrics: { valence: 0.6, arousal: 0.05 }, audio: { valence: 0.6, arousal: 0.05 }, fusion: FUSION } });
    expect(e.summary).toBe("The lyrics and the sound both read as happy.");
  });
  it("falls back to lyrics only without audio scores", () => {
    const e = explain({ valence: -0.5, arousal: -0.5, sources: { lyrics: { valence: -0.5, arousal: -0.5 } } });
    expect(e.audio).toBeNull();
    expect(e.valence).toBeNull();
    expect(e.tagged).toBeUndefined();
    expect(e.summary).toBe("Placed by its lyrics alone, which read as lethargic. The audio model hasn't heard this one yet.");
  });
  it("adds where the mood tags put a MERGE test song", () => {
    const e = explain({ valence: 0.5, arousal: -0.5, true_valence: -0.5, true_arousal: -0.5 });
    expect(e.tagged).toEqual({ valence: -0.5, arousal: -0.5 });
    expect(e.summary).toMatch(/MERGE's mood tags put it in lethargic; our model put it in \w+\.$/);
    expect(explain({ valence: -0.5, arousal: -0.5, true_valence: -0.45, true_arousal: -0.5 }).summary).toMatch(/in lethargic too\.$/);
  });
});

describe("nearestBy", () => {
  const song = (id: string, l: number, a?: number) => ({ id, sources: {
    lyrics: { valence: l, arousal: 0 }, ...(a !== undefined && { audio: { valence: a, arousal: 0 }, fusion: FUSION }) } as Sources });
  const me = song("me", 0, 0);
  const all = [me, song("a", 0.1, 0.9), song("b", 0.5, 0.05), song("c", -0.2), song("d", 0.9, -0.1), { id: "test" }];
  it("finds the closest by one source, never the song itself", () => {
    expect(nearestBy(me, all, "lyrics", 2).map((s) => s.id)).toEqual(["a", "c"]);
    expect(nearestBy(me, all, "audio", 2).map((s) => s.id)).toEqual(["b", "d"]);
  });
  it("leaves out songs without that score", () => {
    expect(nearestBy(me, all, "audio", 9).map((s) => s.id)).toEqual(["b", "d", "a"]);
    expect(nearestBy(song("x", 0), all, "audio", 2)).toEqual([]);
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
  it("recovers the catalogue's weights from its scores", () => {
    // The six score columns come last and are never quoted, so they can be split off the end of each line.
    const rows = scoresCsv.trim().split("\n").slice(1)
      .map((line) => line.split(",").slice(-6).map(Number));
    expect(rows.length).toBeGreaterThan(2500);
    for (const [axis, w] of [[0, FUSION.valence], [1, FUSION.arousal]] as const) {
      const fit = fitWeights(rows.map((r) => [r[axis], r[axis + 2], r[axis + 4]]));
      expect(Math.abs(fit.lyrics - w.lyrics)).toBeLessThan(1e-3);
      expect(Math.abs(fit.audio - w.audio)).toBeLessThan(1e-3);
      expect(Math.abs(fit.bias - w.bias)).toBeLessThan(1e-3);
    }
  });
});
