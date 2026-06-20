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

/**
 * Expand any IPv6 textual form (compressed `::`, embedded dotted IPv4, mixed
 * hex) into its 8 canonical 16-bit groups. Returns null when the literal is
 * not parseable as IPv6 — callers treat null as unsafe.
 */
function expandV6(input: string): number[] | null {
  let addr = input;

  // Embedded IPv4 in the final 32 bits (e.g. ::ffff:1.2.3.4, 64:ff9b::1.2.3.4).
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    const parts = tail.split(".").map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((parts[0] << 8) | parts[1]).toString(16);
    const lo = ((parts[2] << 8) | parts[3]).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const back = halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - back.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill("0"), ...back];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (g === "" ? NaN : parseInt(g, 16)));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

function isPrivateV6(addr: string): boolean {
  const g = expandV6(addr);
  if (!g) return true; // unparseable literal — fail closed
  const embeddedV4 = () => `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
  if (g.every((x) => x === 0)) return true; // :: unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1 loopback
  // IPv4-mapped ::ffff:0:0/96 and deprecated IPv4-compatible ::/96 — check the v4.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPrivateV4(embeddedV4());
  // NAT64 well-known prefix 64:ff9b::/96 — the embedded v4 is the real target.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(embeddedV4());
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
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

  // Numeric/hex hosts that are NOT valid dotted IPs (decimal `2130706433`,
  // octal `0177.0.0.1`, hex `0x7f.1`) are IPv4 obfuscation. getaddrinfo may
  // resolve them to a private address inconsistently across platforms, so
  // reject them outright rather than trusting the later resolution.
  if (/^(0x[0-9a-f]+|[0-9]+)$/i.test(host) || /(^|\.)0x[0-9a-f]+(\.|$)/i.test(host) || /(^|\.)0\d+(\.|$)/.test(host)) {
    throw new BlockedUrlError(`numeric host ${host}`);
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
