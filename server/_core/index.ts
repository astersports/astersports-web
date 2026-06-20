import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter, registerScheduledRoutes } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleStripeWebhook } from "../webhook";
import { assertEnvOrExit, ENV } from "./env";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // M15: fail fast on missing required config before binding a port.
  assertEnvOrExit();

  const app = express();
  const server = createServer(app);

  // CRITICAL: Stripe webhook route MUST be registered BEFORE express.json()
  // because it needs the raw body for signature verification.
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    handleStripeWebhook
  );


  // M2: the large body limit is needed ONLY by the tRPC upload path (base64
  // image payloads). Scope it there; everything else (OAuth, scheduled routes)
  // gets a small default so a 50MB body can't be aimed at those endpoints as a
  // memory-amplification DoS. express.json is a no-op once the body is parsed,
  // so the path-specific parser wins for /api/trpc and the general one skips it.
  app.use("/api/trpc", express.json({ limit: "50mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // Register scheduled routes (heartbeat game-check)
  registerScheduledRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files.
  // Defense-in-depth: the Vite dev server (allowedHosts:true, arbitrary file
  // transform) must NEVER come up in production, even if NODE_ENV is mis-set.
  if (!ENV.isProduction && process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  // In production bind the configured port and fail hard if it's taken, rather
  // than silently drifting to another port and breaking the proxy/healthcheck
  // contract. The scan-for-free-port convenience is dev-only.
  const port = ENV.isProduction ? preferredPort : await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
