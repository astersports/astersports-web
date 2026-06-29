import "./instrument"; // ← MUST be first: installs Sentry's global handlers before app code
import * as Sentry from "@sentry/react";
import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

// Analytics (umami) — inject only when configured, so an unset endpoint never
// fires a request to a literal `%VITE_ANALYTICS_ENDPOINT%` placeholder (the 502
// observed on astersports.io). No-op when the env vars are absent.
const ANALYTICS_SRC = import.meta.env.VITE_ANALYTICS_ENDPOINT;
const ANALYTICS_ID = import.meta.env.VITE_ANALYTICS_WEBSITE_ID;
if (ANALYTICS_SRC && ANALYTICS_ID && !document.getElementById("umami-analytics")) {
  const s = document.createElement("script");
  s.id = "umami-analytics"; // dedupe — avoids a second tag on HMR re-eval
  s.defer = true;
  s.src = `${ANALYTICS_SRC.replace(/\/+$/, "")}/umami`; // normalize trailing slash(es)
  s.setAttribute("data-website-id", ANALYTICS_ID);
  document.head.appendChild(s);
}

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);

// Sentry pipeline self-test: append `?sentrytest=1` to emit ONE captured test event. Reported via
// captureException (not an uncaught throw, so it never breaks the page) and throttled to once per
// browser session (so it cannot be used to spam the project). Used to verify ingestion post-deploy.
if (
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("sentrytest") === "1" &&
  sessionStorage.getItem("sentry-selftest") !== "done"
) {
  sessionStorage.setItem("sentry-selftest", "done");
  Sentry.captureException(new Error("Sentry connectivity self-test"));
}
