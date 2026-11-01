import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/site";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
        <p>Voice Notes for Windows</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/privacy" className="underline-offset-4 hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="underline-offset-4 hover:underline">
            Terms
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline-offset-4 hover:underline">
            {CONTACT_EMAIL}
          </a>
        </nav>
      </div>
    </footer>
  );
}
