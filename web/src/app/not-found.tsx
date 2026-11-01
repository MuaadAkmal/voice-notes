import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-24 sm:px-6">
        <h1 className="text-4xl font-semibold sm:text-5xl">This page doesn&apos;t exist</h1>
        <p className="mt-4 text-muted-foreground">The link may be old or mistyped.</p>
        <Link href="/" className="mt-8 inline-block font-medium underline underline-offset-4">
          Go to the home page
        </Link>
      </main>
      <Footer />
    </>
  );
}
