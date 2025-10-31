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
        className="fixed bottom-24 right-6 h-14 w-14 rounded-full shadow-lg hover:shadow-xl bg-primary hover:bg-primary/90 text-primary-foreground z-40 transition-all duration-200 hover:scale-110"
        size="icon"
      >
        <Plus className="h-6 w-6" />
      </Button>

      {/* Quick Add Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="bg-background max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Quick Add Note</DialogTitle>
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
