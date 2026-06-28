import { Film } from "lucide-react";
import type { HubUser } from "@/lib/aster";
import SectionHeading from "./SectionHeading";
import FilmAiReviewGate from "./FilmAiReviewGate";
import { canAccessChild } from "@/lib/aau/entitlement";
import { C } from "./find/findUi";

// Film — child-data gated (North Star §6 #3 / build-review P1-B + Copilot review on #159). Film
// involves minors, so until a viewer is a verified, entitled, consented guardian, NO named minor or
// reel is shown.
//
// CRITICAL (Copilot #159): a render-only gate is NOT enough — child identifiers and reel URLs must
// not ship in the client bundle either. A hardcoded named minor + an "anyone-with-the-link" Drive
// URL in source can be lifted straight out of the JS by an unverified viewer, defeating the gate. So
// this component carries ZERO child data: the locked state shows only the jersey-not-face / AI-
// review framing, and the verified state loads reels from a gated server source (not yet wired) —
// never from constants in the bundle. canAccessChild(user) is owner-applied and false for EVERY account —
// including the super-admin (architect A5: Film stays locked until a real COPPA-grade guardian-
// verification + consent design exists; an operator email bypass is not consent). It flips true only
// when entitlement + guardian verification + consent are all wired.

export default function FilmHighlights({ user }: { user: HubUser | null }) {
  if (!canAccessChild(user)) {
    return (
      <div className="as-fade-in">
        <SectionHeading eyebrow="Film Room" title="Film" ghostText="FILM" />
        <FilmAiReviewGate />
      </div>
    );
  }

  // Verified state — reels load from a gated, per-child server source (not yet wired). Honest
  // pre-content state; no child data is embedded in the client bundle.
  return (
    <div className="as-fade-in">
      <SectionHeading eyebrow="Film Room" title="Film" ghostText="FILM" />
      <div className="mx-[18px] mt-4 rounded-[16px] p-8 text-center" style={{ border: `1px solid ${C.hair}`, background: "linear-gradient(180deg,#F9FAFB,#FFFFFF)" }}>
        <div className="mx-auto grid h-[44px] w-[44px] place-items-center rounded-full" style={{ background: "rgba(124,58,237,.08)", color: "#7C3AED" }}>
          <Film className="h-[20px] w-[20px]" aria-hidden="true" />
        </div>
        <div className="mt-3 text-[20.8px] font-semibold" style={{ color: C.ink }}>No reels yet</div>
        <div className="mx-auto mt-1.5 max-w-[280px] text-[19.2px] leading-[1.5]" style={{ color: C.mut }}>
          Your verified film loads here once the film room is connected — reels are served per child, never embedded in the app.
        </div>
      </div>
    </div>
  );
}
