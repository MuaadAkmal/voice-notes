import { expect, it } from 'vitest';
import { newestFirst } from '../../src/shared/newest-first';

const BODY = '## 28 Oct 2026\n- [ ] a\n- [x] b\n\n## 30 Oct 2026\n- [ ] c\n- [ ] d ![d](vn-image://x.jpg)\n  more of d\n';

it('shows the newest day first, newest entry first, mapping each line to the stored one', () => {
  const r = newestFirst(BODY);
  expect(r.text).toBe('## 30 Oct 2026\n- [ ] d ![d](vn-image://x.jpg)\n  more of d\n- [ ] c\n\n## 28 Oct 2026\n- [x] b\n- [ ] a\n');
  const stored = BODY.split('\n');
  r.text.split('\n').forEach((line, i) => {
    if (i < r.lines.length && r.lines[i] >= 0) expect(stored[r.lines[i]]).toBe(line);
  });
});

it('keeps text before the first day on top', () => {
  expect(newestFirst('Intro\n\n## 1 Oct 2026\n- x\n').text).toBe('Intro\n\n## 1 Oct 2026\n- x\n');
});

it('leaves a body without days as it is', () => {
  expect(newestFirst('- a\n- b').text).toBe('- a\n- b');
  expect(newestFirst('').text).toBe('');
});
