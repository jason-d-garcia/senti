import { explain } from "../explain";
import type { AxisParts, Explanation, Pt, Sources } from "../explain";

const LYRICS = "#b4a4ff";
const SOUND = "#e8ecf8";

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

function MiniMap({ e, color, label }: { e: Explanation; color: string; label: string }) {
  const f = xy(e.final), l = xy(e.lyrics), a = e.audio && xy(e.audio);
  return (
    <svg className="why-map" viewBox="-1.12 -1.12 2.24 2.24" role="img" aria-label={label}>
      {QUADRANTS.map(([c, d]) => <path key={d} d={quarter(d)} fill={c} opacity={0.075} />)}
      <circle r={1} className="why-ring" />
      <circle r={0.2} className="why-ring is-mixed" />
      <line x1={-1} x2={1} y1={0} y2={0} className="why-axis" />
      <line y1={-1} y2={1} x1={0} x2={0} className="why-axis" />
      {a && <>
        <line x1={l.x} y1={l.y} x2={f.x} y2={f.y} stroke={LYRICS} className="why-pull" />
        <line x1={a.x} y1={a.y} x2={f.x} y2={f.y} stroke={SOUND} className="why-pull" />
        <rect x={l.x - 0.055} y={l.y - 0.055} width={0.11} height={0.11} transform={`rotate(45 ${l.x} ${l.y})`}
          fill="#10131e" stroke={LYRICS} strokeWidth={0.035} />
        <circle cx={a.x} cy={a.y} r={0.06} fill="#10131e" stroke={SOUND} strokeWidth={0.035} />
      </>}
      <circle cx={f.x} cy={f.y} r={0.16} fill={color} opacity={0.22} />
      <circle cx={f.x} cy={f.y} r={0.075} fill={color} stroke="#fff" strokeWidth={0.025} />
    </svg>
  );
}

/** One axis as a waterfall from the centre: the lyrics' push, then the sound's, ending where the song sits. */
function AxisBar({ name, low, high, parts, color }: { name: string; low: string; high: string; parts: AxisParts; color: string }) {
  // Each push gets its own lane, so a sound push that undoes the lyrics' doesn't hide it.
  const seg = (from: number, to: number, c: string, lane: string) => {
    const [lo, hi] = [Math.min(from, to), Math.max(from, to)].map((v) => Math.max(-1, Math.min(1, v)));
    return <span className={`why-seg ${lane}`} style={{ left: at(lo), width: `max(3px, ${((hi - lo) / 2) * 100}%)`, background: c }} />;
  };
  const l = parts.lyrics + parts.bias;
  return (
    <div className="why-axis-row">
      <div className="why-axis-head">
        <span className="why-axis-name">{name}</span>
        <span className="why-share"><i style={{ background: LYRICS }} />lyrics {pct(parts.lyricsShare)}
          <i style={{ background: SOUND }} />sound {pct(1 - parts.lyricsShare)}</span>
      </div>
      <div className="why-track" aria-hidden="true">
        <span className="why-mid" />
        {seg(0, l, LYRICS, "is-lyrics")}
        {seg(l, l + parts.audio, SOUND, "is-sound")}
        <span className="why-end" style={{ left: at(parts.total), "--glow": color } as React.CSSProperties} />
      </div>
      <div className="why-ends" aria-hidden="true"><span>{low}</span><span>{high}</span></div>
    </div>
  );
}

const signed = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(2)}`;

/** The "why is it here?" panel on the song card. */
export function WhyHere({ song, color, id }: { song: Pt & { sources?: Sources }; color: string; id: string }) {
  const e = explain(song);
  const w = song.sources?.fusion;
  const mapLabel = e.audio
    ? `Mini map: lyrics alone put the song at feel ${signed(e.lyrics.valence)}, energy ${signed(e.lyrics.arousal)}; the sound alone at feel ${signed(e.audio.valence)}, energy ${signed(e.audio.arousal)}; blended, it sits at feel ${signed(e.final.valence)}, energy ${signed(e.final.arousal)}.`
    : `Mini map: the song sits at feel ${signed(e.final.valence)}, energy ${signed(e.final.arousal)}, from its lyrics alone.`;
  return (
    <section className="why" id={id} aria-label="Why this song is here">
      <div className="why-body">
        <div className="why-map-col">
          <MiniMap e={e} color={color} label={mapLabel} />
          {e.audio && (
            <ul className="why-legend">
              <li><svg viewBox="-1 -1 2 2" aria-hidden="true"><rect x={-0.55} y={-0.55} width={1.1} height={1.1} transform="rotate(45)" fill="none" stroke={LYRICS} strokeWidth={0.35} /></svg>Lyrics</li>
              <li><svg viewBox="-1 -1 2 2" aria-hidden="true"><circle r={0.6} fill="none" stroke={SOUND} strokeWidth={0.35} /></svg>Sound</li>
              <li><svg viewBox="-1 -1 2 2" aria-hidden="true"><circle r={0.75} fill={color} /></svg>Here</li>
            </ul>
          )}
        </div>
        <p className="why-summary">{e.summary}</p>
        {e.valence && e.arousal && (
          <div className="why-bars">
            <AxisBar name="Feel" low="bad" high="good" parts={e.valence} color={color} />
            <AxisBar name="Energy" low="low" high="high" parts={e.arousal} color={color} />
          </div>
        )}
      </div>
      <p className="why-note">
        {w
          ? <>A BERT model reads the whole lyric and an audio model (MERT) hears the 30-second preview. Feel is {w.valence.lyrics.toFixed(2)} × lyrics + {w.valence.audio.toFixed(2)} × sound; energy is {w.arousal.lyrics.toFixed(2)} × lyrics + {w.arousal.audio.toFixed(2)} × sound, weights fitted on MERGE. </>
          : <>A BERT model reads the whole lyric and predicts how good it feels and how much energy it has. </>}
        Lyrics are never stored or shown.
      </p>
    </section>
  );
}
