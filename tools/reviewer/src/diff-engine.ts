/**
 * Diff Engine — orchestrates per-screen visual comparison.
 *
 * For each screen:
 * 1. Reads figma.png and runtime.png artifacts
 * 2. Handles dimension mismatches (normalize or error)
 * 3. Resolves and applies masks
 * 4. Runs pixelmatch comparison
 * 5. Computes metrics and evaluates thresholds
 * 6. Generates diff.png, overlay.png, result.json
 *
 * Deterministic. No AI. No magic.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FIGMA_STORAGE, RUNTIME_STORAGE, RUNS_STORAGE } from './config.js';
import type { Screen, RegistryCoverage, DriftClassification } from './registry.js';
import { readPng, writePng, compareImages, createOverlay, resizeNearest, type ImageData } from './image-ops.js';
import { resolveMasks, type MaskBox, type ResolvedMask } from './masking.js';
import { computeMetrics, evaluateThresholds, type DiffStatus, type ScoringResult } from './scoring.js';
import { ensureDir, isoNow } from './utils.js';

// ── Types ────────────────────────────────────────────────

export interface ScreenDiffResult {
  screen_id: string;
  status: DiffStatus;
  drift_classification: DriftClassification;
  figma_artifact: string | null;
  runtime_artifact: string | null;
  diff_artifact: string | null;
  overlay_artifact: string | null;
  dimensions: {
    figma: { width: number; height: number } | null;
    runtime: { width: number; height: number } | null;
    normalized: boolean;
    dimension_match: boolean;
  };
  masks_applied: ResolvedMask[];
  metrics: ScoringResult['metrics'] | null;
  threshold_eval: ScoringResult['threshold_eval'] | null;
  failure_reasons: string[];
  warnings: string[];
  timing: {
    started_at: string;
    finished_at: string;
    duration_ms: number;
  };
}

export interface DiffManifest {
  run_id: string;
  source_manifest: string;
  started_at: string;
  finished_at: string;
  git_commit: string;
  git_branch: string;
  total_screens: number;
  coverage?: RegistryCoverage;
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    errored: number;
  };
  worst_screens: Array<{ screen_id: string; mismatch_percent: number }>;
  screens: ScreenDiffResult[];
}

// ── Helpers ──────────────────────────────────────────────

function figmaArtifactPath(screenId: string): string {
  return path.join(FIGMA_STORAGE, screenId, 'figma.png');
}

function runtimeArtifactPath(screenId: string): string {
  return path.join(RUNTIME_STORAGE, screenId, 'runtime.png');
}

function runtimeMetadataPath(screenId: string): string {
  return path.join(RUNTIME_STORAGE, screenId, 'metadata.json');
}

function diffOutputDir(runId: string, screenId: string): string {
  return path.join(RUNS_STORAGE, runId, 'diff', screenId);
}

function loadRuntimeMaskBoxes(screenId: string): Record<string, MaskBox | MaskBox[]> | undefined {
  const metaPath = runtimeMetadataPath(screenId);
  if (!fs.existsSync(metaPath)) return undefined;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return meta.mask_boxes ?? undefined;
  } catch {
    return undefined;
  }
}

// ── Per-screen diff ──────────────────────────────────────

export function diffScreen(screen: Screen, runId: string): ScreenDiffResult {
  const startedAt = isoNow();
  const startTime = Date.now();

  const figmaPath = figmaArtifactPath(screen.screen_id);
  const runtimePath = runtimeArtifactPath(screen.screen_id);
  const outDir = diffOutputDir(runId, screen.screen_id);

  // ── Check artifact existence ──
  const hasFigma = fs.existsSync(figmaPath);
  const hasRuntime = fs.existsSync(runtimePath);

  if (!hasFigma && !hasRuntime) {
    return makeResult(screen, startedAt, startTime, {
      status: 'skipped',
      failure_reasons: [],
      warnings: ['Both figma.png and runtime.png missing — nothing to compare'],
    });
  }

  if (!hasFigma) {
    return makeResult(screen, startedAt, startTime, {
      status: 'skipped',
      figma_artifact: null,
      runtime_artifact: runtimePath,
      failure_reasons: [],
      warnings: ['figma.png missing — cannot compute diff without baseline'],
    });
  }

  if (!hasRuntime) {
    return makeResult(screen, startedAt, startTime, {
      status: 'skipped',
      figma_artifact: figmaPath,
      runtime_artifact: null,
      failure_reasons: [],
      warnings: ['runtime.png missing — cannot compute diff without runtime snapshot'],
    });
  }

  // ── Read images ──
  let figmaImg: ImageData;
  let runtimeImg: ImageData;

  try {
    figmaImg = readPng(figmaPath);
  } catch (err) {
    return makeResult(screen, startedAt, startTime, {
      status: 'error',
      figma_artifact: figmaPath,
      failure_reasons: [`Failed to read figma.png: ${(err as Error).message}`],
    });
  }

  try {
    runtimeImg = readPng(runtimePath);
  } catch (err) {
    return makeResult(screen, startedAt, startTime, {
      status: 'error',
      runtime_artifact: runtimePath,
      failure_reasons: [`Failed to read runtime.png: ${(err as Error).message}`],
    });
  }

  const dimMatch = figmaImg.width === runtimeImg.width && figmaImg.height === runtimeImg.height;
  const warnings: string[] = [];
  let normalized = false;

  // ── Dimension mismatch handling ──
  if (!dimMatch) {
    warnings.push(
      `Dimension mismatch: figma=${figmaImg.width}x${figmaImg.height}, runtime=${runtimeImg.width}x${runtimeImg.height}. Normalizing figma to runtime dimensions.`,
    );
    // Normalize figma to runtime dimensions — runtime viewport is the contract
    figmaImg = resizeNearest(figmaImg, runtimeImg.width, runtimeImg.height);
    normalized = true;
  }

  const { width, height } = runtimeImg;

  // ── Resolve masks ──
  const runtimeBoxes = loadRuntimeMaskBoxes(screen.screen_id);
  const maskResult = resolveMasks(screen.masks, runtimeBoxes, width, height);
  warnings.push(...maskResult.warnings);

  // ── Compare ──
  const maskBuf = maskResult.totalMaskedPixels > 0 ? maskResult.buffer : undefined;
  const diffResult = compareImages(figmaImg, runtimeImg, maskBuf);

  // ── Score ──
  const metrics = computeMetrics(width * height, maskResult.totalMaskedPixels, diffResult.mismatchCount);
  const scoring = evaluateThresholds(metrics, screen.thresholds);
  warnings.push(...scoring.warnings);

  // ── Write artifacts ──
  ensureDir(outDir);
  const diffPngPath = path.join(outDir, 'diff.png');
  const overlayPngPath = path.join(outDir, 'overlay.png');
  const resultJsonPath = path.join(outDir, 'result.json');

  writePng(diffPngPath, width, height, diffResult.diffBuffer);

  const overlayData = createOverlay(runtimeImg, diffResult.diffBuffer, maskBuf);
  writePng(overlayPngPath, width, height, overlayData);

  const result: ScreenDiffResult = {
    screen_id: screen.screen_id,
    status: scoring.status,
    drift_classification: screen.drift_classification ?? 'none',
    figma_artifact: figmaPath,
    runtime_artifact: runtimePath,
    diff_artifact: diffPngPath,
    overlay_artifact: overlayPngPath,
    dimensions: {
      figma: { width: figmaImg.width, height: figmaImg.height },
      runtime: { width: runtimeImg.width, height: runtimeImg.height },
      normalized,
      dimension_match: dimMatch,
    },
    masks_applied: maskResult.masks,
    metrics: scoring.metrics,
    threshold_eval: scoring.threshold_eval,
    failure_reasons: scoring.failure_reasons,
    warnings,
    timing: {
      started_at: startedAt,
      finished_at: isoNow(),
      duration_ms: Date.now() - startTime,
    },
  };

  fs.writeFileSync(resultJsonPath, JSON.stringify(result, null, 2));

  return result;
}

// ── Batch diff ───────────────────────────────────────────

export function diffAllScreens(screens: Screen[], runId: string): ScreenDiffResult[] {
  const results: ScreenDiffResult[] = [];

  for (const screen of screens) {
    console.log(`[diff] ${screen.screen_id}`);
    const result = diffScreen(screen, runId);
    const pct = result.metrics ? `${result.metrics.mismatch_percent.toFixed(2)}%` : 'n/a';
    console.log(`  -> ${result.status} (mismatch: ${pct})`);
    if (result.warnings.length > 0) {
      for (const w of result.warnings) console.log(`  ⚠ ${w}`);
    }
    results.push(result);
  }

  return results;
}

// ── Manifest ─────────────────────────────────────────────

export function buildDiffManifest(
  runId: string,
  sourceManifest: string,
  startedAt: string,
  results: ScreenDiffResult[],
  gitCommit: string,
  gitBranch: string,
  coverage?: RegistryCoverage,
): DiffManifest {
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const errored = results.filter((r) => r.status === 'error').length;

  // Top 5 worst screens by mismatch %
  const worst = results
    .filter((r) => r.metrics && r.status !== 'skipped')
    .sort((a, b) => (b.metrics?.mismatch_percent ?? 0) - (a.metrics?.mismatch_percent ?? 0))
    .slice(0, 5)
    .map((r) => ({
      screen_id: r.screen_id,
      mismatch_percent: r.metrics?.mismatch_percent ?? 0,
    }));

  return {
    run_id: runId,
    source_manifest: sourceManifest,
    started_at: startedAt,
    finished_at: isoNow(),
    git_commit: gitCommit,
    git_branch: gitBranch,
    total_screens: results.length,
    coverage,
    summary: { passed, failed, skipped, errored },
    worst_screens: worst,
    screens: results,
  };
}

export function saveDiffManifest(manifest: DiffManifest): string {
  const dir = path.join(RUNS_STORAGE, manifest.run_id);
  ensureDir(dir);
  const filePath = path.join(dir, 'diff-manifest.json');
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2));
  return filePath;
}

// ── Internal ─────────────────────────────────────────────

function makeResult(
  screen: Screen,
  startedAt: string,
  startTime: number,
  overrides: Partial<ScreenDiffResult>,
): ScreenDiffResult {
  return {
    screen_id: screen.screen_id,
    status: 'skipped',
    drift_classification: screen.drift_classification ?? 'none',
    figma_artifact: null,
    runtime_artifact: null,
    diff_artifact: null,
    overlay_artifact: null,
    dimensions: { figma: null, runtime: null, normalized: false, dimension_match: false },
    masks_applied: [],
    metrics: null,
    threshold_eval: null,
    failure_reasons: [],
    warnings: [],
    timing: {
      started_at: startedAt,
      finished_at: isoNow(),
      duration_ms: Date.now() - startTime,
    },
    ...overrides,
  };
}
