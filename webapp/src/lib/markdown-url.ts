const ALLOWED = /^(https?:|mailto:|vn-image:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A link or image URL that is safe to render: web, mail and page images, or a relative link; else ''. */
export function safeUrl(url: string): string {
  const trimmed = url.trim();
  if (ALLOWED.test(trimmed)) return trimmed;
  return HAS_SCHEME.test(trimmed) || /[\u0000-\u001f]/.test(trimmed) ? "" : trimmed;
}
