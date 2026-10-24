import { describe, expect, it } from "vitest";
import { REPEATS, REPEAT_GAP, makePlan, newRaterCode } from "./plan";

const ids = Array.from({ length: 50 }, (_, i) => `song ${i}`);

describe("study plan", () => {
  it("plays every song once plus the hidden repeats", () => {
    const plan = makePlan(ids);
    expect(plan).toHaveLength(ids.length + REPEATS);
    expect(new Set(plan.filter((t) => !t.repeat).map((t) => t.id))).toEqual(new Set(ids));
  });
  it("puts each repeat well after the first time it was heard", () => {
    for (let k = 0; k < 50; k++) {
      const plan = makePlan(ids);
      for (const [i, t] of plan.entries()) {
        if (!t.repeat) continue;
        const first = plan.findIndex((x) => x.id === t.id && !x.repeat);
        expect(i - first).toBeGreaterThan(REPEAT_GAP);
      }
    }
  });
  it("spreads the repeats out, never two within a few songs of each other", () => {
    for (let k = 0; k < 200; k++) {
      const at = makePlan(ids).flatMap((t, i) => (t.repeat ? [i] : []));
      expect(at).toHaveLength(REPEATS);
      for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(3);
    }
  });
  it("never repeats a song it's told to leave out", () => {
    const skip = new Set(ids.slice(0, 40));
    for (let k = 0; k < 100; k++) for (const t of makePlan(ids, Math.random, skip)) if (t.repeat) expect(skip.has(t.id)).toBe(false);
  });
  it("makes rater codes the API accepts", () => {
    expect(newRaterCode()).toMatch(/^[a-z0-9]{6,16}$/);
  });
});
