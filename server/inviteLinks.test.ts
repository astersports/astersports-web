/**
 * Tests for the invite-links router — the self-service onboarding + access-control
 * surface (create / redeem / revoke / getByToken). Covers the permission gates,
 * every redeem branch (firm / individual / join), the validation rejections, and
 * the atomic-claim race backstop + claim-refund-on-failure introduced alongside.
 *
 * The DB is a queue-driven fake: each top-level `select` / `update` / `insert`
 * shifts the next queued result, so a test seeds the exact read/write sequence a
 * procedure performs. studioDb provisioning helpers are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Fake DB harness ────────────────────────────────────────────────────────
type Queues = { select: any[]; update: any[]; insert: any[] };
const queues: Queues = { select: [], update: [], insert: [] };

/** A thenable whose every chain method (.from/.where/.limit/.set/.for/…) returns
 *  itself, and that resolves to `getVal()` when awaited. */
function thenable(getVal: () => any): any {
  const p: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (onF: any, onR: any) => Promise.resolve(getVal()).then(onF, onR);
        }
        return () => p;
      },
    }
  );
  return p;
}

function makeDb(): any {
  const db: any = {
    select: () => thenable(() => (queues.select.length ? queues.select.shift() : [])),
    update: () => thenable(() => (queues.update.length ? queues.update.shift() : [{ affectedRows: 1 }])),
    insert: () =>
      thenable(() => {
        const v = queues.insert.length ? queues.insert.shift() : undefined;
        if (v instanceof Error) throw v; // lets a test simulate a write failure
        return v;
      }),
    transaction: async (fn: any) => fn(db),
  };
  return db;
}

vi.mock("./db", () => ({ getDb: vi.fn(async () => makeDb()) }));

vi.mock("./studioDb", () => ({
  ensureCategory: vi.fn(async () => ({ id: 1 })),
  createTenant: vi.fn(async () => ({ id: 99 })),
  createMembership: vi.fn(async () => undefined),
  grantCredits: vi.fn(async () => 0),
  countActiveMembers: vi.fn(async () => 0),
}));

import { inviteLinksRouter } from "./routers/inviteLinks";
import * as studioDb from "./studioDb";

const admin = { id: 1, name: "Admin", email: "admin@aster.co" };
const user = { id: 5, name: "Casey", email: "casey@acme.com" };

function caller(ctx: any) {
  return inviteLinksRouter.createCaller(ctx as any);
}

beforeEach(() => {
  queues.select = [];
  queues.update = [];
  queues.insert = [];
  vi.clearAllMocks();
  (studioDb.ensureCategory as any).mockResolvedValue({ id: 1 });
  (studioDb.createTenant as any).mockResolvedValue({ id: 99 });
  (studioDb.createMembership as any).mockResolvedValue(undefined);
  (studioDb.grantCredits as any).mockResolvedValue(0);
  (studioDb.countActiveMembers as any).mockResolvedValue(0);
});

// ─── create / permission gate ─────────────────────────────────────────────────
describe("inviteLinks.create", () => {
  it("lets a platform admin mint a link", async () => {
    queues.select = [[{ userId: admin.id }]]; // superAdmin middleware passes
    const res = await caller({ user: admin }).create({
      type: "individual",
      metadata: { initialCredits: 50 },
      maxUses: 1,
      expiresInDays: 30,
    });
    expect(res.token).toBeTypeOf("string");
    expect(res.token.length).toBeGreaterThan(20);
  });

  it("rejects a non-platform-admin", async () => {
    queues.select = [[]]; // no platformAdmins row
    await expect(
      caller({ user }).create({ type: "individual", metadata: { initialCredits: 50 }, maxUses: 1, expiresInDays: 30 })
    ).rejects.toThrow(/platform admin/i);
  });
});

describe("inviteLinks.createJoinLink", () => {
  it("rejects a member who is not owner/admin of the tenant", async () => {
    queues.select = [[{ role: "member" }]];
    await expect(
      caller({ user }).createJoinLink({ tenantId: 7, role: "member", maxUses: null, expiresInDays: 30 })
    ).rejects.toThrow(/admin access/i);
  });

  it("lets an owner mint a join link", async () => {
    queues.select = [[{ role: "owner" }]];
    const res = await caller({ user }).createJoinLink({ tenantId: 7, role: "member", maxUses: null, expiresInDays: 30 });
    expect(res.token).toBeTypeOf("string");
  });
});

