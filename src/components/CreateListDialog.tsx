import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, Lock, Users } from "lucide-react";
import { useSupabaseLists } from "@/hooks/useSupabaseLists";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";

interface CreateListDialogProps {
  onListCreated?: () => void;
}

export const CreateListDialog: React.FC<CreateListDialogProps> = ({ onListCreated }) => {
  const { t } = useTranslation('lists');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isShared, setIsShared] = useState(true); // Default to shared if in a couple
  const [loading, setLoading] = useState(false);
  
  const { currentCouple } = useSupabaseCouple();
  const { createList } = useSupabaseLists(currentCouple?.id || null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) return;
    
    setLoading(true);
    
    // Note: createList already uses the coupleId from the hook
    // For shared lists, we pass the coupleId; for private, we override with null
    const result = await createList({
      name: name.trim(),
      description: description.trim() || undefined,
      is_manual: true
    });
    
    // If user wants private and we're in a couple, update the list to remove couple_id
    if (result && !isShared && currentCouple) {
      // The list was created with couple_id by default, but user wants private
      // We need to update it to remove the couple_id
      const supabase = (await import("@/lib/supabaseClient")).getSupabase();
      await supabase
        .from("clerk_lists")
        .update({ couple_id: null })
        .eq("id", result.id);
    }
    
    if (result) {
      setName("");
      setDescription("");
      setIsShared(true);
      setOpen(false);
      onListCreated?.();
    }
    
    setLoading(false);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button className="bg-olive hover:bg-olive/90 text-white touch-target-48">
          <Plus className="h-4 w-4 mr-2" />
          {t('createDialog.newList')}
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="bg-white">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="text-olive-dark">{t('createDialog.title')}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-4 md:px-0">
          <div className="space-y-2">
            <Label htmlFor="list-name" className="text-sm font-medium text-olive-dark">
              {t('createDialog.nameLabel')}
            </Label>
            <Input
              id="list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('createDialog.namePlaceholder')}
              className="border-olive/30 focus:border-olive focus:ring-olive/20 text-base"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="list-description" className="text-sm font-medium text-olive-dark">
              {t('createDialog.descriptionLabel')}
            </Label>
            <Textarea
              id="list-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('createDialog.descriptionPlaceholder')}
              className="border-olive/30 focus:border-olive focus:ring-olive/20 text-base"
              rows={3}
            />
          </div>
          
          {/* Privacy Toggle - only show if user is in a couple */}
          {currentCouple && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-olive-dark">Visibility</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={!isShared ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIsShared(false)}
                  className="flex-1 gap-2 touch-target-44"
                >
                  <Lock className="h-4 w-4" />
                  Private
                </Button>
                <Button
                  type="button"
                  variant={isShared ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIsShared(true)}
                  className="flex-1 gap-2 touch-target-44"
                >
                  <Users className="h-4 w-4" />
                  Shared
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {isShared 
                  ? "Both you and your partner can see and edit this list."
                  : "Only you can see this list."}
              </p>
            </div>
          )}
          
          <ResponsiveDialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="border-olive/30 touch-target-48"
            >
              {t('createDialog.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={loading || !name.trim()}
              className="bg-olive hover:bg-olive/90 text-white touch-target-48"
            >
              {loading ? t('createDialog.creating') : t('createDialog.create')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
};