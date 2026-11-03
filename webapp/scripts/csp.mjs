// After `next build`: Next's static pages carry inline <script> tags, so the CSP allows exactly those
// by hash. Fills {{SCRIPT_HASHES}} in out/_headers; a page added later gets its hash on the next build.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "out";
const hashes = new Set();

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".html")) {
      for (const m of readFileSync(path, "utf8").matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
        if (m[1]) hashes.add(`'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
      }
    }
  }
}

walk(OUT);
const headers = join(OUT, "_headers");
writeFileSync(headers, readFileSync(headers, "utf8").replace("{{SCRIPT_HASHES}}", [...hashes].sort().join(" ")));
console.log(`csp: ${hashes.size} inline script hash(es) written to ${headers}`);
