import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, CheckCircle2 } from "lucide-react";
import { useScoutChat } from "@/hooks/useScoutChat";
import { useTurnstile } from "@/hooks/useTurnstile";
import ScoutCtaCard from "./ScoutCtaCard";

/**
 * Live "Aster Scout" concierge chat (docs/SPEC_LANDING_AGENT.txt P4). Consumes
 * the SSE stream via useScoutChat: streams the reply, renders a registry CTA
 * card on a `cta` event, a confirmation on `lead_ack`, and a kind notice on any
 * denial/error. Gated by VITE_LANDING_AGENT_LIVE at the call site — this only
 * mounts when the agent is live, so it never implies a capability that isn't on.
 */
/** Tappable starter questions shown before the first turn — makes "how do I use
 *  this?" answer itself. Each routes a real question through the same send path. */
const EXAMPLE_PROMPTS = [
  "I run an AAU program — what's for me?",
  "What can Print Studio do?",
  "Can you build our team a website?",
];

export default function ScoutChat() {
  const { bubbles, streaming, cta, leadAck, notice, send } = useScoutChat();
  const { configured: turnstileOn, containerRef, token, reset: resetTurnstile } = useTurnstile();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Synchronous in-flight guard: `send` closes over the previous `streaming`, so
  // two taps in the same tick (double-click a chip) would both pass its check and
  // fire overlapping requests. This ref blocks the second call before any render.
  const inFlight = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [bubbles, cta, leadAck, notice]);

  // Clear the guard once a turn finishes (streaming flips back to false).
  useEffect(() => {
    if (!streaming) inFlight.current = false;
  }, [streaming]);

  // Send a question (typed or tapped). Attach the single-use Turnstile token
  // (server verifies the first turn, then caches the session), then refresh the
  // widget so a retry has a fresh token.
  const ask = (text: string) => {
    if (inFlight.current || !text.trim()) return;
    inFlight.current = true;
    void send(text, token ?? undefined);
    if (turnstileOn) resetTurnstile();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft;
    setDraft("");
    ask(text);
  };

  return (
    <div className="aster-terminal p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-3.5 h-3.5 text-[#F6CC55]" />
        <span className="aster-mono text-[11px] tracking-[0.14em] uppercase text-slate-400">
          ask aster scout
        </span>
      </div>

      <div ref={scrollRef} className="max-h-72 overflow-y-auto as-no-scrollbar space-y-2.5 mb-3" aria-live="polite">
        {bubbles.length === 0 && (
          <div>
            <p className="text-[13px] text-slate-400 leading-relaxed mb-3">
              Ask about Print Studio, the app, the AAU hub, or a site build — the scout will point you
              the right way. Tap a question to start:
            </p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => ask(q)}
                  disabled={streaming}
                  className="aster-mono text-left text-[11.5px] text-slate-300 border border-white/12 rounded-full px-3 py-1.5 hover:border-[#F6CC55]/45 hover:text-[#F6CC55] transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {bubbles.map((b, i) => (
          <div key={i} className={b.role === "user" ? "text-right" : "text-left"}>
            <span
              className={`inline-block max-w-[88%] text-[13px] leading-snug px-3 py-2 rounded-2xl ${
                b.role === "user"
                  ? "bg-white/[0.06] text-slate-200 rounded-br-sm"
                  : "bg-[#F6CC55]/[0.08] text-slate-100 rounded-bl-sm"
              }`}
            >
              {b.text || (streaming && i === bubbles.length - 1 ? "…" : "")}
            </span>
          </div>
        ))}

        {cta && <ScoutCtaCard serviceId={cta} />}

        {leadAck && (
          <div className="flex items-center gap-2 text-[12.5px] text-[#34d399] mt-1">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>Thanks{leadAck ? `, ${leadAck}` : ""} — we'll be in touch shortly.</span>
          </div>
        )}

        {notice && <p className="text-[12.5px] text-slate-400 leading-snug mt-1">{notice}</p>}
      </div>

      {/* Cloudflare Turnstile bot gate — renders only when VITE_TURNSTILE_SITE_KEY is set */}
      {turnstileOn && <div ref={containerRef} className="mb-2.5" aria-label="Human verification" />}

      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          disabled={streaming}
          placeholder="Type a question…"
          aria-label="Ask Aster Scout a question"
          className="flex-1 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-[13px] text-white placeholder-slate-500 focus:outline-none focus:border-[#F6CC55]/40 focus:ring-1 focus:ring-[#F6CC55]/20 transition-all disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={streaming || draft.trim().length === 0}
          aria-label="Send"
          className="aster-grad-bg inline-flex items-center justify-center w-10 h-10 rounded-lg text-[#1a0e05] transition-transform duration-160 hover:scale-[1.04] active:scale-[0.96] disabled:opacity-50 disabled:hover:scale-100"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      <p className="mt-2 text-[10.5px] text-slate-500 leading-snug">
        Replies are generated by Claude (Anthropic). Don't share sensitive info; for anything
        specific we'll follow up by email.
      </p>
    </div>
  );
}
