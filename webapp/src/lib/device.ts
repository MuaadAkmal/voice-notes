/** The name this browser syncs as; conflict copies are titled after it. */
export function deviceName(ua: string): string {
  const browser = /SamsungBrowser\//.test(ua)
    ? "Samsung Internet"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  return `Web · ${browser}`;
}
