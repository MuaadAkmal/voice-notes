// Voice to calendar: a dictation that starts with a calendar trigger becomes a Google Quick Add event.
// Strict on purpose: only "calendar" (Whisper also hears "calender") or "add (an) event" / "add to (my)
// calendar" as the first words, so an ordinary sentence ("Schedule is tight…") is still pasted.

const TRIGGER = /^(?:calend[ae]r|add (?:an? )?event|add (?:it )?to (?:my |the )?calend[ae]r)\b[\s,.:;!?-]*/i;
// Lead-in verbs after the trigger, so the title is clean: "set up a meeting with Alex" → "meeting with Alex".
const LEAD_IN = /^(?:remind me (?:to |about )?|(?:set up|schedule|create|add|book|make|put) (?:an? |the )?)/i;

/** The Quick Add text when `text` is a calendar command, else null. */
export function parseCalendarCommand(text: string): { text: string } | null {
  const start = text.trim().replace(/^[\s,.:;!?"'-]+/, '');
  const m = TRIGGER.exec(start);
  if (!m) return null;
  const rest = start
    .slice(m[0].length)
    .replace(LEAD_IN, '')
    .replace(/[\s.!?]+$/, '')
    .trim();
  return rest ? { text: rest } : null;
}
