/**
 * capacitor-init — One-time native plugin setup for iOS.
 *
 * Configures: StatusBar (dark content), Keyboard (resize + accessory bar).
 * Safe to call on web — checks isNativePlatform first.
 */
import { Capacitor } from "@capacitor/core";

export async function initCapacitorPlugins() {
  if (!Capacitor.isNativePlatform()) return;

  // StatusBar: dark content for light backgrounds
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    // StatusBar not available — ok on web/simulator
  }

  // Keyboard: resize behavior + accessory bar
  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
    await Keyboard.setAccessoryBarVisible({ isVisible: true });
    await Keyboard.setScroll({ isDisabled: false });
  } catch {
    // Keyboard not available
  }
}
