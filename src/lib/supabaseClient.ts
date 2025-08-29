import { createClient } from '@supabase/supabase-js'
import { useAuth } from '@clerk/clerk-react'
import { useMemo } from 'react'

export function useSupabase() {
  const { getToken } = useAuth()

  return useMemo(() => {
    const url  = import.meta.env.VITE_SUPABASE_URL!
    const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY!
    if (!url || !anon) console.error('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY')

    return createClient(url, anon, {
      accessToken: async () => await getToken(),      // ← adds Authorization: Bearer <Clerk token>
      auth: { persistSession: false, autoRefreshToken: false },

      // TEMP: warn if a request is missing headers
      global: {
        fetch: async (input, init) => {
          const h = new Headers(init?.headers || {})
          if (!h.has('apikey') || !h.has('authorization')) {
            console.warn('[supabase] missing headers', {
              url: String(input),
              apikey: h.has('apikey'),
              auth: h.has('authorization'),
            })
          }
          return fetch(input, init)
        },
      },
    })
  }, [getToken])
}