import type { Express } from "express";
import { ENV } from "./env";
import { sdk } from "./sdk";
import { getMembership } from "../studioDb";

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    // C1: this proxy presigns ANY key with the Forge service key. Require an
    // authenticated session, and for tenant-scoped keys (studio/<tenantId>/...)
    // require the caller be a member of that tenant — otherwise any party who
    // learns a key (keys appear in API URLs) can read another tenant's images.
    let userId: number;
    try {
      const user = await sdk.authenticateRequest(req);
      userId = user.id;
    } catch {
      res.status(401).send("Authentication required");
      return;
    }
    const tenantMatch = key.match(/^studio\/(\d+)\//);
    if (tenantMatch) {
      const tenantId = Number(tenantMatch[1]);
      const membership = await getMembership(tenantId, userId);
      if (!membership) {
        res.status(403).send("Forbidden");
        return;
      }
    }
    // Non-tenant-scoped keys (e.g. generated/...) are auth-gated only; scoping
    // those to an owner is a follow-up (migrate to tenant keys, or a variation
    // ownership lookup).

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
