import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/clerk-react";
import { getSupabase } from "@/lib/supabaseClient";

export type DefaultPrivacy = "private" | "shared";

export const useDefaultPrivacy = () => {
  const { user } = useUser();
  const [defaultPrivacy, setDefaultPrivacyState] = useState<DefaultPrivacy>("shared");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }
    const supabase = getSupabase();
    supabase
      .from("clerk_profiles")
      .select("default_privacy")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data?.default_privacy) {
          setDefaultPrivacyState(data.default_privacy as DefaultPrivacy);
        }
        setLoading(false);
      });
  }, [user?.id]);

  const saveDefaultPrivacy = useCallback(async (value: DefaultPrivacy) => {
    if (!user?.id) return;
    setSaving(true);
    const supabase = getSupabase();
    await supabase
      .from("clerk_profiles")
      .upsert({ id: user.id, default_privacy: value, updated_at: new Date().toISOString() });
    setDefaultPrivacyState(value);
    setSaving(false);
  }, [user?.id]);

  return { defaultPrivacy, loading, saving, saveDefaultPrivacy };
};
