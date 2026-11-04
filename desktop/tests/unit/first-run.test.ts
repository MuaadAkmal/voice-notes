import { expect, it } from 'vitest';
import { addStarterPages, firstRun, micTestAllowed, STARTER_PAGES } from '../../src/main/first-run';
import type { Page } from '../../src/shared/channels';

it('does nothing once the account is onboarded', () => {
  expect(firstRun({ onboarded: true, notes: 0, userPages: 0 })).toEqual({ onboard: false, starters: false, patch: null });
  expect(firstRun({ onboarded: true, pending: true, notes: 0, userPages: 3 })).toEqual({ onboard: false, starters: false, patch: null });
});

it('onboarding left unfinished on this PC (a restart) shows again, without new starter pages', () => {
  expect(firstRun({ onboarded: false, pending: true, notes: 1, userPages: 3 })).toEqual({ onboard: true, starters: false, patch: null });
});

it('an account with notes is not new: marked onboarded without showing it', () => {
  expect(firstRun({ onboarded: false, notes: 3, userPages: 0 })).toEqual({ onboard: false, starters: false, patch: { onboarded: true } });
});

it('an account with its own pages (from any PC) is not new', () => {
  expect(firstRun({ onboarded: false, notes: 0, userPages: 1 })).toEqual({ onboard: false, starters: false, patch: { onboarded: true } });
});

it('an empty account (only the built-in pages) is new', () => {
  expect(firstRun({ onboarded: false, notes: 0, userPages: 0 })).toEqual({ onboard: true, starters: true, patch: null });
});

it('creates the three starter pages with their text', () => {
  const made: { id: string; title: string; body: string }[] = [];
  addStarterPages({
    create: () => {
      const p = { id: String(made.length), title: '', body: '' };
      made.push(p);
      return p as unknown as Page;
    },
    rename: (id, title) => ((made[Number(id)].title = title), made[Number(id)] as unknown as Page),
    setBody: (id, body) => ((made[Number(id)].body = body), made[Number(id)] as unknown as Page),
  });
  expect(made.map((p) => p.title)).toEqual(['Grocery list', 'Spanish', 'YouTube']);
  expect(made[0].body).toBe('- [ ] milk\n- [ ] eggs\n- [ ] bread\n');
  expect(made[1].body).toContain('- hola · OH-lah · hello\n');
  expect(made[2].body).toBe('Links you save from YouTube (drop one on the pill, or Save this) land here.\n');
  expect(STARTER_PAGES).toHaveLength(3);
});

it('tests the mic only while nothing is recording', () => {
  expect(micTestAllowed('idle', false)).toBe(true);
  expect(micTestAllowed('recording', false)).toBe(false);
  expect(micTestAllowed('idle', true)).toBe(false);
});
