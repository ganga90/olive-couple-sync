import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Phone, MessageCircle, ExternalLink, Check, CheckCircle2, Send, RefreshCw } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';

export const WhatsAppUnifiedCard: React.FC = () => {
  const { t } = useTranslation(['profile', 'common']);
  const { user } = useAuth();
  const userId = user?.id;
  const { toast } = useToast();

  // Phone number state
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isPhoneLoading, setIsPhoneLoading] = useState(true);
  const [isPhoneSaving, setIsPhoneSaving] = useState(false);

  // WhatsApp link state
  const [isLinkLoading, setIsLinkLoading] = useState(false);
  const [linkData, setLinkData] = useState<{ token: string; whatsappLink: string; expiresAt: string } | null>(null);

  // Test message state
  const [isTestSending, setIsTestSending] = useState(false);
  const [testSent, setTestSent] = useState(false);

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

  const handleSendTestMessage = async () => {
    if (!userId) return;
    if (!phoneNumber || phoneNumber.length < 6) {
      sonnerToast.error(t('profile:whatsapp.testMessage.noPhone'));
      return;
    }

    setIsTestSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-gateway', {
        body: {
          action: 'send',
          message: {
            user_id: userId,
            message_type: 'system_alert',
            content: "Hey, it's Olive here! 🫒 How can I help you? You can send me tasks, reminders, or just chat — I'm here to help you stay organized!",
            priority: 'high',
          },
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Send failed');

      setTestSent(true);
      sonnerToast.success(t('profile:whatsapp.testMessage.success'));
      // Reset sent state after 5 seconds
      setTimeout(() => setTestSent(false), 5000);
    } catch (error) {
      console.error('Error sending test message:', error);
      sonnerToast.error(t('profile:whatsapp.testMessage.error'));
    } finally {
      setIsTestSending(false);
    }
  };

  const handleLinkCompleted = async () => {
    // Refresh phone number from DB after user completes the linking flow
    await fetchPhoneNumber();
    setLinkData(null);
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

  const isLinked = phoneNumber && phoneNumber.length > 5;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {t('profile:whatsapp.unifiedDescription', 'Connect your WhatsApp to receive notifications and chat with Olive AI directly.')}
      </p>

      {/* Connection Status */}
      {isLinked && (
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

      {/* WhatsApp AI Link Section — shown first when not linked */}
      {!isLinked && (
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
              variant="default"
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
                variant="outline"
                size="sm"
                onClick={handleLinkCompleted}
                className="w-full"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('profile:whatsappLink.iLinkedMyAccount', "I've linked my account")}
              </Button>

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
      )}

      {/* Send Test Message Section — shown only after WhatsApp is linked */}
      {isLinked && (
        <>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-primary" />
              <Label className="text-sm font-medium">
                {t('profile:whatsapp.testMessage.title', 'Send Test Message')}
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('profile:whatsapp.testMessage.description', 'Send a test message from Olive to your WhatsApp to verify the integration is working.')}
            </p>
            <Button
              onClick={handleSendTestMessage}
              disabled={isTestSending || testSent}
              className="w-full"
              variant={testSent ? "outline" : "default"}
              size="sm"
            >
              {isTestSending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('profile:whatsapp.testMessage.sending', 'Sending...')}
                </>
              ) : testSent ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4 text-[hsl(var(--success))]" />
                  {t('profile:whatsapp.testMessage.success', 'Test message sent! Check your WhatsApp.')}
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {t('profile:whatsapp.testMessage.button', 'Send Test Message')}
                </>
              )}
            </Button>
          </div>

          <Separator />
        </>
      )}

      {/* Phone Number Section — shown after linked, for manual management */}
      {isLinked && (
        <>
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

          {/* Re-link WhatsApp section for already-linked users */}
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
        </>
      )}
    </div>
  );
};

export default WhatsAppUnifiedCard;
