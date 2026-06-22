import { describe, it, expect } from "vitest";
import { cronSecretOk } from "./cronAuth";

const SECRET = "super-secret-cron-value-0123456789abcdef";

describe("cronSecretOk — shared-secret gate for /api/scheduled/*", () => {
  it("opens the gate when CRON_SECRET is unset (unit CI; the route's session check still applies)", () => {
    expect(cronSecretOk({}, undefined)).toBe(true);
    expect(cronSecretOk({ "x-cron-secret": "anything" }, undefined)).toBe(true);
    expect(cronSecretOk({}, "")).toBe(true);
  });

  it("accepts a matching x-cron-secret header (the custom header on the older crons)", () => {
    expect(cronSecretOk({ "x-cron-secret": SECRET }, SECRET)).toBe(true);
  });

  it("accepts a matching Authorization: Bearer header (Manus native injection)", () => {
    expect(cronSecretOk({ authorization: `Bearer ${SECRET}` }, SECRET)).toBe(true);
  });

  it("accepts when both headers are present and at least one matches", () => {
    expect(cronSecretOk({ "x-cron-secret": SECRET, authorization: "Bearer wrong" }, SECRET)).toBe(true);
    expect(cronSecretOk({ "x-cron-secret": "wrong", authorization: `Bearer ${SECRET}` }, SECRET)).toBe(true);
  });

  it("rejects a mismatched x-cron-secret", () => {
    expect(cronSecretOk({ "x-cron-secret": "wrong" }, SECRET)).toBe(false);
  });

  it("rejects a mismatched Bearer token", () => {
    expect(cronSecretOk({ authorization: "Bearer wrong" }, SECRET)).toBe(false);
  });

  it("rejects when neither header is present", () => {
    expect(cronSecretOk({}, SECRET)).toBe(false);
  });

  it("rejects a non-Bearer Authorization scheme even when it carries the secret", () => {
    expect(cronSecretOk({ authorization: `Basic ${SECRET}` }, SECRET)).toBe(false);
    expect(cronSecretOk({ authorization: SECRET }, SECRET)).toBe(false); // raw, no scheme
  });

  it("rejects a Bearer value with the wrong scheme casing or spacing (exact match, per Manus's `Bearer `)", () => {
    expect(cronSecretOk({ authorization: `bearer ${SECRET}` }, SECRET)).toBe(false); // lowercase scheme
    expect(cronSecretOk({ authorization: `Bearer  ${SECRET}` }, SECRET)).toBe(false); // double space
    expect(cronSecretOk({ authorization: `Bearer ${SECRET} ` }, SECRET)).toBe(false); // trailing space
  });

  it("ignores array-valued headers (repeated header → never matches)", () => {
    expect(cronSecretOk({ "x-cron-secret": [SECRET] }, SECRET)).toBe(false);
    expect(cronSecretOk({ authorization: [`Bearer ${SECRET}`] }, SECRET)).toBe(false);
  });
});
