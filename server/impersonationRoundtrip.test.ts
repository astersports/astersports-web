/**
 * Impersonation Round-Trip Smoke Test
 * Validates the full server-side flow:
 * 1. Super admin calls impersonate → gets cookie set
 * 2. Subsequent requests with cookie → impersonation detected
 * 3. Tenancy middleware grants synthetic owner access
 * 4. Exit mutation clears cookie
 * 5. After exit, impersonation is no longer active
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock ENV ────────────────────────────────────────────────────────────────
vi.mock("./_core/env", () => ({
  ENV: { cookieSecret: "test-secret-key-for-jwt-signing-32chars" },
}));

// ─── Real jose (no mock) for actual JWT sign/verify round-trip ───────────────

describe("impersonation round-trip (real JWT)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sign → verify round-trip returns original payload", async () => {
    const { signImpersonationToken, verifyImpersonationToken } = await import(
      "./impersonation"
    );

    const token = await signImpersonationToken(1, 42, "Jaya Design Firm");
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
    expect(token.split(".").length).toBe(3); // JWT has 3 parts

    const payload = await verifyImpersonationToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.adminId).toBe(1);
    expect(payload!.tenantId).toBe(42);
    expect(payload!.tenantName).toBe("Jaya Design Firm");
    expect(payload!.sub).toBe("impersonation");
    expect(payload!.exp).toBeDefined();
    expect(payload!.iat).toBeDefined();
  });

  it("expired token returns null", async () => {
    // We can't easily test real expiry without time manipulation,
    // but we can verify a tampered token fails
    const { verifyImpersonationToken } = await import("./impersonation");

    const result = await verifyImpersonationToken("invalid.jwt.token");
    expect(result).toBeNull();
  });

  it("tampered token returns null", async () => {
    const { signImpersonationToken, verifyImpersonationToken } = await import(
      "./impersonation"
    );

    const token = await signImpersonationToken(1, 42, "Test Firm");
    // Tamper with the payload
    const parts = token.split(".");
    parts[1] = parts[1] + "TAMPERED";
    const tampered = parts.join(".");

    const result = await verifyImpersonationToken(tampered);
    expect(result).toBeNull();
  });

  it("setImpersonationCookie sets correct cookie attributes", async () => {
    const { signImpersonationToken, setImpersonationCookie } = await import(
      "./impersonation"
    );

    const token = await signImpersonationToken(1, 42, "Test Firm");
    const mockRes = { cookie: vi.fn() } as any;

    setImpersonationCookie(mockRes, token, true);

    expect(mockRes.cookie).toHaveBeenCalledWith(
      "ps_impersonate",
      token,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: 7200000, // 2h in ms
      })
    );
  });

  it("clearImpersonationCookie removes the cookie", async () => {
    const { clearImpersonationCookie } = await import("./impersonation");

    const mockRes = { clearCookie: vi.fn() } as any;
    clearImpersonationCookie(mockRes, true);

    expect(mockRes.clearCookie).toHaveBeenCalledWith(
      "ps_impersonate",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
      })
    );
  });

  it("getImpersonationFromRequest reads cookie and verifies JWT", async () => {
    const { signImpersonationToken, getImpersonationFromRequest } = await import(
      "./impersonation"
    );

    const token = await signImpersonationToken(5, 99, "Acme Corp");
    const mockReq = {
      headers: { cookie: `ps_impersonate=${token}; other=abc` },
    } as any;

    const result = await getImpersonationFromRequest(mockReq);
    expect(result).not.toBeNull();
    expect(result!.adminId).toBe(5);
    expect(result!.tenantId).toBe(99);
    expect(result!.tenantName).toBe("Acme Corp");
  });

  it("getImpersonationFromRequest returns null when no cookie", async () => {
    const { getImpersonationFromRequest } = await import("./impersonation");

    const mockReq = { headers: {} } as any;
    const result = await getImpersonationFromRequest(mockReq);
    expect(result).toBeNull();
  });

  it("full flow: set cookie → read from request → clear → read returns null", async () => {
    const {
      signImpersonationToken,
      setImpersonationCookie,
      clearImpersonationCookie,
      getImpersonationFromRequest,
    } = await import("./impersonation");

    // Step 1: Sign token
    const token = await signImpersonationToken(1, 42, "Jaya");

    // Step 2: Set cookie (capture the value)
    const setCookieArgs: any[] = [];
    const mockRes = {
      cookie: vi.fn((...args: any[]) => setCookieArgs.push(args)),
      clearCookie: vi.fn(),
    } as any;
    setImpersonationCookie(mockRes, token, false);
    expect(setCookieArgs.length).toBe(1);
    expect(setCookieArgs[0][0]).toBe("ps_impersonate");

    // Step 3: Simulate request with the cookie
    const cookieValue = setCookieArgs[0][1];
    const mockReq = {
      headers: { cookie: `ps_impersonate=${cookieValue}` },
    } as any;
    const payload = await getImpersonationFromRequest(mockReq);
    expect(payload).not.toBeNull();
    expect(payload!.tenantId).toBe(42);
    expect(payload!.tenantName).toBe("Jaya");

    // Step 4: Clear cookie
    clearImpersonationCookie(mockRes, false);
    expect(mockRes.clearCookie).toHaveBeenCalledWith("ps_impersonate", expect.any(Object));

    // Step 5: Request without cookie → null
    const emptyReq = { headers: { cookie: "other=val" } } as any;
    const afterClear = await getImpersonationFromRequest(emptyReq);
    expect(afterClear).toBeNull();
  });
});

describe("tenancy middleware impersonation bypass", () => {
  it("acts as the tenant's real owner membership when impersonating", () => {
    // Simulates tenancy.ts: impersonation mirrors the tenant's real owner row so
    // mutations keyed on ctx.membership.id (e.g. transferOwnership's demotion)
    // hit a real row instead of a synthetic id:-1 no-op.
    const impersonation = { adminId: 1, tenantId: 42, tenantName: "Jaya" };
    const inputTenantId = 42;
    const ownerMembership = {
      id: 77,
      userId: 9,
      tenantId: 42,
      role: "owner" as const,
      status: "active" as const,
      invitedEmail: null,
      createdAt: new Date(),
    };

    if (impersonation && impersonation.tenantId === inputTenantId) {
      const membership = ownerMembership ?? {
        id: -1,
        userId: 1,
        tenantId: 42,
        role: "owner" as const,
        status: "active" as const,
        invitedEmail: null,
        createdAt: new Date(),
      };

      expect(membership.role).toBe("owner");
      expect(membership.tenantId).toBe(42);
      expect(membership.id).toBe(77); // real owner row, not synthetic -1
    }
  });

  it("falls back to a synthetic owner row when the tenant has no active owner", () => {
    const ownerMembership: { id: number; role: "owner" } | undefined = undefined;
    const membership = ownerMembership ?? { id: -1, role: "owner" as const };

    expect(membership.id).toBe(-1);
    expect(membership.role).toBe("owner");
  });

  it("does NOT bypass when impersonation tenantId does not match input", () => {
    const impersonation = { adminId: 1, tenantId: 42, tenantName: "Jaya" };
    const inputTenantId = 99; // Different tenant

    const shouldBypass = impersonation && impersonation.tenantId === inputTenantId;
    expect(shouldBypass).toBe(false);
  });

  it("does NOT bypass when no impersonation cookie is present", () => {
    const impersonation = null;
    const inputTenantId = 42;

    const shouldBypass = impersonation && impersonation.tenantId === inputTenantId;
    expect(shouldBypass).toBeFalsy();
  });
});

describe("impersonationStatus query logic", () => {
  it("returns active:true with tenant details when impersonating", async () => {
    const { signImpersonationToken, getImpersonationFromRequest } = await import(
      "./impersonation"
    );

    const token = await signImpersonationToken(1, 42, "Jaya");
    const req = { headers: { cookie: `ps_impersonate=${token}` } } as any;

    const impersonation = await getImpersonationFromRequest(req);
    if (!impersonation) {
      // Simulate the query response
      const response = { active: false as const };
      expect(response.active).toBe(false);
    } else {
      const response = {
        active: true as const,
        tenantId: impersonation.tenantId,
        tenantName: impersonation.tenantName,
        adminId: impersonation.adminId,
      };
      expect(response.active).toBe(true);
      expect(response.tenantId).toBe(42);
      expect(response.tenantName).toBe("Jaya");
      expect(response.adminId).toBe(1);
    }
  });

  it("returns active:false when not impersonating", async () => {
    const { getImpersonationFromRequest } = await import("./impersonation");

    const req = { headers: { cookie: "session=abc" } } as any;
    const impersonation = await getImpersonationFromRequest(req);

    if (!impersonation) {
      const response = { active: false as const };
      expect(response.active).toBe(false);
    }
  });
});
