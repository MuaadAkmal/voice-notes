import Link from "next/link";
import { DOWNLOAD_URL, WEB_APP_URL } from "@/lib/site";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  return (
    <header className="sticky top-3 z-50 mx-auto w-full max-w-5xl px-3 sm:top-4 sm:px-6">
      <div className="glass flex items-center justify-between rounded-full py-2 pr-2 pl-5">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <Logo className="h-4.5 w-auto" />
          Voice Notes
        </Link>
        <div className="flex items-center gap-1.5">
          <nav aria-label="Main" className="mr-2 hidden items-center gap-5 text-sm font-medium text-muted-foreground sm:flex">
            <Link href="/#pricing" className="transition-colors hover:text-foreground">
              Pricing
            </Link>
            <Link href="/#contact" className="transition-colors hover:text-foreground">
              Contact
            </Link>
          </nav>
          <a href={WEB_APP_URL} className="mr-1 rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Sign in
          </a>
          <ThemeToggle />
          <a href={DOWNLOAD_URL} className="btn-primary rounded-full px-4 py-2 text-sm font-medium">
            Download
          </a>
        </div>
      </div>
    </header>
  );
}
