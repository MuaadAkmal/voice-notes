import { DOWNLOAD_URL } from "@/lib/site";

/** A plain link, so the download works without JavaScript. */
export function DownloadButton() {
  return (
    <div>
      <a href={DOWNLOAD_URL} className="btn-primary inline-block rounded-full px-7 py-3.5 font-medium">
        Download for Windows
      </a>
      <p className="mt-3 text-sm text-muted-foreground lg:hidden">For Windows PCs</p>
    </div>
  );
}
