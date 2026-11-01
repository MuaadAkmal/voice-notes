/* eslint-disable @next/next/no-img-element -- static export, so there is nothing for next/image to optimise */

/** Set this to the video's R2 address when it's ready. */
const VIDEO_URL: string | null = null;

const frame = "w-full rounded-xl border border-border shadow-sm";

export function HeroMedia() {
  if (VIDEO_URL) {
    return <video src={VIDEO_URL} poster="/hero.png" controls preload="none" className={frame} aria-label="How Voice Notes works" />;
  }
  return (
    <img
      src="/hero.png"
      width={1600}
      height={1002}
      className={frame}
      alt="The Voice Notes Inbox showing three saved Spanish lines from a show, each with a play button, its episode and its transcript."
    />
  );
}
