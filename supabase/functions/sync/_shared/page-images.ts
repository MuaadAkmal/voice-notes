export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;
export type ImageExt = (typeof IMAGE_EXTS)[number];
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const IMAGE_FILE_RE = /^[0-9a-f-]{36}\.(png|jpe?g|gif|webp)$/;

const REF_RE = /vn-image:\/\/([0-9a-f-]{36}\.(?:png|jpe?g|gif|webp))/g;

/** File names (`<uuid>.png`) of the images a page body references. */
export function imageRefs(body: string): Set<string> {
  return new Set(Array.from(body.matchAll(REF_RE), (m) => m[1]));
}
