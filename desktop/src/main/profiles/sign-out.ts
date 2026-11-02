const FLUSH_MS = 10_000;

/**
 * Before signing out: give this PC's waiting changes up to 10 s to upload, then count what is still waiting
 * (rows and files). A failed or slow flush still counts; nothing is lost either way, it stays in the profile.
 */
export async function pendingBeforeSignOut(d: { flush(): Promise<unknown>; pending(): number }): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, FLUSH_MS)));
  await Promise.race([d.flush().catch(() => undefined), timeout]);
  clearTimeout(timer);
  return d.pending();
}
