import { describe, expect, it } from "vitest";
import { buildQueue, clampPt, decodePt, encodePt, EXTENT, groundAt, waypoints } from "./trip";

const grid = Array.from({ length: 121 }, (_, i) => ({ id: i, valence: ((i % 11) - 5) / 6, arousal: (Math.floor(i / 11) - 5) / 10 }));

describe("buildQueue", () => {
  it("gives the nearest songs when there is no destination", () => {
    const q = buildQueue(grid, { valence: 0, arousal: 0 }, null);
    expect(q).toHaveLength(6);
    expect(q[0]).toMatchObject({ valence: 0, arousal: 0 });
  });
  it("walks from one feeling to the other without repeating a song", () => {
    const from = { valence: -0.8, arousal: 0.4 }, to = { valence: 0.8, arousal: -0.4 };
    const q = buildQueue(grid, from, to);
    expect(new Set(q.map((s) => s.id)).size).toBe(6);
    for (let i = 1; i < q.length; i++) expect(q[i].valence).toBeGreaterThan(q[i - 1].valence);
    expect(q[0].valence).toBeLessThan(-0.6);
    expect(q[5].valence).toBeGreaterThan(0.6);
  });
  it("is repeatable for a seed and changes with it", () => {
    const from = { valence: 0.1, arousal: 0.05 };
    const ids = (seed: number) => buildQueue(grid, from, null, seed).map((s) => s.id).join();
    expect(ids(1)).toBe(ids(1));
    expect(ids(1)).not.toBe(ids(2));
  });
  it("moves on to the next nearest songs with skip, and copes with a tiny catalogue", () => {
    const a = buildQueue(grid, { valence: 0, arousal: 0 }, null, 0, 6, 0), b = buildQueue(grid, { valence: 0, arousal: 0 }, null, 0, 6, 6);
    expect(a.some((s) => b.includes(s))).toBe(false);
    expect(buildQueue(grid.slice(0, 3), { valence: 0, arousal: 0 }, { valence: 1, arousal: 0 })).toHaveLength(3);
    expect(buildQueue([], { valence: 0, arousal: 0 }, null)).toEqual([]);
  });
});

describe("map helpers", () => {
  it("spaces waypoints evenly, ends included", () => {
    const w = waypoints({ valence: 0, arousal: 0 }, { valence: 0.5, arousal: -0.5 });
    expect(w[0]).toEqual({ valence: 0, arousal: 0 });
    expect(w[5].valence).toBeCloseTo(0.5);
    expect(w[1].arousal).toBeCloseTo(-0.1);
  });
  it("keeps points on the map and round-trips share links", () => {
    expect(clampPt({ valence: 2, arousal: -2 })).toEqual({ valence: EXTENT.valence, arousal: -EXTENT.arousal });
    expect(decodePt(encodePt({ valence: 0.523, arousal: -0.314 }))).toEqual({ valence: 0.52, arousal: -0.31 });
    expect(decodePt("nope")).toBeNull();
    expect(decodePt(null)).toBeNull();
  });
  it("is paper in the middle and a different colour in each corner", () => {
    expect(groundAt({ valence: 0, arousal: 0 })).toBe("rgb(236 232 223)");
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([v, a]) => groundAt({ valence: v, arousal: a }));
    expect(new Set(corners).size).toBe(4);
  });
});
