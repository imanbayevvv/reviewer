import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlowCanvasProjectConfig } from '../../tools/reviewer/src/project-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: FlowCanvasProjectConfig = {
  projectId: 'resale',

  /** The running Next.js dev server */
  appBaseUrl: process.env.REVIEWER_APP_URL ?? 'http://localhost:3000',

  /** NestJS API */
  apiBaseUrl: process.env.REVIEWER_API_URL ?? 'http://localhost:4000',

  /** Figma file key (shared across all resale screens) */
  figmaFileKey: 'eSn1fOnDgiIQUbBBhrdrOs',

  /** Path to screens.yaml — resolved relative to this config file */
  screensFile: path.join(__dirname, 'screens.yaml'),

  /** Path to flows.yaml */
  flowsFile: path.join(__dirname, 'flows.yaml'),

  /** All runtime artefacts go under storage/resale/ */
  storageDir: path.join(__dirname, '..', '..', 'storage', 'resale'),
};

export default config;
