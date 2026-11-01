import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
});

const description =
  "Catch a line from whatever you're watching. Rewind your PC's audio, save the clip and read it back as text. Free for Windows.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Voice Notes: save the line you just heard", template: "%s | Voice Notes" },
  description,
  openGraph: {
    title: "Voice Notes: save the line you just heard",
    description,
    url: SITE_URL,
    siteName: "Voice Notes",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} ${instrument.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
