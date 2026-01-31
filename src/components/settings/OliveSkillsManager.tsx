import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Sparkles, ShoppingCart, Home, Utensils, Gift, PiggyBank, Users } from 'lucide-react';

interface Skill {
  skill_id: string;
  name: string;
  description: string | null;
  category: string | null;
  triggers: string[];
}

interface UserSkill {
  skill_id: string;
  enabled: boolean;
  config: Record<string, any>;
}

const categoryIcons: Record<string, React.ReactNode> = {
  shopping: <ShoppingCart className="h-5 w-5" />,
  household: <Home className="h-5 w-5" />,
  food: <Utensils className="h-5 w-5" />,
  personal: <Gift className="h-5 w-5" />,
  finance: <PiggyBank className="h-5 w-5" />,
  general: <Sparkles className="h-5 w-5" />,
};

const categoryColors: Record<string, string> = {
  shopping: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  household: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  food: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  personal: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
  finance: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  general: 'bg-muted text-muted-foreground',
};

export function OliveSkillsManager() {
  const { t } = useTranslation('profile');
  const { user } = useAuth();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [userSkills, setUserSkills] = useState<Map<string, UserSkill>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [togglingSkill, setTogglingSkill] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id) {
      loadSkills();
    }
  }, [user?.id]);

  const loadSkills = async () => {
    setIsLoading(true);
    try {
      // Fetch all available skills
      const { data: allSkills, error: skillsError } = await supabase
        .from('olive_skills')
        .select('skill_id, name, description, category, triggers')
        .eq('is_active', true)
        .order('category')
        .order('name');

      if (skillsError) throw skillsError;

      // Fetch user's installed skills
      const { data: installedSkills, error: userSkillsError } = await supabase
        .from('olive_user_skills')
        .select('skill_id, enabled, config')
        .eq('user_id', user?.id);

      if (userSkillsError) throw userSkillsError;

      setSkills(allSkills || []);
      
      const userSkillsMap = new Map<string, UserSkill>();
      installedSkills?.forEach(skill => {
        userSkillsMap.set(skill.skill_id!, {
          skill_id: skill.skill_id!,
          enabled: skill.enabled ?? true,
          config: skill.config as Record<string, any> || {},
        });
      });
      setUserSkills(userSkillsMap);
    } catch (error) {
      console.error('Failed to load skills:', error);
      toast.error(t('skills.errorLoading'));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSkill = async (skillId: string, enabled: boolean) => {
    if (!user?.id) return;
    
    setTogglingSkill(skillId);
    try {
      const existingSkill = userSkills.get(skillId);
      
      if (existingSkill) {
        // Update existing user skill
        const { error } = await supabase
          .from('olive_user_skills')
          .update({ enabled, last_used_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .eq('skill_id', skillId);

        if (error) throw error;
      } else {
        // Install skill for the first time
        const { error } = await supabase
          .from('olive_user_skills')
          .insert({
            user_id: user.id,
            skill_id: skillId,
            enabled: true,
            config: {},
          });

        if (error) throw error;
      }

      // Update local state
      setUserSkills(prev => {
        const updated = new Map(prev);
        updated.set(skillId, {
          skill_id: skillId,
          enabled,
          config: existingSkill?.config || {},
        });
        return updated;
      });

      toast.success(enabled ? t('skills.enabled') : t('skills.disabled'));
    } catch (error) {
      console.error('Failed to toggle skill:', error);
      toast.error(t('skills.errorToggle'));
    } finally {
      setTogglingSkill(null);
    }
  };

  const isSkillEnabled = (skillId: string): boolean => {
    const userSkill = userSkills.get(skillId);
    return userSkill?.enabled ?? false;
  };

  if (!user) {
    return (
      <div className="text-sm text-muted-foreground py-4">
        {t('skills.signInRequired')}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Group skills by category
  const groupedSkills = skills.reduce((acc, skill) => {
    const category = skill.category || 'general';
    if (!acc[category]) acc[category] = [];
    acc[category].push(skill);
    return acc;
  }, {} as Record<string, Skill[]>);

  const categoryOrder = ['household', 'shopping', 'food', 'personal', 'finance', 'general'];
  const sortedCategories = Object.keys(groupedSkills).sort(
    (a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b)
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('skills.subtitle')}
      </p>

      <div className="grid gap-3">
        {sortedCategories.map(category => (
          <div key={category} className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground capitalize">
              {categoryIcons[category] || <Sparkles className="h-4 w-4" />}
              {t(`skills.categories.${category}`, category)}
            </div>
            
            <div className="grid gap-2">
              {groupedSkills[category].map(skill => (
                <Card key={skill.skill_id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium text-sm truncate">
                            {skill.name}
                          </h4>
                          <Badge 
                            variant="secondary" 
                            className={`text-xs ${categoryColors[category] || categoryColors.general}`}
                          >
                            {t(`skills.categories.${category}`, category)}
                          </Badge>
                        </div>
                        
                        {skill.description && (
                          <p className="text-xs text-muted-foreground mb-2">
                            {skill.description}
                          </p>
                        )}
                        
                        {skill.triggers && skill.triggers.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {skill.triggers.slice(0, 3).map((trigger, idx) => (
                              <Badge 
                                key={idx} 
                                variant="outline" 
                                className="text-xs font-mono"
                              >
                                {trigger}
                              </Badge>
                            ))}
                            {skill.triggers.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{skill.triggers.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-shrink-0">
                        {togglingSkill === skill.skill_id ? (
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        ) : (
                          <Switch
                            checked={isSkillEnabled(skill.skill_id)}
                            onCheckedChange={(checked) => toggleSkill(skill.skill_id, checked)}
                          />
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="pt-2 border-t">
        <p className="text-xs text-muted-foreground">
          {t('skills.enabledCount', { count: Array.from(userSkills.values()).filter(s => s.enabled).length })}
        </p>
      </div>
    </div>
  );
}

export default OliveSkillsManager;
