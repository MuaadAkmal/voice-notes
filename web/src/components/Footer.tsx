import Link from "next/link";
import { CONTACT_EMAIL, WEB_APP_URL } from "@/lib/site";

export function Footer() {
  return (
    <footer className="mt-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-8 text-sm text-muted-foreground sm:px-6">
        <p>Voice Notes for Windows</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          <a href={WEB_APP_URL} className="transition-colors hover:text-foreground">
            Web app
          </a>
          <Link href="/#pricing" className="transition-colors hover:text-foreground">
            Pricing
          </Link>
          <Link href="/releases" className="transition-colors hover:text-foreground">
            What&apos;s new
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-foreground">
            Terms
          </Link>
          <Link href="/refund" className="transition-colors hover:text-foreground">
            Refunds
          </Link>
          <Link href="/contact" className="transition-colors hover:text-foreground">
            Contact
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="transition-colors hover:text-foreground">
            {CONTACT_EMAIL}
          </a>
        </nav>
      </div>
    </footer>
  );
}
