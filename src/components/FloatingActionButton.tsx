import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NoteInput } from "@/components/NoteInput";
import { useAuth } from "@/providers/AuthProvider";

export const FloatingActionButton = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { isAuthenticated } = useAuth();

  // Only show FAB for authenticated users
  if (!isAuthenticated) return null;

  return (
    <>
      {/* Floating Action Button */}
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 right-6 h-14 w-14 rounded-full shadow-[var(--shadow-raised)] hover:shadow-olive bg-[hsl(var(--olive-primary))] hover:bg-[hsl(var(--olive-primary))]/90 text-white z-40 transition-all duration-200 hover:scale-110"
        size="icon"
      >
        <Plus className="h-6 w-6" />
      </Button>

      {/* Quick Add Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="bg-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-[hsl(var(--olive-dark))]">Quick Add Note</DialogTitle>
          </DialogHeader>
          <NoteInput 
            onNoteAdded={() => {
              setIsOpen(false);
            }} 
          />
        </DialogContent>
      </Dialog>
    </>
  );
};
