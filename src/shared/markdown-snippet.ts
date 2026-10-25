const MAX = 120;

/** First readable line of a markdown body, with the markup removed, for list rows. */
export function snippet(body: string): string {
  for (const raw of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) continue; // fence lines, including a language tag
    const text = raw
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images vanish entirely
      .replace(/^\s*(?:>\s*)*/, '') // block quotes
      .replace(/^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, '') // heading / bullet / numbered
      .replace(/^\[[ xX]\]\s+/, '') // task checkbox
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links keep their text
      .replace(/[*_~`]+/g, '') // emphasis, strike, code
      .trim();
    if (/^(?:-{3,}|={3,}|\*{3,}|_{3,})$/.test(raw.trim())) continue; // horizontal rules
    if (text === '') continue;
    return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
  }
  return '';
}
