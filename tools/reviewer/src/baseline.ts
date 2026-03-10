/**
 * Baseline System — v0.8
 *
 * Manages explicitly approved baselines for regression comparison.
 * The user approves a completed run; that run's diff-manifest and
 * runtime screenshots become the reference for all future regression checks.
 *
 * Storage layout (project-aware via live STORAGE_DIR binding):
 *   <storageDir>/baselines/current/
 *     baseline-manifest.json   ← BaselineManifest metadata
 *     diff-manifest.json       ← copy of the approved run's DiffManifest
 *     <screen_id>.png          ← runtime screenshot at approval time
 *
 * All path functions read STORAGE_DIR / RUNS_STORAGE / RUNTIME_STORAGE at
 * call time so they automatically pick up multi-project overrides.
 */

import fs from 'node:fs';
import path from 'node:path';
import { STORAGE_DIR, RUNS_STORAGE, RUNTIME_STORAGE } from './config.js';
import { ensureDir, isoNow } from './utils.js';
import type { DiffManifest } from './diff-engine.js';

// ── Types ────────────────────────────────────────────────

export interface BaselineManifest {
  /** Project this baseline belongs to */
  projectId: string;
  /** ISO timestamp when approval happened */
  approvedAt: string;
  /** Run ID that was approved */
  sourceRunId: string;
  /** Screen IDs whose screenshots were copied into this baseline */
  approvedScreens: string[];
  /** Map of screenId → absolute path to the copied PNG */
  artifacts: { [screenId: string]: string };
}

// ── Path helpers ─────────────────────────────────────────

/**
 * Returns the path to the current approved baseline directory.
 * Reads STORAGE_DIR at call time so it respects --project overrides.
 */
export function getBaselineDir(): string {
  return path.join(STORAGE_DIR, 'baselines', 'current');
}

// ── Status queries ───────────────────────────────────────

/** Returns true if an approved baseline exists for the current project. */
export function hasApprovedBaseline(): boolean {
  return fs.existsSync(path.join(getBaselineDir(), 'baseline-manifest.json'));
}

/**
 * Load the BaselineManifest (approval metadata) for the current project.
 * Returns null if no baseline has been approved yet.
 */
export function loadBaselineManifest(): BaselineManifest | null {
  const p = path.join(getBaselineDir(), 'baseline-manifest.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as BaselineManifest;
  } catch {
    return null;
  }
}

/**
 * Load the DiffManifest stored inside the approved baseline.
 * This is a copy of the approved run's diff-manifest.json and is used
 * as the comparison source for regression detection.
 * Returns null if no baseline has been approved yet.
 */
export function loadBaselineDiffManifest(): DiffManifest | null {
  const p = path.join(getBaselineDir(), 'diff-manifest.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as DiffManifest;
  } catch {
    return null;
  }
}

// ── Approval ─────────────────────────────────────────────

export interface ApproveOpts {
  /** Run ID to approve. Must have a diff-manifest.json in RUNS_STORAGE. */
  runId: string;
  /** Project identifier for the baseline-manifest.json record. */
  projectId: string;
}

/**
 * Approve a completed run as the current baseline.
 *
 * Steps:
 *  1. Validate the run has a diff-manifest.json.
 *  2. Create baselines/current/ directory.
 *  3. Copy runtime screenshots for every screen in the run.
 *  4. Copy diff-manifest.json into baselines/current/.
 *  5. Write baseline-manifest.json with approval metadata.
 *
 * All paths resolve through live config bindings so --project works correctly.
 */
export function approveRun(opts: ApproveOpts): BaselineManifest {
  const runDir = path.join(RUNS_STORAGE, opts.runId);
  const diffManifestPath = path.join(runDir, 'diff-manifest.json');

  if (!fs.existsSync(diffManifestPath)) {
    throw new Error(
      `No diff-manifest.json found for run "${opts.runId}".\n` +
      `Run 'reviewer full' or 'reviewer diff' first, then approve.`,
    );
  }

  const diffManifest = JSON.parse(
    fs.readFileSync(diffManifestPath, 'utf-8'),
  ) as DiffManifest;

  const baselineDir = getBaselineDir();
  ensureDir(baselineDir);

  // Copy runtime screenshots
  const approvedScreens: string[] = [];
  const artifacts: { [screenId: string]: string } = {};

  for (const screen of diffManifest.screens) {
    const srcPng = path.join(RUNTIME_STORAGE, screen.screen_id, 'runtime.png');
    if (fs.existsSync(srcPng)) {
      const destPng = path.join(baselineDir, `${screen.screen_id}.png`);
      fs.copyFileSync(srcPng, destPng);
      approvedScreens.push(screen.screen_id);
      artifacts[screen.screen_id] = destPng;
    }
  }

  // Copy diff manifest for regression comparison
  fs.copyFileSync(diffManifestPath, path.join(baselineDir, 'diff-manifest.json'));

  // Write approval metadata
  const baselineManifest: BaselineManifest = {
    projectId: opts.projectId,
    approvedAt: isoNow(),
    sourceRunId: opts.runId,
    approvedScreens,
    artifacts,
  };

  fs.writeFileSync(
    path.join(baselineDir, 'baseline-manifest.json'),
    JSON.stringify(baselineManifest, null, 2),
  );

  return baselineManifest;
}
