import { type RefObject, useEffect } from 'react';

const SIZE_MS = 260;
const FADE_MS = 160;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

type Shape = { width: number; height: number; background: string };

/**
 * Morphs the pill between states: when the `[data-morph]` element inside `root` is replaced, the new
 * one grows or shrinks from the old one's size and colour while its contents fade in. A MutationObserver
 * fires before the next paint, so the new state never flashes at full size first. Only the element's own
 * box animates (no window resize), for a few hundred ms per state change.
 */
export function useMorph(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const host = root.current;
    if (!host || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let current: HTMLElement | null = null;
    let last: Shape | null = null;
    // Tracks the live size, so a change mid-animation (or after the idle bar grows on hover) starts from what's on screen.
    const sizes = new ResizeObserver(() => {
      if (current?.isConnected) last = shapeOf(current);
    });

    const adopt = () => {
      const el = host.querySelector<HTMLElement>('[data-morph]');
      if (el === current) return;
      if (current) sizes.unobserve(current);
      current = el;
      if (!el) return; // hidden idle pill: the next one appears from `last`
      const to = shapeOf(el);
      if (last) morph(el, last, to);
      else el.animate({ opacity: [0, 1], transform: ['scale(0.9)', 'none'] }, { duration: FADE_MS, easing: EASE });
      last = to;
      sizes.observe(el);
    };

    adopt();
    const mutations = new MutationObserver(adopt);
    mutations.observe(host, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      sizes.disconnect();
    };
  }, [root]);
}

function shapeOf(el: HTMLElement): Shape {
  const r = el.getBoundingClientRect();
  return { width: r.width, height: r.height, background: getComputedStyle(el).backgroundColor };
}

function morph(el: HTMLElement, from: Shape, to: Shape) {
  // While the box is smaller than its contents they're clipped, not wrapped.
  el.style.overflow = 'hidden';
  el.style.whiteSpace = 'nowrap';
  const size = el.animate(
    {
      width: [`${from.width}px`, `${to.width}px`],
      height: [`${from.height}px`, `${to.height}px`],
      backgroundColor: [from.background, to.background],
    },
    { duration: SIZE_MS, easing: EASE },
  );
  const restore = () => {
    el.style.overflow = '';
    el.style.whiteSpace = '';
  };
  size.onfinish = restore;
  size.oncancel = restore;
  // One keyframe: fades up to each child's own opacity, so a hidden hover-only control stays hidden.
  for (const child of el.children) child.animate([{ opacity: 0 }], { duration: FADE_MS, easing: 'ease-out' });
}
