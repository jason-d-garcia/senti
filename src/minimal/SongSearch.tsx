import { useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { emotionAt } from "../mood";
import type { PlacedSong } from "../mood";
import { searchSongs } from "../search";

const SHOWN = 8;

interface Props<T extends PlacedSong> {
  songs: T[];
  /** Called on first focus, so the whole catalogue can download (it normally arrives a section at a time). */
  onOpen: () => void;
  /** Whether every section has arrived; until then a search may miss songs. */
  ready: boolean;
  onPick: (song: T) => void;
  color: (s: PlacedSong) => string;
}

/** Search box in the corner: type a title or artist, pick a song, and the light jumps to it. */
export function SongSearch<T extends PlacedSong>({ songs, onOpen, ready, onPick, color }: Props<T>) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = useMemo(() => searchSongs(songs, query, SHOWN), [songs, query]);
  const showing = open && query.trim() !== "";

  const pick = (s: T) => {
    onPick(s);
    setQuery(""); setOpen(false); setActive(0);
    input.current?.blur();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!results.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
    } else if (e.key === "Enter") {
      if (results[active]) { e.preventDefault(); pick(results[active]); }
    } else if (e.key === "Escape") {
      if (query) setQuery(""); else input.current?.blur();
      setOpen(false);
    }
  };

  return (
    <div className="search" role="search">
      <svg className="search-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        ref={input}
        className="search-input"
        type="search"
        placeholder="Find a song"
        aria-label="Find a song by title or artist"
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onFocus={() => { onOpen(); setOpen(true); }}
        onBlur={() => setOpen(false)}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {showing && (
        <ul className="search-results" id={listId} role="listbox" aria-label="Songs">
          {results.map((s, i) => {
            const feeling = emotionAt(s.valence, s.arousal)?.name ?? "Mixed";
            return (
              <li
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`search-result${i === active ? " is-active" : ""}`}
                // Pick on mouse down, before the input's blur closes the list.
                onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="search-title">{s.title}</span>
                <span className="search-meta">
                  {s.artist} · <span style={{ color: color(s) }}>{feeling}</span>
                </span>
              </li>
            );
          })}
          {!results.length && <li className="search-empty" role="presentation">{ready ? "No songs match." : "Loading songs…"}</li>}
        </ul>
      )}
    </div>
  );
}
