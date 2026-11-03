// Light or dark, per browser. Light unless the toggle chose dark; the inline script in layout.tsx
// applies a saved choice before first paint.
export type Theme = "light" | "dark";

const KEY = "vn.theme";
const listeners = new Set<() => void>();

/** Runs in <head> before the page paints (hashed into the CSP at build). Keep it tiny. */
export const THEME_SCRIPT = `try{if(localStorage.getItem("${KEY}")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export function getTheme(): Theme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the choice lasts this visit.
  }
  for (const fn of listeners) fn();
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
