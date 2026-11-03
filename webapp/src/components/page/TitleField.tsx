"use client";

/** A large title edited in place; saved on Enter or when it loses focus. Remounts when the title changes elsewhere. */
export function TitleField({ value, placeholder = "Untitled", onSave }: { value: string; placeholder?: string; onSave(title: string): void }) {
  return (
    <input
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      aria-label="Title"
      className="w-full bg-transparent text-4xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const next = e.currentTarget.value.trim();
        if (next && next !== value) onSave(next);
        else e.currentTarget.value = value;
      }}
    />
  );
}
