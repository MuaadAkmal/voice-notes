// Confirms the installer every download button points at is really there.
import fs from "node:fs";

const site = fs.readFileSync(new URL("../src/lib/site.ts", import.meta.url), "utf8");
const url = site.match(/DOWNLOAD_URL = "([^"]+)"/)?.[1];
if (!url) {
  console.error("check-download: DOWNLOAD_URL not found in src/lib/site.ts");
  process.exit(1);
}

const res = await fetch(url, { method: "HEAD" });
console.log(`${res.status} ${url}`);
console.log(`${res.headers.get("content-type")}, ${res.headers.get("content-length")} bytes`);
if (!res.ok) process.exit(1);
