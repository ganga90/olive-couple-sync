import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabaseClient";
import { Note, OliveTip } from "@/types/note";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useOnboardingTooltip } from "@/hooks/useOnboardingTooltip";
import { OnboardingTooltip } from "@/components/OnboardingTooltip";
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
  Globe,
  Search,
  Brain,
  Wand2
} from "lucide-react";

interface OliveTipsSectionProps {
  note: Note;
  onTipGenerated?: (tip: OliveTip) => void;
}

// Processing stages for loading feedback
type ProcessingStage = 'searching' | 'analyzing' | 'generating';

const STAGE_DURATIONS = {
  searching: 3000,  // 3 seconds for web search
  analyzing: 2000,  // 2 seconds for analysis
  generating: 2000, // 2 seconds for tip generation
};

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

// Enhanced loading skeleton with shimmer
function InsightsSkeleton() {
  return (
    <Card className="p-4 bg-card/50 border-border overflow-hidden">
      <div className="flex gap-4">
        <div className="skeleton w-12 h-12 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-3">
          <div className="skeleton h-4 w-3/4 rounded-md" />
          <div className="skeleton h-3 w-1/2 rounded-md" />
          <div className="skeleton h-16 w-full rounded-xl" />
          <div className="flex gap-2">
            <div className="skeleton h-8 w-24 rounded-full" />
            <div className="skeleton h-8 w-20 rounded-full" />
          </div>
        </div>
      </div>
    </Card>
  );
}

// Processing stage indicator component
function ProcessingStageIndicator({ stage }: { stage: ProcessingStage }) {
  const { t } = useTranslation('notes');
  
  const stageConfig = {
    searching: {
      icon: Search,
      label: t('oliveTips.loading.searching', 'Searching the web...'),
      color: 'text-blue-500',
    },
    analyzing: {
      icon: Brain,
      label: t('oliveTips.loading.analyzing', 'Analyzing information...'),
      color: 'text-purple-500',
    },
    generating: {
      icon: Wand2,
      label: t('oliveTips.loading.generating', 'Generating insights...'),
      color: 'text-[hsl(var(--olive-magic))]',
    },
  };

  const config = stageConfig[stage];
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-3 mb-4">
      <div className={`relative ${config.color}`}>
        <Icon className="h-5 w-5 animate-pulse" />
        {/* Animated ring around icon */}
        <div className="absolute inset-0 -m-1 rounded-full border-2 border-current opacity-30 animate-ping" />
      </div>
      <div className="flex-1">
        <span className="text-sm text-muted-foreground">{config.label}</span>
        {/* Progress dots */}
        <div className="flex gap-1 mt-1">
          <div className={`h-1.5 w-1.5 rounded-full ${stage === 'searching' ? 'bg-current animate-pulse' : 'bg-muted'} ${config.color}`} />
          <div className={`h-1.5 w-1.5 rounded-full ${stage === 'analyzing' ? 'bg-current animate-pulse' : stage === 'generating' ? 'bg-muted-foreground' : 'bg-muted'} ${stage !== 'searching' ? config.color : ''}`} />
          <div className={`h-1.5 w-1.5 rounded-full ${stage === 'generating' ? 'bg-current animate-pulse' : 'bg-muted'} ${stage === 'generating' ? config.color : ''}`} />
        </div>
      </div>
    </div>
  );
}

export function OliveTipsSection({ note, onTipGenerated }: OliveTipsSectionProps) {
  const { t, ready } = useTranslation('notes');
  const [isGenerating, setIsGenerating] = useState(false);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>('searching');
  const [tip, setTip] = useState<OliveTip | null>(() => {
    // Check if note already has tips - handle Json type properly
    const existingTips = note.olive_tips as unknown;
    if (existingTips && typeof existingTips === 'object' && 'status' in (existingTips as OliveTip)) {
      return existingTips as OliveTip;
    }
    return null;
  });
  
  // Onboarding tooltip
  const tipsOnboarding = useOnboardingTooltip('olive_tips_feature');

  // Simulate processing stages for better UX feedback
  useEffect(() => {
    if (!isGenerating) {
      setProcessingStage('searching');
      return;
    }

    // Progress through stages
    const timer1 = setTimeout(() => {
      setProcessingStage('analyzing');
    }, STAGE_DURATIONS.searching);

    const timer2 = setTimeout(() => {
      setProcessingStage('generating');
    }, STAGE_DURATIONS.searching + STAGE_DURATIONS.analyzing);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [isGenerating]);

  if (!ready) return null;

  const handleGenerate = async () => {
    setIsGenerating(true);
    setProcessingStage('searching');
    
    try {
      const { data, error } = await supabase.functions.invoke('generate-olive-tip', {
        body: { note_id: note.id }
      });

      if (error) {
        console.error('Generate tip error:', error);
        toast.error(t('oliveTips.errors.failed', 'Failed to generate tip. Please try again.'));
        return;
      }

      if (data?.tip) {
        setTip(data.tip);
        onTipGenerated?.(data.tip);
        toast.success(t('oliveTips.success', 'Olive found some helpful suggestions!'));
      }
    } catch (e) {
      console.error('Generate tip exception:', e);
      toast.error(t('oliveTips.errors.generic', 'Something went wrong. Please try again.'));
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
    <div className="card-magic p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className={`h-4 w-4 text-[hsl(var(--olive-magic))] ${isGenerating ? 'animate-pulse' : ''}`} />
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">
            {t('oliveTips.title', 'Olive Insights')}
          </span>
        </div>
        {tip && !isGenerating && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={handleRegenerate}
            disabled={isGenerating}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            {t('oliveTips.refresh', 'Refresh')}
          </Button>
        )}
      </div>

      {isGenerating ? (
        <div className="space-y-4 animate-fade-in">
          {/* Stage indicator with progress */}
          <ProcessingStageIndicator stage={processingStage} />
          
          {/* Enhanced skeleton with multiple cards for visual interest */}
          <div className="space-y-3">
            <InsightsSkeleton />
            {/* Second skeleton fades in after a delay for visual progression */}
            <div 
              className="opacity-0 animate-fade-in"
              style={{ animationDelay: '1s', animationFillMode: 'forwards' }}
            >
              <div className="skeleton h-10 w-2/3 rounded-xl" />
            </div>
          </div>
          
          {/* Estimated time hint */}
          <p className="text-xs text-muted-foreground/60 text-center mt-3">
            {t('oliveTips.loading.estimate', 'This usually takes 5-10 seconds...')}
          </p>
        </div>
      ) : tip ? (
        <div className="animate-fade-in">
          {renderTipCard()}
        </div>
      ) : (
        <div className="relative">
          <p className="text-sm text-muted-foreground mb-4">
            {t('oliveTips.ready', 'Ready to analyze this task...')}
          </p>
          <Button
            onClick={() => {
              if (tipsOnboarding.isVisible) {
                tipsOnboarding.dismiss();
              }
              handleGenerate();
            }}
            className="btn-pill bg-primary text-primary-foreground gap-2 w-full sm:w-auto"
          >
            <Sparkles className="h-4 w-4" />
            {t('oliveTips.generate', 'Generate Tips')}
          </Button>
          
          {/* Onboarding Tooltip */}
          <OnboardingTooltip
            isVisible={tipsOnboarding.isVisible}
            onDismiss={tipsOnboarding.dismiss}
            title={t('oliveTips.onboarding.title')}
            description={t('oliveTips.onboarding.description')}
            position="top"
          />
        </div>
      )}
    </div>
  );
}
