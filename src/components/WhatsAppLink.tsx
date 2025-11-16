import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MessageCircle, Check, Loader2, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const WhatsAppLink = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [linkData, setLinkData] = useState<{ token: string; whatsappLink: string; expiresAt: string } | null>(null);

  const generateLink = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-whatsapp-link', {
        body: {}
      });

      if (error) throw error;

      setLinkData(data);
      toast({
        title: "WhatsApp Link Generated",
        description: "Click the link below to connect your WhatsApp account.",
      });
    } catch (error) {
      console.error('Error generating WhatsApp link:', error);
      toast({
        title: "Error",
        description: "Failed to generate WhatsApp link. Please try again.",
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
        title: "Token Copied",
        description: "Paste this token in WhatsApp to link your account.",
      });
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Link your WhatsApp to send tasks via messaging
      </p>

      {!linkData ? (
        <Button 
          onClick={generateLink} 
          disabled={loading}
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating Link...
            </>
          ) : (
            <>
              <MessageCircle className="mr-2 h-4 w-4" />
              Link WhatsApp Account
            </>
          )}
        </Button>
      ) : (
        <div className="space-y-3">
          <Alert>
            <MessageCircle className="h-4 w-4" />
            <AlertDescription>
              Your linking token expires in 10 minutes
            </AlertDescription>
          </Alert>

          <div className="p-3 bg-muted rounded-[var(--radius-md)] space-y-2">
            <p className="text-xs font-medium text-foreground">Your Token:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono bg-background px-3 py-2 rounded border">
                {linkData.token}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={copyToken}
              >
                Copy
              </Button>
            </div>
          </div>

          <Button
            onClick={() => window.open(linkData.whatsappLink, '_blank')}
            className="w-full"
            variant="default"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open WhatsApp & Send Token
          </Button>

          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium">Instructions:</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Click the button above to open WhatsApp</li>
              <li>The token message will be pre-filled</li>
              <li>Send the message to complete linking</li>
            </ol>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLinkData(null)}
            className="w-full"
          >
            Generate New Token
          </Button>
        </div>
      )}
    </div>
  );
};
