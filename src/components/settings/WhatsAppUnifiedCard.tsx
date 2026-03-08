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
import { useIsMobile } from '@/hooks/use-mobile';
import { Loader2, Phone, MessageCircle, ExternalLink, Check, CheckCircle2, Send, RefreshCw, Monitor, Smartphone, Copy } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';

/** Shared component for the linking flow (QR on desktop, deep link on mobile) */
const WhatsAppLinkFlow: React.FC<{
  linkData: { token: string; whatsappLink: string; expiresAt: string };
  onReset: () => void;
  onCompleted?: () => void;
  showCompletedButton?: boolean;
}> = ({ linkData, onReset, onCompleted, showCompletedButton }) => {
  const { t } = useTranslation(['profile', 'common']);
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const copyToken = () => {
    navigator.clipboard.writeText(linkData.token);
    toast({
      title: t('profile:whatsappLink.tokenCopied'),
      description: t('profile:whatsappLink.tokenCopiedDesc'),
    });
  };

  const getWebWhatsAppLink = () => {
    try {
      const url = new URL(linkData.whatsappLink);
      const phone = url.pathname.replace('/', '');
      const text = url.searchParams.get('text') || '';
      return `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;
    } catch {
      return linkData.whatsappLink;
    }
  };

  return (
    <div className="space-y-3">
      <Alert>
        <MessageCircle className="h-4 w-4" />
        <AlertDescription>
          {t('profile:whatsappLink.tokenExpires')}
        </AlertDescription>
      </Alert>

      {isMobile ? (
        /* ── Mobile: direct deep link ── */
        <>
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
        </>
      ) : (
        /* ── Desktop: QR code + web.whatsapp.com ── */
        <>
          <div className="flex flex-col items-center gap-3 p-4 bg-muted rounded-xl">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Smartphone className="h-4 w-4" />
              {t('profile:whatsappLink.desktop.scanQR', 'Scan with your phone')}
            </div>
            <div className="bg-white p-3 rounded-lg shadow-sm">
              <QRCodeSVG
                value={linkData.whatsappLink}
                size={180}
                level="M"
                includeMargin={false}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center max-w-[240px]">
              {t('profile:whatsappLink.desktop.scanHint', 'Open your phone camera and scan this code to open WhatsApp with the token pre-filled.')}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex-1 h-px bg-border" />
            <span>{t('profile:signIn.or', 'or')}</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <Button
            onClick={() => window.open(getWebWhatsAppLink(), '_blank')}
            className="w-full"
            variant="outline"
          >
            <Monitor className="mr-2 h-4 w-4" />
            {t('profile:whatsappLink.desktop.openWeb', 'Open WhatsApp Web')}
          </Button>

          <div className="p-3 bg-muted rounded-xl space-y-2">
            <p className="text-xs font-medium text-foreground">
              {t('profile:whatsappLink.desktop.manualTitle', 'Or send this token manually:')}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono bg-background px-3 py-2 rounded border overflow-x-auto">
                {linkData.token}
              </code>
              <Button variant="outline" size="sm" onClick={copyToken}>
                <Copy className="h-3.5 w-3.5 mr-1" />
                {t('profile:whatsappLink.copy')}
              </Button>
            </div>
          </div>
        </>
      )}

      {showCompletedButton && onCompleted && (
        <Button
          variant="outline"
          size="sm"
          onClick={onCompleted}
          className="w-full"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('profile:whatsappLink.iLinkedMyAccount', "I've linked my account")}
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={onReset}
        className="w-full"
      >
        <RefreshCw className="mr-2 h-3.5 w-3.5" />
        {t('profile:whatsappLink.generateNew')}
      </Button>
    </div>
  );
};

export const WhatsAppUnifiedCard: React.FC = () => {
  const { t } = useTranslation(['profile', 'common']);
  const { user } = useAuth();
  const userId = user?.id;
  const { toast } = useToast();

  const [phoneNumber, setPhoneNumber] = useState("");
  const [isPhoneLoading, setIsPhoneLoading] = useState(true);
  const [isPhoneSaving, setIsPhoneSaving] = useState(false);
  const [isLinkLoading, setIsLinkLoading] = useState(false);
  const [linkData, setLinkData] = useState<{ token: string; whatsappLink: string; expiresAt: string } | null>(null);
  const [isTestSending, setIsTestSending] = useState(false);
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    if (userId) fetchPhoneNumber();
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
      const { data, error } = await supabase.functions.invoke('generate-whatsapp-link', { body: {} });
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
      if (error) throw new Error(error.message || 'Edge function invocation failed');
      if (!data?.success) throw new Error(data?.error || 'Send failed');
      setTestSent(true);
      sonnerToast.success(t('profile:whatsapp.testMessage.success'));
      setTimeout(() => setTestSent(false), 5000);
    } catch (error: any) {
      console.error('[TestMessage] Error:', error);
      sonnerToast.error(`${t('profile:whatsapp.testMessage.error')} (${error?.message || 'Unknown error'})`);
    } finally {
      setIsTestSending(false);
    }
  };

  const handleLinkCompleted = async () => {
    await fetchPhoneNumber();
    setLinkData(null);
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
        {t('profile:whatsapp.unifiedDescription')}
      </p>

      {/* Connection Status */}
      {isLinked && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-[hsl(var(--success))]/10 border border-[hsl(var(--success))]/20">
          <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[hsl(var(--success))]">
              {t('profile:whatsapp.connected')}
            </p>
            <p className="text-xs text-muted-foreground">{phoneNumber}</p>
          </div>
        </div>
      )}

      {/* WhatsApp AI Link Section — not linked */}
      {!isLinked && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-[hsl(var(--success))]" />
            <Label className="text-sm font-medium">
              {t('profile:whatsapp.aiTitle')}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('profile:whatsappLink.description')}
          </p>

          {!linkData ? (
            <Button onClick={generateLink} disabled={isLinkLoading} className="w-full" variant="default">
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
            <WhatsAppLinkFlow
              linkData={linkData}
              onReset={() => setLinkData(null)}
              onCompleted={handleLinkCompleted}
              showCompletedButton
            />
          )}
        </div>
      )}

      {/* Send Test Message — only when linked */}
      {isLinked && (
        <>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-primary" />
              <Label className="text-sm font-medium">
                {t('profile:whatsapp.testMessage.title')}
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('profile:whatsapp.testMessage.description')}
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
                  {t('profile:whatsapp.testMessage.sending')}
                </>
              ) : testSent ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4 text-[hsl(var(--success))]" />
                  {t('profile:whatsapp.testMessage.success')}
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {t('profile:whatsapp.testMessage.button')}
                </>
              )}
            </Button>
          </div>

          <Separator />
        </>
      )}

      {/* Phone Number + Re-link sections when linked */}
      {isLinked && (
        <>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" />
              <Label className="text-sm font-medium">
                {t('profile:whatsapp.phoneTitle')}
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('profile:whatsapp.phoneDescription')}
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
            <Button onClick={handleSavePhone} disabled={isPhoneSaving} className="w-full" size="sm">
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

          {/* Re-link WhatsApp */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-[hsl(var(--success))]" />
              <Label className="text-sm font-medium">
                {t('profile:whatsapp.aiTitle')}
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('profile:whatsappLink.description')}
            </p>

            {!linkData ? (
              <Button onClick={generateLink} disabled={isLinkLoading} className="w-full" variant="outline">
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
              <WhatsAppLinkFlow
                linkData={linkData}
                onReset={() => setLinkData(null)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default WhatsAppUnifiedCard;
