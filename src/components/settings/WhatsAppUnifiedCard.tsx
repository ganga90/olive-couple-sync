import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@clerk/clerk-react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Phone, MessageCircle, ExternalLink, Check, CheckCircle2 } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';

export const WhatsAppUnifiedCard: React.FC = () => {
  const { t } = useTranslation(['profile', 'common']);
  const { userId } = useAuth();
  const { toast } = useToast();
  
  // Phone number state
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isPhoneLoading, setIsPhoneLoading] = useState(true);
  const [isPhoneSaving, setIsPhoneSaving] = useState(false);
  
  // WhatsApp link state
  const [isLinkLoading, setIsLinkLoading] = useState(false);
  const [linkData, setLinkData] = useState<{ token: string; whatsappLink: string; expiresAt: string } | null>(null);

  useEffect(() => {
    if (userId) {
      fetchPhoneNumber();
    }
  }, [userId]);

  const fetchPhoneNumber = async () => {
    try {
      setIsPhoneLoading(true);
      const { data, error } = await supabase
        .from("clerk_profiles")
        .select("phone_number")
        .eq("id", userId)
        .single();
      if (error) throw error;
      setPhoneNumber(data?.phone_number || "");
    } catch (error) {
      console.error("Error fetching phone number:", error);
    } finally {
      setIsPhoneLoading(false);
    }
  };

  const handleSavePhone = async () => {
    if (!userId) return;
    try {
      setIsPhoneSaving(true);
      const cleanedPhone = phoneNumber.replace(/[^\d+]/g, "");
      const { error } = await supabase.from("clerk_profiles").upsert({
        id: userId,
        phone_number: cleanedPhone || null,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
      sonnerToast.success(t('profile:phoneField.success'));
      setPhoneNumber(cleanedPhone);
    } catch (error) {
      console.error("Error saving phone number:", error);
      sonnerToast.error(t('profile:phoneField.error'));
    } finally {
      setIsPhoneSaving(false);
    }
  };

  const generateLink = async () => {
    setIsLinkLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-whatsapp-link', {
        body: {}
      });

      if (error) throw error;

      setLinkData(data);
      toast({
        title: t('profile:whatsappLink.linkGenerated'),
        description: t('profile:whatsappLink.linkGeneratedDesc'),
      });
    } catch (error) {
      console.error('Error generating WhatsApp link:', error);
      toast({
        title: t('common:errors.somethingWentWrong'),
        description: t('profile:whatsappLink.error'),
        variant: "destructive",
      });
    } finally {
      setIsLinkLoading(false);
    }
  };

  const copyToken = () => {
    if (linkData) {
      navigator.clipboard.writeText(linkData.token);
      toast({
        title: t('profile:whatsappLink.tokenCopied'),
        description: t('profile:whatsappLink.tokenCopiedDesc'),
      });
    }
  };

  if (isPhoneLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const isConnected = phoneNumber && phoneNumber.length > 5;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {t('profile:whatsapp.unifiedDescription', 'Connect your WhatsApp to receive notifications and chat with Olive AI directly.')}
      </p>

      {/* Connection Status */}
      {isConnected && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-[hsl(var(--success))]/10 border border-[hsl(var(--success))]/20">
          <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[hsl(var(--success))]">
              {t('profile:whatsapp.connected', 'Connected')}
            </p>
            <p className="text-xs text-muted-foreground">{phoneNumber}</p>
          </div>
        </div>
      )}

      {/* Phone Number Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-primary" />
          <Label className="text-sm font-medium">
            {t('profile:whatsapp.phoneTitle', 'Notification Number')}
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('profile:whatsapp.phoneDescription', 'Receive task reminders and updates on this number.')}
        </p>
        <Input 
          type="tel" 
          placeholder={t('profile:phoneField.placeholder')} 
          value={phoneNumber} 
          onChange={e => setPhoneNumber(e.target.value)} 
          className="border-border focus:border-primary" 
        />
        <p className="text-xs text-muted-foreground">
          {t('profile:phoneField.hint')}
        </p>
        <Button 
          onClick={handleSavePhone} 
          disabled={isPhoneSaving} 
          className="w-full"
          size="sm"
        >
          {isPhoneSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('profile:phoneField.saving')}
            </>
          ) : (
            <>
              <Check className="mr-2 h-4 w-4" />
              {t('profile:phoneField.save')}
            </>
          )}
        </Button>
      </div>

      <Separator />

      {/* WhatsApp AI Link Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-[hsl(var(--success))]" />
          <Label className="text-sm font-medium">
            {t('profile:whatsapp.aiTitle', 'AI Chat Link')}
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('profile:whatsappLink.description')}
        </p>

        {!linkData ? (
          <Button 
            onClick={generateLink} 
            disabled={isLinkLoading}
            className="w-full"
            variant="outline"
          >
            {isLinkLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('profile:whatsappLink.generating')}
              </>
            ) : (
              <>
                <MessageCircle className="mr-2 h-4 w-4" />
                {t('profile:whatsappLink.generateButton')}
              </>
            )}
          </Button>
        ) : (
          <div className="space-y-3">
            <Alert>
              <MessageCircle className="h-4 w-4" />
              <AlertDescription>
                {t('profile:whatsappLink.tokenExpires')}
              </AlertDescription>
            </Alert>

            <div className="p-3 bg-muted rounded-xl space-y-2">
              <p className="text-xs font-medium text-foreground">{t('profile:whatsappLink.yourToken')}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono bg-background px-3 py-2 rounded border overflow-x-auto">
                  {linkData.token}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyToken}
                >
                  {t('profile:whatsappLink.copy')}
                </Button>
              </div>
            </div>

            <Button
              onClick={() => window.open(linkData.whatsappLink, '_blank')}
              className="w-full"
              variant="default"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {t('profile:whatsappLink.openWhatsapp')}
            </Button>

            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium">{t('profile:whatsappLink.instructions')}</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>{t('profile:whatsappLink.step1')}</li>
                <li>{t('profile:whatsappLink.step2')}</li>
                <li>{t('profile:whatsappLink.step3')}</li>
              </ol>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLinkData(null)}
              className="w-full"
            >
              {t('profile:whatsappLink.generateNew')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default WhatsAppUnifiedCard;
