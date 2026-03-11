import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlowCanvasProjectConfig } from '../../tools/reviewer/src/project-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: FlowCanvasProjectConfig = {
  projectId: 'demo-project',

  /** Base URL of the running web app — override with REVIEWER_APP_URL env var */
  appBaseUrl: process.env.REVIEWER_APP_URL ?? 'http://localhost:3000',

  // Uncomment if your project uses a separate API server:
  // apiBaseUrl: process.env.REVIEWER_API_URL ?? 'http://localhost:4000',

  // Uncomment if all screens share one Figma file (you can also set it per-screen):
  // figmaFileKey: 'IbgDotENZdgwweTjvF6QR3',

  /** Screens registry — source of truth for this project */
  screensFile: path.join(__dirname, 'screens.yaml'),

  /** Flow definitions — remove this line if you do not use flows */
  flowsFile: path.join(__dirname, 'flows.yaml'),

  /** All runtime/diff/report artefacts go here */
  storageDir: path.join(__dirname, '..', '..', 'storage', 'demo-project'),
};

export default config;
