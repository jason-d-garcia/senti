import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
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
/** Section lines are drawn this far out (in board half-widths) so they reach the screen edge. */
const RAY = 12;
/** Pixels: the light stops this far short of the screen edge. */
const EDGE = 10;
/** Distance of the emotion names from the centre; a little closer in on narrow screens so they don't crowd the axis titles. */
const NARROW = typeof window !== "undefined" && window.matchMedia("(max-width: 560px)").matches;
const R_LABEL = NARROW ? 0.68 : 0.66;
/** The four names either side of the vertical axis sit further out, where their narrow sections are wide enough to hold them. */
const NEAR_AXIS = [67.5, 90, 247.5, 270];
const labelRadius = (from: number) => (NEAR_AXIS.includes(from) ? (NARROW ? 0.76 : 0.8) : R_LABEL);
/** On narrow screens those sections are too slim for the larger names, so the pairs are set flush away from the axis (Tense|Alert). */
const hug = (from: number) => (!NARROW || !NEAR_AXIS.includes(from) ? "" : from === 90 || from === 247.5 ? " hug-l" : " hug-r");

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
  /** The area that tracks the pointer (the whole stage), so the light can travel past the board to the screen edge. */
  surface?: RefObject<HTMLElement>;
}

const pct = (p: Pt) => ({ x: ((p.valence + 1) / 2) * 100, y: ((1 - p.arousal) / 2) * 100 });
const pos = (p: Pt) => { const { x, y } = pct(p); return { left: `${x}%`, top: `${y}%` }; };

/** The mood map: faint section lines, a light that follows the pointer shedding sparkles, and a zoomed song view. */
export function Field({ dot, labelColor, onMove, color, pinned, onPin, placing, zoom, surface }: Props) {
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
    const area = (surface?.current ?? ref.current)!.getBoundingClientRect();
    const x = Math.max(area.left + EDGE, Math.min(area.right - EDGE, clientX));
    const y = Math.max(area.top + EDGE, Math.min(area.bottom - EDGE, clientY));
    return { valence: ((x - box.left) / box.width) * 2 - 1, arousal: 1 - ((y - box.top) / box.height) * 2 };
  }, [surface]);

  // Sparkles: small twinkling stars drifting off the light.
  const animate = useCallback(() => {
    const c = canvas.current, box = ref.current?.getBoundingClientRect();
    if (!c || !box) { running.current = false; return; }
    // The canvas spills past the board so sparkles follow the light to the screen edge.
    const cb = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(cb.width * dpr) || c.height !== Math.round(cb.height * dpr)) {
      c.width = Math.round(cb.width * dpr); c.height = Math.round(cb.height * dpr);
    }
    const ctx = c.getContext("2d")!;
    // The translation is in device pixels, so it scales with the pixel ratio too.
    ctx.setTransform(dpr, 0, 0, dpr, (box.left - cb.left) * dpr, (box.top - cb.top) * dpr);
    ctx.clearRect(cb.left - box.left, cb.top - box.top, cb.width, cb.height);
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

  const nearLight = (e: PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return false;
    const { x, y } = pct(dot);
    return Math.hypot(e.clientX - (box.left + (x / 100) * box.width), e.clientY - (box.top + (y / 100) * box.height)) < GRAB_RADIUS;
  };

  const panMove = (e: PointerEvent) => {
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
  const follow = (e: PointerEvent) => {
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
  const onPointerDown = (e: PointerEvent) => {
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
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
  const onPointerLeave = (e: PointerEvent) => {
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

  // Pointer events come from the whole stage. Over the panel, the song card or any control, the
  // pointer is treated as having left the map (so reaching for a button doesn't move the light).
  const overUi = useRef(false);
  const isUi = (t: EventTarget | null) =>
    t instanceof Element && !!t.closest(".dock, .card, .discover-bar, .song-dot, button, a, input, summary, label");
  const handlers = useRef({ onPointerDown, follow, onPointerUp, onPointerLeave });
  handlers.current = { onPointerDown, follow, onPointerUp, onPointerLeave };
  useEffect(() => {
    const el = surface?.current ?? ref.current;
    if (!el) return;
    const down = (e: PointerEvent) => { if (!isUi(e.target)) handlers.current.onPointerDown(e); };
    const moveH = (e: PointerEvent) => {
      const ui = isUi(e.target) && !pressed.current && !pan.current;
      if (ui && !overUi.current) handlers.current.onPointerLeave(e);
      overUi.current = ui;
      if (!ui) handlers.current.follow(e);
    };
    const up = () => handlers.current.onPointerUp();
    const leave = (e: PointerEvent) => { overUi.current = false; handlers.current.onPointerLeave(e); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", moveH);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", moveH);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("pointerleave", leave);
    };
  }, [surface]);

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
      role={zoomed ? "group" : "application"}
      aria-roledescription={zoomed ? undefined : "mood map"}
      tabIndex={0}
      aria-label={zoomed ? "Songs nearby. Drag or use arrow keys to move around, Escape to go back." : placing ? "Song position. Click or use arrow keys."
        : `Mood: ${active?.name ?? "Mixed"}. Move the pointer and click to drop the light, or use arrow keys: left and right for how good it feels, up and down for energy.`}
      onKeyDown={onKeyDown}
    >
      {/* Outside the scaled layer: CSS-scaling a layer rasterises it, which turns hairlines into
          bands. The zoom is applied as an SVG transform instead, so lines stay one pixel wide. */}
      <svg className="sections" viewBox="-1 -1 2 2" preserveAspectRatio="none" aria-hidden="true">
        {/* Section lines run out to the sides, but fade away below the map instead of running past the
            "I'm feeling" panel to the bottom of the screen. (y grows downward; the map ends at y = 1.) */}
        <defs>
          <linearGradient id="sections-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0.9" x2="0" y2="1.45">
            <stop offset="0" stopColor="rgb(160, 175, 220)" stopOpacity="0.13" />
            <stop offset="1" stopColor="rgb(160, 175, 220)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="sections-g" style={{ transform: zoom ? `scale(${k}) translate(${-zc.valence}px, ${zc.arousal}px)` : "none" }}>
          {EMOTIONS.map((e) => (
            // Quadrant boundaries are the axes: drawn by the page outside the zoom, here only when zoomed in.
            <line key={e.name} className={e.from % 90 === 0 ? "axis-line" : undefined}
              x1="0" y1="0" x2={RAY * Math.cos(rad(e.from))} y2={-RAY * Math.sin(rad(e.from))} />
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
              className={`emotion-label${active === e ? " is-active" : ""}${hug(e.from)}`}
              style={{ ...pos({ valence: labelRadius(e.from) * Math.cos(mid), arousal: labelRadius(e.from) * Math.sin(mid) }), color: labelColor(e.name) }}>
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
