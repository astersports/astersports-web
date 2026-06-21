import type { Express } from "express";
import { ENV } from "./env";
import { sdk } from "./sdk";
import { getMembership, getVariationByResultKey } from "../studioDb";

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    // H1: reject path traversal / control chars before the key is forwarded to
    // Forge as the `path` param.
    if (key.includes("..") || key.includes("\\") || key.includes("\0") || key.startsWith("/")) {
      res.status(400).send("Invalid storage key");
      return;
    }

    // Protect CUSTOMER images, not the public site. This proxy presigns a key
    // with the Forge service key, and keys travel in URLs, so private namespaces
    // are membership-scoped and FAIL CLOSED:
    //   - studio/<tenantId>/...  : originals + deterministic outputs (tenant in path)
    //   - generated/...          : prompt-path outputs (tenant NOT in path) — must
    //                              be recorded as a job variation or it is denied
    // Anything else is a PUBLIC asset (top-level marketing image / AAU highlight
    // video, e.g. og-image_*.png, IMG_*.mp4) and is served without auth — but if
    // such a key happens to be variation-backed it is still scoped, as a backstop.
    let ownerTenantId: number | null = null;
    if (key.startsWith("studio/")) {
      const tenantMatch = key.match(/^studio\/(\d+)\//);
      if (!tenantMatch) {
        res.status(404).send("Not found"); // malformed private key — fail closed
        return;
      }
      ownerTenantId = Number(tenantMatch[1]);
    } else if (key.startsWith("generated/")) {
      const variation = await getVariationByResultKey(key);
      if (!variation) {
        res.status(404).send("Not found"); // unrecorded generative key — fail closed
        return;
      }
      ownerTenantId = variation.tenantId;
    } else {
      const variation = await getVariationByResultKey(key);
      if (variation) ownerTenantId = variation.tenantId;
    }

    if (ownerTenantId !== null) {
      // Private customer image: require an authenticated member of the owning tenant.
      let userId: number;
      try {
        const user = await sdk.authenticateRequest(req);
        userId = user.id;
      } catch {
        res.status(401).send("Authentication required");
        return;
      }
      const membership = await getMembership(ownerTenantId, userId);
      if (!membership || membership.status !== "active") {
        res.status(403).send("Forbidden");
        return;
      }
    }

    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);

      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });

      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }

      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }

      // H1: only ever 307 the browser to an http(s) presigned URL — never a
      // javascript:/data: or otherwise unexpected scheme from the backend.
      let redirectScheme: string;
      try {
        redirectScheme = new URL(url).protocol;
      } catch {
        res.status(502).send("Invalid signed URL from backend");
        return;
      }
      if (redirectScheme !== "https:" && redirectScheme !== "http:") {
        res.status(502).send("Invalid signed URL scheme from backend");
        return;
      }

      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
