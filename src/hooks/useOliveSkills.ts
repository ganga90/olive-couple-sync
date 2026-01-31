/**
 * Olive Skills Hook
 *
 * React hook for managing and using Olive skills.
 * Skills are extensible capabilities that enhance Olive's functionality.
 */

import { useCallback, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';

export interface Skill {
  id: string;
  skill_id: string;
  name: string;
  description: string;
  category: string;
  content: string;
  triggers: SkillTrigger[];
  is_builtin: boolean;
  enabled: boolean;
}

export interface SkillTrigger {
  keyword?: string;
  category?: string;
  command?: string;
  pattern?: string;
}

export interface UserSkill extends Skill {
  user_config?: Record<string, any>;
  user_skill_id?: string;
  usage_count?: number;
  last_used?: string;
}

export interface SkillExecutionResult {
  success: boolean;
  output?: string;
  suggestions?: string[];
  actions?: Array<{
    type: string;
    data: Record<string, any>;
  }>;
  error?: string;
}

export interface SkillMatchResult {
  matched: boolean;
  skill?: Skill;
  trigger_type?: 'keyword' | 'category' | 'command' | 'pattern';
  matched_value?: string;
}

interface UseOliveSkillsReturn {
  isLoading: boolean;
  error: Error | null;

  // Available skills
  availableSkills: Skill[];
  installedSkills: UserSkill[];
  refreshSkills: () => Promise<void>;

  // Skill management
  installSkill: (skillId: string, config?: Record<string, any>) => Promise<void>;
  uninstallSkill: (skillId: string) => Promise<void>;
  configureSkill: (skillId: string, config: Record<string, any>) => Promise<void>;

  // Skill usage
  matchSkill: (message: string, category?: string) => Promise<SkillMatchResult>;
  executeSkill: (
    skillId: string,
    message: string,
    context?: Record<string, any>
  ) => Promise<SkillExecutionResult>;

  // Helpers
  getSkillsByCategory: (category: string) => UserSkill[];
  isSkillInstalled: (skillId: string) => boolean;
}

/**
 * Call the olive-skills edge function
 */
async function callSkillsService(action: string, params: Record<string, any> = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();

  const response = await supabase.functions.invoke('olive-skills', {
    body: { action, ...params },
    headers: session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : undefined,
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return response.data;
}

/**
 * Hook for Olive Skills System
 */
export function useOliveSkills(): UseOliveSkillsReturn {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [installedSkills, setInstalledSkills] = useState<UserSkill[]>([]);

  /**
   * Load skills on mount
   */
  useEffect(() => {
    if (user?.id) {
      refreshSkills().catch(console.error);
    }
  }, [user?.id]);

  /**
   * Refresh available and installed skills
   */
  const refreshSkills = useCallback(async (): Promise<void> => {
    if (!user?.id) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch available and installed skills in parallel
      const [availableResult, installedResult] = await Promise.all([
        callSkillsService('list_available'),
        callSkillsService('list_installed', { user_id: user.id }),
      ]);

      if (availableResult.success) {
        setAvailableSkills(availableResult.skills || []);
      }

      if (installedResult.success) {
        setInstalledSkills(installedResult.skills || []);
      }
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  /**
   * Install a skill
   */
  const installSkill = useCallback(
    async (skillId: string, config?: Record<string, any>): Promise<void> => {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await callSkillsService('install', {
          user_id: user.id,
          skill_id: skillId,
          config,
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to install skill');
        }

        // Refresh skills list
        await refreshSkills();
      } catch (err) {
        setError(err as Error);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [user?.id, refreshSkills]
  );

  /**
   * Uninstall a skill
   */
  const uninstallSkill = useCallback(
    async (skillId: string): Promise<void> => {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await callSkillsService('uninstall', {
          user_id: user.id,
          skill_id: skillId,
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to uninstall skill');
        }

        // Update local state
        setInstalledSkills((prev) =>
          prev.filter((s) => s.skill_id !== skillId)
        );
      } catch (err) {
        setError(err as Error);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [user?.id]
  );

  /**
   * Configure a skill
   */
  const configureSkill = useCallback(
    async (skillId: string, config: Record<string, any>): Promise<void> => {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      const result = await callSkillsService('configure', {
        user_id: user.id,
        skill_id: skillId,
        config,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to configure skill');
      }

      // Update local state
      setInstalledSkills((prev) =>
        prev.map((s) =>
          s.skill_id === skillId ? { ...s, user_config: config } : s
        )
      );
    },
    [user?.id]
  );

  /**
   * Match a message against installed skills
   */
  const matchSkill = useCallback(
    async (message: string, category?: string): Promise<SkillMatchResult> => {
      if (!user?.id) {
        return { matched: false };
      }

      const result = await callSkillsService('match', {
        user_id: user.id,
        message,
        category,
      });

      return result.success ? result : { matched: false };
    },
    [user?.id]
  );

  /**
   * Execute a skill
   */
  const executeSkill = useCallback(
    async (
      skillId: string,
      message: string,
      context?: Record<string, any>
    ): Promise<SkillExecutionResult> => {
      if (!user?.id) {
        return { success: false, error: 'User not authenticated' };
      }

      const result = await callSkillsService('execute', {
        user_id: user.id,
        skill_id: skillId,
        message,
        context,
      });

      return result;
    },
    [user?.id]
  );

  /**
   * Get skills by category
   */
  const getSkillsByCategory = useCallback(
    (category: string): UserSkill[] => {
      return installedSkills.filter(
        (s) => s.category.toLowerCase() === category.toLowerCase()
      );
    },
    [installedSkills]
  );

  /**
   * Check if a skill is installed
   */
  const isSkillInstalled = useCallback(
    (skillId: string): boolean => {
      return installedSkills.some((s) => s.skill_id === skillId);
    },
    [installedSkills]
  );

  return {
    isLoading,
    error,
    availableSkills,
    installedSkills,
    refreshSkills,
    installSkill,
    uninstallSkill,
    configureSkill,
    matchSkill,
    executeSkill,
    getSkillsByCategory,
    isSkillInstalled,
  };
}

export default useOliveSkills;
