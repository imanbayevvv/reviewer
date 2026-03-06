import type { Config } from 'tailwindcss';
import uiConfig from '@resale/ui/tailwind-config';

const config: Config = {
  presets: [uiConfig],
  content: [
    './app/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './stores/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};

export default config;
