import { expect, test } from '@playwright/test';
import { startConnectorsServer } from './fixtures/connectors-server';
import { launch, type TestApp } from './launch';

const USER = '11111111-1111-4111-8111-111111111111';
const day = (h: number, m = 0) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const today = new Date();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
const EVENTS = [
  { id: 'all', summary: 'Diwali holiday', htmlLink: 'https://www.google.com/calendar/event?eid=all', start: { date: ymd(today) }, end: { date: ymd(tomorrow) } },
  { id: 'meet', summary: 'Design review', htmlLink: 'https://www.google.com/calendar/event?eid=meet', start: { dateTime: day(23, 0) }, end: { dateTime: day(23, 30) } },
];

let server: Awaited<ReturnType<typeof startConnectorsServer>>;
let t: TestApp;

test.beforeAll(async () => {
  server = await startConnectorsServer({ userId: USER, email: 'me@example.com' }, EVENTS);
});
test.afterAll(async () => {
  await server.close();
});
test.afterEach(async () => {
  await t?.close();
});

test('connect Google Calendar, see today on Home, disconnect', async () => {
  t = await launch();
  await t.app.evaluate(
    (_e, { url, user }) => {
      const h = (globalThis as unknown as { __voiceNotes: Record<string, any> }).__voiceNotes; // eslint-disable-line @typescript-eslint/no-explicit-any
      h.connectors.useServer(url);
      h.connectors.useToken(async () => 'test-token');
      h.account.setTestSession({ state: 'signed-in', userId: user, email: 'me@example.com', name: 'Test User', avatar: null });
    },
    { url: server.url, user: USER },
  );
  const page = t.dashboard;

  await page.getByRole('button', { name: /^Connectors/ }).click();
  await expect(page.getByRole('heading', { name: 'Connectors' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('Waiting for browser…')).toBeVisible();
  await expect.poll(() => t.hooks((h) => h.openedExternal.some((u) => u.startsWith('https://accounts.google.com/')))).toBe(true);

  await server.connect('cal@gmail.com'); // the browser comes back from Google
  await expect(page.getByText('Connected as cal@gmail.com')).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: '.superpowers/shots/connectors-connected.png' });

  await page.getByRole('button', { name: "Add Today's calendar to Home" }).click();
  await expect(page.getByRole('button', { name: "Add Today's calendar to Home" })).toBeHidden();
  await page.getByRole('button', { name: /^Home/ }).click();
  await expect(page.getByText(/^Today · /)).toBeVisible();
  await expect(page.getByText('Diwali holiday')).toBeVisible();
  await expect(page.getByText('All day')).toBeVisible();
  await expect(page.getByText('Design review')).toBeVisible();
  await page.screenshot({ path: '.superpowers/shots/connectors-home-card.png' });

  await page.getByText('Design review').click();
  await expect.poll(() => t.hooks((h) => h.openedExternal.includes('https://www.google.com/calendar/event?eid=meet'))).toBe(true);

  await page.getByRole('button', { name: /^Connectors/ }).click();
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();

  await page.getByRole('button', { name: /^Home/ }).click();
  await expect(page.getByText('Connect Google Calendar to see today here.')).toBeVisible();
});

test('signed out, the Connectors page asks to sign in', async () => {
  t = await launch();
  const page = t.dashboard;
  await page.getByRole('button', { name: /^Connectors/ }).click();
  await expect(page.getByText('Sign in to connect Google Calendar.')).toBeVisible();
  await page.screenshot({ path: '.superpowers/shots/connectors-signed-out.png' });
});
