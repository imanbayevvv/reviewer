/**
 * Project bootstrap — scaffolds a new FlowCanvas project directory.
 *
 * Creates:
 *   projects/<id>/
 *     flowcanvas.config.ts   — project config (URLs, Figma key, paths)
 *     screens.yaml           — screen registry (source of truth)
 *     flows.yaml             — flow definitions (optional grouping)
 *     README.md              — quickstart guide
 *
 * Design intent:
 *   - Explicit templates, no abstraction layers
 *   - Templates mirror the conventions of the existing resale project
 *   - Caller checks projectExists() before calling bootstrapProject()
 *   - validateScaffold() is a post-write sanity check
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from './config.js';

const PROJECTS_DIR = path.join(PROJECT_ROOT, 'projects');

// ── Types ────────────────────────────────────────────────

export interface BootstrapResult {
  projectDir: string;
  files: string[];
}

// ── Guards ───────────────────────────────────────────────

/** Returns true if projects/<id>/ already exists. */
export function projectExists(projectId: string): boolean {
  return fs.existsSync(path.join(PROJECTS_DIR, projectId));
}

/** Validate that a project ID is safe for use as a directory name. */
export function isValidProjectId(projectId: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/.test(projectId);
}

// ── Scaffold ─────────────────────────────────────────────

/**
 * Scaffold a new project directory with starter files.
 * Caller must call projectExists() first — this does NOT check for conflicts.
 */
export function bootstrapProject(projectId: string): BootstrapResult {
  const projectDir = path.join(PROJECTS_DIR, projectId);
  fs.mkdirSync(projectDir, { recursive: true });

  const write = (name: string, content: string): string => {
    const p = path.join(projectDir, name);
    fs.writeFileSync(p, content, 'utf-8');
    return p;
  };

  const files: string[] = [
    write('flowcanvas.config.ts', configTemplate(projectId)),
    write('screens.yaml', screensTemplate(projectId)),
    write('flows.yaml', flowsTemplate(projectId)),
    write('README.md', readmeTemplate(projectId)),
  ];

  return { projectDir, files };
}

// ── Validation ───────────────────────────────────────────

/**
 * Lightweight post-scaffold validation.
 * Returns a list of problems; empty array = all good.
 */
export function validateScaffold(projectDir: string): string[] {
  const problems: string[] = [];
  for (const required of ['flowcanvas.config.ts', 'screens.yaml']) {
    if (!fs.existsSync(path.join(projectDir, required))) {
      problems.push(`Missing required file: ${required}`);
    }
  }
  return problems;
}

// ── Templates ────────────────────────────────────────────

function configTemplate(id: string): string {
  return `import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlowCanvasProjectConfig } from '../../tools/reviewer/src/project-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: FlowCanvasProjectConfig = {
  projectId: '${id}',

  /** Base URL of the running web app — override with REVIEWER_APP_URL env var */
  appBaseUrl: process.env.REVIEWER_APP_URL ?? 'http://localhost:3000',

  // Uncomment if your project uses a separate API server:
  // apiBaseUrl: process.env.REVIEWER_API_URL ?? 'http://localhost:4000',

  // Uncomment if all screens share one Figma file (you can also set it per-screen):
  // figmaFileKey: 'YOUR_FIGMA_FILE_KEY',

  /** Screens registry — source of truth for this project */
  screensFile: path.join(__dirname, 'screens.yaml'),

  /** Flow definitions — remove this line if you do not use flows */
  flowsFile: path.join(__dirname, 'flows.yaml'),

  /** All runtime/diff/report artefacts go here */
  storageDir: path.join(__dirname, '..', '..', 'storage', '${id}'),
};

export default config;
`;
}

