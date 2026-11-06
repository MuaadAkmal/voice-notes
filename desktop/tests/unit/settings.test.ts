import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, normaliseLocal, saveSettings, type SettingsFiles, splitSettings } from '../../src/main/settings';

let files: SettingsFiles;
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-settings-'));
  files = { pc: path.join(dir, 'pc.json'), profile: path.join(dir, 'profile.json') };
});

/** The same text in both files: each one only contributes its own keys. */
const writeBoth = (text: string) => {
  fs.writeFileSync(files.pc, text);
  fs.writeFileSync(files.profile, text);
};
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

it('saves synced keys to profile.json and the rest to pc.json', () => {
  saveSettings(files, { theme: 'dark', transcribeLanguage: 'en' });
  expect(readJson(files.pc)).toMatchObject({ theme: 'dark' });
  expect(readJson(files.pc)).not.toHaveProperty('transcribeLanguage');
  expect(readJson(files.profile)).toMatchObject({ transcribeLanguage: 'en' });
  expect(readJson(files.profile)).not.toHaveProperty('theme');
});

it('loads from both files', () => {
  fs.writeFileSync(files.pc, JSON.stringify({ theme: 'dark' }));
  fs.writeFileSync(files.profile, JSON.stringify({ laterPageId: '33333333-3333-4333-8333-333333333333' }));
  expect(loadSettings(files)).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', laterPageId: '33333333-3333-4333-8333-333333333333' });
});

it('a key in the wrong file is ignored', () => {
  fs.writeFileSync(files.pc, JSON.stringify({ laterPageId: '33333333-3333-4333-8333-333333333333' }));
  fs.writeFileSync(files.profile, JSON.stringify({ theme: 'dark' }));
  expect(loadSettings(files)).toEqual(DEFAULT_SETTINGS);
});

it('splitSettings divides by SYNCED_KEYS', () => {
  expect(splitSettings({ theme: 'dark', homeWidgets: [], bogus: 1 })).toEqual({ pc: { theme: 'dark', bogus: 1 }, profile: { homeWidgets: [] } });
});

it('returns defaults when file absent', () => {
  expect(loadSettings(files)).toEqual(DEFAULT_SETTINGS);
  expect(DEFAULT_SETTINGS.hotkeyLabel).toBe('Alt+Win');
  expect(DEFAULT_SETTINGS.hotkey).toEqual([56, 3675]);
});

it('dictation defaults to Ctrl+Win with the start sound on', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({ dictationHotkey: [29, 3675], dictationHotkeyLabel: 'Ctrl+Win', dictationSound: true });
});

it('falls back to defaults on invalid JSON', () => {
  writeBoth('{not json');
  expect(loadSettings(files)).toEqual(DEFAULT_SETTINGS);
});

it('merges partial settings', () => {
  writeBoth(JSON.stringify({ showIdlePill: false, bogus: 1 }));
  const s = loadSettings(files);
  expect(s).toEqual({ ...DEFAULT_SETTINGS, showIdlePill: false });
  expect(s).not.toHaveProperty('bogus');
});

it('saveSettings persists and returns merged', () => {
  expect(saveSettings(files, { micDeviceId: 'abc' }).micDeviceId).toBe('abc');
  expect(loadSettings(files).micDeviceId).toBe('abc');
  expect(fs.existsSync(`${files.pc}.tmp`) || fs.existsSync(`${files.profile}.tmp`)).toBe(false);
});

it('theme defaults to system and rejects unknown values', () => {
  expect(DEFAULT_SETTINGS.theme).toBe('system');
  writeBoth(JSON.stringify({ theme: 'blue' }));
  expect(loadSettings(files).theme).toBe('system');
  writeBoth(JSON.stringify({ theme: 'dark' }));
  expect(loadSettings(files).theme).toBe('dark');
});

it('recordingSource defaults to mic and rejects unknown values', () => {
  expect(DEFAULT_SETTINGS.recordingSource).toBe('mic');
  writeBoth(JSON.stringify({ recordingSource: 'speakers' }));
  expect(loadSettings(files).recordingSource).toBe('mic');
  writeBoth(JSON.stringify({ recordingSource: 'both' }));
  expect(loadSettings(files).recordingSource).toBe('both');
});

