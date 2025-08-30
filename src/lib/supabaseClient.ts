import { createClient } from '@supabase/supabase-js'
import { useAuth } from '@clerk/clerk-react'
import { useMemo } from 'react'

export function useSupabase() {
  const { getToken } = useAuth()

  return useMemo(() => {
    const url  = import.meta.env.VITE_SUPABASE_URL!
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY!
    if (!url || !anon) console.error('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')

    return createClient(url, anon, {
      accessToken: async () => await getToken(), // ← adds Authorization: Bearer <Clerk token>
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }, [getToken])
}