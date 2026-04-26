/**
 * onboarding-flow — Pure helpers that decide which beats + quiz substeps
 * are active for a given onboarding version.
 *
 * Pure functions live here (instead of inside Onboarding.tsx) so the
 * v1 → v2 cohort logic can be unit-tested without spinning up React.
 * Drift between this file and the actual STEPS_ORDER constant in
 * Onboarding.tsx would silently break the funnel — the test suite in
 * supabase/functions/_shared/onboarding-flow-logic.test.ts guards that.
 *
 * Beat dropouts in v2 (vs v1):
 *   - quiz substep 1 (mental-load) → dropped; scope alone drives space type
 *   - regional → dropped; timezone + language are auto-detected silently
 *     and persisted via a side-effect in Onboarding.tsx
 *   - calendar → dropped; replaced with JIT prompt on the Home page when
 *     a process-note response carries a due_date and the user hasn't
 *     yet connected Google Calendar (separate follow-up PR)
 *
 * Anything not in the dropout list is shared between v1 and v2.
 */

export type OnboardingVersion = "v1" | "v2";

export type OnboardingStep =
  | "demoPreview"
  | "quiz"
  | "spaceCreate"
  | "shareSpace"
  | "regional"
  | "whatsapp"
  | "calendar"
  | "demo"
  | "receipt";

// Canonical full-flow ordering. v1 uses this verbatim. v2 derives a
// filtered list by dropping the steps in V2_DROPPED_STEPS below.
//
// `receipt` is the closing transparency beat — Olive echoes back the
// 3–4 facts she just learned. Lives on both v1 and v2 because the
// retention upside (Day-2 hook) applies regardless of cohort.
export const FULL_STEPS_ORDER: OnboardingStep[] = [
  "demoPreview",
  "quiz",
  "spaceCreate",
  "shareSpace",
  "regional",
  "whatsapp",
  "calendar",
  "demo",
  "receipt",
];

const V2_DROPPED_STEPS: ReadonlySet<OnboardingStep> = new Set([
  "regional",
  "calendar",
]);

/**
 * Returns the ordered list of beats to render for a given version.
 * Always returns a non-empty list; the first entry is the entry beat.
 */
export function getStepsForVersion(version: OnboardingVersion): OnboardingStep[] {
  if (version === "v1") return [...FULL_STEPS_ORDER];
  return FULL_STEPS_ORDER.filter((step) => !V2_DROPPED_STEPS.has(step));
}

/**
 * Number of quiz substeps for a given version.
 *   v1: scope + mental-load = 2
 *   v2: scope only          = 1
 *
 * The quiz step is shared between versions but its INTERNAL pagination
 * differs. The Onboarding render uses this to size the progress fraction
 * and to know when to invoke handleQuizComplete.
 */
export function getQuizStepsForVersion(version: OnboardingVersion): number {
  return version === "v2" ? 1 : 2;
}

/**
 * True when a step would render for v2 in any state. Used by the
 * conditional auto-skip + render-guard logic so we don't accidentally
 * leave a v2 user stranded on a beat that v2 has dropped (e.g. after
 * a refresh restores stale state.currentStep === 'regional').
 */
export function isStepActive(
  step: OnboardingStep,
  version: OnboardingVersion,
): boolean {
  if (version === "v1") return true;
  return !V2_DROPPED_STEPS.has(step);
}
