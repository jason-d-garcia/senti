import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { EMOTIONS, MIXED_RADIUS, emotionAt } from "../mood";

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
const rad = (deg: number) => (deg * Math.PI) / 180;
/** Grid units. When the pointer leaves the field, the light goes back to where it was before it
 *  started heading for the edge, so reaching for the button below doesn't drag it to "calm". */
const REWIND_DISTANCE = 0.25;
const REWIND_MS = 700;
/** Pixels: how close the pointer must be to a dropped light to pick it up again. */
const GRAB_RADIUS = 20;
const IDLE_SPARKLE_MS = 240;

export interface Pt { valence: number; arousal: number }

/** A song shown while zoomed in. Featured songs get their cover art. */
export interface FieldSong { id: string; valence: number; arousal: number; color: string; title: string; artwork?: string; featured: boolean }

interface Particle { x: number; y: number; vx: number; vy: number; born: number; life: number; size: number; color: string }

interface Props {
  dot: Pt;
  /** Label colour per emotion name. */
  labelColor: (name: string) => string;
  onMove: (p: Pt) => void;
  /** CSS colour of the dot's current emotion, used for its glow and sparkles. */
  color: string;
  /** Dropped by a click and resting; false while the light follows the pointer. */
  pinned: boolean;
  onPin: (pinned: boolean) => void;
  /** While placing a song, the pointer moves the song marker instead of the dot. */
  placing?: { at: Pt; artwork?: string; onMove: (p: Pt) => void };
  /** Zoomed in on part of the map, showing songs there. */
  zoom?: { center: Pt; scale: number; songs: FieldSong[]; onSong: (id: string) => void; onPan: (center: Pt) => void; onPanLive?: (center: Pt | null) => void } | null;
}

const pct = (p: Pt) => ({ x: ((p.valence + 1) / 2) * 100, y: ((1 - p.arousal) / 2) * 100 });
const pos = (p: Pt) => { const { x, y } = pct(p); return { left: `${x}%`, top: `${y}%` }; };

