"use client";

import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef } from "react";

const WIDTH = 1440;
const HEIGHT = 500;
const STEP = 24;

const RIBBONS = [
  { amp: 62, wave: 0.0042, speed: 0.34, phase: 0, opacity: 0.5, stroke: 2 },
  { amp: 92, wave: 0.0031, speed: -0.24, phase: 1.7, opacity: 0.32, stroke: 1.5 },
  { amp: 44, wave: 0.0061, speed: 0.46, phase: 3.1, opacity: 0.4, stroke: 1.5 },
  { amp: 118, wave: 0.0022, speed: 0.17, phase: 4.6, opacity: 0.22, stroke: 3 },
];

function ribbonPath({ amp, wave, speed, phase }: (typeof RIBBONS)[number], t: number) {
  let d = "";
  for (let x = 0; x <= WIDTH; x += STEP) {
    // A second, slower wave keeps the swell from looking like a plain sine.
    const swell = 0.65 + 0.35 * Math.sin(x * 0.0017 + t * 0.21 + phase);
    const y = HEIGHT / 2 + amp * swell * Math.sin(x * wave + t * speed + phase);
    d += `${x === 0 ? "M" : "L"}${x} ${y.toFixed(1)}`;
  }
  return d;
}

/** Slow lines of sound behind a section. Still when off screen or with reduced motion. */
export function SoundRibbons({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const root = useRef<SVGSVGElement>(null);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const inView = useInView(root);
  const gradient = useId();

  useEffect(() => {
    if (reduce || !inView) return;
    let frame = 0;
    const draw = (ms: number) => {
      RIBBONS.forEach((ribbon, i) => paths.current[i]?.setAttribute("d", ribbonPath(ribbon, ms / 1000)));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [reduce, inView]);

  return (
    <svg ref={root} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" fill="none" aria-hidden="true" className={`pointer-events-none ${className ?? ""}`}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2={WIDTH} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="0.14" stopColor="var(--accent)" />
          {/* Dim through the middle, where the text sits. */}
          <stop offset="0.32" stopColor="var(--accent)" stopOpacity="0.1" />
          <stop offset="0.68" stopColor="var(--accent-2)" stopOpacity="0.1" />
          <stop offset="0.86" stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--accent-2)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {RIBBONS.map((ribbon, i) => (
        <path
          key={ribbon.phase}
          ref={(el) => {
            paths.current[i] = el;
          }}
          d={ribbonPath(ribbon, 0)}
          stroke={`url(#${gradient})`}
          strokeWidth={ribbon.stroke}
          strokeLinecap="round"
          opacity={ribbon.opacity}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
