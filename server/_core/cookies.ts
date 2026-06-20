import type { CookieOptions, Request } from "express";
import { ENV } from "./env";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // const hostname = req.hostname;
  // const shouldSetDomain =
  //   hostname &&
  //   !LOCAL_HOSTS.has(hostname) &&
  //   !isIpAddress(hostname) &&
  //   hostname !== "127.0.0.1" &&
  //   hostname !== "::1";

  // const domain =
  //   shouldSetDomain && !hostname.startsWith(".")
  //     ? `.${hostname}`
  //     : shouldSetDomain
  //       ? hostname
  //       : undefined;

  // M11 (CSRF): "lax" stops the session cookie from riding cross-site POSTs
  // (the CSRF vector) while still sending it on same-origin XHR and on the
  // top-level OAuth redirect back to the app. The app is a same-origin SPA
  // (tRPC at /api/trpc on its own origin) with a top-level OAuth flow, so "lax"
  // is functionally transparent here. The ONLY thing it would break is loading
  // the app inside a cross-origin iframe — which this app does not do (no
  // frame-ancestors/X-Frame-Options/iframe embedding in the tree). If a future
  // embedded surface is added, that context needs its own CSRF-token scheme
  // rather than reverting to "none".
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    // M3: in production the session cookie is ALWAYS Secure — never let a
    // client-spoofed `x-forwarded-proto: http` strip the flag and expose the
    // cookie over plaintext. Header sniffing is only trusted in dev (http://localhost).
    secure: ENV.isProduction ? true : isSecureRequest(req),
  };
}
