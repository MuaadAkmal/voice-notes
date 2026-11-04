import type { Settings } from '../../shared/channels';
import { Switch } from '@/components/ui/switch';
import { Row } from './SettingsPage';

/** What happens to a note once it's recorded: transcribed by itself, and given a title. */
export function NewNotesCard({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold">New notes</h2>
      <div className="divide-y divide-border rounded-2xl border bg-card">
        <Row title="Transcribe new notes" hint="Every note you record on this PC is transcribed as soon as it's saved.">
          <Switch aria-label="Transcribe new notes" checked={settings.autoTranscribe} onCheckedChange={(v) => onChange({ autoTranscribe: v })} />
        </Row>
        <Row title="Give them a title" hint="Titles are written by AI from the transcript, so the transcript is sent to our server for that.">
          <Switch aria-label="Give them a title" checked={settings.autoTitle} onCheckedChange={(v) => onChange({ autoTitle: v })} />
        </Row>
      </div>
    </section>
  );
}
