import { z } from 'zod';
import { MAX_BATCH, REWIND_SECONDS, type Settings } from './channels';

import { IMAGE_EXTS, MAX_IMAGE_BYTES } from './page-images';

export * from './channels';

const SourceSchema = z.enum(['mic', 'system', 'both']);

export const SettingsFieldSchemas = {
  hotkey: z.array(z.number().int().nonnegative()).min(1).max(4),
  hotkeyLabel: z.string().min(1).max(60),
  micDeviceId: z.string().max(512).nullable(),
  launchAtLogin: z.boolean(),
  showIdlePill: z.boolean(),
  hotkeyPaused: z.boolean(),
  theme: z.enum(['system', 'light', 'dark']),
  recordingSource: SourceSchema,
  pillPosition: z.object({ displayId: z.number().int(), x: z.number().int(), y: z.number().int() }).nullable(),
  filmMode: z.boolean(),
  rewindSeconds: z.union(REWIND_SECONDS.map((n) => z.literal(n))),
  autoPause: z.boolean(),
} satisfies { [K in keyof Settings]: z.ZodType<Settings[K]> };

export const SettingsPatchSchema = z.object(SettingsFieldSchemas).partial().strict();

export const AudioPayloadSchema = z.object({
  bytes: z.instanceof(Uint8Array),
  durationMs: z.number().nonnegative().finite(),
  mimeType: z.string().min(1).max(100),
  source: SourceSchema,
});

export const IdSchema = z.uuid();
export const RenameSchema = z.object({ id: IdSchema, title: z.string().trim().min(1).max(200) });
export const PointerSchema = z.object({ over: z.boolean() });
export const OverlayTitleSchema = z.object({ noteId: z.uuid(), title: z.string().trim().min(1).max(200) });
export const DragSchema = z.object({ dx: z.number().int().min(-2000).max(2000), dy: z.number().int().min(-2000).max(2000) });
export const ErrorSchema = z.object({ message: z.string().max(200) });
export const DevicesSchema = z
  .array(z.object({ deviceId: z.string().max(512), label: z.string().max(300) }))
  .max(64);

// Folder names are validated by FolderStore so its exact messages reach the UI; zod only bounds shape.
const FolderNameSchema = z.string().max(200);
const ParentSchema = IdSchema.nullable();
export const CreateFolderSchema = z.object({ name: FolderNameSchema, parentId: ParentSchema });
export const RenameFolderSchema = z.object({ id: IdSchema, name: FolderNameSchema });
export const MoveFolderSchema = z.object({ id: IdSchema, parentId: ParentSchema });
export const IdListSchema = z.array(IdSchema).min(1).max(MAX_BATCH);
export const MoveNotesSchema = z.object({ ids: IdListSchema, folderId: ParentSchema });
export const StarNotesSchema = z.object({ ids: IdListSchema, starred: z.boolean() });
// Blank clears the label.
export const SetShowSchema = z.object({
  id: IdSchema,
  show: z.string().trim().max(120).nullable().transform((s) => s || null),
});

export const CreatePageSchema = z.object({ folderId: IdSchema.nullable() });
export const SetBodySchema = z.object({ id: IdSchema, body: z.string().max(5 * 1024 * 1024) });
export const SaveImageSchema = z.object({
  bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength <= MAX_IMAGE_BYTES, 'Image too large'),
  ext: z.enum(IMAGE_EXTS),
});
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
export const ExternalUrlSchema = z.string().max(4096).refine((s) => {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(s).protocol);
  } catch {
    return false;
  }
}, 'Unsupported link');
export const ProbeResultSchema = z.object({ id: z.number().int().nonnegative(), playing: z.boolean() });
