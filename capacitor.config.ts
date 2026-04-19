import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.olive.couple',
  appName: 'Olive',
  webDir: 'dist',
  // ─── iOS WebView origin alignment (required for Passkeys / WebAuthn) ──
  // By default Capacitor iOS serves the bundled `webDir` under the origin
  // `capacitor://localhost`. That origin has two downstream consequences:
  //
  //   1. WebAuthn / Passkeys refuse to run. WebKit rejects any
  //      `navigator.credentials.get({publicKey: {rpId: 'clerk.witholive.app'}})`
  //      call when the current origin isn't a registrable suffix of the RP ID.
  //      `localhost` is never such a suffix for our production Clerk domain.
  //
  //   2. `main.tsx`'s `isProductionOrigin()` check is always false, so iOS
  //      users fall back to the DEV Clerk instance (pk_test_*) — different
  //      user tenant from the web app. That's a silent data-isolation bug
  //      users wouldn't notice until they tried to cross devices.
  //
  // Setting `server.hostname: 'witholive.app'` with `iosScheme: 'https'`
  // changes the effective WebView origin to `https://witholive.app` while
  // still serving local bundled assets (we never set `server.url`, so no
  // remote fetch happens). The origin match now lets:
  //
  //   - WebKit allow WebAuthn calls against RP IDs under witholive.app
  //     (provided the Associated Domains entitlement is wired — see
  //     `ios/App/App/App.entitlements` and the AASA file at
  //     `public/.well-known/apple-app-site-association`).
  //
  //   - `main.tsx` detect production and use the live Clerk key, so iOS
  //     users share accounts with the web app.
  //
  // IMPORTANT: existing iOS users signed in against pk_test_* will see
  // their sessions cleared (origin changed → localStorage different key).
  // They re-sign-in once against pk_live_* and land on the correct data.
  // This is a one-time migration, not an ongoing regression.
  server: {
    hostname: 'witholive.app',
    iosScheme: 'https',
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#FAF8F5',
      showSpinner: false,
    },
  },
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: true,
    scrollEnabled: true,
  },
};

export default config;
