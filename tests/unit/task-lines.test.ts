import { describe, expect, it } from 'vitest';
import { setTaskChecked, toggledTask } from '../../src/shared/task-lines';

describe('setTaskChecked', () => {
  const body =
    '# Keys\n- [ ] a\n* [x] b\n  + [X] c\n1. [ ] d\nplain\n- not [ ] a task';

  it('changes only the bracket character of that line', () => {
    expect(setTaskChecked(body, 1, true)).toBe(
      body.replace('- [ ] a', '- [x] a'),
    );
    expect(setTaskChecked(body, 2, false)).toBe(
      body.replace('* [x] b', '* [ ] b'),
    );
    expect(setTaskChecked(body, 3, false)).toBe(
      body.replace('+ [X] c', '+ [ ] c'),
    );
    expect(setTaskChecked(body, 4, true)).toBe(
      body.replace('1. [ ] d', '1. [x] d'),
    );
  });

  it('leaves an already matching line as it is', () => {
    expect(setTaskChecked(body, 2, true)).toBe(body);
    expect(setTaskChecked(body, 3, true)).toBe(body);
  });

  it('returns null for lines that are not tasks, or out of range', () => {
    expect(setTaskChecked(body, 0, true)).toBeNull();
    expect(setTaskChecked(body, 5, true)).toBeNull();
    expect(setTaskChecked(body, 6, true)).toBeNull();
    expect(setTaskChecked(body, 7, true)).toBeNull();
    expect(setTaskChecked('-[ ] x', 0, true)).toBeNull();
  });

  it('accepts a task with no text after the marker', () => {
    expect(setTaskChecked('- [ ]', 0, true)).toBe('- [x]');
  });
});

describe('toggledTask', () => {
  it('finds the one task line that changed and its new state', () => {
    expect(
      toggledTask('# K\n- [ ] a\n- [ ] b', '# K\n- [ ] a\n- [x] b'),
    ).toEqual({ line: 2, checked: true });
    expect(toggledTask('- [X] a', '- [ ] a')).toEqual({
      line: 0,
      checked: false,
    });
  });

  it('is null for anything that is not a single task toggle', () => {
    expect(toggledTask('a', 'a')).toBeNull();
    expect(toggledTask('a', 'b')).toBeNull();
    expect(toggledTask('- [ ] a', '- [ ] a\nb')).toBeNull();
    expect(toggledTask('- [ ] a\n- [ ] b', '- [x] a\n- [x] b')).toBeNull();
  });
});
