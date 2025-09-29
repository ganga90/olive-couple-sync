import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OliveLogo } from "@/components/OliveLogo";
import { useNavigate } from "react-router-dom";

interface LoginPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const LoginPromptDialog: React.FC<LoginPromptDialogProps> = ({ 
  open, 
  onOpenChange 
}) => {
  const navigate = useNavigate();

  const handleSignIn = () => {
    navigate("/sign-in");
    onOpenChange(false);
  };

  const handleSignUp = () => {
    navigate("/sign-up");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <div className="flex flex-col items-center space-y-6 py-4">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20">
            <OliveLogo size={32} />
          </div>
          
          <div className="text-center space-y-2">
            <DialogTitle className="text-2xl font-bold text-olive-dark">
              Sign in to continue
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Create an account or sign in to organize your notes with AI
            </DialogDescription>
          </div>

          <div className="flex flex-col gap-3 w-full">
            <Button 
              onClick={handleSignUp}
              className="w-full bg-gradient-olive hover:bg-olive text-white shadow-olive"
            >
              Create Account
            </Button>
            <Button 
              onClick={handleSignIn}
              variant="outline"
              className="w-full border-olive/30 text-olive hover:bg-olive/10"
            >
              Sign In
            </Button>
            <Button 
              onClick={() => onOpenChange(false)}
              variant="ghost"
              className="w-full text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};