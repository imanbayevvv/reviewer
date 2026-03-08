/**
 * PR Comment Generator — builds a GitHub PR comment from diff + regression data.
 *
 * Reads the diff-manifest.json and optional regression-report.json
 * from a run directory and outputs GitHub-flavored markdown.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RUNS_STORAGE } from './config.js';

// ── Types (subset of diff-engine + regression) ───────────

interface ScreenResult {
  screen_id: string;
  status: string;
  drift_classification?: string;
  metrics?: {
    mismatch_percent: number;
    similarity: number;
  };
}

interface DiffManifest {
  run_id: string;
  git_commit: string;
  git_branch: string;
  started_at: string;
  finished_at: string;
  total_screens: number;
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    errored: number;
  };
  screens: ScreenResult[];
  worst_screens: Array<{ screen_id: string; mismatch_percent: number }>;
}

interface ScreenRegression {
  screen_id: string;
  type: string;
  previous_mismatch: number | null;
  current_mismatch: number | null;
  mismatch_delta: number | null;
  drift_classification: string;
  is_expected_drift: boolean;
  detail: string;
}

interface RegressionReport {
  current_run_id: string;
  baseline_run_id: string;
  regressions: ScreenRegression[];
  unexpected_regressions: ScreenRegression[];
  improvements: Array<{
    screen_id: string;
    previous_mismatch: number | null;
    current_mismatch: number | null;
    detail: string;
  }>;
  has_unexpected_regressions: boolean;
}

// ── Helpers ──────────────────────────────────────────────

function statusEmoji(status: string): string {
  switch (status) {
    case 'pass': return ':white_check_mark:';
    case 'fail': return ':x:';
    case 'error': return ':warning:';
    case 'skipped': return ':fast_forward:';
    default: return ':grey_question:';
  }
}

function formatPercent(v: number | null): string {
  return v !== null && v !== undefined ? `${v.toFixed(2)}%` : 'n/a';
}

// ── Main generator ───────────────────────────────────────

export function generatePRComment(
  manifest: DiffManifest,
  regression: RegressionReport | null,
  artifactUrl: string | null,
): string {
  const { summary } = manifest;
  const total = summary.passed + summary.failed + summary.skipped + summary.errored;

  // Overall status
  const hasRegressions = regression?.has_unexpected_regressions ?? false;
  const headerEmoji = hasRegressions ? ':rotating_light:' : summary.failed > 0 ? ':yellow_circle:' : ':green_circle:';

  const lines: string[] = [];

  // Header
  lines.push(`## ${headerEmoji} FlowCanvas Reviewer Results`);
  lines.push('');

  // Summary table
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Screens checked | **${total}** |`);
  lines.push(`| :white_check_mark: Pass | ${summary.passed} |`);
  lines.push(`| :x: Fail | ${summary.failed} |`);
  lines.push(`| :fast_forward: Skipped | ${summary.skipped} |`);
  lines.push(`| :warning: Errors | ${summary.errored} |`);
  lines.push('');

  // Regression section
  if (regression) {
    if (regression.unexpected_regressions.length > 0) {
      lines.push(`### :rotating_light: ${regression.unexpected_regressions.length} Unexpected Regression(s)`);
      lines.push('');
      lines.push('| Screen | Mismatch | Delta | Detail |');
      lines.push('|--------|----------|-------|--------|');
      for (const r of regression.unexpected_regressions) {
        const prev = formatPercent(r.previous_mismatch);
        const curr = formatPercent(r.current_mismatch);
        const delta = r.mismatch_delta !== null ? `+${r.mismatch_delta.toFixed(2)}pp` : '-';
        lines.push(`| \`${r.screen_id}\` | ${prev} → ${curr} | ${delta} | ${r.detail} |`);
      }
      lines.push('');
    }

    // Expected drift regressions (informational)
    const expectedDrift = regression.regressions.filter(r => r.is_expected_drift);
    if (expectedDrift.length > 0) {
      lines.push(`<details><summary>:purple_circle: ${expectedDrift.length} Expected Drift (not blocking)</summary>`);
      lines.push('');
      for (const r of expectedDrift) {
        lines.push(`- \`${r.screen_id}\`: ${r.detail}`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }

    // Improvements
    if (regression.improvements.length > 0) {
      lines.push(`<details><summary>:chart_with_downwards_trend: ${regression.improvements.length} Improvement(s)</summary>`);
      lines.push('');
      for (const imp of regression.improvements) {
        const prev = formatPercent(imp.previous_mismatch);
        const curr = formatPercent(imp.current_mismatch);
        lines.push(`- \`${imp.screen_id}\`: ${prev} → ${curr} — ${imp.detail}`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }

    if (!regression.has_unexpected_regressions && regression.regressions.length === 0 && regression.improvements.length === 0) {
      lines.push(':white_check_mark: **No regressions detected** vs baseline `' + regression.baseline_run_id + '`');
      lines.push('');
    }
  } else {
    lines.push('*No baseline available for regression comparison (first run).*');
    lines.push('');
  }

  // Per-screen details (collapsed)
  if (manifest.screens.length > 0) {
    const failedScreens = manifest.screens.filter(s => s.status === 'fail');
    const passedScreens = manifest.screens.filter(s => s.status === 'pass');

    if (failedScreens.length > 0) {
      lines.push('<details><summary>:x: Failed Screens</summary>');
      lines.push('');
      lines.push('| Screen | Mismatch | Drift |');
      lines.push('|--------|----------|-------|');
      for (const s of failedScreens) {
        const pct = s.metrics ? `${s.metrics.mismatch_percent.toFixed(2)}%` : 'n/a';
        const drift = s.drift_classification === 'real_drift' ? ':purple_circle: REAL_DRIFT' : '';
        lines.push(`| \`${s.screen_id}\` | ${pct} | ${drift} |`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }

    if (passedScreens.length > 0) {
      lines.push(`<details><summary>:white_check_mark: ${passedScreens.length} Passing Screen(s)</summary>`);
      lines.push('');
      for (const s of passedScreens) {
        const pct = s.metrics ? `${s.metrics.mismatch_percent.toFixed(2)}%` : '';
        lines.push(`- \`${s.screen_id}\` ${pct}`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }

  // Metadata
  lines.push('---');
  lines.push(`<sub>Run \`${manifest.run_id}\` · commit \`${manifest.git_commit}\` · branch \`${manifest.git_branch}\`</sub>`);

  if (artifactUrl) {
    lines.push(`<br><sub>:open_file_folder: [Download full report](${artifactUrl})</sub>`);
  }

  lines.push(`<br><sub>Generated by FlowCanvas Reviewer v0.5</sub>`);

  return lines.join('\n');
}

// ── Load from filesystem ─────────────────────────────────

export function loadRunData(runId: string): {
  manifest: DiffManifest | null;
  regression: RegressionReport | null;
} {
  const runDir = path.join(RUNS_STORAGE, runId);

  let manifest: DiffManifest | null = null;
  const manifestPath = path.join(runDir, 'diff-manifest.json');
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  }

  let regression: RegressionReport | null = null;
  const regPath = path.join(runDir, 'regression-report.json');
  if (fs.existsSync(regPath)) {
    regression = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
  }

  return { manifest, regression };
}

/**
 * CLI entry: generate markdown for a given run and write to stdout or file.
 */
export function runPRCommentCLI(runId: string, outputPath?: string, artifactUrl?: string): void {
  const { manifest, regression } = loadRunData(runId);

  if (!manifest) {
    console.error(`No diff-manifest.json found for run: ${runId}`);
    process.exit(1);
  }

  const comment = generatePRComment(manifest, regression, artifactUrl || null);

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, comment, 'utf-8');
    console.log(`PR comment written to: ${outputPath}`);
  } else {
    process.stdout.write(comment);
  }
}
