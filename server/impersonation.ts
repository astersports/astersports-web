/**
 * Server-side impersonation token — signed JWT cookie.
 * Allows super_admins to impersonate a tenant without requiring actual membership.
 * The token is short-lived (2h) and httpOnly.
 */
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { ENV } from "./_core/env";

const COOKIE_NAME = "ps_impersonate";
const TTL_SECONDS = 2 * 60 * 60; // 2 hours

interface ImpersonationPayload extends JWTPayload {
  /** The super_admin's user ID */
  adminId: number;
  /** The target tenant being impersonated */
  tenantId: number;
  /** Tenant name for display */
  tenantName: string;
}

function getSecret(): Uint8Array {
  return new TextEncoder().encode(ENV.cookieSecret);
}

/**
 * Sign an impersonation JWT and return the token string.
 */
export async function signImpersonationToken(
  adminId: number,
  tenantId: number,
  tenantName: string
): Promise<string> {
  const token = await new SignJWT({ adminId, tenantId, tenantName })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .setSubject("impersonation")
    .sign(getSecret());

  return token;
}

/**
 * Verify an impersonation JWT and return the payload.
 * Returns null if the token is invalid or expired.
 */
export async function verifyImpersonationToken(
  token: string
): Promise<ImpersonationPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      subject: "impersonation",
    });
    return payload as ImpersonationPayload;
  } catch {
    return null;
  }
}

/**
 * Set the impersonation cookie on the response.
 */
export function setImpersonationCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: TTL_SECONDS * 1000,
  });
}

/**
 * Clear the impersonation cookie.
 */
export function clearImpersonationCookie(res: Response, secure: boolean): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
  });
}

/**
 * Read the impersonation token from the request cookies.
 * Manually parses the Cookie header since no cookie-parser middleware is used.
 * Returns the verified payload or null.
 */
export async function getImpersonationFromRequest(
  req: Request
): Promise<ImpersonationPayload | null> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  return verifyImpersonationToken(token);
}

export { COOKIE_NAME, ImpersonationPayload };
