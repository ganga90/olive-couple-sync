import { useState, useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { supabase } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Phone } from "lucide-react";
export const PhoneNumberField = () => {
  const {
    userId
  } = useAuth();
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
      const {
        data,
        error
      } = await supabase.from("clerk_profiles").select("phone_number").eq("id", userId).single();
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
      const {
        error
      } = await supabase.from("clerk_profiles").upsert({
        id: userId,
        phone_number: cleanedPhone || null,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
      toast.success("Phone number updated successfully");
      setPhoneNumber(cleanedPhone);
    } catch (error) {
      console.error("Error saving phone number:", error);
      toast.error("Failed to update phone number");
    } finally {
      setIsSaving(false);
    }
  };
  if (isLoading) {
    return <Card className="p-4 bg-white/50 border-olive/20 shadow-soft">
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-olive" />
        </div>
      </Card>;
  }
  return <Card className="p-6 bg-white/50 border-olive/20 shadow-soft">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-olive" />
          <h3 className="text-lg font-semibold text-olive-dark">WhatsApp Integration 🫒</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Connect your WhatsApp to chat with Olive, dump brain notes, and get instant updates about your tasks and lists!
        </p>
        <div className="space-y-2">
          <Label htmlFor="phone-number">Phone Number</Label>
          <Input id="phone-number" type="tel" placeholder="+1234567890" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} className="border-olive/20 focus:border-olive" />
          <p className="text-xs text-muted-foreground">
            Include country code (e.g., +1 for US)
          </p>
        </div>
        <Button onClick={handleSave} disabled={isSaving} className="w-full bg-olive hover:bg-olive/90 text-white">
          {isSaving ? <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </> : "Save Phone Number"}
        </Button>
      </div>
    </Card>;
};