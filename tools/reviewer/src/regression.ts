/**
 * Regression detection — compares two diff manifests to find regressions.
 *
 * A regression is:
 * 1. A screen that was PASS and is now FAIL (status regression)
 * 2. A screen whose mismatch_percent increased beyond a tolerance (mismatch regression)
 * 3. A screen that was present and is now ERROR or SKIPPED (availability regression)
 *
 * Known real_drift screens are still reported but flagged as expected.
 * This module is deterministic — no AI, no heuristics.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RUNS_STORAGE } from './config.js';
import type { DiffManifest, ScreenDiffResult } from './diff-engine.js';

// ── Types ────────────────────────────────────────────────

export interface ScreenRegression {
  screen_id: string;
  type: 'status' | 'mismatch' | 'availability';
  previous_status: string;
  current_status: string;
  previous_mismatch: number | null;
  current_mismatch: number | null;
  mismatch_delta: number | null;
  drift_classification: string;
  is_expected_drift: boolean;
  detail: string;
}

export interface RegressionReport {
  current_run_id: string;
  baseline_run_id: string;
  current_commit: string;
  baseline_commit: string;
  current_branch: string;
  timestamp: string;
  total_screens: number;
  regressions: ScreenRegression[];
  unexpected_regressions: ScreenRegression[];
  improvements: ScreenImprovement[];
  has_unexpected_regressions: boolean;
  summary_table: string;
}

export interface ScreenImprovement {
  screen_id: string;
  previous_status: string;
  current_status: string;
  previous_mismatch: number | null;
  current_mismatch: number | null;
  detail: string;
}

// ── Constants ────────────────────────────────────────────

/** Mismatch increase above this triggers a mismatch regression (percentage points) */
const MISMATCH_INCREASE_THRESHOLD = 0.5;

// ── Manifest discovery ───────────────────────────────────

/**
 * Find the most recent diff-manifest.json in storage/runs/,
 * optionally excluding a specific run ID.
 */
