
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shuttle.oncab',
  appName: 'oncab-shuttle',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
