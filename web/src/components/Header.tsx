import Link from "next/link";
import { DOWNLOAD_URL } from "@/lib/site";
import { Logo } from "./Logo";

export function Header() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
      <Link href="/" className="flex items-center gap-2.5 font-display text-lg font-semibold">
        <Logo className="h-5 w-auto" />
        Voice Notes
      </Link>
      <a href={DOWNLOAD_URL} className="text-sm font-medium underline-offset-4 hover:underline">
        Download
      </a>
    </header>
  );
}
