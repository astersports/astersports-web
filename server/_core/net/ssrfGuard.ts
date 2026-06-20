/**
 * M7 — SSRF guard for server-side image fetches.
 *
 * The deterministic pipeline downloads source/result images server-side
 * (decodeUpright, aiEngine.downloadImageAsBase64). If a fetched URL's host
 * resolves to a private/loopback/link-local address, the server can be coerced
 * into reaching internal services or the cloud metadata endpoint
 * (169.254.169.254). This guard:
 *   - allows only http/https,
 *   - resolves the host and rejects any non-public address.
 *
 * Residual TOCTOU: DNS can rebind between this check and the actual connect.
 * For the current threat model (URLs are internal storage URLs, not arbitrary
 * user input) this resolve-and-validate step is the proportionate mitigation;
 * pinning the resolved IP into the connection is a future hardening step.
 */
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export class BlockedUrlError extends Error {
  constructor(reason: string) {
    super(`blocked URL: ${reason}`);
    this.name = "BlockedUrlError";
  }
}

/** True for IPv4/IPv6 addresses that must never be reachable from a fetch. */
export function isPrivateAddress(addr: string): boolean {
  const v = isIP(addr);
  if (v === 4) return isPrivateV4(addr);
  if (v === 6) return isPrivateV6(addr.toLowerCase());
  // Not a literal IP — caller resolves the host first.
  return false;
}

function isPrivateV4(addr: string): boolean {
  const p = addr.split(".").map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 192 && b === 0 && p[2] === 0) return true; // 192.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmark
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateV6(addr: string): boolean {
  if (addr === "::" || addr === "::1") return true; // unspecified, loopback
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  if (addr.startsWith("fe8") || addr.startsWith("fe9") || addr.startsWith("fea") || addr.startsWith("feb"))
    return true; // fe80::/10 link-local
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // fc00::/7 unique-local
  return false;
}

/**
 * Throws BlockedUrlError if `url` is not a public http(s) destination.
 * Resolves the hostname; every resolved address must be public.
 */
export async function assertSafeFetchUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BlockedUrlError("unparseable");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BlockedUrlError(`scheme ${parsed.protocol}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  // Literal IP in the URL — check directly, no DNS.
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new BlockedUrlError(`private literal ${host}`);
    return;
  }

  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError(`DNS lookup failed for ${host}`);
  }
  if (addrs.length === 0) throw new BlockedUrlError(`no address for ${host}`);
  for (const { address } of addrs) {
    if (isPrivateAddress(address)) throw new BlockedUrlError(`${host} resolves to private ${address}`);
  }
}
