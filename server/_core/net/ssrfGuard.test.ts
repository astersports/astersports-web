/**
 * M7 SSRF-guard tests — private-range classification + URL gate.
 * Uses literal-IP and IP-host URLs so no DNS resolution is needed.
 */
import { describe, it, expect } from "vitest";
import { assertSafeFetchUrl, BlockedUrlError, isPrivateAddress } from "./ssrfGuard";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.0.1", "172.31.255.255",
    "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fd00::1", "fe80::1",
  ])("flags private/loopback/link-local %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"])(
    "allows public %s",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe("assertSafeFetchUrl", () => {
  it("rejects non-http(s) schemes", async () => {
    await expect(assertSafeFetchUrl("file:///etc/passwd")).rejects.toThrow(BlockedUrlError);
    await expect(assertSafeFetchUrl("ftp://example.com/x")).rejects.toThrow(BlockedUrlError);
  });

  it("rejects a private literal IP host", async () => {
    await expect(assertSafeFetchUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(BlockedUrlError);
    await expect(assertSafeFetchUrl("http://127.0.0.1:8080/")).rejects.toThrow(BlockedUrlError);
  });

  it("allows a public literal IP host", async () => {
    await expect(assertSafeFetchUrl("https://8.8.8.8/")).resolves.toBeUndefined();
  });

  it("rejects an unparseable URL", async () => {
    await expect(assertSafeFetchUrl("not a url")).rejects.toThrow(BlockedUrlError);
  });
});
