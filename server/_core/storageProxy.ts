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

    // C1 — protect CUSTOMER images, not the public site. This proxy presigns any
    // key with the Forge service key, and keys travel in URLs, so customer images
    // must be membership-scoped. Two kinds of key are private:
    //   - studio/<tenantId>/...  : originals + deterministic outputs (tenant in path)
    //   - any key recorded as a job variation : prompt-path outputs under generated/*
    //     (the generative path), whose tenant is NOT in the path
    // Everything else through /manus-storage/ is a PUBLIC asset (marketing logo on
    // Privacy/Terms/Home, AAU highlight videos) and is served without auth, exactly
    // as before C1. Confirmed taxonomy: only customer images are studio/* or
    // variation-backed; nothing else customer-owned flows through this proxy. (A
    // future hardening could migrate public assets under an explicit prefix and make
    // the private rule fail-closed for unknown keys.)
    const tenantMatch = key.match(/^studio\/(\d+)\//);
    let ownerTenantId: number | null = null;
    if (tenantMatch) {
      ownerTenantId = Number(tenantMatch[1]);
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
      if (!membership) {
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

      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
