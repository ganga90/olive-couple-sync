/**
 * SpaceNameStep — Onboarding beat for naming the user's first Space.
 *
 * Renders different UI based on the scope chosen in the prior quiz step:
 *   - "Just Me"          → solo space, single name field with smart default
 *   - "Me & My Partner"  → couple space, name + partner-name field
 *   - "My Family"        → family space, single name with household default
 *   - "My Business"      → business space, single name with workspace default
 *
 * The smart default keeps friction low; the field stays editable so power
 * users can own the name. Tooltip below reminds users they can create more
 * Spaces later — addresses the "I didn't know I could make more" problem.
 *
 * Memory wiring:
 *   The Space row + auto-generated Space Soul are produced by the parent
 *   (Onboarding.tsx) via createSpace() / createCouple(). This component
 *   only collects names — actual writes happen on submit.
 */
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, ArrowLeft, Sparkles, Info } from "lucide-react";
import { OliveLogo } from "@/components/OliveLogo";

export type OnboardingScope =
  | "Just Me"
  | "Me & My Partner"
  | "My Family"
  | "My Business";

export interface SpaceNameStepValues {
  spaceName: string;
  partnerName: string; // empty unless scope === "Me & My Partner"
}

interface Props {
  scope: OnboardingScope | null;
  firstName: string;
  lastName: string;
  initialValues?: Partial<SpaceNameStepValues>;
  loading: boolean;
  onBack: () => void;
  onSubmit: (values: SpaceNameStepValues) => void;
}

/**
 * Compute the smart default name for a Space based on scope + identity.
 * Falls back to generic strings when names are missing.
 */
function defaultSpaceName(
  scope: OnboardingScope | null,
  firstName: string,
  lastName: string,
  partnerName: string,
): string {
  const fn = (firstName || "").trim();
  const ln = (lastName || "").trim();
  const pn = (partnerName || "").trim();

  switch (scope) {
    case "Just Me":
      return fn ? `${fn}'s Space` : "My Space";
    case "Me & My Partner":
      if (fn && pn) return `${fn} & ${pn}`;
      if (fn) return `${fn} & ___`;
      return "Our Space";
    case "My Family":
      return ln ? `The ${ln} Household` : "Our Household";
    case "My Business":
      return fn ? `${fn}'s Workspace` : "My Workspace";
    default:
      return "My Space";
  }
}

export const SpaceNameStep: React.FC<Props> = ({
  scope,
  firstName,
  lastName,
  initialValues,
  loading,
  onBack,
  onSubmit,
}) => {
  const [partnerName, setPartnerName] = useState(
    initialValues?.partnerName || "",
  );
  const [spaceName, setSpaceName] = useState(
    initialValues?.spaceName ||
      defaultSpaceName(scope, firstName, lastName, partnerName),
  );
  // Tracks whether the user has manually edited the name. While false, the
  // name auto-syncs to the smart default (esp. when partnerName changes for
  // couple scope). After first manual edit, we stop auto-syncing.
  const [nameTouched, setNameTouched] = useState(
    Boolean(initialValues?.spaceName),
  );

  // Re-derive default when partnerName changes, but only if user hasn't
  // taken ownership of the field yet.
  useEffect(() => {
    if (nameTouched) return;
    setSpaceName(defaultSpaceName(scope, firstName, lastName, partnerName));
  }, [partnerName, scope, firstName, lastName, nameTouched]);

  const isCouple = scope === "Me & My Partner";

  const canSubmit =
    spaceName.trim().length > 0 &&
    (!isCouple || partnerName.trim().length > 0);

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      spaceName: spaceName.trim(),
      partnerName: partnerName.trim(),
    });
  };

  // Header copy keyed off scope — keeps Olive's voice consistent (no exclamation,
  // no "personal assistant" framing per OLIVE_BRAND_BIBLE).
  const headerCopy = (() => {
    switch (scope) {
      case "Just Me":
        return {
          title: "Name your Space.",
          subtext: "This is where Olive will hold what's on your mind.",
        };
      case "Me & My Partner":
        return {
          title: "Set up your shared Space.",
          subtext:
            "Olive will keep memory shared between you two — and private from anyone else.",
        };
      case "My Family":
        return {
          title: "Name your family Space.",
          subtext: "Everyone you invite shares this space's memory.",
        };
      case "My Business":
        return {
          title: "Name your workspace.",
          subtext:
            "Olive will track clients, deadlines, and decisions here.",
        };
      default:
        return {
          title: "Name your Space.",
          subtext: "Where Olive will remember what matters.",
        };
    }
  })();

  return (
    <div className="w-full max-w-md animate-fade-up space-y-6">
      <div className="flex justify-center mb-2">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 shadow-card border border-primary/20">
          <OliveLogo size={32} />
        </div>
      </div>

      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground font-serif">
          {headerCopy.title}
        </h1>
        <p className="text-muted-foreground">{headerCopy.subtext}</p>
      </div>

      <Card className="p-5 bg-card/80 border-border/50 shadow-card space-y-4">
        {isCouple && (
          <div className="space-y-2">
            <Label htmlFor="partner-name" className="text-foreground font-medium">
              Partner's first name
            </Label>
            <Input
              id="partner-name"
              value={partnerName}
              onChange={(e) => setPartnerName(e.target.value)}
              placeholder="e.g. Sarah"
              autoComplete="off"
              disabled={loading}
              className="h-11 text-base"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="space-name" className="text-foreground font-medium">
            Space name
          </Label>
          <Input
            id="space-name"
            value={spaceName}
            onChange={(e) => {
              setSpaceName(e.target.value);
              setNameTouched(true);
            }}
            placeholder="My Space"
            autoComplete="off"
            disabled={loading}
            className="h-11 text-base"
          />
        </div>

        <div className="flex items-start gap-2 text-xs text-muted-foreground pt-1">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            You can create more Spaces anytime — one per group of people you
            share life with.
          </span>
        </div>
      </Card>

      <div className="flex gap-3">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={loading}
          className="h-12"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || loading}
          className="flex-1 h-12 text-base group"
        >
          {loading ? (
            <>
              <Sparkles className="w-4 h-4 mr-2 animate-spin" />
              Creating your Space…
            </>
          ) : (
            <>
              Create Space
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

export default SpaceNameStep;