export function findLatestManifest(excludeRunId?: string): DiffManifest | null {
  if (!fs.existsSync(RUNS_STORAGE)) return null;

  const entries = fs.readdirSync(RUNS_STORAGE, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => name !== excludeRunId)
    .sort()
    .reverse();

  for (const runDir of entries) {
    const manifestPath = path.join(RUNS_STORAGE, runDir, 'diff-manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as DiffManifest;
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Load a specific diff manifest by run ID.
 */
export function loadManifest(runId: string): DiffManifest | null {
  const manifestPath = path.join(RUNS_STORAGE, runId, 'diff-manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as DiffManifest;
  } catch {
    return null;
  }
}

// ── Detection ────────────────────────────────────────────

function getMismatch(screen: ScreenDiffResult): number | null {
  return screen.metrics?.mismatch_percent ?? null;
}

export function detectRegressions(
  baseline: DiffManifest,
  current: DiffManifest,
): RegressionReport {
  const baselineMap = new Map<string, ScreenDiffResult>();
  for (const s of baseline.screens) {
    baselineMap.set(s.screen_id, s);
  }

  const regressions: ScreenRegression[] = [];
  const improvements: ScreenImprovement[] = [];

  for (const curr of current.screens) {
    const prev = baselineMap.get(curr.screen_id);

    if (!prev) {
      // New screen — not a regression
      continue;
    }

    const prevMismatch = getMismatch(prev);
    const currMismatch = getMismatch(curr);
    const drift = curr.drift_classification ?? 'none';
    const isExpected = drift === 'real_drift';

    // ── Status regression: PASS → FAIL ──
    if (prev.status === 'pass' && curr.status === 'fail') {
      regressions.push({
        screen_id: curr.screen_id,
        type: 'status',
        previous_status: prev.status,
        current_status: curr.status,
        previous_mismatch: prevMismatch,
        current_mismatch: currMismatch,
        mismatch_delta: (prevMismatch != null && currMismatch != null)
          ? currMismatch - prevMismatch
          : null,
        drift_classification: drift,
        is_expected_drift: isExpected,
        detail: `PASS → FAIL (${prevMismatch?.toFixed(4) ?? '?'}% → ${currMismatch?.toFixed(4) ?? '?'}%)`,
      });
      continue;
    }

    // ── Availability regression: had results → error/skipped ──
    if (
      (prev.status === 'pass' || prev.status === 'fail') &&
      (curr.status === 'error' || curr.status === 'skipped')
    ) {
      regressions.push({
        screen_id: curr.screen_id,
        type: 'availability',
        previous_status: prev.status,
        current_status: curr.status,
        previous_mismatch: prevMismatch,
        current_mismatch: currMismatch,
        mismatch_delta: null,
        drift_classification: drift,
        is_expected_drift: false,
        detail: `${prev.status.toUpperCase()} → ${curr.status.toUpperCase()} (screen became unavailable)`,
      });
      continue;
    }

    // ── Mismatch regression: significant increase in diff % ──
    if (prevMismatch != null && currMismatch != null) {
      const delta = currMismatch - prevMismatch;
      if (delta > MISMATCH_INCREASE_THRESHOLD) {
        regressions.push({
          screen_id: curr.screen_id,
          type: 'mismatch',
          previous_status: prev.status,
          current_status: curr.status,
          previous_mismatch: prevMismatch,
          current_mismatch: currMismatch,
          mismatch_delta: delta,
          drift_classification: drift,
          is_expected_drift: isExpected,
          detail: `mismatch increased +${delta.toFixed(4)}pp (${prevMismatch.toFixed(4)}% → ${currMismatch.toFixed(4)}%)`,
        });
        continue;
      }

      // ── Improvement: significant decrease ──
      if (delta < -MISMATCH_INCREASE_THRESHOLD) {
        improvements.push({
          screen_id: curr.screen_id,
          previous_status: prev.status,
          current_status: curr.status,
          previous_mismatch: prevMismatch,
          current_mismatch: currMismatch,
          detail: `mismatch decreased ${delta.toFixed(4)}pp (${prevMismatch.toFixed(4)}% → ${currMismatch.toFixed(4)}%)`,
        });
      }
    }

    // ── Improvement: FAIL → PASS ──
    if (prev.status === 'fail' && curr.status === 'pass') {
      improvements.push({
        screen_id: curr.screen_id,
        previous_status: prev.status,
        current_status: curr.status,
        previous_mismatch: prevMismatch,
        current_mismatch: currMismatch,
        detail: `FAIL → PASS (${prevMismatch?.toFixed(4) ?? '?'}% → ${currMismatch?.toFixed(4) ?? '?'}%)`,
      });
    }
  }

  const unexpected = regressions.filter(r => !r.is_expected_drift);
  const summaryTable = formatSummaryTable(current, regressions, improvements);

  return {
    current_run_id: current.run_id,
    baseline_run_id: baseline.run_id,
    current_commit: current.git_commit,
    baseline_commit: baseline.git_commit,
    current_branch: current.git_branch,
    timestamp: new Date().toISOString(),
    total_screens: current.screens.length,
    regressions,
    unexpected_regressions: unexpected,
    improvements,
    has_unexpected_regressions: unexpected.length > 0,
    summary_table: summaryTable,
  };
}

// ── Formatting ───────────────────────────────────────────

function formatSummaryTable(
  manifest: DiffManifest,
  regressions: ScreenRegression[],
  improvements: ScreenImprovement[],
): string {
  const lines: string[] = [];

  lines.push('=' .repeat(76));
  lines.push('REGRESSION REPORT');
  lines.push('='.repeat(76));
  lines.push(`Run:    ${manifest.run_id}`);
  lines.push(`Commit: ${manifest.git_commit} (${manifest.git_branch})`);
  lines.push(`Time:   ${manifest.started_at}`);
  lines.push('');

  // Current status summary
  lines.push('Current run:');
  lines.push(`  Passed:  ${manifest.summary.passed}`);
  lines.push(`  Failed:  ${manifest.summary.failed}`);
  lines.push(`  Skipped: ${manifest.summary.skipped}`);
  lines.push(`  Errors:  ${manifest.summary.errored}`);
  lines.push('');

  // Per-screen table
  lines.push('Screen'.padEnd(42) + 'Status'.padEnd(10) + 'Mismatch'.padEnd(12) + 'Drift');
  lines.push('-'.repeat(76));
  for (const s of manifest.screens) {
    const pct = s.metrics ? `${s.metrics.mismatch_percent.toFixed(4)}%` : 'n/a';
    const drift = s.drift_classification === 'real_drift' ? 'REAL_DRIFT' : '';
    lines.push(`${s.screen_id.padEnd(42)}${s.status.toUpperCase().padEnd(10)}${pct.padEnd(12)}${drift}`);
  }
  lines.push('');

  // Regressions
  if (regressions.length > 0) {
    const unexpected = regressions.filter(r => !r.is_expected_drift);
    const expected = regressions.filter(r => r.is_expected_drift);

    if (unexpected.length > 0) {
      lines.push('!! UNEXPECTED REGRESSIONS !!');
      lines.push('-'.repeat(76));
      for (const r of unexpected) {
        lines.push(`  [${r.type.toUpperCase()}] ${r.screen_id}: ${r.detail}`);
      }
      lines.push('');
    }

    if (expected.length > 0) {
      lines.push('Expected regressions (known drift):');
      lines.push('-'.repeat(76));
      for (const r of expected) {
        lines.push(`  [${r.type.toUpperCase()}] ${r.screen_id}: ${r.detail}`);
      }
      lines.push('');
    }
  } else {
    lines.push('No regressions detected.');
    lines.push('');
  }

  // Improvements
  if (improvements.length > 0) {
    lines.push('Improvements:');
    lines.push('-'.repeat(76));
    for (const imp of improvements) {
      lines.push(`  ${imp.screen_id}: ${imp.detail}`);
    }
    lines.push('');
  }

  lines.push('='.repeat(76));

  return lines.join('\n');
}

// ── Persistence ──────────────────────────────────────────

export function saveRegressionReport(report: RegressionReport, runId: string): string {
  const dir = path.join(RUNS_STORAGE, runId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'regression-report.json');
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  return filePath;
}
