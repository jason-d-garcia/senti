import { describe, expect, it } from "vitest";
import { parseRow } from "./songs";
import type { Row } from "./songs";
import type { Fusion } from "./explain";

const FUSION: Fusion = {
  valence: { lyrics: 0.6465, audio: 0.6114, bias: 0.0039 },
  arousal: { lyrics: 0.1402, audio: 1.0184, bias: -0.0194 },
};
const PREVIEW: Row[7] = ["https://a/x.m4a", "https://music.apple.com/x", "https://i/600x600bb.jpg"];

describe("parseRow", () => {
  it("reads a song with a stored preview and audio scores", () => {
    const s = parseRow([3, "Running Bear", "Johnny Preston", 0.4741, 0.0189, 1960, 4, PREVIEW, [0.471, -0.193, 0.2711, 0.0642]], FUSION);
    expect(s).toMatchObject({ id: "3-Johnny Preston-Running Bear", valence: 0.4741, arousal: 0.0189, year: 1960, peak_rank: 4 });
    expect(s.preview).toEqual({ audioUrl: PREVIEW![0], pageUrl: PREVIEW![1], artworkUrl: PREVIEW![2] });
    expect(s.sources).toEqual({ lyrics: { valence: 0.471, arousal: -0.193 }, audio: { valence: 0.2711, arousal: 0.0642 }, fusion: FUSION });
  });
  it("reads audio scores after a null preview", () => {
    const s = parseRow([5, "T", "A", 0.1, 0.2, 0, 0, null, [0.1, 0.2, 0.3, 0.4]], FUSION);
    expect(s.preview).toBeUndefined();
    expect(s.year).toBeUndefined();
    expect(s.sources?.audio).toEqual({ valence: 0.3, arousal: 0.4 });
  });
  it("places a seven-field row by its lyrics alone", () => {
    const s = parseRow([9, "T", "A", -0.3, 0.5, 1999, 12], FUSION);
    expect(s.preview).toBeUndefined();
    expect(s.sources).toEqual({ lyrics: { valence: -0.3, arousal: 0.5 } });
  });
});
