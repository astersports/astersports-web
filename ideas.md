# Aster Sports Landing Page — Design Brainstorm

## Three Stylistic Approaches

### 1. Celestial Cartography
A dark, constellation-themed design that leans into the "Aster" (star) brand identity. The page feels like navigating a star map — geometric lines connect nodes of information against a deep navy void.
**Probability:** 0.07

### 2. Brutalist Tech Manifesto
High-contrast, oversized typography with raw structural elements. Monospaced fonts, exposed grid lines, and a stark black/gold palette that feels like a technical blueprint.
**Probability:** 0.04

### 3. Liquid Gold Editorial
A premium editorial layout with flowing asymmetric sections, where gold gradients animate subtly like molten metal. Inspired by luxury tech brands — think Vertu meets Stripe's own marketing.
**Probability:** 0.06

---

## Selected Approach: Celestial Cartography

### Design Movement
Dark-mode constellation UI — inspired by astronomical cartography, data visualization aesthetics, and the geometric precision of star charts. References: Stripe Atlas branding, Linear.app's dark UI, constellation map illustrations.

### Core Principles
1. **Structured Darkness** — Deep navy (#0a0e1a) as the canvas, content emerges like stars from void
2. **Connected Geometry** — Thin lines and nodes connect sections, echoing the logo's constellation structure
3. **Gradient Luminance** — Gold-to-orange gradients (matching the logo) used sparingly as focal accents
4. **Purposeful Restraint** — Minimal elements, maximum impact; every element earns its place

### Color Philosophy
- **Primary Background:** #0a0e1a (deep space navy) — conveys depth, professionalism, technical mastery
- **Secondary Background:** #111827 (slightly lighter navy for cards/sections)
- **Brand Gold:** #f5b731 (warm gold, top of logo gradient) — used for CTAs and primary accents
- **Brand Orange:** #e67e22 (warm orange, bottom of logo gradient) — secondary accent
- **Text Primary:** #f0f0f0 (near-white, high readability)
- **Text Secondary:** #94a3b8 (muted slate for supporting copy)
- **Subtle Lines:** rgba(245, 183, 49, 0.15) (faint gold for decorative geometry)

### Layout Paradigm
Asymmetric vertical scroll with a left-anchored navigation marker. Content sections are offset from center, creating visual tension. Decorative constellation lines span the full viewport behind content, connecting sections like star paths.

### Signature Elements
1. **Constellation Grid** — SVG lines with animated dots traveling along paths, connecting sections
2. **Star Burst Accents** — Four-pointed star shapes (matching the logo's top star) used as decorative markers
3. **Node Indicators** — Small circles at intersection points, echoing the logo's connection nodes

### Interaction Philosophy
Interactions feel like discovering stars — elements brighten on hover, connections illuminate on scroll, content fades in as if emerging from darkness. Nothing is aggressive; everything is a gentle reveal.

### Animation
- Scroll-triggered fade-in with subtle upward drift (translateY 20px → 0, opacity 0 → 1)
- Constellation lines draw themselves on page load (stroke-dashoffset animation)
- Star accents pulse gently with a 3s ease-in-out infinite cycle
- Hover states: elements gain a subtle gold glow (box-shadow with brand gold at 20% opacity)
- All animations respect prefers-reduced-motion
- Timing: 200-400ms for reveals, cubic-bezier(0.23, 1, 0.32, 1) for easing

### Typography System
- **Display/Headlines:** "Space Grotesk" — geometric, technical, modern (Google Fonts)
- **Body:** "Inter" weight 400 for body, 500 for emphasis — clean readability at all sizes
- **Hierarchy:** Display at 48-64px, H2 at 32-40px, body at 16-18px, captions at 14px
- **Letter spacing:** Headlines slightly tracked (+0.5px), body normal

### Brand Essence
Aster Sports is a precision web development agency for organizations that need reliable, high-performance digital presence — built by craftspeople who treat code like constellation maps: every connection intentional, every node purposeful.
**Personality:** Precise, Luminous, Dependable

### Brand Voice
Headlines and CTAs sound confident and direct without being salesy. Technical competence implied through clarity, not jargon.
- Example headline: "We build digital infrastructure that doesn't break."
- Example CTA: "Start a conversation"

### Wordmark & Logo
The existing constellation mark (geometric A-shape with star nodes and four-pointed star crown) is the primary brand symbol. The wordmark "Aster Sports" uses Space Grotesk at weight 600 with the "A" subtly referencing the mark's triangular form.

### Signature Brand Color
**Aster Gold — #f5b731** — A warm, luminous gold that stands out unmistakably against the deep navy canvas. Not yellow, not amber — a specific warm gold that references both stars and premium craftsmanship.
