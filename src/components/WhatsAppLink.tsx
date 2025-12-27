import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { MessageCircle, Loader2, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useOnboardingTooltip } from '@/hooks/useOnboardingTooltip';
import { OnboardingTooltip } from '@/components/OnboardingTooltip';

export const WhatsAppLink = () => {
  const { t } = useTranslation('profile');
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [linkData, setLinkData] = useState<{ token: string; whatsappLink: string; expiresAt: string } | null>(null);
  const whatsappOnboarding = useOnboardingTooltip('whatsapp-link');

  const generateLink = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-whatsapp-link', {
        body: {}
      });

      if (error) throw error;

      setLinkData(data);
      toast({
        title: t('whatsappLink.linkGenerated'),
        description: t('whatsappLink.linkGeneratedDesc'),
      });
    } catch (error) {
      console.error('Error generating WhatsApp link:', error);
      toast({
        title: t('common:errors.somethingWentWrong'),
        description: t('whatsappLink.error'),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const copyToken = () => {
    if (linkData) {
      navigator.clipboard.writeText(linkData.token);
      toast({
        title: t('whatsappLink.tokenCopied'),
        description: t('whatsappLink.tokenCopiedDesc'),
      });
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('whatsappLink.description')}
      </p>

      {!linkData ? (
        <div className="relative">
          <Button 
            onClick={() => {
              whatsappOnboarding.dismiss();
              generateLink();
            }} 
            disabled={loading}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('whatsappLink.generating')}
              </>
            ) : (
              <>
                <MessageCircle className="mr-2 h-4 w-4" />
                {t('whatsappLink.generateButton')}
              </>
            )}
          </Button>
          <OnboardingTooltip
            isVisible={whatsappOnboarding.isVisible}
            onDismiss={whatsappOnboarding.dismiss}
            title={t('whatsappLink.onboarding.title')}
            description={t('whatsappLink.onboarding.description')}
            position="top"
          />
        </div>
      ) : (
        <div className="space-y-3">
          <Alert>
            <MessageCircle className="h-4 w-4" />
            <AlertDescription>
              {t('whatsappLink.tokenExpires')}
            </AlertDescription>
          </Alert>

          <div className="p-3 bg-muted rounded-[var(--radius-md)] space-y-2">
            <p className="text-xs font-medium text-foreground">{t('whatsappLink.yourToken')}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono bg-background px-3 py-2 rounded border">
                {linkData.token}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={copyToken}
              >
                {t('whatsappLink.copy')}
              </Button>
            </div>
          </div>

          <Button
            onClick={() => window.open(linkData.whatsappLink, '_blank')}
            className="w-full"
            variant="default"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            {t('whatsappLink.openWhatsapp')}
          </Button>

          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium">{t('whatsappLink.instructions')}</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>{t('whatsappLink.step1')}</li>
              <li>{t('whatsappLink.step2')}</li>
              <li>{t('whatsappLink.step3')}</li>
            </ol>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLinkData(null)}
            className="w-full"
          >
            {t('whatsappLink.generateNew')}
          </Button>
        </div>
      )}
    </div>
  );
};
