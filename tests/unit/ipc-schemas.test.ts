import { describe, expect, it } from 'vitest';
import {
  AppendEntrySchema,
  CreatePageSchema,
  ExternalUrlSchema,
  SaveImageSchema,
  SetBodySchema,
  SetTaskSchema,
} from '../../src/shared/ipc';
import { MAX_IMAGE_BYTES } from '../../src/shared/page-images';

const id = '123e4567-e89b-42d3-a456-426614174000';

describe('page IPC schemas', () => {
  it('caps the page body at 5 MB', () => {
    const max = 5 * 1024 * 1024;
    expect(SetBodySchema.safeParse({ id, body: 'a'.repeat(max) }).success).toBe(
      true,
    );
    expect(
      SetBodySchema.safeParse({ id, body: 'a'.repeat(max + 1) }).success,
    ).toBe(false);
  });

  it('accepts only known image extensions up to 20 MB', () => {
    expect(
      SaveImageSchema.safeParse({ bytes: new Uint8Array(3), ext: 'png' })
        .success,
    ).toBe(true);
    expect(
      SaveImageSchema.safeParse({ bytes: new Uint8Array(3), ext: 'svg' })
        .success,
    ).toBe(false);
    expect(
      SaveImageSchema.safeParse({
        bytes: new Uint8Array(MAX_IMAGE_BYTES),
        ext: 'png',
      }).success,
    ).toBe(true);
    expect(
      SaveImageSchema.safeParse({
        bytes: new Uint8Array(MAX_IMAGE_BYTES + 1),
        ext: 'png',
      }).success,
    ).toBe(false);
  });

  it('allows only http, https and mailto external urls', () => {
    for (const ok of ['https://a.b', 'http://a.b/x?y=1', 'mailto:x@y.z'])
      expect(ExternalUrlSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of [
      'file:///C:/x',
      'javascript:alert(1)',
      'vn-image://x.png',
      'not a url',
    ])
      expect(ExternalUrlSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('appends a trimmed entry of 1 to 500 chars', () => {
    expect(AppendEntrySchema.parse({ id, text: '  hola  ' }).text).toBe('hola');
    expect(AppendEntrySchema.safeParse({ id, text: '' }).success).toBe(false);
    expect(AppendEntrySchema.safeParse({ id, text: '   ' }).success).toBe(false);
    expect(AppendEntrySchema.safeParse({ id, text: 'a'.repeat(500) }).success).toBe(true);
    expect(AppendEntrySchema.safeParse({ id, text: 'a'.repeat(501) }).success).toBe(false);
  });

  it('sets a task by a non-negative line index', () => {
    expect(SetTaskSchema.safeParse({ id, line: 0, checked: true }).success).toBe(true);
    expect(SetTaskSchema.safeParse({ id, line: -1, checked: true }).success).toBe(false);
    expect(SetTaskSchema.safeParse({ id, line: 1.5, checked: true }).success).toBe(false);
    expect(SetTaskSchema.safeParse({ id, line: 1, checked: 'yes' }).success).toBe(false);
  });

  it('creates a page in the inbox or a folder', () => {
    expect(CreatePageSchema.safeParse({ folderId: null }).success).toBe(true);
    expect(CreatePageSchema.safeParse({ folderId: id }).success).toBe(true);
    expect(CreatePageSchema.safeParse({ folderId: 'x' }).success).toBe(false);
  });
});
