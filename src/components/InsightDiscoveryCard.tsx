import React, { useState, useEffect } from 'react';
import { Sparkles, Lightbulb, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface MemoryInsight {
  id: string;
  suggested_content: string;
  source: string;
  confidence_score: number | null;
  status: string;
  created_at: string;
}

export function InsightDiscoveryCard() {
  const { t } = useTranslation('home');
  const { user } = useAuth();
  const userId = user?.id;
  
  const [insights, setInsights] = useState<MemoryInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (userId) {
      loadPendingInsights();
    }
  }, [userId]);

  async function loadPendingInsights() {
    if (!userId) return;
    
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('memory_insights')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setInsights(data || []);
    } catch (error) {
      console.error('Failed to load insights:', error);
    } finally {
      setLoading(false);
    }
  }

  async function approveInsight(insight: MemoryInsight) {
    if (!userId || processingId) return;
    
    try {
      setProcessingId(insight.id);
      
      // 1. Update insight status to approved
      const { error: updateError } = await supabase
        .from('memory_insights')
        .update({ status: 'approved' })
        .eq('id', insight.id);

      if (updateError) throw updateError;

      // 2. Insert into memories table via manage-memories function
      const { data, error: insertError } = await supabase.functions.invoke('manage-memories', {
        body: {
          action: 'add',
          user_id: userId,
          title: insight.suggested_content.substring(0, 50),
          content: insight.suggested_content,
          category: 'inferred',
          importance: 4,
          metadata: {
            auto_extracted: true,
            confidence: insight.confidence_score,
            source: 'insight_engine'
          }
        }
      });

      if (insertError) throw insertError;

      // 3. Animate out and show success
      setDismissedIds(prev => new Set(prev).add(insight.id));
      toast.success(t('insights.memorySaved', "Memory saved. I'll use this context to help you in the future."));
      
      // Remove from local state after animation
      setTimeout(() => {
        setInsights(prev => prev.filter(i => i.id !== insight.id));
      }, 300);
      
    } catch (error) {
      console.error('Failed to approve insight:', error);
      toast.error(t('insights.error', 'Failed to save memory'));
    } finally {
      setProcessingId(null);
    }
  }

  async function rejectInsight(insight: MemoryInsight) {
    if (!userId || processingId) return;
    
    try {
      setProcessingId(insight.id);
      
      const { error } = await supabase
        .from('memory_insights')
        .update({ status: 'rejected' })
        .eq('id', insight.id);

      if (error) throw error;

      // Animate out and show feedback
      setDismissedIds(prev => new Set(prev).add(insight.id));
      toast.success(t('insights.thanksForCorrection', 'Thanks for the correction.'));
      
      // Remove from local state after animation
      setTimeout(() => {
        setInsights(prev => prev.filter(i => i.id !== insight.id));
      }, 300);
      
    } catch (error) {
      console.error('Failed to reject insight:', error);
      toast.error(t('insights.error', 'Failed to update'));
    } finally {
      setProcessingId(null);
    }
  }

  // Don't render if no pending insights or still loading
  if (loading || insights.length === 0) {
    return null;
  }

  // Only show the first pending insight
  const currentInsight = insights.find(i => !dismissedIds.has(i.id));
  
  if (!currentInsight) {
    return null;
  }

  const isDismissing = dismissedIds.has(currentInsight.id);
  const isProcessing = processingId === currentInsight.id;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border transition-all duration-300",
        "bg-gradient-to-r from-primary/5 via-white to-white",
        "border-primary/10 shadow-lg shadow-primary/5",
        isDismissing && "opacity-0 scale-95 translate-y-2"
      )}
    >
      {/* Decorative gradient accent */}
      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary via-primary/60 to-primary/20" />
      
      <div className="p-5 pl-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm font-medium text-primary">
            {t('insights.header', 'Olive noticed something...')}
          </span>
        </div>
        
        {/* Content */}
        <p className="text-base text-stone-800 leading-relaxed mb-4">
          "{currentInsight.suggested_content}"
        </p>
        
        {/* Confidence indicator */}
        {currentInsight.confidence_score && (
          <div className="flex items-center gap-2 mb-4">
            <div className="h-1 flex-1 bg-stone-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full transition-all"
                style={{ width: `${currentInsight.confidence_score * 100}%` }}
              />
            </div>
            <span className="text-xs text-stone-400">
              {Math.round(currentInsight.confidence_score * 100)}% {t('insights.confidence', 'confidence')}
            </span>
          </div>
        )}
        
        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={() => approveInsight(currentInsight)}
            disabled={isProcessing}
            className="rounded-full px-4 gap-2 bg-primary hover:bg-primary/90"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {t('insights.approve', 'Yes, remember this')}
          </Button>
          
          <Button
            size="sm"
            variant="ghost"
            onClick={() => rejectInsight(currentInsight)}
            disabled={isProcessing}
            className="rounded-full px-4 gap-2 text-stone-500 hover:text-stone-700 hover:bg-stone-100"
          >
            <X className="h-4 w-4" />
            {t('insights.reject', 'No, incorrect')}
          </Button>
        </div>
      </div>
    </div>
  );
}
