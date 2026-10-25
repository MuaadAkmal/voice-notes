import { describe, expect, it } from 'vitest';
import { checkImageFile } from '../../src/renderer/dashboard/editor/image-input';
import { MAX_IMAGE_BYTES } from '../../src/shared/page-images';

describe('checkImageFile', () => {
  it('maps supported image mime types to an extension', () => {
    expect(checkImageFile({ type: 'image/png', size: 10 })).toEqual({
      ext: 'png',
    });
    expect(checkImageFile({ type: 'image/jpeg', size: 10 })).toEqual({
      ext: 'jpeg',
    });
    expect(checkImageFile({ type: 'image/gif', size: 10 })).toEqual({
      ext: 'gif',
    });
    expect(
      checkImageFile({ type: 'image/webp', size: MAX_IMAGE_BYTES }),
    ).toEqual({ ext: 'webp' });
  });

  it('rejects other types and oversized files', () => {
    expect(checkImageFile({ type: 'image/bmp', size: 10 })).toEqual({
      error: 'Unsupported image type',
    });
    expect(checkImageFile({ type: 'text/plain', size: 10 })).toEqual({
      error: 'Unsupported image type',
    });
    expect(checkImageFile({ type: '', size: 10 })).toEqual({
      error: 'Unsupported image type',
    });
    expect(
      checkImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 }),
    ).toEqual({
      error: 'Image too large (max 20 MB)',
    });
  });
});
