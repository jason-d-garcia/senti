import { useMemo } from "react";
import { ENDS, STUDY_ENERGY, STUDY_FEEL, explain, nearestBy, verdict, verdictText } from "../explain";
import type { AxisParts, Explanation, Pt, Sources } from "../explain";

export const LYRICS = "#b4a4ff";
export const SOUND = "#e8ecf8";
const TAGS = "#f3c98b";

/** Quarter-circle tints in the map's quadrant colours, so the mini map reads as the big one. */
const QUADRANTS: [string, number][] = [["#f6b93b", 0], ["#f0604d", 90], ["#5b8cff", 180], ["#31c9a3", 270]];
const quarter = (deg: number) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const [x1, y1, x2, y2] = [Math.cos(r(deg)), -Math.sin(r(deg)), Math.cos(r(deg + 90)), -Math.sin(r(deg + 90))];
  return `M0 0L${x1} ${y1}A1 1 0 0 0 ${x2} ${y2}Z`;
};
const xy = (p: Pt) => ({ x: p.valence, y: -p.arousal });
const pct = (v: number) => `${Math.round(v * 100)}%`;
const at = (v: number) => `${((Math.max(-1, Math.min(1, v)) + 1) / 2) * 100}%`;

/** Legend and map shapes: lyrics a diamond, sound a ring, tags a square, so colour is never the only cue. */
const Diamond = ({ x = 0, y = 0, s, ...rest }: { x?: number; y?: number; s: number } & React.SVGProps<SVGRectElement>) =>
  <rect x={x - s} y={y - s} width={2 * s} height={2 * s} transform={`rotate(45 ${x} ${y})`} {...rest} />;

function MiniMap({ e, color, label }: { e: Explanation; color: string; label: string }) {
  const f = xy(e.final), l = xy(e.lyrics), a = e.audio && xy(e.audio), t = e.tagged && xy(e.tagged);
  return (
    <svg className="why-map" viewBox="-1.12 -1.12 2.24 2.24" role="img" aria-label={label}>
      {QUADRANTS.map(([c, d]) => <path key={d} d={quarter(d)} fill={c} opacity={0.075} />)}
      <circle r={1} className="why-ring" />
      <circle r={0.2} className="why-ring is-mixed" />
      <line x1={-1} x2={1} y1={0} y2={0} className="why-axis" />
      <line y1={-1} y2={1} x1={0} x2={0} className="why-axis" />
      {t && <rect x={t.x - 0.06} y={t.y - 0.06} width={0.12} height={0.12} fill="none" stroke={TAGS} strokeWidth={0.03} />}
      {a && <>
        <line x1={l.x} y1={l.y} x2={f.x} y2={f.y} stroke={LYRICS} className="why-pull" />
        <line x1={a.x} y1={a.y} x2={f.x} y2={f.y} stroke={SOUND} className="why-pull" />
        <Diamond x={l.x} y={l.y} s={0.055} fill="#10131e" stroke={LYRICS} strokeWidth={0.035} />
        <circle cx={a.x} cy={a.y} r={0.06} fill="#10131e" stroke={SOUND} strokeWidth={0.035} />
      </>}
      <circle cx={f.x} cy={f.y} r={0.16} fill={color} opacity={0.22} />
      <circle cx={f.x} cy={f.y} r={0.075} fill={color} stroke="#fff" strokeWidth={0.025} />
    </svg>
  );
}

/** One axis: the verdict, then each source's push as a tick from the centre (lyrics above, sound below) and where
 *  the song ends up. The tiny blend bias is folded into the lyrics tick, so the two ticks add up to the marker. */
function VerdictRow({ name, axis, parts, color, context }: { name: string; axis: keyof typeof ENDS; parts: AxisParts; color: string; context: string }) {
  const v = verdict(parts);
  const tick = (to: number, c: string, lane: string) => {
    const [lo, hi] = [Math.min(0, to), Math.max(0, to)].map((x) => Math.max(-1, Math.min(1, x)));
    return (
      <span className={`why-tick ${lane}${to < 0 ? " is-neg" : ""}`} style={{ left: at(lo), width: `${((hi - lo) / 2) * 100}%`, "--c": c } as React.CSSProperties} />
    );
  };
  return (
    <div className="why-row">
      <p className="why-verdict">
        <span className="why-axis-name">{name}</span> {verdictText(axis, parts, v)}
        {v !== "still" && v !== "conflict" && <span className="why-pct"> lyrics {pct(parts.lyricsShare)} · sound {pct(1 - parts.lyricsShare)}</span>}
      </p>
      <div className="why-track" aria-hidden="true">
        <span className="why-mid" />
        {tick(parts.lyrics + parts.bias, LYRICS, "is-lyrics")}
        {tick(parts.audio, SOUND, "is-sound")}
        <span className="why-end" style={{ left: at(parts.total), "--glow": color } as React.CSSProperties} />
      </div>
      <div className="why-ends" aria-hidden="true"><span>{ENDS[axis][0]}</span><span>{ENDS[axis][1]}</span></div>
      <p className="why-context">{context}</p>
    </div>
  );
}

