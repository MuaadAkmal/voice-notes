import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
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
    <html lang="en" className={`${geist.variable} h-full antialiased`} data-theme="light" suppressHydrationWarning>
      <head>
        {/* Before the first paint, so a saved dark choice doesn't flash light. */}
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem("theme")==="dark")document.documentElement.dataset.theme="dark"}catch{}` }} />
        {/* Motion starts things hidden and JavaScript reveals them, so without JavaScript show them at once. The toggle needs JavaScript too. */}
        <noscript>
          <style>{`[style*="opacity:0"]{opacity:1!important;transform:none!important;filter:none!important}.theme-toggle{display:none!important}`}</style>
        </noscript>
      </head>
      <body className="min-h-full flex flex-col">
        <div className="ambient" aria-hidden="true">
          <div className="sun-glow" />
          <div className="sun-rays" />
        </div>
        {children}
      </body>
    </html>
  );
}
