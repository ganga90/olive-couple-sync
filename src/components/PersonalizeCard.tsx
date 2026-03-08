import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, X, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/providers/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";

const COMPLETED_KEY = "olive_personalization_completed";

interface PreferenceOption {
  value: string;
  labelKey: string;
  emoji: string;
}

const DIET_OPTIONS: PreferenceOption[] = [
  { value: "none", labelKey: "personalize.diet.none", emoji: "🍽️" },
  { value: "vegetarian", labelKey: "personalize.diet.vegetarian", emoji: "🥦" },
  { value: "vegan", labelKey: "personalize.diet.vegan", emoji: "🌱" },
  { value: "gluten_free", labelKey: "personalize.diet.glutenFree", emoji: "🌾" },
];

const HOUSEHOLD_OPTIONS: PreferenceOption[] = [
  { value: "solo", labelKey: "personalize.household.solo", emoji: "🏠" },
  { value: "couple", labelKey: "personalize.household.couple", emoji: "👫" },
  { value: "family", labelKey: "personalize.household.family", emoji: "👨‍👩‍👧" },
  { value: "roommates", labelKey: "personalize.household.roommates", emoji: "🏡" },
];

const STYLE_OPTIONS: PreferenceOption[] = [
  { value: "auto", labelKey: "personalize.style.auto", emoji: "✨" },
  { value: "succinct", labelKey: "personalize.style.succinct", emoji: "📝" },
  { value: "conversational", labelKey: "personalize.style.conversational", emoji: "💬" },
];

export const PersonalizeCard = () => {
  const { t } = useTranslation("home");
  const { user } = useAuth();

  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem(COMPLETED_KEY) === "true"
  );
  const [hasExistingPrefs, setHasExistingPrefs] = useState<boolean | null>(null);
  const [diet, setDiet] = useState<string | null>(null);
  const [household, setHousehold] = useState<string | null>(null);
  const [style, setStyle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Check if user already has preferences set (note_style !== 'auto' or memory chunks exist)
  useEffect(() => {
    if (!user?.id) return;

    const checkPrefs = async () => {
      try {
        // Check note_style in profile
        const { data: profile } = await supabase
          .from("clerk_profiles")
          .select("note_style")
          .eq("id", user.id)
          .single();

        // Check if user has any personalization memory chunks
        const { data: chunks } = await supabase
          .from("olive_memory_chunks")
          .select("id")
          .eq("user_id", user.id)
          .eq("chunk_type", "preference")
          .limit(1);

        const hasStyle = profile?.note_style && profile.note_style !== "auto";
        const hasChunks = chunks && chunks.length > 0;

        if (hasStyle || hasChunks) {
          setHasExistingPrefs(true);
          localStorage.setItem(COMPLETED_KEY, "true");
        } else {
          setHasExistingPrefs(false);
        }
      } catch {
        setHasExistingPrefs(false);
      }
    };

    checkPrefs();
  }, [user?.id]);

  if (dismissed || hasExistingPrefs === null || hasExistingPrefs) return null;

  const handleDismiss = () => {
    localStorage.setItem(COMPLETED_KEY, "true");
    setDismissed(true);
  };

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);

    try {
      const promises: Promise<any>[] = [];

      // Save note style to profile
      if (style) {
        promises.push(
          supabase
            .from("clerk_profiles")
            .update({ note_style: style, updated_at: new Date().toISOString() })
            .eq("id", user.id)
        );
      }

      // Save diet and household as memory chunks for Olive context
      if (diet && diet !== "none") {
        promises.push(
          supabase.from("olive_memory_chunks").insert({
            user_id: user.id,
            content: `User dietary preference: ${diet}`,
            chunk_type: "preference",
            importance: 4,
            source: "personalization",
            metadata: { type: "diet", value: diet },
          })
        );
      }

      if (household) {
        promises.push(
          supabase.from("olive_memory_chunks").insert({
            user_id: user.id,
            content: `Household type: ${household}`,
            chunk_type: "preference",
            importance: 4,
            source: "personalization",
            metadata: { type: "household", value: household },
          })
        );
      }

      await Promise.all(promises);

      localStorage.setItem(COMPLETED_KEY, "true");
      setDismissed(true);
      toast.success(t("personalize.saved", { defaultValue: "Preferences saved! Olive will use these to help you better." }), { icon: "🫒" });
    } catch (e) {
      console.error("Failed to save preferences:", e);
      toast.error(t("personalize.error", { defaultValue: "Couldn't save. Try again." }));
    } finally {
      setSaving(false);
    }
  };

  const hasAnySelection = diet || household || style;

  const renderOptions = (
    options: PreferenceOption[],
    selected: string | null,
    onSelect: (v: string) => void,
    sectionLabel: string
  ) => (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {sectionLabel}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSelect(selected === opt.value ? null as any : opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all",
              selected === opt.value
                ? "bg-primary text-primary-foreground shadow-md"
                : "bg-muted/60 text-foreground hover:bg-muted"
            )}
          >
            <span>{opt.emoji}</span>
            <span>{t(opt.labelKey, { defaultValue: opt.value })}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Card className="p-4 md:p-5 bg-card/80 border-border/50 shadow-card space-y-4 relative">
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            {t("personalize.title", { defaultValue: "Personalize Olive" })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("personalize.subtitle", { defaultValue: "Help Olive understand your lifestyle for smarter suggestions." })}
          </p>
        </div>
      </div>

      {renderOptions(
        DIET_OPTIONS,
        diet,
        setDiet,
        t("personalize.dietLabel", { defaultValue: "Diet" })
      )}
      {renderOptions(
        HOUSEHOLD_OPTIONS,
        household,
        setHousehold,
        t("personalize.householdLabel", { defaultValue: "Household" })
      )}
      {renderOptions(
        STYLE_OPTIONS,
        style,
        setStyle,
        t("personalize.styleLabel", { defaultValue: "Note style" })
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          onClick={handleSave}
          disabled={!hasAnySelection || saving}
          size="sm"
          className="flex-1"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Check className="w-4 h-4 mr-2" />
          )}
          {t("personalize.save", { defaultValue: "Save" })}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleDismiss} className="text-muted-foreground">
          {t("personalize.skip", { defaultValue: "Skip" })}
        </Button>
      </div>
    </Card>
  );
};
