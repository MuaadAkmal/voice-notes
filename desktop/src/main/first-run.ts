import type { Page } from '../shared/channels';

// A new account's first launch: decided once the first sync has brought in whatever the account
// already has on other PCs. A new one gets starter pages and the onboarding screen; one that
// already has notes or pages of its own is marked onboarded without seeing it.

export type FirstRun = { onboard: boolean; starters: boolean; patch: { onboarded: true } | null };

/** userPages: pages other than the built-in Review later and Quick notes. */
export function firstRun(i: { onboarded: boolean; notes: number; userPages: number }): FirstRun {
  if (i.onboarded) return { onboard: false, starters: false, patch: null };
  if (i.notes > 0 || i.userPages > 0) return { onboard: false, starters: false, patch: { onboarded: true } };
  return { onboard: true, starters: true, patch: null };
}

export const STARTER_PAGES: readonly { title: string; body: string }[] = [
  { title: 'Grocery list', body: '- [ ] milk\n- [ ] eggs\n- [ ] bread\n' },
  {
    title: 'Spanish',
    body:
      'Words you learn by voice land here: say “Pixie, I learned a new word in Spanish, …” with the Language learner on.\n\n' +
      '- hola · OH-lah · hello\n- gracias · GRAH-syahs · thank you\n- por favor · por fah-VOR · please\n',
  },
  // Save by site finds its page by this title, so links from YouTube land here.
  { title: 'YouTube', body: 'Links you save from YouTube (drop one on the pill, or Save this) land here.\n' },
];

export function addStarterPages(pages: { create(folderId: null): Page; rename(id: string, title: string): Page; setBody(id: string, body: string): Page }): void {
  for (const { title, body } of STARTER_PAGES) {
    const { id } = pages.create(null);
    pages.rename(id, title);
    pages.setBody(id, body);
  }
}

/** The mic check borrows the pill's mic: only while it isn't recording or dictating. */
export const micTestAllowed = (recorder: string, dictating: boolean): boolean => recorder === 'idle' && !dictating;
