import { createClient } from '@supabase/supabase-js'
import { useAuth as useClerkAuth } from '@clerk/clerk-react'
import { useMemo } from 'react'
import type { Database } from '@/integrations/supabase/types'

export function useSupabase() {
  const { getToken } = useClerkAuth()

  return useMemo(() => {
    const url = import.meta.env.VITE_SUPABASE_URL!
    const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY!
    if (!url || !anon) console.error('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY')

    return createClient<Database>(url, anon, {
      accessToken: async () => await getToken(),
      auth: { persistSession: false, autoRefreshToken: false },
      // TEMP diagnostics: warn if a request misses headers
      global: {
        fetch: async (input, init) => {
          const h = new Headers(init?.headers || {})
          if (!h.has('apikey') || !h.has('authorization')) {
            console.warn('[supabase] missing headers', { url: String(input), apikey: h.has('apikey'), auth: h.has('authorization') })
          }
          return fetch(input, init)
        },
      },
    })
  }, [getToken])
}