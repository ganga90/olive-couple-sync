/**
 * capacitor-init — One-time native plugin setup for iOS.
 *
 * Configures:
 *   - StatusBar (dark content on light backgrounds)
 *   - Keyboard (resize + accessory bar)
 *   - App.appUrlOpen listener for deep-link OAuth return (olive://)
 *
 * Safe to call on web — checks isNativePlatform first.
 */
import { Capacitor } from "@capacitor/core";

/** Custom URL scheme registered in ios/App/App/Info.plist (CFBundleURLSchemes). */
const DEEP_LINK_SCHEME = "olive://";

/**
 * Handle a deep link received via the `olive://` scheme.
 *
 * Current known paths:
 *   - olive://auth-complete  — fired by src/pages/AuthRedirectNative.tsx
 *     after a web-based sign-in completes; iOS re-opens the native app
 *     with this URL. The listener here ensures the WebView notices the
 *     return (forces a Clerk session re-hydrate) and navigates home.
 *
 * NOTE: Cross-context auth (signing in via Safari / in-app browser,
 * session restoration in the native WebView) still depends on Clerk's
 * ability to share the session across browser contexts. This handler
 * routes the URL back into the React app but does NOT by itself
 * materialize a native session if the web sign-in happened in a
 * different browser context. Tracked as a follow-up.
 */
function handleDeepLink(url: string): void {
  try {
    console.log("[capacitor-init] Deep link received:", url);

    if (!url.startsWith(DEEP_LINK_SCHEME)) return;

    // Strip scheme → "auth-complete" or "auth-complete?foo=bar"
    const path = url.substring(DEEP_LINK_SCHEME.length);

    if (path.startsWith("auth-complete")) {
      // Force the Capacitor WebView to reload so Clerk re-hydrates from
      // storage. If the session is present, the auth flow completes;
      // if not, the user lands on sign-in with native context preserved.
      // We prefer a full reload over history navigation because it's
      // the most reliable way to force SDK re-initialization.
      const isAlreadyAuthRedirect =
        window.location.pathname.includes("/auth-redirect-native") ||
        window.location.pathname.includes("/sign-in");
      if (!isAlreadyAuthRedirect) {
        window.location.href = "/";
      }
      return;
    }

    // Future deep-link paths (e.g. olive://note/<id>, olive://list/<id>)
    // can branch here — guarded so unknown paths are non-fatal.
  } catch (err) {
    console.warn("[capacitor-init] Deep link handler error (non-blocking):", err);
  }
}

export async function initCapacitorPlugins() {
  if (!Capacitor.isNativePlatform()) return;

  // StatusBar: dark content for light backgrounds.
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    // StatusBar not available — ok on web/simulator.
  }

  // Keyboard: resize behavior + accessory bar.
  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
    await Keyboard.setAccessoryBarVisible({ isVisible: true });
    await Keyboard.setScroll({ isDisabled: false });
  } catch {
    // Keyboard not available.
  }

  // App: listen for deep-link URL opens so OAuth return routes back
  // into the React app instead of leaving the user stranded on a blank
  // Capacitor WebView. Registered once — Capacitor's listener list is
  // per-process so this won't double-register across hot reloads in dev.
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("appUrlOpen", (event) => {
      if (event?.url) {
        handleDeepLink(event.url);
      }
    });
  } catch (err) {
    console.warn(
      "[capacitor-init] App plugin not available — OAuth deep-link return may not work:",
      err
    );
  }
}

/**
 * Exported for unit testing the pure URL parsing logic.
 * Not consumed by production code.
 */
export const __test__ = { handleDeepLink };
