import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, Edit2, Check, X, Star, Loader2, Sparkles, Search, Filter, Wand2 } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/providers/LanguageProvider';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface Memory {
  id: string;
  title: string;
  content: string;
  category: string;
  importance: number;
  created_at: string;
  updated_at?: string;
  metadata?: {
    auto_extracted?: boolean;
    confidence?: number;
  };
}

const CATEGORIES = [
  { value: 'all', label: 'All', icon: '📋' },
  { value: 'personal', label: 'Personal', icon: '👤' },
  { value: 'preference', label: 'Preference', icon: '⭐' },
  { value: 'family', label: 'Family', icon: '👨‍👩‍👧' },
  { value: 'pet', label: 'Pets', icon: '🐾' },
  { value: 'health', label: 'Health', icon: '💊' },
  { value: 'dietary', label: 'Dietary', icon: '🥗' },
  { value: 'work', label: 'Work', icon: '💼' },
  { value: 'other', label: 'Other', icon: '📝' },
];

const getCategoryInfo = (value: string) => {
  return CATEGORIES.find(c => c.value === value) || { value, label: value, icon: '📝' };
};

export function MemoryPersonalization() {
  const { t } = useTranslation('profile');
  const { user } = useAuth();
  const navigate = useNavigate();
  const { getLocalizedPath } = useLanguage();
  const userId = user?.id;
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState<'view' | 'add'>('view');
  
  // Search and filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  
  // New memory form state
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('personal');
  const [newImportance, setNewImportance] = useState(3);
  
  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Analyze notes function
  async function analyzeNotes() {
    if (!userId || analyzing) return;
    
    try {
      setAnalyzing(true);
      const { data, error } = await supabase.functions.invoke('analyze-notes', {
        body: { user_id: userId }
      });

      if (error) throw error;
      
      if (data?.insight_created) {
        toast.success(data.message || t('memory.patternDetected', 'Pattern detected! Check your home screen.'));
        // Navigate to home to see the insight card
        navigate(getLocalizedPath('/home'));
      } else {
        toast.info(data?.message || t('memory.noPatterns', 'No strong patterns detected.'));
      }
    } catch (error) {
      console.error('Failed to analyze notes:', error);
      toast.error(t('memory.analyzeError', 'Failed to analyze notes'));
    } finally {
      setAnalyzing(false);
    }
  }

  // Filtered memories
  const filteredMemories = useMemo(() => {
    return memories.filter(memory => {
      const matchesSearch = searchQuery === '' || 
        memory.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        memory.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'all' || memory.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [memories, searchQuery, selectedCategory]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: memories.length };
    memories.forEach(m => {
      counts[m.category] = (counts[m.category] || 0) + 1;
    });
    return counts;
  }, [memories]);

  useEffect(() => {
    if (userId) {
      loadMemories();
    }
  }, [userId]);

  async function loadMemories() {
    if (!userId) return;
    
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('manage-memories', {
        body: { action: 'list', user_id: userId }
      });

      if (error) throw error;
      if (data?.success) {
        setMemories(data.memories || []);
      }
    } catch (error) {
      console.error('Failed to load memories:', error);
      toast.error(t('memory.loadingMemories'));
    } finally {
      setLoading(false);
    }
  }

  async function addMemory() {
    if (!userId || !newContent.trim()) return;

    try {
      setSaving(true);
      const title = newContent.split('\n')[0].substring(0, 50) || newContent.substring(0, 50);
      
      const { data, error } = await supabase.functions.invoke('manage-memories', {
        body: {
          action: 'add',
          user_id: userId,
          title,
          content: newContent,
          category: newCategory,
          importance: newImportance,
        }
      });

      if (error) throw error;
      if (data?.success) {
        toast.success(t('memory.memorySaved'));
        setNewContent('');
        setNewCategory('personal');
        setNewImportance(3);
        setActiveTab('view');
        await loadMemories();
      }
    } catch (error) {
      console.error('Failed to add memory:', error);
      toast.error(t('memory.error'));
    } finally {
      setSaving(false);
    }
  }

  async function updateMemory(memoryId: string) {
    if (!userId || !editContent.trim()) return;

    try {
      setSaving(true);
      const title = editContent.split('\n')[0].substring(0, 50) || editContent.substring(0, 50);
      
      const { data, error } = await supabase.functions.invoke('manage-memories', {
        body: {
          action: 'update',
          user_id: userId,
          memory_id: memoryId,
          title,
          content: editContent,
        }
      });

      if (error) throw error;
      if (data?.success) {
        toast.success(t('memory.memoryUpdated'));
        setEditingId(null);
        await loadMemories();
      }
    } catch (error) {
      console.error('Failed to update memory:', error);
      toast.error(t('memory.error'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteMemory(memoryId: string) {
    if (!userId) return;

    try {
      const { data, error } = await supabase.functions.invoke('manage-memories', {
        body: {
          action: 'delete',
          user_id: userId,
          memory_id: memoryId,
        }
      });

      if (error) throw error;
      if (data?.success) {
        toast.success(t('memory.memoryDeleted'));
        await loadMemories();
      }
    } catch (error) {
      console.error('Failed to delete memory:', error);
      toast.error(t('memory.error'));
    }
  }

  function startEditing(memory: Memory) {
    setEditingId(memory.id);
    setEditContent(memory.content);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditContent('');
  }

  return (
    <div className="space-y-4">
      {/* Analyze Notes Button */}
      <Button
        onClick={analyzeNotes}
        disabled={analyzing}
        variant="outline"
        className="w-full gap-2 h-12 bg-gradient-to-r from-primary/5 to-transparent border-primary/20 hover:border-primary/40 hover:bg-primary/10"
      >
        {analyzing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Wand2 className="h-4 w-4 text-primary" />
        )}
        <span className="font-medium">
          {analyzing 
            ? t('memory.analyzing', 'Analyzing your notes...') 
            : t('memory.analyzeButton', '✨ Analyze My Recent Notes')}
        </span>
      </Button>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'view' | 'add')}>
        <TabsList className="grid w-full grid-cols-2 h-11">
          <TabsTrigger value="view" className="gap-2">
            <Sparkles className="h-4 w-4" />
            {t('memory.tabMemories')} ({memories.length})
          </TabsTrigger>
          <TabsTrigger value="add" className="gap-2">
            <Plus className="h-4 w-4" />
            {t('memory.tabAddNew')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="view" className="space-y-4 mt-4">
          {/* Search & Filter */}
          {memories.length > 0 && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('memory.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-11 bg-muted/30 border-0 focus-visible:ring-1"
                />
              </div>
              
              {/* Category Pills */}
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
                {CATEGORIES.filter(c => c.value === 'all' || categoryCounts[c.value]).map((cat) => (
                  <button
                    key={cat.value}
                    onClick={() => setSelectedCategory(cat.value)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all",
                      selectedCategory === cat.value
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <span>{cat.icon}</span>
                    <span>{cat.label}</span>
                    {categoryCounts[cat.value] > 0 && (
                      <span className={cn(
                        "text-xs px-1.5 rounded-full",
                        selectedCategory === cat.value
                          ? "bg-primary-foreground/20"
                          : "bg-muted-foreground/20"
                      )}>
                        {categoryCounts[cat.value]}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
              <p className="text-sm text-muted-foreground mt-3">{t('memory.loadingMemories')}</p>
            </div>
          ) : memories.length === 0 ? (
            <Card className="border-dashed border-2 bg-muted/20">
              <CardContent className="py-10 text-center">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="h-8 w-8 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{t('memory.noMemoriesYet')}</h3>
                <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto">
                  {t('memory.noMemoriesDescription')}
                </p>
                <Button onClick={() => setActiveTab('add')} className="gap-2">
                  <Plus className="h-4 w-4" />
                  {t('memory.addFirstMemory')}
                </Button>
              </CardContent>
            </Card>
          ) : filteredMemories.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">{t('memory.noMatchingMemories')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredMemories.map((memory, index) => {
                const categoryInfo = getCategoryInfo(memory.category);
                
                return (
                  <Card 
                    key={memory.id} 
                    className={cn(
                      "shadow-card overflow-hidden transition-all animate-fade-up",
                      editingId === memory.id && "ring-2 ring-primary"
                    )}
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <CardContent className="p-0">
                      {editingId === memory.id ? (
                        <div className="p-4 space-y-3">
                          <Textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="min-h-[100px] resize-none"
                            autoFocus
                          />
                          <div className="flex gap-2 justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={cancelEditing}
                              disabled={saving}
                            >
                              <X className="h-4 w-4 mr-1" />
                              {t('partnerInfo.cancel')}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => updateMemory(memory.id)}
                              disabled={saving || !editContent.trim()}
                            >
                              {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : (
                                <Check className="h-4 w-4 mr-1" />
                              )}
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex">
                          {/* Category Indicator */}
                          <div className={cn(
                            "w-12 flex-shrink-0 flex items-center justify-center text-xl",
                            "bg-gradient-to-b from-muted/50 to-muted/30"
                          )}>
                            {categoryInfo.icon}
                          </div>
                          
                          <div className="flex-1 p-4">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge 
                                  variant="secondary" 
                                  className="text-xs font-medium"
                                >
                                  {categoryInfo.label}
                                </Badge>
                                {memory.metadata?.auto_extracted && (
                                  <Badge 
                                    variant="outline" 
                                    className="text-xs bg-accent/10 text-accent border-accent/20"
                                  >
                                    <Sparkles className="h-3 w-3 mr-1" />
                                    {t('memory.autoLearned')}
                                  </Badge>
                                )}
                              </div>
                              
                              {/* Importance Stars */}
                              <div className="flex items-center gap-0.5">
                                {Array.from({ length: 5 }).map((_, i) => (
                                  <Star 
                                    key={i} 
                                    className={cn(
                                      "h-3 w-3",
                                      i < memory.importance 
                                        ? "fill-amber-400 text-amber-400" 
                                        : "text-muted-foreground/20"
                                    )} 
                                  />
                                ))}
                              </div>
                            </div>
                            
                            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                              {memory.content}
                            </p>
                            
                            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
                              <span className="text-xs text-muted-foreground">
                                {new Date(memory.created_at).toLocaleDateString()}
                              </span>
                              <div className="flex gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 hover:bg-muted"
                                  onClick={() => startEditing(memory)}
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => deleteMemory(memory.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="add" className="mt-4 space-y-4">
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                {t('memory.addMemoryTitle')}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {t('memory.addMemoryDescription')}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={t('memory.placeholder')}
                className="min-h-[120px] resize-none"
              />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('memory.category')}</label>
                  <Select value={newCategory} onValueChange={setNewCategory}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.filter(c => c.value !== 'all').map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          <span className="flex items-center gap-2">
                            <span>{cat.icon}</span>
                            <span>{cat.label}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('memory.importance')}</label>
                  <div className="flex items-center gap-1 h-11 px-3 rounded-md border bg-background">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setNewImportance(level)}
                        className="p-0.5 transition-transform hover:scale-110"
                      >
                        <Star
                          className={cn(
                            "h-5 w-5 transition-colors",
                            level <= newImportance
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-muted-foreground/30 hover:text-muted-foreground/50'
                          )}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <Button
                className="w-full h-11"
                onClick={addMemory}
                disabled={saving || !newContent.trim()}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('memory.saving')}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    {t('memory.saveMemory')}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Examples Card */}
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-foreground mb-3">
                💡 Examples of things to remember:
              </p>
              <div className="grid gap-2">
                {[
                  "I have 2 kids: Emma (8) and Jack (5)",
                  "We're vegetarian and prefer Italian restaurants",
                  "My partner's name is Sarah",
                  "I prefer morning appointments",
                  "Allergic to peanuts",
                ].map((example, i) => (
                  <button
                    key={i}
                    onClick={() => setNewContent(example)}
                    className="text-left text-sm text-muted-foreground hover:text-foreground p-2 rounded-lg hover:bg-background/50 transition-colors"
                  >
                    "{example}"
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
