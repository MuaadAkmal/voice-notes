import { describe, expect, it } from 'vitest';
import {
  appendEntry,
  appendLine,
  dayHeading,
  todayEntries,
} from '../../src/shared/learn-log';

const D = new Date(2026, 9, 25, 9);

describe('dayHeading', () => {
  it('formats D Mon YYYY', () => {
    expect(dayHeading(new Date(2026, 9, 25))).toBe('## 25 Oct 2026');
    expect(dayHeading(new Date(2027, 0, 3))).toBe('## 3 Jan 2027');
  });

  it('maps all 12 months', () => {
    const names = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    names.forEach((n, i) =>
      expect(dayHeading(new Date(2026, i, 1))).toBe(`## 1 ${n} 2026`),
    );
  });
});

describe('appendEntry', () => {
  it('starts an empty body', () => {
    expect(appendEntry('', 'hola', D)).toBe('## 25 Oct 2026\n- hola\n');
  });
  it('adds a section after a body ending in one newline', () => {
    expect(appendEntry('# Words\n', 'hola', D)).toBe(
      '# Words\n\n## 25 Oct 2026\n- hola\n',
    );
  });
  it('adds a section after a body with no trailing newline', () => {
    expect(appendEntry('# Words', 'hola', D)).toBe(
      '# Words\n\n## 25 Oct 2026\n- hola\n',
    );
  });
  it('adds a section after a body ending in a blank line', () => {
    expect(appendEntry('# Words\n\n', 'hola', D)).toBe(
      '# Words\n\n## 25 Oct 2026\n- hola\n',
    );
  });
  it("appends to today's section", () => {
    expect(appendEntry('## 25 Oct 2026\n- hola\n', 'adiós', D)).toBe(
      '## 25 Oct 2026\n- hola\n- adiós\n',
    );
  });
  it('keeps trailing newlines after the insertion', () => {
    expect(appendEntry('## 25 Oct 2026\n- hola\n\n\n', 'adiós', D)).toBe(
      '## 25 Oct 2026\n- hola\n- adiós\n\n\n',
    );
  });
  it('starts a new section after an older day', () => {
    expect(appendEntry('## 24 Oct 2026\n- uno', 'hola', D)).toBe(
      '## 24 Oct 2026\n- uno\n\n## 25 Oct 2026\n- hola\n',
    );
  });
  it("appends a new section when today's heading is not the last", () => {
    expect(appendEntry('## 25 Oct 2026\n- a\n\n## Notes\nx\n', 'b', D)).toBe(
      '## 25 Oct 2026\n- a\n\n## Notes\nx\n\n## 25 Oct 2026\n- b\n',
    );
  });
  it('collapses whitespace containing newlines', () => {
    expect(appendEntry('', '  two\n lines  ', D)).toBe(
      '## 25 Oct 2026\n- two lines\n',
    );
  });
  it('rejects an empty entry', () => {
    expect(() => appendEntry('', '   ', D)).toThrow('Entry is empty');
  });
  it('never writes \r', () => {
    expect(appendEntry('', 'a\r\nb', D)).not.toContain('\r');
    expect(appendEntry('x\n', 'a\r\n\r\nb', D)).not.toContain('\r');
  });
});

describe('todayEntries', () => {
  it('reads bullet and task lines', () => {
    expect(
      todayEntries('## 25 Oct 2026\n- a\n* b\n- [ ] c\n- [x] d\ntext', D),
    ).toEqual(['a', 'b', 'c', 'd']);
  });
  it('is empty for an older day', () => {
    expect(todayEntries('## 24 Oct 2026\n- a\n', D)).toEqual([]);
  });
  it("is empty when today's heading is not last", () => {
    expect(todayEntries('## 25 Oct 2026\n- a\n\n## Notes\n- x\n', D)).toEqual(
      [],
    );
  });
  it('is empty for an empty body', () => {
    expect(todayEntries('', D)).toEqual([]);
  });
});

describe('appendLine', () => {
  it('adds a bullet as the last line, keeping the trailing newline', () => {
    expect(appendLine('', 'milk')).toBe('- milk\n');
    expect(appendLine('\n\n', 'milk')).toBe('- milk\n');
    expect(appendLine('- eggs\n', 'milk')).toBe('- eggs\n- milk\n');
    expect(appendLine('- eggs', 'milk')).toBe('- eggs\n- milk\n');
    expect(appendLine('# Groceries\n\n- eggs\n\n\n', ' milk ')).toBe('# Groceries\n\n- eggs\n- milk\n\n\n');
  });

  it('keeps an entry on one line and refuses an empty one', () => {
    expect(appendLine('', 'a\nb')).toBe('- a b\n');
    expect(() => appendLine('', '  ')).toThrow();
  });
});