function screensTemplate(id: string): string {
  return `# Screen Registry — Source of Truth for ${id}
#
# Every screen the FlowCanvas Reviewer can validate is defined here.
# This file IS the contract between design (Figma) and implementation (runtime).
#
# screen_id naming convention:
#   {flow_id}_{screen_name}_{variant}
#   Examples: auth_login_default   dashboard_home_empty   shop_create_step_1_default
#
# Figma readiness markers:
#   node_id: "TODO_FIGMA_NODE_ID"   — unconfigured, auto-skipped by reviewer
#   node_id: "174:1412"             — ready, included in default runs
#   reviewer_enabled: false         — explicitly disabled, always skipped

screens:

  # ── Example Screen ──────────────────────────────────────────────────────────
  # Replace this entry with your real screens.
  # One entry per reviewable state/variant of a screen.

  - screen_id: home_default
    flow_id: home
    step: 1
    variant: default

    # URL path the reviewer navigates to
    route: /

    preconditions:
      auth: false   # set true if the reviewer must log in before navigating here

    setup:
      strategy: direct   # direct | wizard_inject | action_sequence
      # For action_sequence, list steps:
      # strategy: action_sequence
      # actions:
      #   - { action: click, selector: '[data-testid="menu-trigger"]' }
      #   - { action: wait, timeout: 500 }

    figma:
      # Figma file key — from your Figma file URL:
      #   https://figma.com/design/FILE_KEY/My-Design/...
      file_key: "TODO_FIGMA_FILE_KEY"

      # Figma node ID — right-click a frame in Figma → Copy link
      # Extract the node-id param and replace hyphens with colons:
      #   ?node-id=174-1412  →  "174:1412"
      node_id: "TODO_FIGMA_NODE_ID"

    viewport: { width: 1440, height: 1024 }

    # Selectors to black out before diffing (dynamic or environment-specific content)
    masks: []
    # masks:
    #   - selector: "[data-testid='user-avatar']"
    #     reason: "Profile images differ between environments"

    thresholds:
      pixel_diff_percent: 0.5       # max % of pixels allowed to differ (0–100)
      structural_similarity: 0.95   # min SSIM score (0–1, higher = stricter)

    tags: [example]
    notes: "Example screen — replace with a real screen from your app."
`;
}

function flowsTemplate(id: string): string {
  return `# Flows — User Journey Definitions for ${id}
#
# Flows group related screens into named user journeys.
# Used for filtering: pnpm reviewer --project ${id} --flow <flow_id>
#
# Optional — remove the flowsFile line from flowcanvas.config.ts if unused.

flows:

  - flow_id: home
    title: Home
    entry_route: /
    nodes:
      - id: home_default
        screen_id: home_default
        route: /
    edges: []
    notes: "Example flow — replace with your real user journeys."
`;
}

function readmeTemplate(id: string): string {
  return `# FlowCanvas Reviewer — ${id}

Visual regression review configuration for the **${id}** project.

## How it works

1. **Figma fetch** — downloads design reference screenshots from Figma
2. **Runtime capture** — takes Playwright screenshots of the running app
3. **Diff** — compares Figma vs runtime pixel-by-pixel, generates an HTML report
4. **Baseline** — approve a passing run so future diffs detect regressions

## Source of truth

\`screens.yaml\` is the contract. Every reviewable screen must have an entry here.
The reviewer auto-skips screens with \`node_id: TODO_FIGMA_NODE_ID\`.

## Setup checklist

- [ ] Set \`appBaseUrl\` in \`flowcanvas.config.ts\` (or \`export REVIEWER_APP_URL=…\`)
- [ ] Set Figma token: \`export FIGMA_TOKEN=your_personal_access_token\`
- [ ] Fill in \`figma.file_key\` and \`figma.node_id\` for each screen in \`screens.yaml\`
- [ ] Start your dev server before running \`runtime\` or \`full\`

## Commands

\`\`\`bash
# Fetch Figma design screenshots
pnpm reviewer --project ${id} figma

# Capture runtime screenshots (dev server must be running)
pnpm reviewer --project ${id} runtime

# Generate visual diff report
pnpm reviewer --project ${id} diff

# All phases in one go
pnpm reviewer --project ${id} full

# List all screens in the registry
pnpm reviewer --project ${id} list

# After a successful full run, approve it as the regression baseline
pnpm reviewer --project ${id} approve --latest

# Check approved baseline status
pnpm reviewer --project ${id} baseline-status
\`\`\`

## Artifacts

All output is stored in \`storage/${id}/\`:

\`\`\`
storage/${id}/
  figma/        — Figma reference screenshots
  runtime/      — Runtime Playwright screenshots
  runs/         — Diff output and HTML reports per run
  baselines/    — Approved regression baseline
\`\`\`

## Adding a new screen

1. Add an entry to \`screens.yaml\` with \`screen_id\`, \`route\`, and \`figma.node_id\`
2. Fetch its Figma frame:  \`pnpm reviewer --project ${id} figma --screen <id>\`
3. Capture it at runtime:  \`pnpm reviewer --project ${id} runtime --screen <id>\`
4. View the diff:          \`pnpm reviewer --project ${id} diff --screen <id>\`

## Files

| File | Purpose |
|------|---------|
| \`flowcanvas.config.ts\` | Project config (URLs, Figma key, storage path) |
| \`screens.yaml\` | Screen registry — **edit this file** |
| \`flows.yaml\` | Flow groupings (optional) |
| \`README.md\` | This file |
`;
}
