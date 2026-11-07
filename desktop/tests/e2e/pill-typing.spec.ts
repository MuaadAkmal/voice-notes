import { expect, type Page, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

// Clicking the idle pill opens a one-line input: plain text goes to Quick notes (no server), and
// Undo last takes back the newest list write.

let t: TestApp;

const overlay = async (): Promise<Page> => {
  for (let i = 0; i < 50; i++) {
    const p = t.app.windows().find((w) => w.url().includes('/overlay/'));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('overlay window not found');
};

test.afterEach(async () => {
  await t?.close();
});

const quickNotes = async () =>
  (await t.hooks((h) => h.store.pages.list().map((p) => ({ title: p.title, body: p.body })))).find((p) => p.title === 'Quick notes')?.body ?? '';
const typing = () => t.hooks((h) => h.typing.active());

test('typing a note saves it to Quick notes, and Undo last takes it back', async () => {
  t = await launch();
  const pill = await overlay();
  await pill.getByTitle('Click to type · hold your hotkey to speak').dispatchEvent('click'); // the bar grows on hover: never 'stable'
  const box = pill.getByRole('textbox', { name: 'Type a note' });
  await expect(box).toBeFocused();
  await box.fill('milk');
  await pill.waitForTimeout(1000); // let the window repaint at its new size
  await pill.screenshot({ path: '.superpowers/shots/pill-typing.png' });
  await box.press('Enter');
  await expect(pill.getByTestId('pill')).toContainText(/Added · milk\s*→ Quick notes/);
  expect(await quickNotes()).toContain('- milk');
  expect(await typing()).toBe(false);
  expect(await t.hooks((h) => h.pasted)).toEqual([]);

  await expect(pill.getByTestId('pill')).not.toContainText('Added', { timeout: 10_000 }); // flash over
  await pill.getByTitle('Click to type · hold your hotkey to speak').dispatchEvent('click'); // the bar grows on hover: never 'stable'
  await pill.getByRole('button', { name: 'Undo last' }).dispatchEvent('mousedown');
  await expect(pill.getByTestId('pill')).toContainText('Undone');
  expect(await quickNotes()).not.toContain('- milk');
});

test('Esc closes the input and keeps the draft; a recording closes it too', async () => {
  t = await launch();
  const pill = await overlay();
  await pill.getByTitle('Click to type · hold your hotkey to speak').dispatchEvent('click'); // the bar grows on hover: never 'stable'
  await pill.getByRole('textbox', { name: 'Type a note' }).fill('half');
  await pill.keyboard.press('Escape');
  await expect.poll(typing).toBe(false);
  await pill.getByTitle('Click to type · hold your hotkey to speak').dispatchEvent('click'); // the bar grows on hover: never 'stable'
  await expect(pill.getByRole('textbox', { name: 'Type a note' })).toHaveValue('half');
  await t.hooks((h) => h.gesture.toggle());
  await expect.poll(typing).toBe(false);
  await expect.poll(() => t.hooks((h) => h.controller.state)).toBe('recording');
  await t.hooks((h) => h.gesture.toggle());
});

test('Undo last and Move last to… are disabled with nothing recent', async () => {
  t = await launch();
  const pill = await overlay();
  await pill.getByTitle('Click to type · hold your hotkey to speak').dispatchEvent('click'); // the bar grows on hover: never 'stable'
  await expect(pill.getByRole('button', { name: 'Undo last' })).toBeDisabled();
  await expect(pill.getByRole('button', { name: 'Move last to…' })).toBeDisabled();
});

const overlayFocusable = () =>
  t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/overlay/'))!.isFocusable());

test('closing the input hands focus back to the window that was in front', async () => {
  t = await launch();
  const pill = await overlay();
  await t.hooks((h) => h.setForeground(() => ({ title: 'notes.txt - Notepad', processName: 'notepad.exe', pid: 4242, hwnd: 77 })));
  await pill.getByTitle('Click to type · hold your hotkey to speak').dispatchEvent('click'); // the bar grows on hover: never 'stable'
  await expect(pill.getByRole('textbox', { name: 'Type a note' })).toBeFocused();
  await pill.keyboard.press('Escape');
  await expect.poll(() => t.hooks((h) => h.typing.refocused)).toEqual([77]);
  expect(await overlayFocusable()).toBe(false);
});

test('a reloaded pill does not leave typing open', async () => {
  t = await launch();
  const pill = await overlay();
  await pill.getByTitle('Click to type · hold your hotkey to speak').dispatchEvent('click'); // the bar grows on hover: never 'stable'
  await expect.poll(typing).toBe(true);
  await pill.reload();
  await expect.poll(typing).toBe(false);
  expect(await overlayFocusable()).toBe(false);
});

test('Move last to… opens the picker for the newest write and moves it', async () => {
  t = await launch();
  const pill = await overlay();
  await t.hooks((h) => {
    const pages = h.store.pages as unknown as { create(folderId: null): { id: string }; rename(id: string, title: string): void };
    pages.rename(pages.create(null).id, 'Groceries');
  });
  await pill.getByTitle('Click to type · hold your hotkey to speak').dispatchEvent('click'); // the bar grows on hover: never 'stable'
  await pill.getByRole('textbox', { name: 'Type a note' }).fill('milk');
  await pill.getByRole('textbox', { name: 'Type a note' }).press('Enter');
  await expect(pill.getByTestId('pill')).toContainText('Added');
  await expect(pill.getByTestId('pill')).not.toContainText('Added', { timeout: 10_000 }); // flash over
  await pill.getByTitle('Click to type · hold your hotkey to speak').dispatchEvent('click'); // the bar grows on hover: never 'stable'
  const handedBack = (await t.hooks((h) => h.typing.refocused)).length;
  await pill.getByRole('button', { name: 'Move last to…' }).dispatchEvent('mousedown');
  await expect(pill.getByLabel('Page to move to')).toBeFocused();
  expect(await t.hooks((h) => h.typing.refocused)).toHaveLength(handedBack); // the picker keeps focus: no hand-back in between
  await pill.getByRole('button', { name: 'Groceries' }).dispatchEvent('mousedown');
  await expect(pill.getByTestId('pill')).toContainText(/Moved\s*→ Groceries/);
  const bodies = await t.hooks((h) => h.store.pages.list().map((p) => ({ title: p.title, body: p.body })));
  expect(bodies.find((p) => p.title === 'Groceries')?.body).toContain('- milk');
  expect(bodies.find((p) => p.title === 'Quick notes')?.body).not.toContain('- milk');
  expect(await overlayFocusable()).toBe(false);
});