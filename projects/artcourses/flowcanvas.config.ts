import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlowCanvasProjectConfig } from '../../tools/reviewer/src/project-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: FlowCanvasProjectConfig = {
  projectId: 'artcourses',

  /** The running web app for Art Courses */
  appBaseUrl: process.env.REVIEWER_APP_URL ?? 'http://localhost:3001',

  /** Path to screens.yaml — resolved relative to this config file */
  screensFile: path.join(__dirname, 'screens.yaml'),

  /** All runtime artefacts go under storage/artcourses/ */
  storageDir: path.join(__dirname, '..', '..', 'storage', 'artcourses'),
};

export default config;
