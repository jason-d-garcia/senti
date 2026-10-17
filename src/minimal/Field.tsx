import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { EMOTIONS, MIXED_RADIUS, emotionAt } from "../mood";

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
const rad = (deg: number) => (deg * Math.PI) / 180;
/** Grid units. When the pointer leaves the field, the light goes back to where it was before it
 *  started heading for the edge, so reaching for the button below doesn't drag it to "calm". */
const REWIND_DISTANCE = 0.25;
const REWIND_MS = 700;

export interface Pt { valence: number; arousal: number }

interface Particle { x: number; y: number; vx: number; vy: number; born: number; life: number; size: number; color: string }

interface Props {
  dot: Pt;
  onMove: (p: Pt) => void;
  /** CSS colour of the dot's current emotion, used for its glow and sparkles. */
  color: string;
  /** Dropped by a click: stays put while the pointer moves; another click moves it. */
  pinned: boolean;
  onPin: (pinned: boolean) => void;
  /** While placing a song, the pointer moves the song marker instead of the dot. */
  placing?: { at: Pt; artwork?: string; onMove: (p: Pt) => void };
}

/** Full-bleed mood field: faint lines between the 16 emotion sections and a light that follows the pointer, shedding sparkles. */
export function Field({ dot, onMove, color, pinned, onPin, placing }: Props) {
  const [ghost, setGhost] = useState<Pt | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const frame = useRef(0);
  const pressed = useRef(false);
  const history = useRef<{ p: Pt; t: number }[]>([]);
  const move = placing ? placing.onMove : onMove;
  const at = placing ? placing.at : dot;

  const toPt = useCallback((clientX: number, clientY: number): Pt | null => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return null;
    return { valence: clamp(((clientX - box.left) / box.width) * 2 - 1),
      arousal: clamp(1 - ((clientY - box.top) / box.height) * 2) };
  }, []);

  // Sparkles: a few particles per move, drifting outward, twinkling and fading.
  const animate = useCallback(() => {
    const c = canvas.current, box = ref.current?.getBoundingClientRect();
    if (!c || !box) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(box.width * dpr) || c.height !== Math.round(box.height * dpr)) {
      c.width = Math.round(box.width * dpr); c.height = Math.round(box.height * dpr);
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    const now = performance.now();
    particles.current = particles.current.filter((p) => now - p.born < p.life);
    for (const p of particles.current) {
      const age = (now - p.born) / p.life;
      const x = ((p.x + 1) / 2) * box.width + p.vx * (now - p.born);
      const y = ((1 - p.y) / 2) * box.height + p.vy * (now - p.born) + 0.00002 * (now - p.born) ** 2;
      const twinkle = 0.6 + 0.4 * Math.sin((now - p.born) / 40 + p.size * 10);
      const r = p.size * (1 - age);
      ctx.globalAlpha = (1 - age) * twinkle;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      // four-point star
      ctx.beginPath();
      ctx.moveTo(x, y - r * 2.2); ctx.lineTo(x + r * 0.5, y - r * 0.5); ctx.lineTo(x + r * 2.2, y);
      ctx.lineTo(x + r * 0.5, y + r * 0.5); ctx.lineTo(x, y + r * 2.2); ctx.lineTo(x - r * 0.5, y + r * 0.5);
      ctx.lineTo(x - r * 2.2, y); ctx.lineTo(x - r * 0.5, y - r * 0.5); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (particles.current.length) frame.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    if (placing || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const now = performance.now();
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2, speed = 0.015 + Math.random() * 0.05;
      particles.current.push({ x: dot.valence, y: dot.arousal, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        born: now, life: 600 + Math.random() * 700, size: 1.6 + Math.random() * 2.4, color: Math.random() < 0.25 ? "#ffffff" : color });
    }
    if (particles.current.length > 400) particles.current.splice(0, particles.current.length - 400);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(animate);
  }, [dot.valence, dot.arousal, color, placing, animate]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const follow = (e: PointerEvent<HTMLDivElement>) => {
    // Mouse and pen follow on hover until a click drops the light; touch moves while the finger is down.
    const p = toPt(e.clientX, e.clientY);
    if (!p) return;
    if (!pressed.current) {
      if (e.pointerType === "touch") return;
      if (pinned) { setGhost(p); return; }
    }
    history.current.push({ p, t: performance.now() });
    if (history.current.length > 60) history.current.shift();
    move(p);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    pressed.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setGhost(null);
    onPin(true);
    follow(e);
  };
  const onPointerUp = () => { pressed.current = false; };
  const onPointerLeave = (e: PointerEvent<HTMLDivElement>) => {
    pressed.current = false;
    setGhost(null);
    if (e.pointerType === "touch" || pinned) return;
    const exit = toPt(e.clientX, e.clientY), now = performance.now();
    if (!exit) return;
    const before = [...history.current].reverse().find((h) => now - h.t < REWIND_MS
      && Math.hypot(h.p.valence - exit.valence, h.p.arousal - exit.arousal) > REWIND_DISTANCE);
    if (before) move(before.p);
    history.current = [];
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.2 : 0.05;
    const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] } as Record<string, number[]>)[e.key];
    if (!d) return;
    e.preventDefault();
    onPin(true);
    move({ valence: clamp(at.valence + d[0]), arousal: clamp(at.arousal + d[1]) });
  };
  const pos = (p: Pt) => ({ left: `${((p.valence + 1) / 2) * 100}%`, top: `${((1 - p.arousal) / 2) * 100}%` });
  const active = emotionAt(at.valence, at.arousal);

  return (
    <div
      ref={ref}
      className={`field${placing ? " is-placing" : ""}${pinned ? " is-pinned" : ""}`}
      role="slider"
      tabIndex={0}
      aria-label={placing ? "Song position. Click or use arrow keys." : "Mood. Move the pointer and click to drop the light, or use arrow keys: left and right for how good it feels, up and down for energy."}
      aria-valuetext={active?.name ?? "Mixed"}
      onPointerDown={onPointerDown}
      onPointerMove={follow}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
    >
      <div className="edge-glow" aria-hidden="true" />
      <svg className="sections" viewBox="-1 -1 2 2" preserveAspectRatio="none" aria-hidden="true">
        {EMOTIONS.map((e) => e.from % 90 !== 0 && (
          <line key={e.name} x1="0" y1="0" x2={1.5 * Math.cos(rad(e.from))} y2={-1.5 * Math.sin(rad(e.from))} />
        ))}
        <ellipse cx="0" cy="0" rx={MIXED_RADIUS} ry={MIXED_RADIUS} />
      </svg>
      <span className="axis axis-x" aria-hidden="true" />
      <span className="axis axis-y" aria-hidden="true" />
      <span className="axis-end end-right" aria-hidden="true">Feels good →</span>
      <span className="axis-end end-left" aria-hidden="true">← Feels bad</span>
      <span className="axis-end end-top" aria-hidden="true">↑ Energetic</span>
      <span className="axis-end end-bottom" aria-hidden="true">↓ Calm</span>
      <canvas ref={canvas} className="sparkles" aria-hidden="true" />
      <span className={`light${placing ? " is-dim" : ""}${pinned && !placing ? " is-pinned" : ""}`} style={{ ...pos(dot), "--glow": color } as React.CSSProperties} aria-hidden="true" />
      {ghost && <span className="ghost-ring" style={pos(ghost)} aria-hidden="true" />}
      {placing && (
        <span className="song-pin" style={pos(placing.at)} aria-hidden="true">
          {placing.artwork ? <img src={placing.artwork} alt="" /> : <span>♪</span>}
        </span>
      )}
    </div>
  );
}
