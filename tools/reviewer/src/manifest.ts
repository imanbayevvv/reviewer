import fs from 'node:fs';
import path from 'node:path';
import { RUNS_STORAGE } from './config.js';
import type { FigmaFetchResult } from './figma-fetcher.js';
import type { RuntimeCaptureResult } from './runtime-runner.js';
import { ensureDir, getGitBranch, getGitCommit, isoNow } from './utils.js';

// ── Types ────────────────────────────────────────────────

export interface ScreenRunEntry {
  screen_id: string;
  figma_fetch_status: string | null;
  runtime_capture_status: string | null;
  figma_artifact?: string;
  runtime_artifact?: string;
  figma_error?: string;
  runtime_error?: string;
  figma_duration_ms?: number;
  runtime_duration_ms?: number;
}

export interface RunManifest {
  run_id: string;
  started_at: string;
  finished_at: string;
  git_commit: string;
  git_branch: string;
  mode: 'figma' | 'runtime' | 'full';
  filters: {
    screen_id?: string;
    flow_id?: string;
    tag?: string;
  };
  total_targets: number;
  summary: {
    figma_success: number;
    figma_skipped: number;
    figma_failed: number;
    runtime_success: number;
    runtime_skipped: number;
    runtime_failed: number;
  };
  screens: ScreenRunEntry[];
}

// ── Builder ──────────────────────────────────────────────

export function buildManifest(opts: {
  runId: string;
  startedAt: string;
  mode: 'figma' | 'runtime' | 'full';
  filters: { screen_id?: string; flow_id?: string; tag?: string };
  screenIds: string[];
  figmaResults: FigmaFetchResult[];
  runtimeResults: RuntimeCaptureResult[];
}): RunManifest {
  const figmaMap = new Map(opts.figmaResults.map((r) => [r.screen_id, r]));
  const runtimeMap = new Map(opts.runtimeResults.map((r) => [r.screen_id, r]));

  const screens: ScreenRunEntry[] = opts.screenIds.map((id) => {
    const figma = figmaMap.get(id);
    const runtime = runtimeMap.get(id);

    return {
      screen_id: id,
      figma_fetch_status: figma?.status ?? null,
      runtime_capture_status: runtime?.status ?? null,
      figma_artifact: figma?.artifact_path,
      runtime_artifact: runtime?.artifact_path,
      figma_error: figma?.error,
      runtime_error: runtime?.error,
      figma_duration_ms: figma?.duration_ms,
      runtime_duration_ms: runtime?.duration_ms,
    };
  });

  const figmaSuccess = opts.figmaResults.filter((r) => r.status === 'success').length;
  const figmaSkipped = opts.figmaResults.filter((r) => r.status.startsWith('skipped')).length;
  const figmaFailed = opts.figmaResults.filter(
    (r) => r.status.startsWith('failed'),
  ).length;

  const runtimeSuccess = opts.runtimeResults.filter((r) => r.status === 'success').length;
  const runtimeSkipped = opts.runtimeResults.filter((r) => r.status.startsWith('skipped')).length;
  const runtimeFailed = opts.runtimeResults.filter(
    (r) => r.status.startsWith('failed'),
  ).length;

  return {
    run_id: opts.runId,
    started_at: opts.startedAt,
    finished_at: isoNow(),
    git_commit: getGitCommit(),
    git_branch: getGitBranch(),
    mode: opts.mode,
    filters: opts.filters,
    total_targets: opts.screenIds.length,
    summary: {
      figma_success: figmaSuccess,
      figma_skipped: figmaSkipped,
      figma_failed: figmaFailed,
      runtime_success: runtimeSuccess,
      runtime_skipped: runtimeSkipped,
      runtime_failed: runtimeFailed,
    },
    screens,
  };
}

/** Save manifest JSON to storage/runs/{run_id}/ */
export function saveManifest(manifest: RunManifest): string {
  const dir = path.join(RUNS_STORAGE, manifest.run_id);
  ensureDir(dir);

  const filePath = path.join(dir, 'run-manifest.json');
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2));

  return filePath;
}
