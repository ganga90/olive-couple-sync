import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.fe28fe116f80433faa49de1399a1110c',
  appName: 'olive-couple-sync',
  webDir: 'dist',
  server: {
    url: "https://fe28fe11-6f80-433f-aa49-de1399a1110c.lovableproject.com?forceHideBadge=true",
    cleartext: true
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  }
};

export default config;