const signed = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(2)}`;

type Song = Pt & { id: string; title: string; sources?: Sources; true_valence?: number; true_arousal?: number };

/** A few song titles that play when clicked. */
function Titles<S extends Song>({ list, onPlay }: { list: S[]; onPlay: (id: string) => void }) {
  return <>{list.map((s, i) => (
    <span key={s.id}>{i > 0 && ", "}<button type="button" className="why-song" onClick={() => onPlay(s.id)}>{s.title}</button></span>
  ))}</>;
}

/** The "why is it here?" panel on the song card. */
export function WhyHere<S extends Song>({ song, songs, onPlay, color, id }: { song: S; songs: S[]; onPlay: (id: string) => void; color: string; id: string }) {
  const e = explain(song);
  const w = song.sources?.fusion;
  const reads = useMemo(() => nearestBy(song, songs, "lyrics", 2), [song, songs]);
  const sounds = useMemo(() => nearestBy(song, songs, "audio", 2), [song, songs]);
  const tagLabel = e.tagged ? ` MERGE's mood tags put it at feel ${signed(e.tagged.valence)}, energy ${signed(e.tagged.arousal)}.` : "";
  const mapLabel = (e.audio
    ? `Mini map: lyrics alone put the song at feel ${signed(e.lyrics.valence)}, energy ${signed(e.lyrics.arousal)}; the sound alone at feel ${signed(e.audio.valence)}, energy ${signed(e.audio.arousal)}; blended, it sits at feel ${signed(e.final.valence)}, energy ${signed(e.final.arousal)}.`
    : `Mini map: the song sits at feel ${signed(e.final.valence)}, energy ${signed(e.final.arousal)}, from its lyrics alone.`) + tagLabel;
  return (
    <section className="why" id={id} aria-label="Why this song is here">
      <div className="why-body">
        <div className="why-map-col">
          <MiniMap e={e} color={color} label={mapLabel} />
          {(e.audio || e.tagged) && (
            <ul className="why-legend">
              {e.audio && <>
                <li><svg viewBox="-1 -1 2 2" aria-hidden="true"><Diamond s={0.55} fill="none" stroke={LYRICS} strokeWidth={0.35} /></svg>Lyrics</li>
                <li><svg viewBox="-1 -1 2 2" aria-hidden="true"><circle r={0.6} fill="none" stroke={SOUND} strokeWidth={0.35} /></svg>Sound</li>
              </>}
              <li><svg viewBox="-1 -1 2 2" aria-hidden="true"><circle r={0.75} fill={color} /></svg>Here</li>
              {e.tagged && <li><svg viewBox="-1 -1 2 2" aria-hidden="true"><rect x={-0.6} y={-0.6} width={1.2} height={1.2} fill="none" stroke={TAGS} strokeWidth={0.35} /></svg>Tagged</li>}
            </ul>
          )}
        </div>
        <div className="why-text">
          <p className="why-summary">{e.summary}</p>
          {(reads.length > 0 || sounds.length > 0) && (
            <p className="why-like">
              {reads.length > 0 && <>Reads like <Titles list={reads} onPlay={onPlay} /></>}
              {reads.length > 0 && sounds.length > 0 && <span aria-hidden="true"> · </span>}
              {sounds.length > 0 && <>{reads.length > 0 ? "sounds" : "Sounds"} like <Titles list={sounds} onPlay={onPlay} /></>}
            </p>
          )}
        </div>
        {e.valence && e.arousal && (
          <div className="why-rows">
            <VerdictRow name="Feel" axis="valence" parts={e.valence} color={color} context={STUDY_FEEL} />
            <VerdictRow name="Energy" axis="arousal" parts={e.arousal} color={color} context={STUDY_ENERGY} />
          </div>
        )}
      </div>
      <p className="why-note">
        {w
          ? <>A BERT model reads the whole lyric; an audio model (MERT) hears only the 30-second preview. Feel is {w.valence.lyrics.toFixed(2)} × lyrics + {w.valence.audio.toFixed(2)} × sound; energy is {w.arousal.lyrics.toFixed(2)} × lyrics + {w.arousal.audio.toFixed(2)} × sound, weights fitted on MERGE. </>
          : <>A BERT model reads the whole lyric and predicts how good it feels and how much energy it has. </>}
        {e.tagged && <>Tags are AllMusic moods mapped through word norms, so they are a rough target. </>}
        Lyrics are never stored or shown.
      </p>
    </section>
  );
}
