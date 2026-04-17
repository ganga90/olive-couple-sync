/**
 * Safe Clerk hook wrappers.
 *
 * In degraded mode (when VITE_CLERK_PUBLISHABLE_KEY is missing and the app
 * is rendered without <ClerkProvider>), the real Clerk hooks throw on every
 * render. These wrappers swallow that and return inert defaults so public
 * routes (landing, legal) keep rendering.
 *
 * Authenticated hooks (useUser, useAuth, useClerk) still need to work on
 * authed routes — when ClerkProvider IS present, they delegate as normal.
 */
import {
  useUser as useClerkUser,
  useAuth as useClerkAuthHook,
  useClerk as useClerkInstance,
} from "@clerk/clerk-react";

export const useSafeUser = (): { user: any; isLoaded: boolean; isSignedIn: boolean } => {
  try {
    const u = useClerkUser();
    return { user: u.user, isLoaded: !!u.isLoaded, isSignedIn: !!u.isSignedIn };
  } catch {
    return { user: null, isLoaded: true, isSignedIn: false };
  }
};

export const useSafeClerkAuth = (): {
  getToken: (opts?: any) => Promise<string | null>;
  isSignedIn: boolean;
  isLoaded: boolean;
  signOut: (opts?: any) => Promise<void>;
} => {
  try {
    const a = useClerkAuthHook();
    return {
      getToken: a.getToken as any,
      isSignedIn: !!a.isSignedIn,
      isLoaded: !!a.isLoaded,
      signOut: a.signOut as any,
    };
  } catch {
    return {
      getToken: async () => null,
      isSignedIn: false,
      isLoaded: true,
      signOut: async () => {},
    };
  }
};

export const useSafeClerk = (): any => {
  try {
    return useClerkInstance();
  } catch {
    return {
      signOut: async () => {},
      openSignIn: () => {},
      openUserProfile: () => {},
    };
  }
};
