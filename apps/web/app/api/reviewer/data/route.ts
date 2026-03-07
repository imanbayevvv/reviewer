import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const PROJECT_ROOT = path.resolve(process.cwd(), '..', '..');
const SCREENS_YAML = path.join(PROJECT_ROOT, 'registry', 'screens.yaml');
const RUNS_DIR = path.join(PROJECT_ROOT, 'storage', 'runs');

const FIGMA_PLACEHOLDER_NODE_ID = 'TODO_FIGMA_NODE_ID';
const FIGMA_PLACEHOLDER_FILE_KEY = 'TODO_FIGMA_FILE_KEY';

function getScreenReadiness(screen: any): string {
  if (screen.reviewer_enabled === false) return 'disabled';
  if (!screen.figma?.file_key || screen.figma.file_key === FIGMA_PLACEHOLDER_FILE_KEY) return 'unconfigured';
  if (!screen.figma?.node_id || screen.figma.node_id === FIGMA_PLACEHOLDER_NODE_ID) return 'unconfigured';
  return 'ready';
}

function findLatestDiffManifest(): any | null {
  if (!fs.existsSync(RUNS_DIR)) return null;
  const entries = fs.readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
    .reverse();

  for (const runDir of entries) {
    const manifestPath = path.join(RUNS_DIR, runDir, 'diff-manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch {
        continue;
      }
    }
  }
  return null;
}

function findRegressionReport(runId: string): any | null {
  const reportPath = path.join(RUNS_DIR, runId, 'regression-report.json');
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    // Load registry
    const screensRaw = fs.readFileSync(SCREENS_YAML, 'utf-8');
    const { screens } = parse(screensRaw) as { screens: any[] };

    const registry = screens.map(s => ({
      screen_id: s.screen_id,
      flow_id: s.flow_id,
      step: s.step,
      variant: s.variant,
      route: s.route,
      tags: s.tags || [],
      notes: s.notes || null,
      readiness: getScreenReadiness(s),
      drift_classification: s.drift_classification || 'none',
      unconfigured_reason: s.unconfigured_reason || null,
      thresholds: s.thresholds,
      masks: (s.masks || []).map((m: any) => ({ selector: m.selector, reason: m.reason })),
    }));

    // Load latest diff manifest
    const manifest = findLatestDiffManifest();

    // Load regression report if available
    const regression = manifest ? findRegressionReport(manifest.run_id) : null;

    // Merge registry with diff results
    const diffMap = new Map<string, any>();
    if (manifest) {
      for (const s of manifest.screens) {
        diffMap.set(s.screen_id, s);
      }
    }

    const mergedScreens = registry.map(reg => {
      const diff = diffMap.get(reg.screen_id);
      return {
        ...reg,
        diff_status: diff?.status || null,
        mismatch_percent: diff?.metrics?.mismatch_percent ?? null,
        similarity: diff?.metrics?.similarity ?? null,
        masked_ratio: diff?.metrics?.masked_ratio ?? null,
        threshold_eval: diff?.threshold_eval || null,
        failure_reasons: diff?.failure_reasons || [],
        warnings: diff?.warnings || [],
        masks_applied: diff?.masks_applied || [],
        has_figma_artifact: diff?.figma_artifact ? true : false,
        has_runtime_artifact: diff?.runtime_artifact ? true : false,
        has_diff_artifact: diff?.diff_artifact ? true : false,
        has_overlay_artifact: diff?.overlay_artifact ? true : false,
        timing: diff?.timing || null,
      };
    });

    // Get unique flow IDs
    const flows = [...new Set(registry.map(s => s.flow_id))];

    return NextResponse.json({
      screens: mergedScreens,
      flows,
      run: manifest ? {
        run_id: manifest.run_id,
        git_commit: manifest.git_commit,
        git_branch: manifest.git_branch,
        started_at: manifest.started_at,
        finished_at: manifest.finished_at,
        summary: manifest.summary,
        coverage: manifest.coverage,
      } : null,
      regression: regression ? {
        has_unexpected_regressions: regression.has_unexpected_regressions,
        regressions: regression.regressions,
        improvements: regression.improvements,
        baseline_run_id: regression.baseline_run_id,
      } : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to load reviewer data: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
