import React from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import { OliveLogo } from "@/components/OliveLogo";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";

interface LoginPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const LoginPromptDialog: React.FC<LoginPromptDialogProps> = ({ 
  open, 
  onOpenChange 
}) => {
  const { t } = useTranslation('common');
  const navigate = useLocalizedNavigate();

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
              {t('loginPrompt.title', 'Sign in to continue')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('loginPrompt.description', 'Create an account or sign in to organize your notes with AI')}
            </DialogDescription>
          </div>

          <div className="flex flex-col gap-3 w-full">
            <Button 
              onClick={handleSignUp}
              className="w-full bg-gradient-olive hover:bg-olive text-white shadow-olive"
            >
              {t('loginPrompt.createAccount', 'Create Account')}
            </Button>
            <Button
              onClick={handleSignIn}
              variant="outline"
              className="w-full border-olive/30 text-olive hover:bg-olive/10"
            >
              {t('loginPrompt.signIn', 'Sign In')}
            </Button>
            <Button
              onClick={() => onOpenChange(false)}
              variant="ghost"
              className="w-full text-muted-foreground hover:text-foreground"
            >
              {t('buttons.cancel', 'Cancel')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};