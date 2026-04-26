# Brand — Implementation Status

> **Last updated:** 2026-04-26 — initial brain seed
> Update when brand work ships across surfaces.
> Full brand bible: `OLIVE_BRAND_BIBLE.md` at repo root.
> Operational summary: `.claude/skills/olive-brand/SKILL.md`.

---

## Brand-in-product status

| Surface | Voice | Visual identity | Notes |
|---|---|---|---|
| WhatsApp 1:1 (Olive's responses) | ✅ aligned | n/a | 🌿 prefix consistent, no emoji confetti |
| WhatsApp templates (outbound, outside 24h window) | _verify_ | n/a | check Meta templates list match voice rules |
| Web app (witholive.app/home, lists, calendar) | _verify_ | _verify_ | check for stray "AI-powered" / forbidden words |
| iOS app | _verify_ | _verify_ | App Store screenshots + first-launch copy |
| Marketing landing (witholive.app) | _verify_ | _verify_ | five differentiation pillars, in order |
| Email (transactional) | _TBD_ | _TBD_ | |
| Push notifications | _verify_ | n/a | Olive voice, never marketing voice |

---

## Brand assets — where they live

- **Brand bible:** `OLIVE_BRAND_BIBLE.md` (1,500+ lines, repo root)
- **Brand skill (operational):** `.claude/skills/olive-brand/SKILL.md`
- **Color tokens:** in `tailwind.config.ts` + `OLIVE_BRAND_BIBLE.md` §6
- **Typography:** in `OLIVE_BRAND_BIBLE.md` §7
- **Components:** shadcn primitives styled per `OLIVE_BRAND_BIBLE.md` §11–12
- **Logo / 🌿 motif:** _confirm asset path_

---

## Open brand work

> _TBD — drop items as they appear._

Examples of the kind of work that goes here:
- New WhatsApp template needs voice review
- Landing page hero copy A/B
- Onboarding tour copy refresh
- iOS App Store screenshot refresh
- Push notification copy audit

---

## Brand non-negotiables (quick reference — full rules in skill)

- **Tagline:** "She remembers, so you don't have to." — never change
- **Category frame:** "shared memory for the people you care about" — not "AI assistant"
- **🌿 motif:** prefix when Olive speaks; never paired with other emojis
- **Forbidden words:** AI-powered, leveraging, seamless, supercharge, 10x, platform, solution, enterprise-grade (full list in skill)
- **Voice test:** "would a friend say this?" — if no, rewrite
- **Discipline:** say less

---

## Recent brand decisions

> Append with date when brand-relevant decisions are made.

- **2026-04-21** — Brand Bible v1.0 published (`OLIVE_BRAND_BIBLE.md`, 1,563 lines).
