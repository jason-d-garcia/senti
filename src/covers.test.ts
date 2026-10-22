import { describe, expect, it } from "vitest";
import { TILES, coverUrl, tileOf, tilesAround } from "./covers";

describe("cover tiles", () => {
  it("puts the map's corners and edges in the outer tiles", () => {
    expect(tileOf(-1, -1)).toBe("0-0");
    expect(tileOf(1, 1)).toBe(`${TILES - 1}-${TILES - 1}`);
    expect(tileOf(0, 0)).toBe(`${TILES / 2}-${TILES / 2}`);
  });
  it("lists every tile a view touches, and only those", () => {
    expect(tilesAround(0.1, 0.1, 0.05)).toEqual([tileOf(0.1, 0.1)]);
    expect(tilesAround(0, 0, 0.2)).toHaveLength(4);
    expect(tilesAround(0, 0, 5)).toHaveLength(TILES * TILES);
  });
  it("rebuilds the cover URL at any size, and keeps a known miss empty", () => {
    expect(coverUrl("is1-ssl.mzstatic.com/image/thumb/a/b.jpg/", 120)).toBe("https://is1-ssl.mzstatic.com/image/thumb/a/b.jpg/120x120bb.jpg");
    expect(coverUrl("")).toBe("");
  });
});
