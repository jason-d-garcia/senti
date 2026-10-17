import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { emotionAt } from "../mood";

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
const TRAIL_MS = 650;

export interface Pt { valence: number; arousal: number }

interface Props {
  dot: Pt;
  onMove: (p: Pt) => void;
  /** CSS colour of the dot's current emotion, used for its glow and trail. */
  color: string;
  /** While placing a song, drags move the song marker instead of the dot. */
  placing?: { at: Pt; artwork?: string; onMove: (p: Pt) => void };
}

/** Full-bleed mood field: two faint axes, a draggable light that leaves a fading trail. */
export function Field({ dot, onMove, color, placing }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const trail = useRef<{ x: number; y: number; t: number; c: string }[]>([]);
  const frame = useRef(0);
  const dragging = useRef(false);
  const move = placing ? placing.onMove : onMove;

  const toPt = useCallback((clientX: number, clientY: number): Pt | null => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return null;
    return { valence: clamp(((clientX - box.left) / box.width) * 2 - 1),
      arousal: clamp(1 - ((clientY - box.top) / box.height) * 2) };
  }, []);

  // Record the dot's path; the canvas fades it out.
  useEffect(() => {
    if (placing) return;
    trail.current.push({ x: dot.valence, y: dot.arousal, t: performance.now(), c: color });
    const draw = () => {
      const c = canvas.current, box = ref.current?.getBoundingClientRect();
      if (!c || !box) return;
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.round(box.width * dpr)) { c.width = Math.round(box.width * dpr); c.height = Math.round(box.height * dpr); }
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, box.width, box.height);
      const now = performance.now();
      trail.current = trail.current.filter((p) => now - p.t < TRAIL_MS);
      const pts = trail.current;
      const px = (p: { x: number; y: number }) => [((p.x + 1) / 2) * box.width, ((1 - p.y) / 2) * box.height];
      ctx.lineCap = "round";
      for (let i = 1; i < pts.length; i++) {
        const life = 1 - (now - pts[i].t) / TRAIL_MS;
        const [x0, y0] = px(pts[i - 1]), [x1, y1] = px(pts[i]);
        ctx.strokeStyle = pts[i].c;
        ctx.globalAlpha = life * 0.85;
        ctx.lineWidth = 1 + life * 7;
        ctx.shadowColor = pts[i].c;
        ctx.shadowBlur = 18 * life;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (pts.length > 1) frame.current = requestAnimationFrame(draw);
    };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  }, [dot.valence, dot.arousal, color, placing]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toPt(e.clientX, e.clientY); if (p) move(p);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const p = toPt(e.clientX, e.clientY); if (p) move(p);
  };
  const stop = () => { dragging.current = false; };
  const at = placing ? placing.at : dot;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.2 : 0.05;
    const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] } as Record<string, number[]>)[e.key];
    if (!d) return;
    e.preventDefault();
    move({ valence: clamp(at.valence + d[0]), arousal: clamp(at.arousal + d[1]) });
  };
  const pos = (p: Pt) => ({ left: `${((p.valence + 1) / 2) * 100}%`, top: `${((1 - p.arousal) / 2) * 100}%` });

  return (
    <div
      ref={ref}
      className={`field${placing ? " is-placing" : ""}`}
      role="slider"
      tabIndex={0}
      aria-label={placing ? "Song position. Drag or use arrow keys." : "Mood. Drag or use arrow keys: left and right for how good it feels, up and down for energy."}
      aria-valuetext={`${emotionAt(at.valence, at.arousal)?.name ?? "Mixed"}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
    >
      <span className="axis axis-x" aria-hidden="true" />
      <span className="axis axis-y" aria-hidden="true" />
      <span className="axis-end end-right" aria-hidden="true">feels good</span>
      <span className="axis-end end-left" aria-hidden="true">feels bad</span>
      <span className="axis-end end-top" aria-hidden="true">energetic</span>
      <span className="axis-end end-bottom" aria-hidden="true">calm</span>
      <canvas ref={canvas} className="trail" aria-hidden="true" />
      <span className={`light${placing ? " is-dim" : ""}`} style={{ ...pos(dot), "--glow": color } as React.CSSProperties} aria-hidden="true" />
      {placing && (
        <span className="song-pin" style={pos(placing.at)} aria-hidden="true">
          {placing.artwork ? <img src={placing.artwork} alt="" /> : <span>♪</span>}
        </span>
      )}
    </div>
  );
}
