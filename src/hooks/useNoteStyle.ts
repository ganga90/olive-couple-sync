import { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { supabase } from "@/lib/supabaseClient";

export type NoteStyle = 'auto' | 'succinct' | 'conversational';

export const useNoteStyle = () => {
  const { user } = useAuth();
  const [style, setStyle] = useState<NoteStyle>('auto');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStyle = async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }
      
      try {
        const { data, error } = await supabase
          .from('clerk_profiles')
          .select('note_style')
          .eq('id', user.id)
          .single();

        if (!error && data?.note_style) {
          setStyle(data.note_style as NoteStyle);
        }
      } catch (error) {
        console.error('Error fetching note style:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStyle();
  }, [user?.id]);

  return { style, loading };
};
