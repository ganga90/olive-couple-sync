/**
 * CitationBadges Component
 * ============================================================================
 * Feature 2: Recall & Reframe Agent
 *
 * Displays citations/sources used by the RAG system in chat responses.
 * Shows both "facts" (from saved links) and "memories" (from user memories).
 */

import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Link2,
  Brain,
  ExternalLink,
  Info,
  ChevronDown,
  ChevronUp,
  FileText,
  Sparkles
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface Citation {
  type: 'fact' | 'memory';
  label: string;
  url?: string;
  date?: string;
  similarity?: number;
}

export interface SourcesUsed {
  facts: number;
  memories: number;
}

export interface CitationBadgesProps {
  citations: Citation[];
  sourcesUsed?: SourcesUsed;
  compact?: boolean;
  className?: string;
}

// ============================================================================
// INDIVIDUAL CITATION BADGE
// ============================================================================

interface CitationBadgeProps {
  citation: Citation;
  compact?: boolean;
}

const CitationBadge: React.FC<CitationBadgeProps> = ({ citation, compact }) => {
  const isFact = citation.type === 'fact';
  const Icon = isFact ? Link2 : Brain;

  // Parse label to get cleaner display
  const displayLabel = citation.label
    .replace(/^(Link|Memory):\s*/i, '')
    .replace(/\s*from\s+.+$/i, '')
    .substring(0, 30);

  const timeAgo = citation.date
    ? formatDistanceToNow(new Date(citation.date), { addSuffix: true })
    : null;

  const badge = (
    <Badge
      variant="secondary"
      className={cn(
        "cursor-pointer transition-all text-xs font-normal gap-1.5",
        isFact
          ? "bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200"
          : "bg-purple-50 text-purple-700 hover:bg-purple-100 border-purple-200",
        compact && "text-[10px] px-1.5 py-0.5"
      )}
      onClick={() => {
        if (citation.url) {
          window.open(citation.url, '_blank');
        }
      }}
    >
      <Icon className={cn("flex-shrink-0", compact ? "w-3 h-3" : "w-3.5 h-3.5")} />
      <span className="truncate max-w-[120px]">{displayLabel}</span>
      {citation.url && <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-60" />}
    </Badge>
  );

  // Don't use tooltip in compact mode
  if (compact) {
    return badge;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          {badge}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px]">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Icon className={cn(
                "w-4 h-4",
                isFact ? "text-blue-600" : "text-purple-600"
              )} />
              <span className="font-medium text-sm">
                {isFact ? 'Saved Link' : 'Memory'}
              </span>
            </div>

            <p className="text-xs text-muted-foreground">
              {citation.label}
            </p>

            {timeAgo && (
              <p className="text-[10px] text-muted-foreground/70">
                Saved {timeAgo}
              </p>
            )}

            {citation.similarity && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                <Sparkles className="w-3 h-3" />
                <span>
                  {(citation.similarity * 100).toFixed(0)}% relevance
                </span>
              </div>
            )}

            {citation.url && (
              <p className="text-[10px] text-blue-600 truncate">
                {citation.url}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ============================================================================
// SOURCES SUMMARY
// ============================================================================

interface SourcesSummaryProps {
  sourcesUsed: SourcesUsed;
  compact?: boolean;
}

const SourcesSummary: React.FC<SourcesSummaryProps> = ({ sourcesUsed, compact }) => {
  const total = sourcesUsed.facts + sourcesUsed.memories;

  if (total === 0) return null;

  return (
    <div className={cn(
      "flex items-center gap-1.5 text-muted-foreground",
      compact ? "text-[10px]" : "text-xs"
    )}>
      <Info className={cn(compact ? "w-3 h-3" : "w-3.5 h-3.5")} />
      <span>
        Based on{' '}
        {sourcesUsed.facts > 0 && (
          <>
            <span className="font-medium text-blue-600">
              {sourcesUsed.facts} saved link{sourcesUsed.facts !== 1 ? 's' : ''}
            </span>
            {sourcesUsed.memories > 0 && ' and '}
          </>
        )}
        {sourcesUsed.memories > 0 && (
          <span className="font-medium text-purple-600">
            {sourcesUsed.memories} {sourcesUsed.memories !== 1 ? 'memories' : 'memory'}
          </span>
        )}
      </span>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const CitationBadges: React.FC<CitationBadgesProps> = ({
  citations,
  sourcesUsed,
  compact = false,
  className
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!citations || citations.length === 0) {
    return null;
  }

  // Separate facts and memories
  const facts = citations.filter(c => c.type === 'fact');
  const memories = citations.filter(c => c.type === 'memory');

  // Show max 4 in collapsed state
  const maxVisible = compact ? 2 : 4;
  const hasMore = citations.length > maxVisible;
  const visibleCitations = isExpanded ? citations : citations.slice(0, maxVisible);

  return (
    <div className={cn("space-y-2", className)}>
      {/* Sources Summary */}
      {sourcesUsed && (
        <SourcesSummary sourcesUsed={sourcesUsed} compact={compact} />
      )}

      {/* Citation Badges */}
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="flex flex-wrap gap-1.5">
          {visibleCitations.map((citation, index) => (
            <CitationBadge
              key={`${citation.type}-${index}`}
              citation={citation}
              compact={compact}
            />
          ))}

          {hasMore && !isExpanded && (
            <CollapsibleTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  "cursor-pointer hover:bg-muted",
                  compact ? "text-[10px] px-1.5 py-0.5" : "text-xs"
                )}
              >
                +{citations.length - maxVisible} more
                <ChevronDown className="w-3 h-3 ml-1" />
              </Badge>
            </CollapsibleTrigger>
          )}
        </div>

        <CollapsibleContent className="mt-2">
          {/* Additional badges shown when expanded */}
          {isExpanded && hasMore && (
            <div className="space-y-3 pt-2 border-t">
              {/* Facts Section */}
              {facts.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-xs font-medium text-blue-600">
                      Saved Links ({facts.length})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {facts.map((citation, index) => (
                      <CitationBadge
                        key={`fact-${index}`}
                        citation={citation}
                        compact={compact}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Memories Section */}
              {memories.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Brain className="w-3.5 h-3.5 text-purple-600" />
                    <span className="text-xs font-medium text-purple-600">
                      Memories ({memories.length})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {memories.map((citation, index) => (
                      <CitationBadge
                        key={`memory-${index}`}
                        citation={citation}
                        compact={compact}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Collapse Button */}
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full text-xs h-7">
                  <ChevronUp className="w-3 h-3 mr-1" />
                  Show less
                </Button>
              </CollapsibleTrigger>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default CitationBadges;