// ─── redeem: happy paths ───────────────────────────────────────────────────────
describe("inviteLinks.redeem — provisioning", () => {
  it("firm link creates an org, makes the user owner, grants credits", async () => {
    queues.select = [
      [{ id: 10, type: "firm", status: "active", maxUses: 1, useCount: 0, tenantId: null, metadata: { plan: "pro", seats: 5, initialCredits: 100 }, expiresAt: null }],
      [], // no prior redemption
    ];
    queues.update = [[{ affectedRows: 1 }]]; // claim succeeds
    const res = await caller({ user }).redeem({ token: "t", orgName: "Casey Design Co" });
    expect(res).toEqual({ success: true, tenantId: 99 });
    expect(studioDb.createTenant).toHaveBeenCalledWith(expect.objectContaining({ name: "Casey Design Co", type: "firm" }));
    expect(studioDb.createMembership).toHaveBeenCalledWith(expect.objectContaining({ role: "owner" }));
    expect(studioDb.grantCredits).toHaveBeenCalledWith(99, 100, "grant", undefined, user.id);
  });

  it("join link adds the user as a member when under the seat limit", async () => {
    queues.select = [
      [{ id: 11, type: "join", status: "active", maxUses: null, useCount: 3, tenantId: 7, metadata: { role: "member" }, expiresAt: null }],
      [], // no prior redemption
      [], // not already a member
      [{ id: 7, seats: 5, allowedEmailDomain: null }], // tenant
    ];
    queues.update = [[{ affectedRows: 1 }]];
    (studioDb.countActiveMembers as any).mockResolvedValue(2);
    const res = await caller({ user }).redeem({ token: "t" });
    expect(res).toEqual({ success: true, tenantId: 7 });
    expect(studioDb.createMembership).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 7, role: "member" }));
  });
});

