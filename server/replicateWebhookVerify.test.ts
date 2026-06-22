/**
 * Phase 3 (ASYNC_GENERATION_SPEC §3) — Replicate webhook signature verification. Confirms the
 * fail-closed HMAC-SHA256 (svix-style) check: a correctly-signed in-window request passes;
 * tampered body / wrong secret / missing secret / missing headers / stale-or-malformed
 * timestamp all fail. Node `crypto` only — no network, no creds.
 */
import { describe, it, expect } from "vitest";
import { verifyReplicateWebhook, signReplicateWebhook } from "./_core/net/replicateWebhookVerify";

// svix secrets are base64 (with a `whsec_` prefix); include the prefix to exercise stripping.
const SECRET = "whsec_" + Buffer.from("super-secret-key-bytes-len-32!!!").toString("base64");
const ID = "msg_2xZ";
const BODY = JSON.stringify({ id: "pred_1", status: "succeeded" });
const nowSec = () => Math.floor(Date.now() / 1000);

describe("verifyReplicateWebhook (svix-style HMAC, fail-closed)", () => {
  it("accepts a correctly-signed, in-window request", () => {
    const ts = String(nowSec());
    const signature = signReplicateWebhook(ID, ts, BODY, SECRET);
    expect(verifyReplicateWebhook({ id: ID, timestamp: ts, signature, body: BODY, secret: SECRET })).toBe(true);
  });

  it("accepts when the header carries multiple space-delimited v1 entries (key rotation)", () => {
    const ts = String(nowSec());
    const good = signReplicateWebhook(ID, ts, BODY, SECRET);
    const header = `v1,ZGVhZGJlZWY= ${good}`; // first entry wrong, second correct
    expect(verifyReplicateWebhook({ id: ID, timestamp: ts, signature: header, body: BODY, secret: SECRET })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const ts = String(nowSec());
    const signature = signReplicateWebhook(ID, ts, BODY, SECRET);
    expect(verifyReplicateWebhook({ id: ID, timestamp: ts, signature, body: BODY + "x", secret: SECRET })).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const ts = String(nowSec());
    const signature = signReplicateWebhook(ID, ts, BODY, SECRET);
    const other = "whsec_" + Buffer.from("a-totally-different-secret-key!!!").toString("base64");
    expect(verifyReplicateWebhook({ id: ID, timestamp: ts, signature, body: BODY, secret: other })).toBe(false);
  });

  it("fail-closed: empty secret -> false (no work before verify)", () => {
    const ts = String(nowSec());
    const signature = signReplicateWebhook(ID, ts, BODY, SECRET);
    expect(verifyReplicateWebhook({ id: ID, timestamp: ts, signature, body: BODY, secret: "" })).toBe(false);
  });

  it("fail-closed: any missing header -> false", () => {
    const ts = String(nowSec());
    const signature = signReplicateWebhook(ID, ts, BODY, SECRET);
    expect(verifyReplicateWebhook({ id: "", timestamp: ts, signature, body: BODY, secret: SECRET })).toBe(false);
    expect(verifyReplicateWebhook({ id: ID, timestamp: "", signature, body: BODY, secret: SECRET })).toBe(false);
    expect(verifyReplicateWebhook({ id: ID, timestamp: ts, signature: "", body: BODY, secret: SECRET })).toBe(false);
  });

  it("rejects a stale timestamp outside the replay window", () => {
    const now = 1_000_000_000;
    const staleTs = String(now - 400); // > 300s tolerance
    const signature = signReplicateWebhook(ID, staleTs, BODY, SECRET);
    expect(verifyReplicateWebhook({ id: ID, timestamp: staleTs, signature, body: BODY, secret: SECRET, nowSec: now })).toBe(false);
  });

  it("rejects a malformed (non-numeric) timestamp", () => {
    const signature = signReplicateWebhook(ID, "not-a-number", BODY, SECRET);
    expect(verifyReplicateWebhook({ id: ID, timestamp: "not-a-number", signature, body: BODY, secret: SECRET })).toBe(false);
  });

  it("handles array-valued headers (Express can deliver duplicates as arrays)", () => {
    const ts = String(nowSec());
    const signature = signReplicateWebhook(ID, ts, BODY, SECRET);
    expect(verifyReplicateWebhook({ id: [ID], timestamp: [ts], signature: [signature], body: BODY, secret: SECRET })).toBe(true);
  });
});
