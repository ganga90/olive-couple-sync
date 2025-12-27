import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@clerk/clerk-react";
import { supabase } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Phone } from "lucide-react";

export const PhoneNumberField = () => {
  const { t } = useTranslation('profile');
  const { userId } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (userId) {
      fetchPhoneNumber();
    }
  }, [userId]);

  const fetchPhoneNumber = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("clerk_profiles")
        .select("phone_number")
        .eq("id", userId)
        .single();
      if (error) throw error;
      setPhoneNumber(data?.phone_number || "");
    } catch (error) {
      console.error("Error fetching phone number:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!userId) return;
    try {
      setIsSaving(true);

      // Remove any non-digit characters except +
      const cleanedPhone = phoneNumber.replace(/[^\d+]/g, "");
      const { error } = await supabase.from("clerk_profiles").upsert({
        id: userId,
        phone_number: cleanedPhone || null,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
      toast.success(t('phoneField.success'));
      setPhoneNumber(cleanedPhone);
    } catch (error) {
      console.error("Error saving phone number:", error);
      toast.error(t('phoneField.error'));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="p-4 bg-card border-border shadow-soft">
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-card border-border shadow-soft">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">{t('phoneField.title')} 🫒</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('phoneField.description')}
        </p>
        <div className="space-y-2">
          <Label htmlFor="phone-number">{t('phoneField.label')}</Label>
          <Input 
            id="phone-number" 
            type="tel" 
            placeholder={t('phoneField.placeholder')} 
            value={phoneNumber} 
            onChange={e => setPhoneNumber(e.target.value)} 
            className="border-border focus:border-primary" 
          />
          <p className="text-xs text-muted-foreground">
            {t('phoneField.hint')}
          </p>
        </div>
        <Button 
          onClick={handleSave} 
          disabled={isSaving} 
          className="w-full"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('phoneField.saving')}
            </>
          ) : (
            t('phoneField.save')
          )}
        </Button>
      </div>
    </Card>
  );
};
