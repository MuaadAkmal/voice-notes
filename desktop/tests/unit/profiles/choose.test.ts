import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { chooseStart } from '../../../src/main/profiles/choose';
import { profileDir, profilesDir, UNCLAIMED } from '../../../src/main/profiles/paths';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-profiles-'));
});

it('no session: sign-in, and nothing is created', () => {
  expect(chooseStart(root, null)).toEqual({ mode: 'signin' });
  expect(fs.existsSync(profilesDir(root))).toBe(false);
});

it('a new user gets an empty profile folder', () => {
  expect(chooseStart(root, 'a')).toEqual({ mode: 'profile', userId: 'a', dir: profileDir(root, 'a') });
  expect(fs.readdirSync(profileDir(root, 'a'))).toEqual([]);
});

it('unclaimed is adopted once', () => {
  fs.mkdirSync(profileDir(root, UNCLAIMED), { recursive: true });
  fs.writeFileSync(path.join(profileDir(root, UNCLAIMED), 'x.txt'), 'hi');
  chooseStart(root, 'a');
  expect(fs.readFileSync(path.join(profileDir(root, 'a'), 'x.txt'), 'utf8')).toBe('hi');
  expect(fs.existsSync(profileDir(root, UNCLAIMED))).toBe(false);
  chooseStart(root, 'b');
  expect(fs.readdirSync(profileDir(root, 'b'))).toEqual([]);
});

it('an existing profile is never replaced by unclaimed', () => {
  fs.mkdirSync(profileDir(root, 'a'), { recursive: true });
  fs.writeFileSync(path.join(profileDir(root, 'a'), 'mine.txt'), 'a');
  fs.mkdirSync(profileDir(root, UNCLAIMED), { recursive: true });
  fs.writeFileSync(path.join(profileDir(root, UNCLAIMED), 'x.txt'), 'hi');
  chooseStart(root, 'a');
  expect(fs.readdirSync(profileDir(root, 'a'))).toEqual(['mine.txt']);
  expect(fs.readdirSync(profileDir(root, UNCLAIMED))).toEqual(['x.txt']);
});

it('the profile folder sits under profiles/', () => {
  expect(profileDir(root, 'a')).toBe(path.join(root, 'profiles', 'a'));
});
