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
  expect(DEFAULT_SETTINGS.hotkeyLabel).toBe('Ctrl+Win');
  expect(DEFAULT_SETTINGS.hotkey).toEqual([29, 3675]);
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

it('ignores wrongly-typed fields', () => {
  fs.writeFileSync(file, JSON.stringify({ launchAtLogin: 'yes' }));
  expect(loadSettings(file).launchAtLogin).toBe(false);
});
