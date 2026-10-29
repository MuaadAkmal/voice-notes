import http from 'node:http';
import type { AddressInfo } from 'node:net';
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

/** Signed in with the fixture server; `connect` also finishes the consent, returning the app's loopback port. */
async function signedIn() {
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
  return t.dashboard;
}

async function connect(page: TestApp['dashboard']): Promise<number | null> {
  await page.getByRole('button', { name: /^Connectors/ }).click();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(() => t.hooks((h) => h.openedExternal.some((u) => u.startsWith('https://accounts.google.com/')))).toBe(true);
  const port = await server.connect('cal@gmail.com');
  await expect(page.getByText('Connected as cal@gmail.com')).toBeVisible({ timeout: 10_000 });
  return port;
}
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
  // Not connected, the card must not keep asking: one load, then quiet.
  const asked = server.requests('google/token');
  await page.waitForTimeout(2000);
  expect(server.requests('google/token') - asked).toBeLessThanOrEqual(1);
});

test('signed out, the Connectors page asks to sign in', async () => {
  t = await launch();
  const page = t.dashboard;
  await page.getByRole('button', { name: /^Connectors/ }).click();
  await expect(page.getByText('Sign in to connect Google Calendar.')).toBeVisible();
  await page.screenshot({ path: '.superpowers/shots/connectors-signed-out.png' });
});

test("Calendar is in the sidebar only when connected, and the consent lands on the app's page", async () => {
  const page = await signedIn();
  await expect(page.getByRole('button', { name: /^Connectors/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Calendar/ })).toBeHidden();
  const port = await connect(page);
  expect(port).not.toBeNull();
  const html = await (await fetch(`http://127.0.0.1:${port}/connectors/done?result=connected`)).text();
  expect(html).toContain('Google Calendar connected');
  await expect(page.getByRole('button', { name: /^Calendar/ })).toBeVisible();

  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('button', { name: /^Calendar/ })).toBeHidden();
});

test('the month grid shows events and New event adds one', async () => {
  const page = await signedIn();
  await connect(page);
  await page.getByRole('button', { name: /^Calendar/ }).click();
  // The cell's name is the date in the app's own locale.
  const label = await page.evaluate(() =>
    new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  );
  const todayCell = page.getByRole('gridcell', { name: label, exact: true });
  await expect(todayCell.getByText('Design review')).toBeVisible();
  await page.screenshot({ path: '.superpowers/shots/calendar-month.png' });

  await todayCell.getByText('Design review').click();
  await expect(page.getByRole('dialog').getByText('Design review')).toBeVisible();
  await page.getByRole('button', { name: 'Open in Google Calendar' }).click();
  await expect.poll(() => t.hooks((h) => h.openedExternal.includes('https://www.google.com/calendar/event?eid=meet'))).toBe(true);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByLabel('Title').fill('Dentist');
  await page.getByLabel('All day').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/^Added: Dentist · /)).toBeVisible();
  await expect(todayCell.getByText('Dentist')).toBeVisible();

  // The fixture's account outlives the app: leave it disconnected for the next test.
  await page.getByRole('button', { name: /^Connectors/ }).click();
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
});

test('Quick Add on the Home card adds one event', async () => {
  const page = await signedIn();
  await connect(page);
  await page.getByRole('button', { name: "Add Today's calendar to Home" }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  const box = page.getByRole('textbox', { name: 'Add to calendar' });
  await box.fill('Lunch with Sam');
  const before = server.requests('quickAdd');
  await box.press('Enter');
  await box.press('Enter'); // a second Enter while the first runs must not add it twice
  await expect(page.getByText(/^Added: Lunch with Sam · /)).toBeVisible();
  await expect(page.getByRole('button', { name: /Lunch with Sam/ })).toBeVisible();
  expect(server.requests('quickAdd') - before).toBe(1);
  await expect(box).toHaveValue('');
  await page.screenshot({ path: '.superpowers/shots/calendar-quick-add.png' });

  await page.getByRole('button', { name: /^Connectors/ }).click();
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
});

test('voice to calendar: a "Calendar, …" dictation adds an event and pastes nothing', async () => {
  // A fake Whisper server that always hears the command.
  const whisper = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: ' Calendar, lunch tomorrow 1pm.' })));
  });
  await new Promise<void>((r) => whisper.listen(0, '127.0.0.1', r));
  try {
    const page = await signedIn();
    await connect(page);
    await expect(page.getByRole('switch', { name: 'Voice to calendar' })).toBeChecked();
    const baseUrl = `http://127.0.0.1:${(whisper.address() as AddressInfo).port}/v1`;
    await page.evaluate((u) => window.dashboardApi.setSettings({ transcription: { provider: 'server', baseUrl: u, model: 'whisper', localModel: null } }), baseUrl);
    const overlay = t.app.windows().find((w) => w.url().includes('/overlay/'));
    const before = server.requests('quickAdd');

    await t.hooks((h) => h.dictationGesture.toggle());
    await page.waitForTimeout(1500);
    await t.hooks((h) => h.dictationGesture.toggle());

    await expect(overlay!.getByTestId('pill')).toContainText('Added · lunch tomorrow 1pm · ', { timeout: 10_000 });
    expect(server.requests('quickAdd') - before).toBe(1);
    expect(await t.hooks((h) => h.pasted)).toEqual([]);

    await page.getByRole('button', { name: /^Connectors/ }).click();
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  } finally {
    whisper.close();
  }
});
