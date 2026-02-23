import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
  ResponsiveDialogFooter
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Plus, CheckSquare, ShoppingCart, Home, Plane, Heart, ShoppingBag, Activity, DollarSign, Briefcase, User, Gift, ChefHat, Film, BookOpen, Utensils } from "lucide-react";
import { format } from "date-fns";
import { formatDateForStorage } from "@/utils/dateUtils";
import { cn } from "@/lib/utils";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSupabaseLists } from "@/hooks/useSupabaseLists";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { categories } from "@/constants/categories";

const categoryIcons: Record<string, any> = {
  "Groceries": ShoppingCart,
  "Task": CheckSquare,
  "Home Improvement": Home,
  "Travel Idea": Plane,
  "Date Idea": Heart,
  "Shopping": ShoppingBag,
  "Health": Activity,
  "Finance": DollarSign,
  "Work": Briefcase,
  "Personal": User,
  "Gift Ideas": Gift,
  "Recipes": ChefHat,
  "Movies to Watch": Film,
  "Books to Read": BookOpen,
  "Restaurants": Utensils,
};

interface CreateNoteDialogProps {
  onNoteCreated?: () => void;
  preselectedDate?: Date;
}

export const CreateNoteDialog: React.FC<CreateNoteDialogProps> = ({ 
  onNoteCreated,
  preselectedDate 
}) => {
  const { t } = useTranslation('notes');
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "">("");
  const [dueDate, setDueDate] = useState<Date | undefined>(preselectedDate);
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const { currentCouple } = useSupabaseCouple();
  const { addNote } = useSupabaseNotesContext();
  const { lists } = useSupabaseLists(currentCouple?.id || null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!summary.trim()) return;
    
    setLoading(true);
    
    try {
      const noteData = {
        originalText: originalText.trim() || summary.trim(),
        summary: summary.trim(),
        category: category || "General",
        priority: priority || undefined,
        dueDate: dueDate ? formatDateForStorage(dueDate) : null,
        completed: false,
        list_id: selectedListId || undefined,
        tags: [],
        items: []
      };

      await addNote(noteData);
      
      // Reset form
      setSummary("");
      setOriginalText("");
      setCategory("");
      setPriority("");
      setDueDate(preselectedDate);
      setSelectedListId("");
      setOpen(false);
      onNoteCreated?.();
    } catch (error) {
      console.error("Error creating note:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button className="bg-olive hover:bg-olive/90 text-white">
          <Plus className="h-4 w-4 mr-2" />
          {t('createDialog.addNote', 'Add Note')}
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="bg-background max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="text-olive-dark">{t('createDialog.title', 'Add New Note')}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-4 md:px-0">
          <div className="space-y-2">
            <Label htmlFor="note-summary" className="text-sm font-medium text-olive-dark">
              {t('createDialog.summaryLabel', 'Summary *')}
            </Label>
            <Input
              id="note-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={t('createDialog.summaryPlaceholder', 'What needs to be done?')}
              className="border-olive/30 focus:border-olive focus:ring-olive/20"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note-details" className="text-sm font-medium text-olive-dark">
              {t('createDialog.detailsLabel', 'Details (Optional)')}
            </Label>
            <Textarea
              id="note-details"
              value={originalText}
              onChange={(e) => setOriginalText(e.target.value)}
              placeholder={t('createDialog.detailsPlaceholder', 'Add more details...')}
              className="border-olive/30 focus:border-olive focus:ring-olive/20"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-olive-dark">{t('createDialog.category', 'Category')}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="border-olive/30 focus:border-olive">
                  <SelectValue placeholder={t('createDialog.selectCategory', 'Select category')} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => {
                    const IconComponent = categoryIcons[cat] || CheckSquare;
                    return (
                      <SelectItem key={cat} value={cat}>
                        <div className="flex items-center gap-2">
                          <IconComponent className="h-4 w-4" />
                          {cat}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-olive-dark">{t('createDialog.priority', 'Priority')}</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as any)}>
                <SelectTrigger className="border-olive/30 focus:border-olive">
                  <SelectValue placeholder={t('createDialog.priority', 'Priority')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('createDialog.priorityLow', 'Low')}</SelectItem>
                  <SelectItem value="medium">{t('createDialog.priorityMedium', 'Medium')}</SelectItem>
                  <SelectItem value="high">{t('createDialog.priorityHigh', 'High')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-olive-dark">{t('createDialog.dueDate', 'Due Date')}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal border-olive/30",
                      !dueDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dueDate ? format(dueDate, "PPP") : t('createDialog.pickDate', 'Pick date')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={dueDate}
                    onSelect={setDueDate}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-olive-dark">{t('createDialog.list', 'List')}</Label>
              <Select value={selectedListId} onValueChange={setSelectedListId}>
                <SelectTrigger className="border-olive/30 focus:border-olive">
                  <SelectValue placeholder={t('createDialog.selectList', 'Select list')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('createDialog.noList', 'No list')}</SelectItem>
                  {lists.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ResponsiveDialogFooter className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="border-olive/30 flex-1 md:flex-none"
            >
              {t('createDialog.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              disabled={loading || !summary.trim()}
              className="bg-olive hover:bg-olive/90 text-white flex-1 md:flex-none"
            >
              {loading ? t('createDialog.creating', 'Creating...') : t('createDialog.createNote', 'Create Note')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
};