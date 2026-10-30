// Voice reminders: "remind me to call mom in 10 min" → the task and when. Read here, on the PC, for the
// common English phrasings; anything this can't place in time goes to the `commands` function's
// `remind` route instead (dueAt null).

const START = /^remind me\b[\s,.:;!?-]*(?:(?:to|about|that)\b\s*)?/i;
const UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const RELATIVE = /\bin\s+(half an hour|an? (?:sec(?:ond)?|min(?:ute)?|hour|hr|day)|\d+(?:\.\d+)?\s*(?:secs?|seconds?|mins?|minutes?|hours?|hrs?|h|days?))\b/i;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY = new RegExp(`\\b(?:(today|tonight|tomorrow)|(?:on\\s+|next\\s+)?(${WEEKDAYS.join('|')}))\\b`, 'i');
const PERIOD = /\b(?:this\s+|in the\s+)?(morning|afternoon|evening)\b/i;
const PERIOD_HOUR: Record<string, number> = { morning: 9, afternoon: 15, evening: 18 };
// "at" is required so numbers in the task ("buy 2 apples") are left alone.
const CLOCK = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?(?=$|[\s,.!?])/i;

const isTrim = (s: string) => s.replace(/\s{2,}/g, ' ').replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, '').trim();

/** True when `text` (after any wake word or calendar trigger) asks for a reminder. */
export function isReminder(text: string): boolean {
  return START.test(text.trim().replace(/^[\s,.:;!?"'-]+/, ''));
}

/** The task and its due time (ms) when `text` is a reminder; dueAt null when no time was understood. */
export function parseReminder(text: string, now: number): { text: string; dueAt: number | null } | null {
  const start = text.trim().replace(/^[\s,.:;!?"'-]+/, '');
  const m = START.exec(start);
  if (!m) return null;
  let rest = start.slice(m[0].length);
  const take = (re: RegExp) => {
    const hit = re.exec(rest);
    if (hit) rest = rest.slice(0, hit.index) + ' ' + rest.slice(hit.index + hit[0].length);
    return hit;
  };

  let dueAt: number | null = null;
  const rel = take(RELATIVE);
  if (rel) dueAt = now + relativeMs(rel[1]);
  else {
    const day = take(DAY);
    const clock = take(CLOCK);
    const period = take(PERIOD);
    if (day || clock || period) dueAt = absolute(now, day, clock, period?.[1].toLowerCase());
  }
  const task = isTrim(rest.replace(/^\s*(?:to|about|that)\b/i, '').replace(/\b(?:to|at|on)\s*$/i, ''));
  return task ? { text: task, dueAt } : null;
}

function relativeMs(phrase: string): number {
  const p = phrase.toLowerCase();
  if (p === 'half an hour') return 30 * UNITS.m;
  const [, n, unit] = /^(an?|\d+(?:\.\d+)?)\s*(\w)/.exec(p)!;
  const count = n.startsWith('a') ? 1 : Number(n);
  const key = unit === 'h' ? 'h' : unit === 'd' ? 'd' : unit === 's' ? 's' : 'm';
  return Math.round(count * UNITS[key]);
}

function absolute(now: number, day: RegExpExecArray | null, clock: RegExpExecArray | null, period?: string): number {
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  const word = day?.[1]?.toLowerCase();
  let offset = 0;
  if (word === 'tomorrow') offset = 1;
  else if (day?.[2]) {
    const target = WEEKDAYS.indexOf(day[2].toLowerCase());
    offset = (target - base.getDay() + 7) % 7 || 7; // "on Friday" said on a Friday means next week
  }
  const fixedDay = !!day && word !== 'today';
  const evening = word === 'tonight' || period === 'evening' || period === 'afternoon';
  const dayAt = (d: number, h: number, min: number) => {
    const t = new Date(base);
    t.setDate(t.getDate() + d);
    t.setHours(h, min, 0, 0);
    return t.getTime();
  };

  if (!clock) {
    const hour = period ? PERIOD_HOUR[period] : word === 'tonight' ? 21 : 9;
    const t = dayAt(offset, hour, 0);
    return t > now || fixedDay ? t : dayAt(offset + 1, hour, 0);
  }
  let hour = Number(clock[1]) % 24;
  const min = Number(clock[2] ?? 0);
  const ampm = clock[3]?.toLowerCase().replace(/[^ap]/g, '');
  if (ampm === 'p' && hour < 12) hour += 12;
  else if (ampm === 'a' && hour === 12) hour = 0;
  else if (!ampm && hour < 12 && (evening || (fixedDay && hour < 7))) hour += 12;
  if (ampm || hour >= 12 || fixedDay || evening) {
    const t = dayAt(offset, hour, min);
    return t > now || fixedDay ? t : dayAt(offset + 1, hour, min);
  }
  // "at 5" with no day: the next 5:00 or 17:00.
  return [dayAt(0, hour, min), dayAt(0, hour + 12, min), dayAt(1, hour, min)].find((t) => t > now)!;
}
