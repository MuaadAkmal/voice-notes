"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { DownloadButton } from "../DownloadButton";
import { HeroMedia } from "../HeroMedia";
import { SoundRibbons } from "../SoundRibbons";
import { HeroFeatures } from "./HeroFeatures";

const EASE = [0.22, 1, 0.36, 1] as const;
const WORDS = "The best way to learn is to teach.".split(" ");
/** Seconds between words coming into focus, and when the last one has (the rest of the hero follows). */
const WORD_STEP = 0.11;
const HEADLINE_DONE = 0.1 + WORDS.length * WORD_STEP;

export function Hero() {
  const reduce = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "start 25%"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [reduce ? 0 : 12, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0.95, 1]);

  const enter = (delay: number) => (reduce ? { duration: 0 } : { duration: 0.8, delay, ease: EASE });

  return (
    <section className="relative isolate mx-auto w-full max-w-5xl px-4 pt-16 pb-14 sm:px-6 sm:pt-24">
      <SoundRibbons className="absolute top-8 left-1/2 -z-10 h-[30rem] w-screen -translate-x-1/2" />
      <div className="text-center">
        <h1 className="text-5xl leading-[1.04] font-semibold sm:text-7xl lg:text-[5.5rem]">
          {WORDS.map((word, i) => {
            const last = i === WORDS.length - 1;
            return (
              <motion.span
                key={`${i}-${word}`}
                className={`mr-[0.24em] inline-block last:mr-0 ${last ? "relative" : ""}`}
                initial={{ opacity: 0, y: "0.35em", filter: "blur(12px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={reduce ? { duration: 0 } : { duration: 0.9, delay: 0.1 + i * WORD_STEP, ease: EASE }}
              >
                {last && (
                  // A highlighter swiped behind the last word once the sentence has landed.
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-x-[-0.08em] bottom-[0.08em] -z-10 h-[0.42em] origin-left rounded-[0.12em] bg-accent/25"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={reduce ? { duration: 0 } : { duration: 0.7, delay: HEADLINE_DONE + 0.5, ease: EASE }}
                  />
                )}
                {word}
              </motion.span>
            );
          })}
        </h1>
        <motion.p
          className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={enter(HEADLINE_DONE)}
        >
          So teach it, out loud. Hold Alt+Win and explain what you just learned in your own words. Voice Notes keeps the recording, turns it into text and syncs it to your devices, so you can come back to it.
        </motion.p>
        <motion.div className="mt-8" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={enter(HEADLINE_DONE + 0.12)}>
          <DownloadButton />
        </motion.div>
        <motion.div className="mt-10" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={enter(HEADLINE_DONE + 0.24)}>
          <HeroFeatures />
        </motion.div>
      </div>

      <div ref={stage} className="relative mt-10 [perspective:1400px] sm:mt-12">
        <motion.div
          className="glass rounded-3xl p-2 sm:p-3"
          style={{ rotateX, scale, transformOrigin: "50% 100%" }}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={enter(HEADLINE_DONE + 0.36)}
        >
          <HeroMedia />
        </motion.div>

        <motion.div
          className="absolute -right-3 -bottom-6 hidden lg:block"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={enter(HEADLINE_DONE + 0.8)}
          aria-hidden="true"
        >
          <div className="glass drift rounded-2xl px-5 py-4 [animation-delay:-3s]">
            <p className="text-sm text-muted-foreground">Voice note · 0:48 · transcribed</p>
            <p className="mt-1 font-medium">&ldquo;So compound interest is interest on the interest…&rdquo;</p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
