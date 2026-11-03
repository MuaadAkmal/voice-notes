"use client";

import { useEffect } from "react";

/** Tells the card under the pointer where the pointer is, for the soft glow in globals.css. */
export function PointerGlow() {
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest?.<HTMLElement>(".glass-hover");
      if (!card) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty("--glow-x", `${e.clientX - box.left}px`);
      card.style.setProperty("--glow-y", `${e.clientY - box.top}px`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);
  return null;
}
