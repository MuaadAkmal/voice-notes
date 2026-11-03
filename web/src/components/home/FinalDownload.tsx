import { DownloadButton } from "../DownloadButton";
import { Reveal } from "../Reveal";
import { SoundRibbons } from "../SoundRibbons";

export function FinalDownload() {
  return (
    <section id="download" className="mx-auto w-full max-w-5xl px-4 pt-14 pb-16 sm:px-6">
      <Reveal>
        <div className="glass relative isolate overflow-hidden rounded-[2rem] px-6 py-16 text-center sm:py-20">
          <SoundRibbons className="absolute inset-0 -z-10 size-full opacity-60" />
          <h2 className="mx-auto max-w-3xl text-3xl font-semibold sm:text-5xl">Record what moves you. Save what intrigues you. Come back when you&apos;re ready.</h2>
          <p className="mt-4 text-lg text-muted-foreground">Voice Notes runs on 64-bit Windows.</p>
          <div className="mt-8">
            <DownloadButton />
          </div>
          <p className="mx-auto mt-8 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Windows may show a SmartScreen warning when you open the installer, because it isn&apos;t code-signed yet. To continue, click More info,
            then Run anyway.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
