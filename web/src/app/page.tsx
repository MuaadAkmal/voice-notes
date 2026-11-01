import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { EverydayCapture } from "@/components/home/EverydayCapture";
import { FinalDownload } from "@/components/home/FinalDownload";
import { Hero } from "@/components/home/Hero";
import { HowItWorks } from "@/components/home/HowItWorks";
import { Transcription } from "@/components/home/Transcription";
import { YourNotes } from "@/components/home/YourNotes";

export default function Home() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <EverydayCapture />
        <YourNotes />
        <Transcription />
        <FinalDownload />
      </main>
      <Footer />
    </>
  );
}
