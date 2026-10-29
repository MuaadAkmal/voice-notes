import { useEffect, useRef } from 'react';

const COUNT = 48;
const DURATION_MS = 1800;
const GRAVITY = 0.00045; // px per ms²
const COLORS = ['#fb7185', '#34d399', '#38bdf8', '#fbbf24', '#a78bfa', '#ffffff'];

type Piece = { x: number; y: number; vx: number; vy: number; spin: number; angle: number; w: number; h: number; color: string };

/**
 * One burst of confetti out of the pill, drawn on a canvas over the whole (click-through) overlay
 * window. A few dozen rectangles for under two seconds, then the loop stops; skipped entirely when
 * the user prefers reduced motion.
 */
export function Confetti({ onDone }: { onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      done.current();
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    el.width = width * dpr;
    el.height = height * dpr;
    ctx.scale(dpr, dpr);

    // From the bar at the bottom centre, fanned upwards.
    const pieces: Piece[] = Array.from({ length: COUNT }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const speed = 0.18 + Math.random() * 0.22;
      return {
        x: width / 2,
        y: height - 14,
        vx: Math.cos(angle) * speed * 1.6,
        vy: Math.sin(angle) * speed,
        spin: (Math.random() - 0.5) * 0.02,
        angle: Math.random() * Math.PI,
        w: 3 + Math.random() * 3,
        h: 5 + Math.random() * 4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      };
    });

    let frame = 0;
    const start = performance.now();
    let last = start;
    const draw = (t: number) => {
      const dt = t - last;
      last = t;
      const elapsed = t - start;
      ctx.clearRect(0, 0, width, height);
      if (elapsed >= DURATION_MS) {
        done.current();
        return;
      }
      ctx.globalAlpha = Math.min(1, 2 * (1 - elapsed / DURATION_MS));
      for (const p of pieces) {
        p.vy += GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.angle += p.spin * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        // Squashing the width with the angle reads as the piece tumbling.
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w * Math.abs(Math.cos(p.angle * 2)), p.h);
        ctx.restore();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvas} aria-hidden data-testid="confetti" className="pointer-events-none fixed inset-0 h-screen w-screen" />;
}
