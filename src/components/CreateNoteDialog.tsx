import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Plus, CheckSquare, ShoppingCart, Home, Plane, Heart, ShoppingBag, Activity, DollarSign, Briefcase, User, Gift, ChefHat, Film, BookOpen, Utensils } from "lucide-react";
import { format } from "date-fns";
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
        dueDate: dueDate?.toISOString() || null,
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-olive hover:bg-olive/90 text-white">
          <Plus className="h-4 w-4 mr-2" />
          Add Note
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-olive-dark">Add New Note</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="note-summary" className="text-sm font-medium text-olive-dark">
              Summary *
            </Label>
            <Input
              id="note-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What needs to be done?"
              className="border-olive/30 focus:border-olive focus:ring-olive/20"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note-details" className="text-sm font-medium text-olive-dark">
              Details (Optional)
            </Label>
            <Textarea
              id="note-details"
              value={originalText}
              onChange={(e) => setOriginalText(e.target.value)}
              placeholder="Add more details..."
              className="border-olive/30 focus:border-olive focus:ring-olive/20"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-olive-dark">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="border-olive/30 focus:border-olive">
                  <SelectValue placeholder="Select category" />
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
              <Label className="text-sm font-medium text-olive-dark">Priority</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as any)}>
                <SelectTrigger className="border-olive/30 focus:border-olive">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-olive-dark">Due Date</Label>
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
                    {dueDate ? format(dueDate, "PPP") : "Pick date"}
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
              <Label className="text-sm font-medium text-olive-dark">List</Label>
              <Select value={selectedListId} onValueChange={setSelectedListId}>
                <SelectTrigger className="border-olive/30 focus:border-olive">
                  <SelectValue placeholder="Select list" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No list</SelectItem>
                  {lists.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="border-olive/30"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !summary.trim()}
              className="bg-olive hover:bg-olive/90 text-white"
            >
              {loading ? "Creating..." : "Create Note"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};