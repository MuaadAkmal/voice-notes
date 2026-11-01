import { DownloadButton } from "../DownloadButton";

export function FinalDownload() {
  return (
    <section id="download" className="mx-auto w-full max-w-6xl px-4 pt-8 pb-20 sm:px-6">
      <h2 className="text-3xl font-semibold sm:text-4xl">Catch your next line</h2>
      <p className="mt-3 text-lg text-muted-foreground">Voice Notes runs on 64-bit Windows.</p>
      <div className="mt-7">
        <DownloadButton />
      </div>
      <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Windows may show a SmartScreen warning when you open the installer, because it isn&apos;t code-signed yet. To continue, click More info,
        then Run anyway.
      </p>
    </section>
  );
}
