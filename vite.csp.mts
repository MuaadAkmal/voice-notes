import type { Plugin } from 'vite';

const CSP =
  "default-src 'self'; media-src 'self' note: blob: mediastream:; img-src 'self' data:; style-src 'self' 'unsafe-inline'";

// Production-only CSP: in dev, Vite's React refresh preamble is an inline script that a strict CSP would block.
export function cspPlugin(): Plugin {
  return {
    name: 'voice-notes-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  };
}