it('pillPosition defaults to null and rejects malformed values', () => {
  expect(DEFAULT_SETTINGS.pillPosition).toBeNull();
  writeBoth(JSON.stringify({ pillPosition: { displayId: 'x', x: 1 } }));
  expect(loadSettings(files).pillPosition).toBeNull();
  writeBoth(JSON.stringify({ pillPosition: { displayId: 2, x: 10, y: 20 } }));
  expect(loadSettings(files).pillPosition).toEqual({ displayId: 2, x: 10, y: 20 });
});

it('film mode defaults: off, 15 s rewind, auto-pause on; rewindSeconds only allows the listed lengths', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({ filmMode: false, rewindSeconds: 15, autoPause: true });
  writeBoth(JSON.stringify({ rewindSeconds: 20 }));
  expect(loadSettings(files).rewindSeconds).toBe(15);
  writeBoth(JSON.stringify({ rewindSeconds: 30, autoPause: false }));
  expect(loadSettings(files)).toMatchObject({ rewindSeconds: 30, autoPause: false });
});

it('homeWidgets defaults to [] and falls back to it when invalid', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const pageId = '22222222-2222-4222-8222-222222222222';
  expect(DEFAULT_SETTINGS.homeWidgets).toEqual([]);
  const good = [
    { id, type: 'quick-add', pageId, label: 'Words' },
    { id: pageId, type: 'page', pageId: id },
  ];
  writeBoth(JSON.stringify({ homeWidgets: good }));
  expect(loadSettings(files).homeWidgets).toEqual(good);
  const bad: unknown[] = [
    [{ id: 'nope', type: 'page', pageId }],
    [{ id, type: 'quick-add', pageId, label: 'x'.repeat(61) }],
    [{ id, type: 'chart', pageId }],
    Array.from({ length: 26 }, () => ({ id, type: 'page', pageId })), // 24 + the locked card is the most
  ];
  for (const homeWidgets of bad) {
    writeBoth(JSON.stringify({ homeWidgets }));
    expect(loadSettings(files).homeWidgets).toEqual([]);
  }
});

it('ignores wrongly-typed fields', () => {
  writeBoth(JSON.stringify({ launchAtLogin: 'yes' }));
  expect(loadSettings(files).launchAtLogin).toBe(false);
});

it('transcription settings default to not set up', () => {
  expect(DEFAULT_SETTINGS.transcription).toEqual({
    provider: null,
    baseUrl: '',
    model: 'openai/whisper-large-v3',
    localModel: null,
  });
  expect(DEFAULT_SETTINGS.transcribeLanguage).toBe('auto');
});

it('loads the built-in provider with its model', () => {
  const transcription = { provider: 'local', baseUrl: '', model: 'x', localModel: 'base' };
  writeBoth(JSON.stringify({ transcription }));
  expect(loadSettings(files).transcription).toEqual(transcription);
});

it('falls back to not set up when the built-in model file is gone', () => {
  const local = { ...DEFAULT_SETTINGS, transcription: { ...DEFAULT_SETTINGS.transcription, provider: 'local' as const, localModel: 'base' as const } };
  expect(normaliseLocal(local, () => false).transcription).toMatchObject({ provider: null, localModel: 'base' });
  expect(normaliseLocal(local, () => true)).toBe(local);
  const server = { ...DEFAULT_SETTINGS, transcription: { ...DEFAULT_SETTINGS.transcription, provider: 'server' as const, baseUrl: 'https://vm/v1' } };
  expect(normaliseLocal(server, () => false)).toBe(server);
});

it('reads settings saved before the built-in provider existed', () => {
  writeBoth(JSON.stringify({ transcription: { provider: 'server', baseUrl: 'https://vm/v1', model: 'm' } }));
  expect(loadSettings(files).transcription).toEqual({ provider: 'server', baseUrl: 'https://vm/v1', model: 'm', localModel: null });
});

