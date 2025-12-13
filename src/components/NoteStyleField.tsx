import React, { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Brain, MessageSquare, Sparkles } from "lucide-react";

type NoteStyle = 'auto' | 'succinct' | 'conversational';

interface NoteStyleFieldProps {
  onStyleChange?: (style: NoteStyle) => void;
}

export const NoteStyleField: React.FC<NoteStyleFieldProps> = ({ onStyleChange }) => {
  const { user } = useAuth();
  const [style, setStyle] = useState<NoteStyle>('auto');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchStyle = async () => {
      if (!user?.id) return;
      
      try {
        const { data, error } = await supabase
          .from('clerk_profiles')
          .select('note_style')
          .eq('id', user.id)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Error fetching note style:', error);
          return;
        }

        if (data?.note_style) {
          setStyle(data.note_style as NoteStyle);
        }
      } catch (error) {
        console.error('Error fetching note style:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStyle();
  }, [user?.id]);

  const handleStyleChange = async (newStyle: NoteStyle) => {
    if (!user?.id) return;
    
    setSaving(true);
    const previousStyle = style;
    setStyle(newStyle);

    try {
      const { error } = await supabase
        .from('clerk_profiles')
        .update({ note_style: newStyle, updated_at: new Date().toISOString() })
        .eq('id', user.id);

      if (error) {
        setStyle(previousStyle);
        toast.error('Failed to save preference');
        console.error('Error saving note style:', error);
        return;
      }

      toast.success('Note style updated');
      onStyleChange?.(newStyle);
    } catch (error) {
      setStyle(previousStyle);
      toast.error('Failed to save preference');
      console.error('Error saving note style:', error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-muted rounded w-1/3"></div>
          <div className="h-16 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Choose how you typically write your notes. Olive will adapt to understand your style better.
      </p>
      
      <RadioGroup
        value={style}
        onValueChange={(value) => handleStyleChange(value as NoteStyle)}
        disabled={saving}
        className="space-y-3"
      >
        <div className="flex items-start space-x-3 p-3 rounded-[var(--radius-md)] border border-border hover:border-olive/50 transition-colors cursor-pointer">
          <RadioGroupItem value="auto" id="style-auto" className="mt-0.5" />
          <Label htmlFor="style-auto" className="flex-1 cursor-pointer">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-4 w-4 text-olive" />
              <span className="font-medium">Auto-detect</span>
              <span className="text-xs bg-olive/10 text-olive px-2 py-0.5 rounded-full">Recommended</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Olive automatically detects if you're using quick brain-dumps or conversational messages
            </p>
          </Label>
        </div>

        <div className="flex items-start space-x-3 p-3 rounded-[var(--radius-md)] border border-border hover:border-olive/50 transition-colors cursor-pointer">
          <RadioGroupItem value="succinct" id="style-succinct" className="mt-0.5" />
          <Label htmlFor="style-succinct" className="flex-1 cursor-pointer">
            <div className="flex items-center gap-2 mb-1">
              <Brain className="h-4 w-4 text-primary" />
              <span className="font-medium">Brain-dump style</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Quick, keyword-focused notes like "buy milk, call doctor tomorrow, book restaurant Friday"
            </p>
          </Label>
        </div>

        <div className="flex items-start space-x-3 p-3 rounded-[var(--radius-md)] border border-border hover:border-olive/50 transition-colors cursor-pointer">
          <RadioGroupItem value="conversational" id="style-conversational" className="mt-0.5" />
          <Label htmlFor="style-conversational" className="flex-1 cursor-pointer">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="font-medium">Conversational style</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Natural messages like "Hey, I think we need to pick up the kids on Tuesday and maybe go to dinner Friday"
            </p>
          </Label>
        </div>
      </RadioGroup>
    </div>
  );
};
