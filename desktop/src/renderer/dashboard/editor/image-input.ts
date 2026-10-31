import {
  IMAGE_EXTS,
  MAX_IMAGE_BYTES,
  type ImageExt,
} from '../../../shared/page-images';

/** Whether a pasted/dropped file can become a page image: its extension, or the toast message. */
export function checkImageFile(file: {
  type: string;
  size: number;
}): { ext: ImageExt } | { error: string } {
  const ext = file.type.startsWith('image/')
    ? file.type.slice('image/'.length)
    : '';
  if (!(IMAGE_EXTS as readonly string[]).includes(ext))
    return { error: 'Unsupported image type' };
  if (file.size > MAX_IMAGE_BYTES)
    return { error: 'Image too large (max 20 MB)' };
  return { ext: ext as ImageExt };
}
