import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../src/main/settings';

let file: string;
beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vn-settings-')), 'settings.json');
});

it('returns defaults when file absent', () => {
  expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
  expect(DEFAULT_SETTINGS.hotkeyLabel).toBe('Alt+Win');
  expect(DEFAULT_SETTINGS.hotkey).toEqual([56, 3675]);
});

it('falls back to defaults on invalid JSON', () => {
  fs.writeFileSync(file, '{not json');
  expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
});

it('merges partial settings', () => {
  fs.writeFileSync(file, JSON.stringify({ showIdlePill: false, bogus: 1 }));
  const s = loadSettings(file);
  expect(s).toEqual({ ...DEFAULT_SETTINGS, showIdlePill: false });
  expect(s).not.toHaveProperty('bogus');
});

it('saveSettings persists and returns merged', () => {
  expect(saveSettings(file, { micDeviceId: 'abc' }).micDeviceId).toBe('abc');
  expect(loadSettings(file).micDeviceId).toBe('abc');
  expect(fs.existsSync(`${file}.tmp`)).toBe(false);
});

it('theme defaults to system and rejects unknown values', () => {
  expect(DEFAULT_SETTINGS.theme).toBe('system');
  fs.writeFileSync(file, JSON.stringify({ theme: 'blue' }));
  expect(loadSettings(file).theme).toBe('system');
  fs.writeFileSync(file, JSON.stringify({ theme: 'dark' }));
  expect(loadSettings(file).theme).toBe('dark');
});

it('recordingSource defaults to mic and rejects unknown values', () => {
  expect(DEFAULT_SETTINGS.recordingSource).toBe('mic');
  fs.writeFileSync(file, JSON.stringify({ recordingSource: 'speakers' }));
  expect(loadSettings(file).recordingSource).toBe('mic');
  fs.writeFileSync(file, JSON.stringify({ recordingSource: 'both' }));
  expect(loadSettings(file).recordingSource).toBe('both');
});

it('pillPosition defaults to null and rejects malformed values', () => {
  expect(DEFAULT_SETTINGS.pillPosition).toBeNull();
  fs.writeFileSync(file, JSON.stringify({ pillPosition: { displayId: 'x', x: 1 } }));
  expect(loadSettings(file).pillPosition).toBeNull();
  fs.writeFileSync(file, JSON.stringify({ pillPosition: { displayId: 2, x: 10, y: 20 } }));
  expect(loadSettings(file).pillPosition).toEqual({ displayId: 2, x: 10, y: 20 });
});

it('film mode defaults: off, 15 s rewind, auto-pause on; rewindSeconds only allows the listed lengths', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({ filmMode: false, rewindSeconds: 15, autoPause: true });
  fs.writeFileSync(file, JSON.stringify({ rewindSeconds: 20 }));
  expect(loadSettings(file).rewindSeconds).toBe(15);
  fs.writeFileSync(file, JSON.stringify({ rewindSeconds: 30, autoPause: false }));
  expect(loadSettings(file)).toMatchObject({ rewindSeconds: 30, autoPause: false });
});

it('homeWidgets defaults to [] and falls back to it when invalid', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const pageId = '22222222-2222-4222-8222-222222222222';
  expect(DEFAULT_SETTINGS.homeWidgets).toEqual([]);
  const good = [
    { id, type: 'quick-add', pageId, label: 'Words' },
    { id: pageId, type: 'page', pageId: id },
  ];
  fs.writeFileSync(file, JSON.stringify({ homeWidgets: good }));
  expect(loadSettings(file).homeWidgets).toEqual(good);
  const bad: unknown[] = [
    [{ id: 'nope', type: 'page', pageId }],
    [{ id, type: 'quick-add', pageId, label: 'x'.repeat(61) }],
    [{ id, type: 'chart', pageId }],
    Array.from({ length: 25 }, () => ({ id, type: 'page', pageId })),
  ];
  for (const homeWidgets of bad) {
    fs.writeFileSync(file, JSON.stringify({ homeWidgets }));
    expect(loadSettings(file).homeWidgets).toEqual([]);
  }
});

it('ignores wrongly-typed fields', () => {
  fs.writeFileSync(file, JSON.stringify({ launchAtLogin: 'yes' }));
  expect(loadSettings(file).launchAtLogin).toBe(false);
});

it('transcription settings default to not set up', () => {
  expect(DEFAULT_SETTINGS.transcription).toEqual({ provider: null, baseUrl: '', model: 'openai/whisper-large-v3' });
  expect(DEFAULT_SETTINGS.transcribeLanguage).toBe('auto');
});

it('loads valid transcription settings', () => {
  const transcription = { provider: 'server', baseUrl: 'https://vm/v1', model: 'm' };
  fs.writeFileSync(file, JSON.stringify({ transcription, transcribeLanguage: 'es' }));
  expect(loadSettings(file)).toMatchObject({ transcription, transcribeLanguage: 'es' });
});

it.each([
  ['unknown language', { transcribeLanguage: 'xx' }],
  ['non-http URL', { transcription: { provider: null, baseUrl: 'ftp://x', model: 'm' } }],
  ['un-normalised URL', { transcription: { provider: 'server', baseUrl: 'https://vm/v1/', model: 'm' } }],
  ['server without URL', { transcription: { provider: 'server', baseUrl: '', model: 'm' } }],
  ['empty model', { transcription: { provider: null, baseUrl: '', model: '' } }],
])('falls back to defaults on %s', (_name, raw) => {
  fs.writeFileSync(file, JSON.stringify(raw));
  const s = loadSettings(file);
  expect(s.transcription).toEqual(DEFAULT_SETTINGS.transcription);
  expect(s.transcribeLanguage).toBe('auto');
});
