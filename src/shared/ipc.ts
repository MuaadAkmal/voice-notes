import { z } from 'zod';
import { MAX_BATCH, REWIND_SECONDS, type Settings } from './channels';

import { MAX_HOME_WIDGETS, MAX_SPAN } from './home-widgets';
import { MAX_DROP_FIELD } from './later';
import { IMAGE_EXTS, MAX_IMAGE_BYTES } from './page-images';
import { LANGUAGE_CODES, normaliseBaseUrl } from './transcription';

export * from './channels';

const SourceSchema = z.enum(['mic', 'system', 'both']);

const Span = z.number().int().min(1).max(MAX_SPAN).optional();
const HomeWidgetSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.uuid(),
    type: z.literal('quick-add'),
    pageId: z.uuid(),
    label: z.string().trim().min(1).max(60),
    w: Span,
    h: Span,
  }),
  z.object({ id: z.uuid(), type: z.literal('page'), pageId: z.uuid(), w: Span, h: Span, locked: z.literal(true).optional() }),
]);

const TranscriptionSchema = z
  .object({
    provider: z.literal('server').nullable(),
    // Stored already normalised; anything else is a hand-edited file.
    baseUrl: z
      .string()
      .max(2048)
      .refine((s) => s === '' || normaliseBaseUrl(s) === s),
    model: z.string().trim().min(1).max(200),
  })
  .refine((t) => t.provider === null || t.baseUrl !== '');

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
  homeWidgets: z.array(HomeWidgetSchema).max(MAX_HOME_WIDGETS + 1), // + the locked Review later card
  transcription: TranscriptionSchema,
  transcribeLanguage: z.enum(LANGUAGE_CODES),
  laterPageId: z.uuid().nullable(),
  dictationHotkey: z.array(z.number().int().nonnegative()).min(1).max(4),
  dictationHotkeyLabel: z.string().min(1).max(60),
  dictationSound: z.boolean(),
} satisfies { [K in keyof Settings]: z.ZodType<Settings[K]> };

export const SettingsPatchSchema = z.object(SettingsFieldSchemas).partial().strict();

export const AudioPayloadSchema = z.object({
  bytes: z.instanceof(Uint8Array),
  durationMs: z.number().nonnegative().finite(),
  mimeType: z.string().min(1).max(100),
  source: SourceSchema,
});

export const IdSchema = z.uuid();
// About 1.9 MB of WAV per minute: 30 MB is a long dictation.
export const DictationAudioSchema = z.object({
  bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength <= 30 * 1024 * 1024, 'Audio too large'),
  durationMs: z.number().nonnegative().finite(),
});
export const CopyDictationSchema = z.object({ id: IdSchema });
export const RenameSchema = z.object({ id: IdSchema, title: z.string().trim().min(1).max(200) });
export const PointerSchema = z.object({ over: z.boolean() });
export const OverlayTitleSchema = z.object({ noteId: z.uuid(), title: z.string().trim().min(1).max(200) });
export const DragSchema = z.object({ dx: z.number().int().min(-2000).max(2000), dy: z.number().int().min(-2000).max(2000) });
export const ErrorSchema = z.object({ message: z.string().max(200) });
// A long styled selection's HTML can be huge: keep the start rather than refuse the drop.
const DropField = z.string().max(5_000_000).transform((s) => s.slice(0, MAX_DROP_FIELD));
export const DropPayloadSchema = z.object({ text: DropField, uriList: DropField, html: DropField });
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
export const AppendEntrySchema = z.object({ id: IdSchema, text: z.string().trim().min(1).max(500) });
export const SetTaskSchema = z.object({ id: IdSchema, line: z.number().int().min(0), checked: z.boolean() });
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
export const TranscriptionEnqueueSchema = z.object({
  ids: IdListSchema,
  language: z.enum(LANGUAGE_CODES),
});
export const TranscriptionTestSchema = z.object({
  baseUrl: z
    .string()
    .max(2048)
    .refine((s) => normaliseBaseUrl(s) !== null, 'Invalid URL'),
  model: z.string().trim().min(1).max(200),
});
export const SetKeySchema = z.object({ key: z.string().trim().min(1).max(500) });
export const SetTranscriptSchema = z.object({
  id: IdSchema,
  text: z.string().max(100_000),
});
// Generous: about 1.9 MB of WAV per minute of audio.
const MAX_WAV_BYTES = 1024 * 1024 * 1024;
export const WavReplySchema = z.union([
  z.object({
    requestId: z.number().int().positive(),
    bytes: z
      .instanceof(Uint8Array)
      .refine((b) => b.byteLength <= MAX_WAV_BYTES, 'Audio too large'),
  }),
  z.object({
    requestId: z.number().int().positive(),
    error: z.string().max(200),
  }),
]);
export const ProbeResultSchema = z.object({ id: z.number().int().nonnegative(), playing: z.boolean() });