/** The mood map: faint section lines, a light that follows the pointer shedding sparkles, and a zoomed song view. */
export function Field({ dot, labelColor, onMove, color, pinned, onPin, placing, zoom }: Props) {
  const [ghost, setGhost] = useState<Pt | null>(null);
  const [overLight, setOverLight] = useState(false);
  // Panning the zoomed map: where the drag started, and the centre it would move to.
  const pan = useRef<{ x: number; y: number; from: Pt } | null>(null);
  const [panCenter, setPanCenter] = useState<Pt | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const light = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const frame = useRef(0);
  const running = useRef(false);
  const pressed = useRef(false);
  const history = useRef<{ p: Pt; t: number }[]>([]);
  const pending = useRef<Pt | null>(null);
  const raf = useRef(0);
  // Latest light position and colour, for the sparkle emitter between renders.
  const live = useRef({ dot, color });
  useEffect(() => { live.current.dot = dot; }, [dot]);
  useEffect(() => { live.current.color = color; }, [color]);
  const move = placing ? placing.onMove : onMove;
  const at = placing ? placing.at : dot;
  const zoomed = !!zoom;

  const toPt = useCallback((clientX: number, clientY: number): Pt | null => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return null;
    return { valence: clamp(((clientX - box.left) / box.width) * 2 - 1),
      arousal: clamp(1 - ((clientY - box.top) / box.height) * 2) };
  }, []);

  // Sparkles: small twinkling stars drifting off the light.
  const animate = useCallback(() => {
    const c = canvas.current, box = ref.current?.getBoundingClientRect();
    if (!c || !box) { running.current = false; return; }
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
      const t = now - p.born, age = t / p.life;
      const x = ((p.x + 1) / 2) * box.width + p.vx * t;
      const y = ((1 - p.y) / 2) * box.height + p.vy * t + 0.00002 * t * t;
      const r = p.size * (1 - age);
      ctx.globalAlpha = (1 - age) * (0.6 + 0.4 * Math.sin(t / 40 + p.size * 10));
      ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(x, y - r * 2.2); ctx.lineTo(x + r * 0.5, y - r * 0.5); ctx.lineTo(x + r * 2.2, y);
      ctx.lineTo(x + r * 0.5, y + r * 0.5); ctx.lineTo(x, y + r * 2.2); ctx.lineTo(x - r * 0.5, y + r * 0.5);
      ctx.lineTo(x - r * 2.2, y); ctx.lineTo(x - r * 0.5, y - r * 0.5); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (particles.current.length) frame.current = requestAnimationFrame(animate);
    else running.current = false;
  }, []);

  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const emit = useCallback((p: Pt, n: number, slow = false) => {
    if (reduced) return;
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2, speed = (slow ? 0.006 : 0.015) + Math.random() * (slow ? 0.02 : 0.05);
      particles.current.push({ x: p.valence, y: p.arousal, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        born: now, life: (slow ? 800 : 600) + Math.random() * 700, size: 1.4 + Math.random() * 2.4,
        color: Math.random() < 0.25 ? "#ffffff" : live.current.color });
    }
    if (particles.current.length > 400) particles.current.splice(0, particles.current.length - 400);
    if (!running.current) { running.current = true; frame.current = requestAnimationFrame(animate); }
  }, [animate, reduced]);

  // A few sparkles now and then while the light is still.
  useEffect(() => {
    if (placing || zoomed) return;
    const id = setInterval(() => { if (Math.random() < 0.75) emit(live.current.dot, 1, true); }, IDLE_SPARKLE_MS);
    return () => clearInterval(id);
  }, [emit, placing, zoomed]);
  useEffect(() => () => { cancelAnimationFrame(frame.current); cancelAnimationFrame(raf.current); }, []);

  // Move the light straight away; tell React at most once per frame.
  const moveNow = (p: Pt) => {
    if (!placing && light.current) {
      const { x, y } = pct(p);
      light.current.style.left = `${x}%`; light.current.style.top = `${y}%`;
      live.current.dot = p;
      emit(p, 2);
    }
    pending.current = p;
    if (!raf.current) {
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        if (pending.current) move(pending.current);
      });
    }
  };

  const nearLight = (e: PointerEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return false;
    const { x, y } = pct(dot);
    return Math.hypot(e.clientX - (box.left + (x / 100) * box.width), e.clientY - (box.top + (y / 100) * box.height)) < GRAB_RADIUS;
  };

  const panMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!pan.current || !box || !zoom) return;
    const k = zoom.scale;
    const next = {
      valence: clamp(pan.current.from.valence - ((e.clientX - pan.current.x) / (box.width / 2)) / k),
      arousal: clamp(pan.current.from.arousal + ((e.clientY - pan.current.y) / (box.height / 2)) / k),
    };
    setPanCenter(next);
    zoom.onPanLive?.(next);
  };
  const follow = (e: PointerEvent<HTMLDivElement>) => {
    if (zoomed) { panMove(e); return; }
    // Mouse and pen: the light follows until a click drops it. Touch: it moves while the finger is down.
    const p = toPt(e.clientX, e.clientY);
    if (!p) return;
    if (!pressed.current) {
      if (e.pointerType === "touch") return;
      if (pinned) {
        setGhost(p);
        if (!placing) { const near = nearLight(e); if (near !== overLight) setOverLight(near); }
        return;
      }
    }
    history.current.push({ p, t: performance.now() });
    if (history.current.length > 60) history.current.shift();
    moveNow(p);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (zoom) { pan.current = { x: e.clientX, y: e.clientY, from: zoom.center }; return; }
    setGhost(null);
    // Clicking a dropped light picks it up so it follows the pointer again.
    if (pinned && !placing && e.pointerType !== "touch" && nearLight(e)) {
      setOverLight(false);
      onPin(false);
      return;
    }
    pressed.current = true;
    onPin(true);
    follow(e);
  };
  const endPan = () => {
    if (pan.current && panCenter && zoom) zoom.onPan(panCenter);
    pan.current = null;
    setPanCenter(null);
    zoom?.onPanLive?.(null);
  };
  const onPointerUp = () => { pressed.current = false; endPan(); };
  const onPointerLeave = (e: PointerEvent<HTMLDivElement>) => {
    pressed.current = false;
    if (zoomed) { endPan(); return; }
    setGhost(null); setOverLight(false);
    if (e.pointerType === "touch" || pinned) return;
    const exit = toPt(e.clientX, e.clientY), now = performance.now();
    if (!exit) return;
    const before = [...history.current].reverse().find((h) => now - h.t < REWIND_MS
      && Math.hypot(h.p.valence - exit.valence, h.p.arousal - exit.arousal) > REWIND_DISTANCE);
    if (before) moveNow(before.p);
    history.current = [];
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Zoomed in, arrow keys pan by a quarter of the view (half the view with Shift).
    const step = zoom ? (e.shiftKey ? 0.5 : 0.25) / zoom.scale : e.shiftKey ? 0.2 : 0.05;
    const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] } as Record<string, number[]>)[e.key];
    if (!d) return;
    e.preventDefault();
    if (zoom) { zoom.onPan({ valence: clamp(zoom.center.valence + d[0]), arousal: clamp(zoom.center.arousal + d[1]) }); return; }
    onPin(true);
    moveNow({ valence: clamp(at.valence + d[0]), arousal: clamp(at.arousal + d[1]) });
  };

  const active = emotionAt(at.valence, at.arousal);
  const zc = zoom ? panCenter ?? zoom.center : { valence: 0, arousal: 0 };
  const c = zoom ? pct(zc) : { x: 50, y: 50 };
  const k = zoom?.scale ?? 1;

  return (
    <div
      ref={ref}
      className={`field${placing ? " is-placing" : ""}${pinned ? " is-pinned" : ""}${zoomed ? " is-zoomed" : ""}${panCenter ? " is-panning" : ""}${overLight ? " over-light" : ""}`}
      role={zoomed ? "group" : "slider"}
      tabIndex={0}
      aria-label={zoomed ? "Songs nearby. Drag or use arrow keys to move around, Escape to go back." : placing ? "Song position. Click or use arrow keys."
        : "Mood. Move the pointer and click to drop the light, or use arrow keys: left and right for how good it feels, up and down for energy."}
      aria-valuetext={zoomed ? undefined : active?.name ?? "Mixed"}
      onPointerDown={onPointerDown}
      onPointerMove={follow}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
    >
      {/* Outside the scaled layer: CSS-scaling a layer rasterises it, which turns hairlines into
          bands. The zoom is applied as an SVG transform instead, so lines stay one pixel wide. */}
      <svg className="sections" viewBox="-1 -1 2 2" preserveAspectRatio="none" aria-hidden="true">
        <g className="sections-g" style={{ transform: zoom ? `scale(${k}) translate(${-zc.valence}px, ${zc.arousal}px)` : "none" }}>
          {EMOTIONS.map((e) => (
            // Quadrant boundaries are the axes: drawn by the page outside the zoom, here only when zoomed in.
            <line key={e.name} className={e.from % 90 === 0 ? "axis-line" : undefined}
              x1="0" y1="0" x2={1.5 * Math.cos(rad(e.from))} y2={-1.5 * Math.sin(rad(e.from))} />
          ))}
          <ellipse cx="0" cy="0" rx={MIXED_RADIUS} ry={MIXED_RADIUS} />
        </g>
      </svg>
      <div
        className="zoom-layer"
        style={{
          transformOrigin: `${c.x}% ${c.y}%`,
          transform: zoom ? `translate(${50 - c.x}%, ${50 - c.y}%) scale(${k})` : "none",
          "--k": k,
        } as React.CSSProperties}
      >
        {EMOTIONS.map((e) => {
          const mid = rad((e.from + e.to) / 2);
          return (
            <span key={e.name} aria-hidden="true"
              className={`emotion-label${active === e ? " is-active" : ""}`}
              style={{ ...pos({ valence: 0.66 * Math.cos(mid), arousal: 0.66 * Math.sin(mid) }), color: labelColor(e.name) }}>
              {e.name}
            </span>
          );
        })}

        {zoom?.songs.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`song-dot${s.featured ? " is-featured" : ""}`}
            style={{ ...pos(s), "--c": s.color } as React.CSSProperties}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => zoom.onSong(s.id)}
            title={s.title}
            aria-label={`Play ${s.title}`}
            tabIndex={s.featured ? 0 : -1}
          >
            {s.featured && (s.artwork ? <img src={s.artwork} alt="" width={46} height={46} /> : <span aria-hidden="true">♪</span>)}
          </button>
        ))}

        <span
          ref={light}
          className={`light${placing ? " is-dim" : ""}${!pinned && !placing ? " is-selected" : ""}${overLight ? " is-hover" : ""}`}
          style={{ ...pos(dot), "--glow": color } as React.CSSProperties}
          aria-hidden="true"
        />
        {ghost && !overLight && <span className="ghost-ring" style={pos(ghost)} aria-hidden="true" />}
        {placing && (
          <span className="song-pin" style={pos(placing.at)} aria-hidden="true">
            {placing.artwork ? <img src={placing.artwork} alt="" width={44} height={44} /> : <span>♪</span>}
          </span>
        )}
      </div>
      <canvas ref={canvas} className="sparkles" aria-hidden="true" />
    </div>
  );
}
