import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT, overrideProjectPaths } from './config.js';

// ── Types ────────────────────────────────────────────────

export interface FlowCanvasProjectConfig {
  /** Unique identifier for this project, e.g. "resale" or "artcourses" */
  projectId: string;
  /** Base URL of the running web app, e.g. "http://localhost:3000" */
  appBaseUrl: string;
  /** Base URL of the API server (optional, falls back to REVIEWER_API_URL env) */
  apiBaseUrl?: string;
  /** Figma file key override for this project (optional) */
  figmaFileKey?: string;
  /** Absolute path to screens.yaml for this project */
  screensFile: string;
  /** Absolute path to flows.yaml for this project (optional) */
  flowsFile?: string;
  /** Absolute path to the storage root for this project */
  storageDir: string;
}

// ── Helpers ──────────────────────────────────────────────

const PROJECTS_DIR = path.join(PROJECT_ROOT, 'projects');

/** Returns true when a `projects/` directory exists in the repo root. */
export function hasProjectsDir(): boolean {
  return fs.existsSync(PROJECTS_DIR);
}

/**
 * Load the flowcanvas.config.ts for a given projectId.
 *
 * Convention:  projects/<projectId>/flowcanvas.config.ts
 *
 * The config file must export a default FlowCanvasProjectConfig object.
 * Relative paths in the config are resolved against the project directory.
 */
export async function loadProjectConfig(projectId: string): Promise<FlowCanvasProjectConfig> {
  const projectDir = path.join(PROJECTS_DIR, projectId);

  if (!fs.existsSync(projectDir)) {
    throw new Error(
      `Project directory not found: ${projectDir}\n` +
      `Create projects/${projectId}/flowcanvas.config.ts to use --project ${projectId}`,
    );
  }

  const configFile = path.join(projectDir, 'flowcanvas.config.ts');
  if (!fs.existsSync(configFile)) {
    throw new Error(
      `Project config not found: ${configFile}\n` +
      `Expected: projects/${projectId}/flowcanvas.config.ts`,
    );
  }

  // Dynamic import — use file:// URL so Windows absolute paths work with ESM
  const mod = await import(pathToFileURL(configFile).href);
  const raw: FlowCanvasProjectConfig = mod.default ?? mod;

  // Resolve relative paths against the project directory
  const resolve = (p: string) =>
    path.isAbsolute(p) ? p : path.resolve(projectDir, p);

  return {
    ...raw,
    screensFile: resolve(raw.screensFile),
    flowsFile: raw.flowsFile ? resolve(raw.flowsFile) : undefined,
    storageDir: resolve(raw.storageDir),
  };
}

/**
 * Apply project config overrides to the shared path state in config.ts,
 * update process.env so getEnv() picks up project-level URL overrides,
 * and print the startup banner.
 *
 * Call this at the very top of every CLI command action — BEFORE any
 * engine function is invoked.
 */
export function activateProject(cfg: FlowCanvasProjectConfig): void {
  // Propagate path overrides to the shared config state
  overrideProjectPaths({
    screensYaml: cfg.screensFile,
    flowsYaml: cfg.flowsFile,
    storageDir: cfg.storageDir,
  });

  // Propagate URL overrides via env so getEnv() returns correct values
  process.env.REVIEWER_APP_URL = cfg.appBaseUrl;
  if (cfg.apiBaseUrl) {
    process.env.REVIEWER_API_URL = cfg.apiBaseUrl;
  }

  // Startup banner
  console.log('\n' + '─'.repeat(60));
  console.log(`FlowCanvas project : ${cfg.projectId}`);
  console.log(`Base URL           : ${cfg.appBaseUrl}`);
  if (cfg.apiBaseUrl) {
    console.log(`API URL            : ${cfg.apiBaseUrl}`);
  }
  console.log(`Screens file       : ${cfg.screensFile}`);
  console.log(`Storage dir        : ${cfg.storageDir}`);
  console.log('─'.repeat(60));
}

// ── Default fallback config ──────────────────────────────

/**
 * Synthesise a default FlowCanvasProjectConfig from the existing single-project
 * layout (registry/screens.yaml + storage/).
 * Used when --project is not specified and no projects/ directory exists.
 */
export function defaultProjectConfig(): FlowCanvasProjectConfig {
  const registryDir = path.join(PROJECT_ROOT, 'registry');
  return {
    projectId: 'default',
    appBaseUrl: process.env.REVIEWER_APP_URL ?? 'http://localhost:3000',
    apiBaseUrl: process.env.REVIEWER_API_URL,
    screensFile: path.join(registryDir, 'screens.yaml'),
    flowsFile: path.join(registryDir, 'flows.yaml'),
    storageDir: path.join(PROJECT_ROOT, 'storage'),
  };
}