// ─── redeem: validation + races ────────────────────────────────────────────────
describe("inviteLinks.redeem — rejections", () => {
  it("rejects a link the user already redeemed", async () => {
    queues.select = [
      [{ id: 12, type: "individual", status: "active", maxUses: 1, useCount: 1, metadata: {}, expiresAt: null }],
      [{ id: 1 }], // prior redemption exists
    ];
    await expect(caller({ user }).redeem({ token: "t" })).rejects.toThrow(/already used/i);
    expect(studioDb.createTenant).not.toHaveBeenCalled();
  });

  it("reports 'usage limit' when the atomic claim is lost (affectedRows 0)", async () => {
    queues.select = [
      [{ id: 13, type: "individual", status: "active", maxUses: 1, useCount: 1, metadata: {}, expiresAt: null }],
      [], // no prior redemption
      [{ id: 13, status: "active", maxUses: 1, useCount: 1, expiresAt: null }], // fresh re-read
    ];
    queues.update = [[{ affectedRows: 0 }]]; // claim lost the race
    await expect(caller({ user }).redeem({ token: "t" })).rejects.toThrow(/usage limit/i);
  });

  it("reports 'revoked' when the claim fails on a revoked link", async () => {
    queues.select = [
      [{ id: 14, type: "individual", status: "active", maxUses: 1, useCount: 0, metadata: {}, expiresAt: null }],
      [],
      [{ id: 14, status: "revoked", maxUses: 1, useCount: 0, expiresAt: null }],
    ];
    queues.update = [[{ affectedRows: 0 }]];
    await expect(caller({ user }).redeem({ token: "t" })).rejects.toThrow(/revoked/i);
  });

  it("reports 'expired' when the claim fails on an expired link", async () => {
    queues.select = [
      [{ id: 15, type: "individual", status: "active", maxUses: 1, useCount: 0, metadata: {}, expiresAt: null }],
      [],
      [{ id: 15, status: "active", maxUses: 1, useCount: 0, expiresAt: new Date(Date.now() - 1000) }],
    ];
    queues.update = [[{ affectedRows: 0 }]];
    await expect(caller({ user }).redeem({ token: "t" })).rejects.toThrow(/expired/i);
  });

  it("enforces the domain lock on a join link and refunds the claim", async () => {
    queues.select = [
      [{ id: 16, type: "join", status: "active", maxUses: null, useCount: 0, tenantId: 7, metadata: {}, expiresAt: null }],
      [],
      [], // not already a member
      [{ id: 7, seats: 5, allowedEmailDomain: "other.com" }],
    ];
    queues.update = [[{ affectedRows: 1 }] /* claim */, [{ affectedRows: 1 }] /* refund */];
    await expect(caller({ user }).redeem({ token: "t" })).rejects.toThrow(/other\.com/);
    expect(studioDb.createMembership).not.toHaveBeenCalled();
    expect(queues.update).toHaveLength(0); // both claim + refund updates consumed
  });

  it("enforces the seat limit on a join link and refunds the claim", async () => {
    queues.select = [
      [{ id: 17, type: "join", status: "active", maxUses: null, useCount: 0, tenantId: 7, metadata: { role: "member" }, expiresAt: null }],
      [],
      [],
      [{ id: 7, seats: 2, allowedEmailDomain: null }],
    ];
    queues.update = [[{ affectedRows: 1 }], [{ affectedRows: 1 }]];
    (studioDb.countActiveMembers as any).mockResolvedValue(2); // full
    await expect(caller({ user }).redeem({ token: "t" })).rejects.toThrow(/seat limit/i);
    expect(queues.update).toHaveLength(0); // claim refunded
  });

  it("refunds the claim when provisioning throws (createTenant fails)", async () => {
    queues.select = [
      [{ id: 18, type: "firm", status: "active", maxUses: 1, useCount: 0, metadata: {}, expiresAt: null }],
      [],
    ];
    queues.update = [[{ affectedRows: 1 }], [{ affectedRows: 1 }]];
    (studioDb.createTenant as any).mockResolvedValue(null); // provisioning failure
    await expect(caller({ user }).redeem({ token: "t" })).rejects.toThrow(/create organization/i);
    expect(queues.update).toHaveLength(0); // claim refunded
    expect(queues.insert).toHaveLength(0); // redemption never recorded
  });

  it("still succeeds if only the redemption audit insert fails (user is provisioned)", async () => {
    queues.select = [
      [{ id: 19, type: "firm", status: "active", maxUses: 1, useCount: 0, metadata: {}, expiresAt: null }],
      [],
    ];
    queues.update = [[{ affectedRows: 1 }]]; // claim succeeds, no refund
    queues.insert = [new Error("audit write failed")];
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await caller({ user }).redeem({ token: "t" });
    expect(res).toEqual({ success: true, tenantId: 99 });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// ─── revoke ────────────────────────────────────────────────────────────────────
describe("inviteLinks.revoke", () => {
  it("lets the creator revoke their own link", async () => {
    queues.select = [
      [{ id: 3, token: "t", createdBy: user.id }],
      [], // not a platform admin, but is the creator
    ];
    const res = await caller({ user }).revoke({ token: "t" });
    expect(res).toEqual({ success: true });
  });

  it("blocks a non-creator non-admin from revoking", async () => {
    queues.select = [
      [{ id: 3, token: "t", createdBy: 999 }],
      [], // not a platform admin
    ];
    await expect(caller({ user }).revoke({ token: "t" })).rejects.toThrow(/only revoke links you created/i);
  });
});

// ─── getByToken (public preview) ────────────────────────────────────────────────
describe("inviteLinks.getByToken", () => {
  it("is callable without an authenticated user (public preview)", async () => {
    queues.select = [[{ id: 20, token: "t", type: "join", status: "active", maxUses: null, useCount: 0, tenantId: 7, metadata: { role: "member" }, expiresAt: null }], [{ name: "Acme" }]];
    const res = await caller({ user: null }).getByToken({ token: "t" });
    expect(res.tenantName).toBe("Acme");
    expect(res.status).toBe("active");
    // Public shape must not echo the bearer token or internal user data.
    expect((res as any).token).toBeUndefined();
    expect((res as any).createdBy).toBeUndefined();
  });

  it("reports expired without leaking the tenant", async () => {
    queues.select = [[{ id: 21, token: "t", type: "firm", status: "active", maxUses: 1, useCount: 0, tenantId: null, metadata: {}, expiresAt: new Date(Date.now() - 1000) }]];
    const res = await caller({ user: null }).getByToken({ token: "t" });
    expect(res.status).toBe("expired");
    expect(res.tenantName).toBeNull();
  });
});
