import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { PointerGlow } from "@/components/PointerGlow";
import { Contact } from "@/components/home/Contact";
import { DragToPill } from "@/components/home/DragToPill";
import { EverydayCapture } from "@/components/home/EverydayCapture";
import { FinalDownload } from "@/components/home/FinalDownload";
import { Hero } from "@/components/home/Hero";
import { HowItWorks } from "@/components/home/HowItWorks";
import { LineMarquee } from "@/components/home/LineMarquee";
import { Pricing } from "@/components/home/Pricing";
import { Quotes } from "@/components/home/Quotes";
import { Transcription } from "@/components/home/Transcription";
import { YourNotes } from "@/components/home/YourNotes";

export default function Home() {
  return (
    <>
      <Header />
      <PointerGlow />
      <main className="flex-1 overflow-x-clip">
        <Hero />
        <Quotes />
        <LineMarquee />
        <HowItWorks />
        <EverydayCapture />
        <DragToPill />
        <YourNotes />
        <Transcription />
        <Pricing />
        <FinalDownload />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
