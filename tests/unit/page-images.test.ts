import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { imageRefs } from '../../src/shared/page-images';

it('imageRefs collects vn-image file names', () => {
  const u1 = randomUUID();
  const u2 = randomUUID();
  const body = `![a](vn-image://${u1}.png) x ![](vn-image://${u2}.webp)`;
  expect(imageRefs(body)).toEqual(new Set([`${u1}.png`, `${u2}.webp`]));
});

it('imageRefs ignores other urls and malformed names', () => {
  expect(imageRefs('![](https://x/y.png)').size).toBe(0);
  expect(imageRefs('vn-image://not-a-uuid.png').size).toBe(0);
});