it('loads valid transcription settings', () => {
  const transcription = { provider: 'server', baseUrl: 'https://vm/v1', model: 'm' };
  writeBoth(JSON.stringify({ transcription, transcribeLanguage: 'es' }));
  expect(loadSettings(files)).toMatchObject({ transcription, transcribeLanguage: 'es' });
});

it.each([
  ['unknown language', { transcribeLanguage: 'xx' }],
  ['non-http URL', { transcription: { provider: null, baseUrl: 'ftp://x', model: 'm' } }],
  ['un-normalised URL', { transcription: { provider: 'server', baseUrl: 'https://vm/v1/', model: 'm' } }],
  ['server without URL', { transcription: { provider: 'server', baseUrl: '', model: 'm' } }],
  ['empty model', { transcription: { provider: null, baseUrl: '', model: '' } }],
  ['built-in without a model', { transcription: { provider: 'local', baseUrl: '', model: 'm', localModel: null } }],
  ['unknown built-in model', { transcription: { provider: 'local', baseUrl: '', model: 'm', localModel: 'huge' } }],
])('falls back to defaults on %s', (_name, raw) => {
  writeBoth(JSON.stringify(raw));
  const s = loadSettings(files);
  expect(s.transcription).toEqual(DEFAULT_SETTINGS.transcription);
  expect(s.transcribeLanguage).toBe('auto');
});

const uuid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;

it('laterPageId defaults to null and ignores an invalid value', () => {
  expect(DEFAULT_SETTINGS.laterPageId).toBeNull();
  writeBoth(JSON.stringify({ laterPageId: 'not-a-uuid' }));
  expect(loadSettings(files).laterPageId).toBeNull();
  writeBoth(JSON.stringify({ laterPageId: uuid(1) }));
  expect(loadSettings(files).laterPageId).toBe(uuid(1));
});

it('keeps 24 widgets plus the locked one', () => {
  const widgets = [
    { id: uuid(99), type: 'page', pageId: uuid(98), locked: true },
    ...Array.from({ length: 24 }, (_, i) => ({ id: uuid(i), type: 'page', pageId: uuid(50 + i) })),
  ];
  writeBoth(JSON.stringify({ homeWidgets: widgets }));
  expect(loadSettings(files).homeWidgets).toEqual(widgets);
});

it('auto-transcribe and titles start on, with no custom words or Cloud warnings yet', () => {
  expect(loadSettings(files)).toMatchObject({
    autoTranscribe: true,
    autoTitle: true,
    customWords: [],
    cloudWarnedPeriod: null,
    cloudOutPeriod: null,
  });
});

it('custom words follow the account; the rest of these stay on the PC', () => {
  const { pc, profile } = splitSettings({ customWords: ['Muaad'], autoTranscribe: false, autoTitle: false, cloudWarnedPeriod: 'x' });
  expect(profile).toEqual({ customWords: ['Muaad'] });
  expect(pc).toEqual({ autoTranscribe: false, autoTitle: false, cloudWarnedPeriod: 'x' });
});

it('voice note cleanup starts on, and stays on the PC', () => {
  expect(loadSettings(files).voiceNoteCleanup).toBe(true);
  expect(splitSettings({ voiceNoteCleanup: false })).toEqual({ pc: { voiceNoteCleanup: false }, profile: {} });
});

it('onboarding is not done yet, and follows the account', () => {
  expect(loadSettings(files).onboarded).toBe(false);
  expect(loadSettings(files).onboardingPending).toBe(false);
  expect(splitSettings({ onboardingPending: true }).pc).toEqual({ onboardingPending: true });
  expect(splitSettings({ onboarded: true }).profile).toEqual({ onboarded: true });
});

it('the language learner starts off and stays on this PC', () => {
  expect(loadSettings(files).languageLearner).toBe(false);
  expect(splitSettings({ languageLearner: true }).pc).toEqual({ languageLearner: true });
});

it('custom words are normalised on load', () => {
  writeBoth(JSON.stringify({ customWords: [' Muaad ', 'muaad', 'a[b]'] }));
  expect(loadSettings(files).customWords).toEqual(['Muaad', 'ab']);
});
