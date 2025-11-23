import { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, Globe } from "lucide-react";

// Common timezones
const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEDT/AEST)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
];

export function TimezoneField() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [timezone, setTimezone] = useState<string>('America/New_York');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanged, setHasChanged] = useState(false);

  useEffect(() => {
    const fetchTimezone = async () => {
      if (!user?.id) return;

      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('clerk_profiles')
          .select('timezone')
          .eq('id', user.id)
          .single();

        if (error) throw error;

        if (data?.timezone) {
          setTimezone(data.timezone);
        } else {
          // Try to detect user's timezone from browser
          const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (detectedTimezone && TIMEZONES.some(tz => tz.value === detectedTimezone)) {
            setTimezone(detectedTimezone);
            setHasChanged(true); // Mark as changed to prompt saving
          }
        }
      } catch (error) {
        console.error('Error fetching timezone:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTimezone();
  }, [user?.id]);

  const handleSave = async () => {
    if (!user?.id) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('clerk_profiles')
        .update({ timezone })
        .eq('id', user.id);

      if (error) throw error;

      setHasChanged(false);
      toast({
        title: "Timezone updated",
        description: "Your timezone preference has been saved.",
      });
    } catch (error) {
      console.error('Error updating timezone:', error);
      toast({
        title: "Error",
        description: "Failed to update timezone. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Globe className="h-5 w-5 text-muted-foreground mt-0.5" />
        <div className="flex-1 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground mb-1">Your Timezone</p>
            <p className="text-xs text-muted-foreground mb-3">
              Set your timezone so reminders are scheduled correctly
            </p>
          </div>
          
          <Select
            value={timezone}
            onValueChange={(value) => {
              setTimezone(value);
              setHasChanged(true);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasChanged && (
            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full"
              size="sm"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Timezone'
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
