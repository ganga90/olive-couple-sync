import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ChevronDown, ChevronUp, ExternalLink, MessageCircleQuestion } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  searchHelpArticles,
  type HelpArticle,
  type HelpCategoryKey,
} from '@/constants/oliveHelp';

const HelpArticleCard = ({ article, lang }: { article: HelpArticle; lang: 'en' | 'es' | 'it' }) => {
  const [expanded, setExpanded] = useState(false);
  const cat = HELP_CATEGORIES[article.category];

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full text-left p-4 rounded-xl hover:bg-accent/50 active:bg-accent/70 transition-all duration-200 border border-border/40"
    >
      <div className="flex items-start gap-3">
        <span className="text-lg mt-0.5 shrink-0">{cat.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground text-sm leading-snug">
            {article.question[lang]}
          </p>
          {expanded && (
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed whitespace-pre-line animate-fade-up">
              {article.answer[lang]}
            </p>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        )}
      </div>
    </button>
  );
};

export const HelpFAQSection: React.FC = () => {
  const { t, i18n } = useTranslation(['profile', 'common']);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<HelpCategoryKey | 'all'>('all');

  const lang = (i18n.language?.startsWith('es') ? 'es' : i18n.language?.startsWith('it') ? 'it' : 'en') as 'en' | 'es' | 'it';

  const filteredArticles = useMemo(() => {
    if (searchQuery.trim().length >= 2) {
      return searchHelpArticles(searchQuery, lang);
    }
    if (activeCategory === 'all') {
      return HELP_ARTICLES;
    }
    return HELP_ARTICLES.filter(a => a.category === activeCategory);
  }, [searchQuery, activeCategory, lang]);

  const categoryEntries = Object.entries(HELP_CATEGORIES) as [HelpCategoryKey, typeof HELP_CATEGORIES[HelpCategoryKey]][];

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            if (e.target.value.trim().length >= 2) setActiveCategory('all');
          }}
          placeholder={t('profile:help.searchPlaceholder', 'Search help articles...')}
          className="pl-10 rounded-xl border-border/60 bg-background/80"
        />
      </div>

      {/* Category pills */}
      {!searchQuery && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
          <Badge
            variant={activeCategory === 'all' ? 'default' : 'outline'}
            className={cn(
              'cursor-pointer shrink-0 rounded-full px-3 py-1.5 text-xs transition-all',
              activeCategory === 'all' && 'bg-primary text-primary-foreground'
            )}
            onClick={() => setActiveCategory('all')}
          >
            {t('common:all', 'All')}
          </Badge>
          {categoryEntries.map(([key, cat]) => (
            <Badge
              key={key}
              variant={activeCategory === key ? 'default' : 'outline'}
              className={cn(
                'cursor-pointer shrink-0 rounded-full px-3 py-1.5 text-xs transition-all whitespace-nowrap',
                activeCategory === key && 'bg-primary text-primary-foreground'
              )}
              onClick={() => setActiveCategory(key)}
            >
              {cat.icon} {cat[lang]}
            </Badge>
          ))}
        </div>
      )}

      {/* Articles */}
      <div className="space-y-2">
        {filteredArticles.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MessageCircleQuestion className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">
              {t('profile:help.noResults', 'No articles found. Try a different search or ask Olive directly!')}
            </p>
          </div>
        ) : (
          filteredArticles.map(article => (
            <HelpArticleCard key={article.id} article={article} lang={lang} />
          ))
        )}
      </div>

      {/* Ask Olive hint */}
      <div className="text-center pt-2 pb-1">
        <p className="text-xs text-muted-foreground">
          {t('profile:help.askOliveHint', "Can't find what you need? Ask Olive in the chat or on WhatsApp!")}
        </p>
      </div>
    </div>
  );
};

export default HelpFAQSection;
