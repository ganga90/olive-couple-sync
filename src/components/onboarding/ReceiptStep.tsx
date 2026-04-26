/**
 * ReceiptStep — Final beat of the onboarding flow.
 *
 * Why this exists: every prior beat asked the user for something.
 * The receipt is the moment Olive demonstrates she was paying attention
 * — she echoes back four concrete facts she just learned, sourced from
 * the live data we wrote during onboarding (clerk_profiles, olive_spaces,
 * the user's first clerk_notes row, and the seeded soul layer).
 *
 * This is a transparency moment + a Day-2 hook. The user leaves
 * onboarding with a clear sense of what Olive remembers — which
 * primes them to come back tomorrow expecting Olive to know more.
 *
 * Sourcing strategy: read from in-memory state where possible (no extra
 * round trip on the activation hot path). Fall back to one Supabase query
 * for the latest note IF we don't have it in props. Failures are silent
 * — the receipt always renders something even with partial data.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OliveLogo } from "@/components/OliveLogo";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import type { ProcessNoteResult, ProcessNoteSingle } from "./CapturePreview";

interface Props {
  /** Clerk-provided first name. Used in the greeting bullet. */
  firstName: string;
  /** Active Space name from useSpace().spaceName. */
  spaceName: string;
  /** Active Space type — used for friendlier copy ("our family", "our team"…). */
  spaceType: string | null;
  /** First-capture summary from the demo step, if it happened. */
  demoResult: ProcessNoteResult | null;
  /** Quiz mental-load answers, used as a soul-fact bullet when present. */
  mentalLoad: string[];
  /** User's Clerk ID — used as the fallback note query scope. */
  userId: string | undefined;
  /** Called when the user taps "Open my day". Parent handles navigation + completion. */
  onContinue: () => void;
}

interface ReceiptBullet {
  text: string;
}

/** Pull the human-friendly summary from a single-note shape. */
function summaryFromSingle(note: ProcessNoteSingle): string {
  return (note.summary || "").trim();
}

/**
 * Reduce a process-note result to the most narratable single line.
 * Multi-note: pick the first that has a summary; multi-count is shown
 * as a parenthetical so the user feels how much was captured.
 */
function describeDemoCapture(result: ProcessNoteResult | null): string | null {
  if (!result) return null;
  if ("multiple" in result && result.multiple && Array.isArray(result.notes)) {
    if (result.notes.length === 0) return null;
    const first = summaryFromSingle(result.notes[0]);
    if (!first) return null;
    return result.notes.length > 1
      ? `${first} (and ${result.notes.length - 1} more)`
      : first;
  }
  const single = summaryFromSingle(result as ProcessNoteSingle);
  return single || null;
}

/**
 * Friendly relational descriptor for the space type. Used in the
 * "shared memory in {our family}" bullet so the receipt doesn't say
 * "shared memory in custom" or other internal labels.
 */
function audiencePhrase(spaceType: string | null, spaceName: string): string {
  switch (spaceType) {
    case "couple":
      return `you and your partner in ${spaceName}`;
    case "family":
      return `your family in ${spaceName}`;
    case "household":
      return `your household in ${spaceName}`;
    case "business":
      return `your team in ${spaceName}`;
    case "custom":
      return `everything in ${spaceName}`;
    default:
      return `everything in ${spaceName || "your Space"}`;
  }
}

export const ReceiptStep: React.FC<Props> = ({
  firstName,
  spaceName,
  spaceType,
  demoResult,
  mentalLoad,
  userId,
  onContinue,
}) => {
  // If the demo step was skipped, demoResult is null. As a fallback,
  // fetch the user's most-recent clerk_notes row so the receipt still
  // has a real "you told me…" bullet to show. Best-effort.
  const [fallbackSummary, setFallbackSummary] = useState<string | null>(null);

  useEffect(() => {
    if (demoResult) return; // already have one
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("clerk_notes")
        .select("summary")
        .eq("author_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data?.summary) setFallbackSummary(String(data.summary));
    })();
    return () => {
      cancelled = true;
    };
  }, [demoResult, userId]);

  const bullets = useMemo<ReceiptBullet[]>(() => {
    const out: ReceiptBullet[] = [];

    if (firstName) {
      out.push({ text: `You're ${firstName} — nice to meet you.` });
    }

    if (spaceName) {
      out.push({
        text: `I'll keep memory shared between ${audiencePhrase(spaceType, spaceName)}.`,
      });
    }

    const captureLine =
      describeDemoCapture(demoResult) || fallbackSummary || null;
    if (captureLine) {
      out.push({
        text: `You told me about: "${captureLine}" — saved.`,
      });
    }

    if (mentalLoad.length > 0) {
      // Limit to first 2 to keep the bullet short. The rest are still
      // in the soul layer; this is a teaser, not a full read-back.
      const focuses = mentalLoad.slice(0, 2).join(" and ");
      out.push({
        text: `I'll keep an eye on ${focuses.toLowerCase()} as we go.`,
      });
    } else {
      out.push({
        text: "I'll learn more about you with every brain-dump.",
      });
    }

    // Always cap with a forward-looking promise so the user leaves
    // with a sense of "tomorrow this gets better".
    out.push({
      text: "Come back tomorrow — I'll know more by then.",
    });

    return out;
  }, [firstName, spaceName, spaceType, demoResult, fallbackSummary, mentalLoad]);

  return (
    <div className="w-full max-w-md animate-fade-up space-y-6">
      <div className="flex justify-center mb-2">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 shadow-card border border-primary/20">
          <OliveLogo size={32} />
        </div>
      </div>

      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground font-serif">
          Here's what I've got so far.
        </h1>
        <p className="text-muted-foreground">
          Everything from here on, I'll remember.
        </p>
      </div>

      <Card className="p-5 bg-card/80 border-border/50 shadow-card space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <Sparkles className="w-4 h-4 text-primary" />
          <span>Your starting picture</span>
        </div>

        {bullets.map((bullet, i) => (
          <div
            key={i}
            className="flex items-start gap-2.5 rounded-lg px-2 py-1.5"
          >
            <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <p className="text-sm text-foreground leading-snug">{bullet.text}</p>
          </div>
        ))}
      </Card>

      <Button
        onClick={onContinue}
        className="w-full h-12 text-base group"
      >
        Open my day
        <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
      </Button>
    </div>
  );
};

export default ReceiptStep;
