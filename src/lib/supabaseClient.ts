import { createClient, SupabaseClient } from '@supabase/supabase-js'

const URL = "https://wtfspzvcetxmcfftwonq.supabase.co"
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"

// we'll let the AuthProvider give us the latest Clerk token when needed
let tokenGetter: null | (() => Promise<string | null>) = null;
export function setClerkTokenGetter(fn: () => Promise<string | null>) {
  tokenGetter = fn;
}

// keep a single instance
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  _client = createClient(URL, ANON, {
    // important: we're not using Supabase Auth at all
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'olive-thirdparty',
    },
    global: {
      headers: {
        apikey: ANON,
      },
      // inject Clerk "supabase" token for EVERY request
      fetch: async (input, init: RequestInit = {}) => {
        const headers = new Headers(init.headers || {});
        headers.set('apikey', ANON);
        if (tokenGetter) {
          const token = await tokenGetter();
          if (token) headers.set('Authorization', `Bearer ${token}`);
        }
        return fetch(input, { ...init, headers });
      },
    },
  });

  return _client;
}

// Export the singleton client directly for convenience
export const supabase = getSupabase();

// Keep setClerkTokenGetter for backwards compatibility
export const setTokenGetter = setClerkTokenGetter;
