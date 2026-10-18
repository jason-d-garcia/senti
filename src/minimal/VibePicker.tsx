import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { MAX_TAGS, SUGGESTED_VIBES, cleanVibe, sendVibes } from "../vibes";
import { voterId } from "../feedback";

const SHOWN = 8;

/** "What’s the vibe?": up to three short tags, picked from suggestions or typed. */
export function VibePicker({ song, at }: { song: string; at: { v: number; a: number } }) {
  const suggestions = useMemo(() => [...SUGGESTED_VIBES].sort(() => Math.random() - 0.5).slice(0, SHOWN), []);
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"edit" | "sending" | "sent" | "failed">("edit");
  const done = useRef<HTMLParagraphElement>(null);
  // The form (and its focused Save button) is replaced by the thank-you, so move focus there.
  useEffect(() => { if (state === "sent") done.current?.focus({ preventScroll: true }); }, [state]);
  const full = tags.length >= MAX_TAGS;

  const toggle = (t: string) => setTags((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : xs.length < MAX_TAGS ? [...xs, t] : xs));
  const addDraft = () => {
    const t = cleanVibe(draft);
    if (t && !tags.includes(t) && !full) setTags((xs) => [...xs, t]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); addDraft(); } };
  const save = async () => {
    setState("sending");
    const ok = await sendVibes({ song, tags, voter: voterId(), v: at.v, a: at.a });
    setState(ok ? "sent" : "failed");
  };

  if (state === "sent") return <p className="vibe-done" ref={done} tabIndex={-1}>Tagged: {tags.join(", ")}. Thanks!</p>;
  const custom = tags.filter((t) => !suggestions.includes(t));
  return (
    <div className="vibes">
      <p className="ask-q">What’s the vibe?</p>
      <p className="ask-sub">Optional. Pick or type up to {MAX_TAGS}; they help us find moods the map doesn’t name yet.</p>
      <div className="vibe-chips">
        {[...suggestions, ...custom].map((t) => (
          <button key={t} type="button" className="vibe-chip" aria-pressed={tags.includes(t)}
            disabled={full && !tags.includes(t)} onClick={() => toggle(t)}>{t}</button>
        ))}
      </div>
      <div className="vibe-row">
        <input
          className="vibe-input" name="vibe" autoComplete="off" spellCheck={false} value={draft} maxLength={28} aria-label="Add your own vibe"
          onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => draft && addDraft()}
          readOnly={full} aria-disabled={full || undefined} placeholder={full ? `Up to ${MAX_TAGS} tags` : "Add your own…"}
        />
        <button type="button" className="solid" disabled={!tags.length || state === "sending"} onClick={save}>
          {state === "sending" ? "Saving…" : state === "failed" ? "Try again" : "Save"}
        </button>
      </div>
      {state === "failed" && <p className="vibe-error" role="alert">Couldn’t save your tags. Check your connection and try again.</p>}
    </div>
  );
}
