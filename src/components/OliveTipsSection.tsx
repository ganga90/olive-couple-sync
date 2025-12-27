import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Note, OliveTip } from "@/types/note";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { 
  Sparkles, 
  ExternalLink, 
  Phone, 
  MapPin, 
  ShoppingCart, 
  Book,
  Calendar,
  RefreshCw,
  Star,
  Globe
} from "lucide-react";

interface OliveTipsSectionProps {
  note: Note;
  onTipGenerated?: (tip: OliveTip) => void;
}

// Icon mapping
const iconMap: Record<string, React.ReactNode> = {
  'shopping-cart': <ShoppingCart className="h-4 w-4" />,
  'phone': <Phone className="h-4 w-4" />,
  'map-pin': <MapPin className="h-4 w-4" />,
  'external-link': <ExternalLink className="h-4 w-4" />,
  'book': <Book className="h-4 w-4" />,
  'calendar': <Calendar className="h-4 w-4" />,
  'globe': <Globe className="h-4 w-4" />,
};

// Book/Media Tip Card
function BookTipCard({ tip }: { tip: OliveTip }) {
  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex gap-4">
        {tip.metadata?.image && (
          <div className="flex-shrink-0">
            <img 
              src={tip.metadata.image} 
              alt={tip.title}
              className="w-20 h-28 object-cover rounded-md shadow-sm"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-foreground text-sm mb-1">{tip.title}</h4>
          {tip.metadata?.author && (
            <p className="text-xs text-muted-foreground mb-1">by {tip.metadata.author}</p>
          )}
          {tip.metadata?.price && (
            <p className="text-sm font-medium text-primary mb-2">{tip.metadata.price}</p>
          )}
          <p className="text-sm text-muted-foreground mb-3">{tip.summary}</p>
          <div className="flex flex-wrap gap-2">
            {tip.actions.map((action, i) => (
              <Button
                key={i}
                size="sm"
                variant={action.type === 'primary' ? 'default' : 'outline'}
                className="gap-1.5"
                onClick={() => window.open(action.url, '_blank')}
              >
                {action.icon && iconMap[action.icon]}
                {action.label}
                <ExternalLink className="h-3 w-3 opacity-60" />
              </Button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

// Place/Location Tip Card
function PlaceTipCard({ tip }: { tip: OliveTip }) {
  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex gap-4">
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <MapPin className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className="font-semibold text-foreground text-sm">{tip.title}</h4>
            {tip.metadata?.rating && (
              <div className="flex items-center gap-1 text-amber-500">
                <Star className="h-4 w-4 fill-current" />
                <span className="text-xs font-medium">{tip.metadata.rating}</span>
              </div>
            )}
          </div>
          {tip.metadata?.address && (
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {tip.metadata.address}
            </p>
          )}
          {tip.metadata?.phone && (
            <a 
              href={`tel:${tip.metadata.phone}`}
              className="text-xs text-primary hover:underline mb-2 flex items-center gap-1"
            >
              <Phone className="h-3 w-3" />
              {tip.metadata.phone}
            </a>
          )}
          <p className="text-sm text-muted-foreground mb-3">{tip.summary}</p>
          <div className="flex flex-wrap gap-2">
            {tip.metadata?.phone && (
              <Button
                size="sm"
                variant="default"
                className="gap-1.5"
                onClick={() => window.open(`tel:${tip.metadata.phone}`, '_self')}
              >
                <Phone className="h-4 w-4" />
                Call Now
              </Button>
            )}
            {tip.actions.map((action, i) => (
              <Button
                key={i}
                size="sm"
                variant={action.type === 'primary' && !tip.metadata?.phone ? 'default' : 'outline'}
                className="gap-1.5"
                onClick={() => window.open(action.url, '_blank')}
              >
                {action.icon && iconMap[action.icon]}
                {action.label}
                <ExternalLink className="h-3 w-3 opacity-60" />
              </Button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

// Action/Navigational Tip Card
function ActionTipCard({ tip }: { tip: OliveTip }) {
  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex gap-4">
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Globe className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-foreground text-sm mb-1">{tip.title}</h4>
          <p className="text-sm text-muted-foreground mb-3">{tip.summary}</p>
          <div className="flex flex-wrap gap-2">
            {tip.actions.map((action, i) => (
              <Button
                key={i}
                size="sm"
                variant={action.type === 'primary' ? 'default' : 'outline'}
                className="gap-1.5"
                onClick={() => window.open(action.url, '_blank')}
              >
                {action.icon && iconMap[action.icon]}
                {action.label}
                <ExternalLink className="h-3 w-3 opacity-60" />
              </Button>
            ))}
          </div>
        </div>
      </div>
      {tip.metadata?.source && (
        <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border">
          Source: {tip.metadata.source}
        </p>
      )}
    </Card>
  );
}

// General Tip Card
function GeneralTipCard({ tip }: { tip: OliveTip }) {
  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex gap-3 items-start">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-foreground text-sm mb-1">{tip.title}</h4>
          <p className="text-sm text-muted-foreground mb-3">{tip.summary}</p>
          <div className="flex flex-wrap gap-2">
            {tip.actions.map((action, i) => (
              <Button
                key={i}
                size="sm"
                variant={action.type === 'primary' ? 'default' : 'outline'}
                className="gap-1.5"
                onClick={() => window.open(action.url, '_blank')}
              >
                {action.icon && iconMap[action.icon]}
                {action.label}
                <ExternalLink className="h-3 w-3 opacity-60" />
              </Button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

// Loading skeleton
function TipSkeleton() {
  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex gap-4">
        <Skeleton className="w-12 h-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-10 w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      </div>
    </Card>
  );
}

export function OliveTipsSection({ note, onTipGenerated }: OliveTipsSectionProps) {
  const { t, ready } = useTranslation('notes');
  const [isGenerating, setIsGenerating] = useState(false);
  const [tip, setTip] = useState<OliveTip | null>(() => {
    // Check if note already has tips - handle Json type properly
    const existingTips = note.olive_tips as unknown;
    if (existingTips && typeof existingTips === 'object' && 'status' in (existingTips as OliveTip)) {
      return existingTips as OliveTip;
    }
    return null;
  });

  if (!ready) return null;

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-olive-tip', {
        body: { note_id: note.id }
      });

      if (error) {
        console.error('Generate tip error:', error);
        toast.error('Failed to generate tip. Please try again.');
        return;
      }

      if (data?.tip) {
        setTip(data.tip);
        onTipGenerated?.(data.tip);
        toast.success('Olive found some helpful suggestions!');
      }
    } catch (e) {
      console.error('Generate tip exception:', e);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = () => {
    setTip(null);
    handleGenerate();
  };

  // Render tip card based on type
  const renderTipCard = () => {
    if (!tip) return null;

    switch (tip.type) {
      case 'book':
        return <BookTipCard tip={tip} />;
      case 'place':
        return <PlaceTipCard tip={tip} />;
      case 'action':
        return <ActionTipCard tip={tip} />;
      default:
        return <GeneralTipCard tip={tip} />;
    }
  };

  return (
    <div className="rounded-xl bg-card/50 p-4 border border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-medium text-sm text-foreground">
            Tips from Olive
          </h3>
        </div>
        {tip && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleRegenerate}
            disabled={isGenerating}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${isGenerating ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        )}
      </div>

      {isGenerating ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4 animate-pulse text-primary" />
            <span>Olive is thinking...</span>
          </div>
          <TipSkeleton />
        </div>
      ) : tip ? (
        renderTipCard()
      ) : (
        <Button
          variant="outline"
          className="w-full gap-2 h-12 border-dashed"
          onClick={handleGenerate}
        >
          <Sparkles className="h-4 w-4" />
          Ask Olive for Help
        </Button>
      )}
    </div>
  );
}
