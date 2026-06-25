#!/usr/bin/env node
/**
 * Re-materialize the Cinq à Sept + LIKELY eval image set from the committed
 * manifest. Image binaries are intentionally gitignored (eval/.gitignore keeps
 * *.jpg/*.png/*.webp out of the repo), so the DURABLE artifact is manifest.json +
 * this script: it rebuilds the exact same set from the recorded source URLs.
 *
 * Run from repo root:  node eval/samples/cinqasept-likely/fetch.mjs
 * Requires outbound access to cdn.shopify.com (see strategy doc §8).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const manifest = JSON.parse(await readFile(resolve(here, "manifest.json"), "utf8"));

let ok = 0;
for (const item of manifest) {
  const dest = resolve(repoRoot, item.image);
  try {
    const res = await fetch(item.sourceImageUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error(`suspiciously small (${buf.length} bytes)`);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    ok++;
    console.log(`  ✓ ${item.id} (${buf.length} bytes)`);
  } catch (err) {
    console.error(`  ✗ ${item.id} — ${err.message}\n      ${item.sourceImageUrl}`);
  }
}
console.log(`\n${ok}/${manifest.length} images fetched into eval/samples/cinqasept-likely/`);
if (ok < manifest.length) process.exitCode = 1;
