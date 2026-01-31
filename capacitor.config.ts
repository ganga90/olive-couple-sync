import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.olive.couple',
  appName: 'Olive',
  webDir: 'dist',
  // Remove server.url to load from local dist folder instead of remote URL
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#FAF8F5",
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