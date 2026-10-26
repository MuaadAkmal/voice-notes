// Pure: what a drop onto the pill becomes in the Review later page. Rules: spec "Entry format".
import type { DropPayload, LaterItem, OverlayState } from './channels';

export const LATER_PAGE_TITLE = 'Review later';
const MAX_TEXT = 500;
const MAX_TITLE = 200;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Only http(s): a dropped javascript: or file: URL must never become a clickable link. */
function webUrl(candidate: string): string | null {
  if (!candidate || /\s/.test(candidate)) return null;
  try {
    const { protocol } = new URL(candidate);
    return protocol === 'http:' || protocol === 'https:' ? candidate : null;
  } catch {
    return null;
  }
}

/** The text a person sees in the HTML: tags stripped, a few entities decoded, whitespace collapsed. */
function visibleText(html: string): string {
  return oneLine(html.replace(/<[^>]*>/g, ' ').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e]));
}

export function parseDrop(p: DropPayload): LaterItem | null {
  const listed = p.uriList
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  const url = webUrl(listed ?? '') ?? webUrl(p.text.trim());
  if (url) {
    const title = visibleText(p.html);
    return { kind: 'link', url, title: title && title !== url ? title : null };
  }
  const text = oneLine(p.text) || (listed ?? '');
  return text ? { kind: 'text', text } : null;
}

/** The entry text; appendEntry adds the leading `- `. */
export function laterEntry(item: LaterItem, source: string | null): string {
  const suffix = source ? ` · ${source}` : '';
  if (item.kind === 'text') return `[ ] ${cap(item.text, MAX_TEXT)}${suffix}`;
  const url = item.url.replace(/\)/g, '%29').replace(/ /g, '%20');
  if (!item.title) return `[ ] <${url}>${suffix}`;
  return `[ ] [${cap(item.title, MAX_TITLE).replace(/[[\]]/g, '\\$&')}](${url})${suffix}`;
}

/** The pill takes drops only while it is visibly resting or showing "Saved". */
export const acceptsDrops = (s: OverlayState): boolean => (s.kind === 'idle' && s.visible) || s.kind === 'saved';
