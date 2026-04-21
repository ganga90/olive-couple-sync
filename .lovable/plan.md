

## Olive Brand & Design Bible — Plan

I'll create **`OLIVE_BRAND_BIBLE.md`** at the project root: a single, world-class brand reference distilled from everything Olive is today (design system, voice, product architecture) and where it's going (consumer + B2B verticals on the same backend, anchored by the three primitives: Space, Capture, Compiled Artifact).

### Format & length
- Markdown, ~1,500–2,000 lines, structured for skim + deep-read.
- Self-contained: a designer, copywriter, PM, or partner agency could open it and ship on-brand work the same day.
- Living document: dated, versioned, with a "How to evolve this" section at the end.

### Structure (12 sections)

**1. North Star** — The vision paragraph (Olive as the AI you invite into conversations, 1:1 and small spaces of up to 9, memory scoped to member×space). The five compounding moats. Why same backend, multiple surfaces.

**2. Brand Essence** — Purpose, mission, vision. Brand promise ("She remembers, so you don't have to."). Brand archetype (The Caregiver × The Sage — warm intelligence). Three brand values: *Compounding Trust, Quiet Competence, Human Warmth*.

**3. The Olive Persona** — Who Olive is as a character: a sharp, warm friend who texts back fast; remembers your gate code, your partner's birthday, and what your client said three weeks ago. Never robotic, never theatrical. Specific personality dimensions on a scale (formal↔casual, serious↔playful, reserved↔expressive, traditional↔innovative) with the exact dial position and rationale.

**4. Voice & Tone Principles** — The seven non-negotiables, derived from `SYSTEM_CORE_V1` and our shipped copy:
   - **Produce, don't describe** (deliver the result, not a description of what she could do)
   - **Mine the context** (reference real tasks/memories, never generic advice)
   - **Warm, direct, concise** (smart friend texting energy; emojis sparingly)
   - **Never re-ask** (memory is the product; repetition is the failure state)
   - **Match the user** (language, register, length)
   - **Capture-Offer-Confirm-Execute** is the conversational rhythm
   - **Beta-transparent** (we say "Beta," we don't pretend we're finished)
   
   Tone matrix by context: *Onboarding, Daily capture, Recall, Errors, Empty states, Celebrations, B2B/Real Estate, Partner relay*.

**5. Copy System** — Headline patterns, subhead patterns, CTA patterns (with do/don't pairs from real shipped copy). Microcopy library: confirmations, undos, empty states, loading, errors. Forbidden words list ("simply," "just," "powerful," "revolutionary," "delight"). Naming conventions: *Olive* (always capitalized, female pronouns), *Space* (the universal container), *Capture* (the verb + noun for input), *Compiled Artifact* (internal term — externally: "summary," "list," "recap"). Surface-specific lexicon (Consumer vs. Olive for Real Estate).

**6. Visual Identity — Color** — The full token system from `index.css`:
   - Primary: Hunter Green `hsl(130 22% 29%)` / `#3A5A40`
   - Accent: Warm Coral `hsl(18 75% 60%)` / `#E8956F`
   - Magic/AI: Muted Gold `hsl(45 85% 74%)` / `#F4E285`
   - Backgrounds: Warm Beige `#FDFDF8`, Desk Stone `#EAE8E0`, Paper `#FDFCF8`
   - Semantic: priority high/medium/low, success/info/warning, sage, cream
   - Dark mode mappings
   - Usage rules: when to use Magic Gold vs. Coral, primary green dominance ratio, accessibility contrast minimums (WCAG AA on all text).

**7. Visual Identity — Typography** — Fraunces (serif, display + headings) and Plus Jakarta Sans (body). Type scale, line-height, tracking. Heading classes (`.heading-display`, `.heading-page`, `.heading-card`). The 16px iOS-zoom rule. Multilingual considerations (en/it/es).

**8. Visual Language — Surfaces & Materials** — The "Frosted Glass on Warm Sand" aesthetic. Card system (`card-glass`, `card-elevated`, `card-magic`). Squircle icons (28% radius). Pill buttons. Paper inputs (floating, soft shadow). Atmospheric gradients. Shadow scale (sm → float). Border radius scale. The "Apple Notes meets Notion meets a really good notebook" mood board reference.

**9. Motion & Interaction** — The animation library (fade-in, fade-up, scale-in, slide-up, pulse-soft, shimmer, bounce-subtle). 0.3s ease-out as default. Optimistic UX (5-second undo). Hover-lift on desktop, active-scale on mobile. `prefers-reduced-motion` respect. Haptics on iOS. The "5-second rule" — every interaction must feel sub-perceptual.

**10. Logo, Iconography, Imagery** — OliveLogo usage rules, BetaBadge pairing, clearspace, minimum sizes, do/don't. Iconography: lucide-react only, 5px stroke equivalent, squircle wraps for emphasis. Photography/illustration direction: warm, organic, human-first; no stock-photo gloss; sketch-style chat bubbles in product visuals (per `SuperpowersGrid` references).

**11. Product Architecture as Brand** — Why Space, Capture, Compiled Artifact are the brand's spine, not just engineering primitives:
   - **Space** = "the room you invite Olive into" — naming, UI metaphor (rooms, not channels), member capacity (1–9), privacy boundary as design language
   - **Capture** = "anything you drop in" — never "create a task," always "drop it in" / "tell Olive"
   - **Compiled Artifact** = invisible to users, but underlies the magic of "Olive already knew that"
   - How these primitives express across surfaces: Consumer (personal/partner/family), Olive for Real Estate (agent ↔ client space), future verticals (legal, wealth, healthcare).

**12. Surface System — Consumer vs. B2B** — Same brand DNA, two voices:
   - **Consumer Olive**: warmer, more emoji-tolerant (sparingly), playful headlines ("Stop texting into the void"), pricing language casual
   - **Olive for Real Estate**: same warmth, more precise, professional restraint, vocabulary shifts ("client" vs. "partner," "transaction" vs. "household"), zero emojis in client-facing surfaces, Hunter Green dominates over Coral, Magic Gold reserved for AI moments only
   - Side-by-side example pairs (same idea, two surfaces) for: hero headline, onboarding, capture confirmation, error state, empty state.

### Appendices
- **A. Quick reference cheat sheet** (1-page printable: colors, type, voice rules, do/don't)
- **B. Component-to-token map** (which classes to use for which moments)
- **C. Voice prompt for AI agents** (drop-in system prompt fragment so any LLM-generated copy stays on-brand — derived from `SYSTEM_CORE_V1` and extended)
- **D. Vocabulary glossary** (Space, Capture, Compiled Artifact, Brain Dump, Skill, Heartbeat, Thread, Member — internal vs. external naming)
- **E. Anti-patterns** — screenshots/snippets of off-brand work with annotations
- **F. Versioning & evolution rules** (when to amend, who approves, how to deprecate a token)

### What this delivers
A single artifact that:
- Any new designer, writer, engineer, or vendor can read in 30 minutes and produce on-brand work.
- Codifies the voice that's been emerging in shipped product (`SYSTEM_CORE_V1`, landing copy, onboarding) into explicit rules.
- Connects engineering primitives (Space/Capture/Compiled Artifact) to brand language so consumer and B2B stay coherent.
- Is reusable across decks, partner briefs, agency handoffs, AI prompts, and future vertical launches.

### Files created
- `OLIVE_BRAND_BIBLE.md` (root) — the bible itself
- `/mnt/documents/OLIVE_BRAND_BIBLE.md` — downloadable copy with `<lov-artifact>` for easy export

No code changes, no dependencies, no risk to existing functionality.

