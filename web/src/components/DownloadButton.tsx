import { DOWNLOAD_URL } from "@/lib/site";

/** A plain link, so the download works without JavaScript. */
export function DownloadButton() {
  return (
    <div>
      <a
        href={DOWNLOAD_URL}
        className="inline-block rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground transition-opacity hover:opacity-85"
      >
        Download for Windows
      </a>
      <p className="mt-2 text-sm text-muted-foreground lg:hidden">For Windows PCs</p>
    </div>
  );
}
