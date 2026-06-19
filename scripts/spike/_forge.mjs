// Shared Forge helpers for the spike scripts. Self-contained (no project imports).
// NOTE: authored but not run against the live API here — verify on first run.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const FORGE = (process.env.BUILT_IN_FORGE_API_URL || "").replace(/\/+$/, "");
const KEY = process.env.BUILT_IN_FORGE_API_KEY || "";

export function requireEnv() {
  if (!FORGE || !KEY) {
    console.error("Set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY.");
    process.exit(1);
  }
}

export const OUT_DIR = path.resolve("scripts/spike/out");
export async function ensureOut() {
  await mkdir(OUT_DIR, { recursive: true });
}

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
export async function fileToImage(p) {
  const buf = await readFile(p);
  const mimeType = MIME[path.extname(p).toLowerCase()] || "image/jpeg";
  return { b64Json: buf.toString("base64"), mimeType };
}

/** POST images.v1.ImageService/GenerateImage. Pass `extra` to add fields (e.g. {seed}). */
export async function generateImage({ prompt, originalImages = [], extra = {} }) {
  const url = new URL("images.v1.ImageService/GenerateImage", FORGE + "/").toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({ prompt, original_images: originalImages, ...extra }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, ok: res.ok, json, text };
}

/** POST /v1/chat/completions (vision). */
export async function chat({ messages, response_format }) {
  const url = `${FORGE}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ messages, ...(response_format ? { response_format } : {}) }),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, ok: res.ok, json, text };
}

export async function saveResultImage(json, name) {
  const b64 = json?.image?.b64Json;
  if (!b64) return null;
  await ensureOut();
  const out = path.join(OUT_DIR, name);
  await writeFile(out, Buffer.from(b64, "base64"));
  return out;
}
