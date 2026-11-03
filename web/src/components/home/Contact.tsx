import { CONTACT_EMAIL } from "@/lib/site";
import { Reveal } from "../Reveal";

export function Contact() {
  return (
    <section id="contact" className="mx-auto w-full max-w-5xl scroll-mt-24 px-4 pt-6 pb-16 text-center sm:px-6">
      <Reveal>
        <h2 className="text-3xl font-semibold sm:text-5xl">Get in touch</h2>
        <p className="mt-4 text-lg text-muted-foreground">Found a bug, or have an idea? Send us an email.</p>
        <a href={`mailto:${CONTACT_EMAIL}`} className="btn-primary mt-8 inline-block rounded-full px-7 py-3.5 font-medium">
          {CONTACT_EMAIL}
        </a>
      </Reveal>
    </section>
  );
}
