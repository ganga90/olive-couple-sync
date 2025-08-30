import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// will be set by AuthProvider once Clerk is loaded
let tokenGetter: null | (() => Promise<string | null>) = null
export const setClerkTokenGetter = (fn: () => Promise<string | null>) => { tokenGetter = fn }

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (_client) return _client
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    // We are NOT using Supabase Auth—Clerk is the IdP. Disable GoTrue session.
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers ?? {})
        
        // Always send apikey
        if (!headers.has('apikey')) headers.set('apikey', SUPABASE_ANON_KEY)
        
        // Always send Clerk JWT
        try {
          const token = tokenGetter ? await tokenGetter() : null
          console.log('[SupabaseClient] Token getter result:', !!token, token?.substring(0, 50) + '...')
          
          if (token && !headers.has('authorization')) {
            headers.set('authorization', `Bearer ${token}`)
            console.log('[SupabaseClient] Added authorization header')
          } else if (!token) {
            console.log('[SupabaseClient] No token available')
          }
        } catch (err) {
          console.error('[SupabaseClient] Error getting token:', err)
        }
        
        console.log('[SupabaseClient] Request headers:', {
          apikey: headers.has('apikey'),
          authorization: headers.has('authorization'),
          url: typeof input === 'string' ? input : 'Request object'
        })
        
        return fetch(input as RequestInfo, { ...init, headers })
      }
    }
  })
  return _client
}

// Temporary compatibility export to identify files still using old import
export function useSupabase(): SupabaseClient {
  console.warn('⚠️ DEPRECATED: useSupabase() is deprecated. Use getSupabase() instead.', new Error().stack)
  return getSupabase()
}