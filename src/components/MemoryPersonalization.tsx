import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, Edit2, Check, X, Star, Loader2 } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

interface Memory {
  id: string;
  title: string;
  content: string;
  category: string;
  importance: number;
  created_at: string;
  updated_at?: string;
}

const CATEGORIES = [
  { value: 'personal', label: 'Personal' },
  { value: 'preference', label: 'Preference' },
  { value: 'family', label: 'Family' },
  { value: 'pet', label: 'Pets' },
  { value: 'health', label: 'Health' },
  { value: 'dietary', label: 'Dietary' },
  { value: 'work', label: 'Work' },
  { value: 'other', label: 'Other' },
];

export function MemoryPersonalization() {
  const { user } = useAuth();
  const userId = user?.id;
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'view' | 'add'>('view');
  
  // New memory form state
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('personal');
  const [newImportance, setNewImportance] = useState(3);
  
  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

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
      toast.error('Failed to load memories');
    } finally {
      setLoading(false);
    }
  }

  async function addMemory() {
    if (!userId || !newContent.trim()) return;

    try {
      setSaving(true);
      
      // Extract title from content (first line or first 50 chars)
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
        toast.success('Memory saved');
        setNewContent('');
        setNewCategory('personal');
        setNewImportance(3);
        setActiveTab('view');
        await loadMemories();
      }
    } catch (error) {
      console.error('Failed to add memory:', error);
      toast.error('Failed to save memory');
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
        toast.success('Memory updated');
        setEditingId(null);
        await loadMemories();
      }
    } catch (error) {
      console.error('Failed to update memory:', error);
      toast.error('Failed to update memory');
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
        toast.success('Memory deleted');
        await loadMemories();
      }
    } catch (error) {
      console.error('Failed to delete memory:', error);
      toast.error('Failed to delete memory');
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

  const getCategoryLabel = (value: string) => {
    return CATEGORIES.find(c => c.value === value)?.label || value;
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'view' | 'add')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="view">My Memories ({memories.length})</TabsTrigger>
          <TabsTrigger value="add">
            <Plus className="h-4 w-4 mr-1" />
            Add New
          </TabsTrigger>
        </TabsList>

        <TabsContent value="view" className="space-y-3 mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : memories.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground mb-2">No memories yet</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Tell Olive about yourself, your family, pets, preferences, and more
                </p>
                <Button variant="outline" onClick={() => setActiveTab('add')}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add your first memory
                </Button>
              </CardContent>
            </Card>
          ) : (
            memories.map((memory) => (
              <Card key={memory.id} className="shadow-sm">
                <CardContent className="p-4">
                  {editingId === memory.id ? (
                    <div className="space-y-3">
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="min-h-[80px]"
                        autoFocus
                      />
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={cancelEditing}
                          disabled={saving}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => updateMemory(memory.id)}
                          disabled={saving || !editContent.trim()}
                        >
                          {saving ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {getCategoryLabel(memory.category)}
                          </Badge>
                          <span className="text-xs text-muted-foreground flex items-center">
                            {Array.from({ length: memory.importance }).map((_, i) => (
                              <Star key={i} className="h-3 w-3 fill-primary text-primary" />
                            ))}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => startEditing(memory)}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => deleteMemory(memory.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm text-foreground whitespace-pre-wrap">
                        {memory.content}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="add" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Add a memory</CardTitle>
              <p className="text-sm text-muted-foreground">
                Tell Olive something about yourself that will help personalize your experience
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="e.g., I have a dog named Milka. She's a golden retriever and needs her vet checkups every 6 months."
                  className="min-h-[100px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Category</label>
                  <Select value={newCategory} onValueChange={setNewCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Importance</label>
                  <div className="flex items-center gap-1 pt-2">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setNewImportance(level)}
                        className="p-1"
                      >
                        <Star
                          className={`h-5 w-5 ${
                            level <= newImportance
                              ? 'fill-primary text-primary'
                              : 'text-muted-foreground/30'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <Button
                className="w-full"
                onClick={addMemory}
                disabled={saving || !newContent.trim()}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Memory'
                )}
              </Button>
            </CardContent>
          </Card>

          <div className="mt-4 p-4 bg-muted/50 rounded-lg">
            <p className="text-sm text-muted-foreground">
              <strong>Examples of things to remember:</strong>
            </p>
            <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
              <li>"I have 2 kids: Emma (8) and Jack (5)"</li>
              <li>"We're vegetarian and prefer Italian restaurants"</li>
              <li>"My partner's name is Sarah"</li>
              <li>"I prefer morning appointments"</li>
              <li>"Allergic to peanuts"</li>
            </ul>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
