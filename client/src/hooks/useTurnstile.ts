import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile bot-gate hook for the landing "Aster Scout" concierge
 * (docs/SPEC_LANDING_AGENT.txt P5, Fork D). Loads the Turnstile script once,
 * renders a managed widget, and exposes the latest challenge token for the chat
 * hook to attach to a turn.
 *
 * Configured = VITE_TURNSTILE_SITE_KEY is set. When unset the hook is inert
 * (configured:false, no widget, token undefined) — the server then runs without
 * a gate (dark testing), and the boot warning + pre-flip blocker cover the
 * misconfig case. The server VERIFIES every token and FAILS CLOSED, so a missing
 * or stale token can never open the gate.
 */
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "cf-turnstile-script";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
      theme?: "light" | "dark" | "auto";
      size?: "normal" | "flexible" | "compact";
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

/** Inject the Turnstile script once (idempotent across hook instances). */
function loadScript(): Promise<void> {
  if (typeof document === "undefined") return Promise.reject(new Error("no document"));
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("turnstile script failed")));
      return;
    }
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile script failed"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface UseTurnstile {
  /** Whether the gate is wired (site key present). When false, render nothing. */
  configured: boolean;
  /** Container ref to mount the widget into (only meaningful when configured). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Latest single-use challenge token, or null until the widget solves. */
  token: string | null;
  /** Reset the widget to fetch a fresh token (a token is single-use). */
  reset: () => void;
}

export function useTurnstile(): UseTurnstile {
  const configured = typeof SITE_KEY === "string" && SITE_KEY.length > 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !window.turnstile || !containerRef.current) return;
        if (widgetId.current !== null) return; // already rendered
        widgetId.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY as string,
          theme: "dark",
          size: "flexible",
          callback: (t: string) => setToken(t),
          "expired-callback": () => setToken(null),
          "error-callback": () => setToken(null),
        });
      })
      .catch(() => {
        /* script blocked → token stays null → server fails the gate closed */
      });

    return () => {
      cancelled = true;
      if (widgetId.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* widget already gone */
        }
        widgetId.current = null;
      }
    };
  }, [configured]);

  const reset = useCallback(() => {
    setToken(null);
    if (widgetId.current !== null && window.turnstile) {
      try {
        window.turnstile.reset(widgetId.current);
      } catch {
        /* no-op */
      }
    }
  }, []);

  return { configured, containerRef, token, reset };
}
