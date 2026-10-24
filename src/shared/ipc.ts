import { z } from 'zod';
import type { Settings } from './channels';

export * from './channels';

export const SettingsFieldSchemas = {
  hotkey: z.array(z.number().int().nonnegative()).min(1).max(4),
  hotkeyLabel: z.string().min(1).max(60),
  micDeviceId: z.string().max(512).nullable(),
  launchAtLogin: z.boolean(),
  showIdlePill: z.boolean(),
  hotkeyPaused: z.boolean(),
} satisfies { [K in keyof Settings]: z.ZodType<Settings[K]> };

export const SettingsPatchSchema = z.object(SettingsFieldSchemas).partial().strict();

export const AudioPayloadSchema = z.object({
  bytes: z.instanceof(Uint8Array),
  durationMs: z.number().nonnegative().finite(),
  mimeType: z.string().min(1).max(100),
});

export const IdSchema = z.uuid();
export const RenameSchema = z.object({ id: IdSchema, title: z.string().trim().min(1).max(200) });
export const PointerSchema = z.object({ over: z.boolean() });
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
export const IdListSchema = z.array(IdSchema).min(1).max(500);
export const MoveNotesSchema = z.object({ ids: IdListSchema, folderId: ParentSchema });
