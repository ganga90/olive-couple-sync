import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';

interface TaskList {
  id: string;
  title: string;
}

export function useGoogleTasks() {
  const { user } = useAuth();
  const userId = user?.id;
  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTaskLists = useCallback(async () => {
    if (!userId) return [];
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('google-tasks', {
        body: { user_id: userId, action: 'list_tasklists' }
      });
      if (error) throw error;
      if (data?.success) {
        setTaskLists(data.tasklists || []);
        return data.tasklists || [];
      }
      return [];
    } catch (error) {
      console.error('Failed to fetch task lists:', error);
      return [];
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const createTask = useCallback(async (params: {
    tasklist_id?: string;
    task_title: string;
    task_notes?: string;
    task_due?: string;
  }) => {
    if (!userId) return null;
    try {
      const { data, error } = await supabase.functions.invoke('google-tasks', {
        body: { user_id: userId, action: 'create_task', ...params }
      });
      if (error) throw error;
      if (data?.success) return data.task;
      throw new Error(data?.error || 'Failed to create task');
    } catch (error) {
      console.error('Failed to create Google Task:', error);
      throw error;
    }
  }, [userId]);

  return { taskLists, loading, fetchTaskLists, createTask };
}
