import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project root (three levels up from tools/reviewer/src/) */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

/** Registry YAML files */
export const REGISTRY_DIR = path.join(PROJECT_ROOT, 'registry');
// `let` so multi-project support can override these via overrideProjectPaths()
export let SCREENS_YAML = path.join(REGISTRY_DIR, 'screens.yaml');
export let FLOWS_YAML = path.join(REGISTRY_DIR, 'flows.yaml');

/** Artifact storage (gitignored) */
// `let` so multi-project support can override these via overrideProjectPaths()
export let STORAGE_DIR = path.join(PROJECT_ROOT, 'storage');
export let FIGMA_STORAGE = path.join(STORAGE_DIR, 'figma');
export let RUNTIME_STORAGE = path.join(STORAGE_DIR, 'runtime');
export let RUNS_STORAGE = path.join(STORAGE_DIR, 'runs');

/**
 * Override path constants for multi-project support.
 * Called by activateProject() in project-config.ts before any command runs.
 * Uses ESM live bindings — all importers see the updated values immediately.
 */
export function overrideProjectPaths(overrides: {
  screensYaml?: string;
  flowsYaml?: string;
  storageDir?: string;
}): void {
  if (overrides.screensYaml) SCREENS_YAML = overrides.screensYaml;
  if (overrides.flowsYaml) FLOWS_YAML = overrides.flowsYaml;
  if (overrides.storageDir) {
    STORAGE_DIR = overrides.storageDir;
    FIGMA_STORAGE = path.join(overrides.storageDir, 'figma');
    RUNTIME_STORAGE = path.join(overrides.storageDir, 'runtime');
    RUNS_STORAGE = path.join(overrides.storageDir, 'runs');
  }
}

/** Diff engine defaults */
export const DIFF_PIXELMATCH_THRESHOLD = 0.1; // anti-aliasing tolerance (0=exact, 1=anything)
export const DIFF_INCLUDE_AA = false; // count anti-aliased pixels as diff

/** Environment-based config */
export function getEnv() {
  return {
    figmaToken: process.env.FIGMA_TOKEN || '',
    apiUrl: process.env.REVIEWER_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
    appUrl: process.env.REVIEWER_APP_URL || 'http://localhost:3000',
    seedUserEmail: process.env.REVIEWER_SEED_USER_EMAIL || 'imanbaev01@gmail.com',
    seedUserPassword: process.env.REVIEWER_SEED_USER_PASSWORD || '12345678',
    seedEmptyUserEmail: process.env.REVIEWER_SEED_EMPTY_USER_EMAIL || 'reviewer-empty@resale.test',
    seedEmptyUserPassword: process.env.REVIEWER_SEED_EMPTY_USER_PASSWORD || 'Reviewer123!',
  };
}

/** Placeholder values that indicate missing Figma references */
export const FIGMA_PLACEHOLDER_FILE_KEY = 'TODO_FIGMA_FILE_KEY';
export const FIGMA_PLACEHOLDER_NODE_ID = 'TODO_FIGMA_NODE_ID';

/** Figma API base URL */
export const FIGMA_API_BASE = 'https://api.figma.com/v1';

/** Retry config */
export const RETRY_MAX = 3;
export const RETRY_BASE_DELAY_MS = 1000;

/** Playwright defaults */
export const DEFAULT_READINESS_TIMEOUT_MS = 15_000;
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
