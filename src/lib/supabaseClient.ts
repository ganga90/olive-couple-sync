import { createClient } from '@supabase/supabase-js'
import { useAuth } from '@clerk/clerk-react'
import { useMemo } from 'react'

export function useSupabase() {
  const { getToken } = useAuth() // Clerk session JWT

  return useMemo(() => {
    const url  = import.meta.env.VITE_SUPABASE_URL!
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY!
    if (!url || !anon) console.error('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')

    // Use a custom fetch so *every* request carries both headers.
    return createClient(url, anon, {
      global: {
        fetch: async (input, init) => {
          const token = await getToken() // no template needed with Supabase 3rd-party auth
          const headers = new Headers(init?.headers ?? {})
          // Always set both:
          if (anon && !headers.has('apikey')) headers.set('apikey', anon)
          if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`)
          return fetch(input, { ...init, headers })
        },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }, [getToken])
}