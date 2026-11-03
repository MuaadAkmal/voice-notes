/* eslint-disable @next/next/no-img-element -- static export, so there is nothing for next/image to optimise */

/** Set this to the video's R2 address when it's ready. */
const VIDEO_URL: string | null = null;

const frame = "block w-full rounded-2xl";

export function HeroMedia() {
  if (VIDEO_URL) {
    return <video src={VIDEO_URL} poster="/hero.png" controls preload="none" className={frame} aria-label="How Voice Notes works" />;
  }
  const alt = "The Voice Notes Inbox showing three saved Spanish lines from a show, each with a play button, its episode and its transcript.";
  return (
    <>
      <img src="/hero.png" width={1600} height={1002} className={`${frame} dark:hidden`} alt={alt} />
      <img src="/hero-dark.png" width={1600} height={1002} className="hidden w-full rounded-2xl dark:block" alt={alt} loading="lazy" />
    </>
  );
}
