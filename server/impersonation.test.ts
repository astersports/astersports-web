import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the _core/env module
vi.mock("./_core/env", () => ({
  ENV: { cookieSecret: "test-secret-key-for-jwt-signing-32chars" },
}));

// Mock cookie parser
vi.mock("cookie", () => ({
  parse: vi.fn((header: string) => {
    const result: Record<string, string> = {};
    header.split(";").forEach((pair) => {
      const [key, ...val] = pair.trim().split("=");
      if (key) result[key] = val.join("=");
    });
    return result;
  }),
}));

// Mock jose
const mockSign = vi.fn().mockResolvedValue("mock.jwt.token");
vi.mock("jose", () => ({
  SignJWT: vi.fn().mockImplementation(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    setIssuedAt: vi.fn().mockReturnThis(),
    setSubject: vi.fn().mockReturnThis(),
    sign: mockSign,
  })),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { tenantId: 42, tenantName: "Test Firm", adminId: 1 },
  }),
}));

describe("impersonation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("signImpersonationToken", () => {
    it("creates a signed JWT with adminId, tenantId, and tenantName", async () => {
      const { signImpersonationToken } = await import("./impersonation");
      const token = await signImpersonationToken(1, 42, "Test Firm");
      expect(token).toBe("mock.jwt.token");
      expect(mockSign).toHaveBeenCalled();
    });
  });

  describe("verifyImpersonationToken", () => {
    it("returns payload with tenantId and tenantName", async () => {
      const { verifyImpersonationToken } = await import("./impersonation");
      const payload = await verifyImpersonationToken("mock.jwt.token");
      expect(payload).toEqual({
        tenantId: 42,
        tenantName: "Test Firm",
        adminId: 1,
      });
    });

    it("returns null for invalid token", async () => {
      const { jwtVerify } = await import("jose");
      (jwtVerify as any).mockRejectedValueOnce(new Error("invalid signature"));

      const { verifyImpersonationToken } = await import("./impersonation");
      const payload = await verifyImpersonationToken("bad.token");
      expect(payload).toBeNull();
    });
  });

  describe("getImpersonationFromRequest", () => {
    it("returns null when no cookie header is present", async () => {
      const { getImpersonationFromRequest } = await import("./impersonation");
      const req = { headers: {} } as any;
      const result = await getImpersonationFromRequest(req);
      expect(result).toBeNull();
    });

    it("returns null when cookie header has no impersonation cookie", async () => {
      const { getImpersonationFromRequest } = await import("./impersonation");
      const req = { headers: { cookie: "other=val; session=abc" } } as any;
      const result = await getImpersonationFromRequest(req);
      expect(result).toBeNull();
    });

    it("returns payload when valid impersonation cookie is present", async () => {
      const { getImpersonationFromRequest } = await import("./impersonation");
      const req = {
        headers: { cookie: "ps_impersonate=mock.jwt.token; other=val" },
      } as any;
      const result = await getImpersonationFromRequest(req);
      expect(result).toEqual({
        tenantId: 42,
        tenantName: "Test Firm",
        adminId: 1,
      });
    });
  });

  describe("setImpersonationCookie", () => {
    it("sets httpOnly cookie with correct options", async () => {
      const { setImpersonationCookie } = await import("./impersonation");
      const res = { cookie: vi.fn() } as any;
      setImpersonationCookie(res, "test-token", true);
      expect(res.cookie).toHaveBeenCalledWith("ps_impersonate", "test-token", {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: 2 * 60 * 60 * 1000,
      });
    });
  });

  describe("clearImpersonationCookie", () => {
    it("clears the impersonation cookie", async () => {
      const { clearImpersonationCookie } = await import("./impersonation");
      const res = { clearCookie: vi.fn() } as any;
      clearImpersonationCookie(res, false);
      expect(res.clearCookie).toHaveBeenCalledWith("ps_impersonate", {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
      });
    });
  });
});
