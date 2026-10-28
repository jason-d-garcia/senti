import { describe, expect, it } from "vitest";
import { searchSongs } from "./search";

const songs = [
  { title: "Someone Like You", artist: "Adele" },
  { title: "Hello", artist: "Adele" },
  { title: "Hello, Goodbye", artist: "The Beatles" },
  { title: "Say Hello", artist: "Rosie Thomas" },
  { title: "Café del Mar", artist: "Energy 52" },
];

describe("song search", () => {
  it("puts titles that start with the search first, then other title matches", () => {
    expect(searchSongs(songs, "hello", 10).map((s) => s.title)).toEqual(["Hello", "Hello, Goodbye", "Say Hello"]);
  });
  it("matches words across title and artist, ignoring case, accents and punctuation", () => {
    expect(searchSongs(songs, "adele HELLO", 10).map((s) => s.title)).toEqual(["Hello"]);
    expect(searchSongs(songs, "cafe", 10).map((s) => s.title)).toEqual(["Café del Mar"]);
    expect(searchSongs(songs, "hello goodbye!", 10).map((s) => s.artist)).toEqual(["The Beatles"]);
  });
  it("finds songs by artist alone, and returns nothing for an empty search", () => {
    expect(searchSongs(songs, "adele", 10)).toHaveLength(2);
    expect(searchSongs(songs, "  ", 10)).toEqual([]);
  });
  it("stops at the limit", () => {
    expect(searchSongs(songs, "e", 2)).toHaveLength(2);
  });
});
