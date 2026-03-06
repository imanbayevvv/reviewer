/**
 * Scoring and threshold evaluation for diff results.
 *
 * All scores are deterministic and explainable through numbers.
 * No magic — every pass/fail decision traces to a specific threshold check.
 */

import type { ScreenThresholds } from './registry.js';

// ── Types ────────────────────────────────────────────────

export type DiffStatus = 'pass' | 'fail' | 'skipped' | 'error';

export interface DiffMetrics {
  total_pixels: number;
  compared_pixels: number;
  masked_pixels: number;
  masked_ratio: number;
  mismatch_pixels: number;
  /** mismatch_pixels / compared_pixels (excludes masked area) */
  mismatch_percent: number;
  /** 1 - mismatch_percent/100 — approximate structural similarity proxy */
  similarity: number;
}

export interface ThresholdEval {
  pixel_diff_percent: { threshold: number; actual: number; passed: boolean };
  structural_similarity: { threshold: number; actual: number; passed: boolean };
}

export interface ScoringResult {
  status: DiffStatus;
  metrics: DiffMetrics;
  threshold_eval: ThresholdEval;
  failure_reasons: string[];
  warnings: string[];
}

// ── Constants ────────────────────────────────────────────

/** Warn if more than this fraction of the screen is masked */
const OVER_MASKED_WARN_RATIO = 0.5;

// ── Compute ──────────────────────────────────────────────

export function computeMetrics(
  totalPixels: number,
  maskedPixels: number,
  mismatchPixels: number,
): DiffMetrics {
  const comparedPixels = totalPixels - maskedPixels;
  const mismatchPercent = comparedPixels > 0
    ? (mismatchPixels / comparedPixels) * 100
    : 0;
  const similarity = comparedPixels > 0
    ? 1 - mismatchPixels / comparedPixels
    : 1;

  return {
    total_pixels: totalPixels,
    compared_pixels: comparedPixels,
    masked_pixels: maskedPixels,
    masked_ratio: totalPixels > 0 ? maskedPixels / totalPixels : 0,
    mismatch_pixels: mismatchPixels,
    mismatch_percent: round4(mismatchPercent),
    similarity: round4(similarity),
  };
}

export function evaluateThresholds(
  metrics: DiffMetrics,
  thresholds: ScreenThresholds,
): ScoringResult {
  const failure_reasons: string[] = [];
  const warnings: string[] = [];

  // Threshold checks
  const pixelDiffPassed = metrics.mismatch_percent <= thresholds.pixel_diff_percent;
  const similarityPassed = metrics.similarity >= thresholds.structural_similarity;

  if (!pixelDiffPassed) {
    failure_reasons.push(
      `pixel_diff_percent ${metrics.mismatch_percent.toFixed(4)}% exceeds threshold ${thresholds.pixel_diff_percent}%`,
    );
  }

  if (!similarityPassed) {
    failure_reasons.push(
      `structural_similarity ${metrics.similarity.toFixed(4)} below threshold ${thresholds.structural_similarity}`,
    );
  }

  // Warnings
  if (metrics.masked_ratio > OVER_MASKED_WARN_RATIO) {
    warnings.push(
      `Over-masked: ${(metrics.masked_ratio * 100).toFixed(1)}% of screen is masked — diff may be unreliable`,
    );
  }

  if (metrics.compared_pixels === 0) {
    warnings.push('No pixels compared — entire image is masked');
  }

  const status: DiffStatus = failure_reasons.length > 0 ? 'fail' : 'pass';

  return {
    status,
    metrics,
    threshold_eval: {
      pixel_diff_percent: {
        threshold: thresholds.pixel_diff_percent,
        actual: metrics.mismatch_percent,
        passed: pixelDiffPassed,
      },
      structural_similarity: {
        threshold: thresholds.structural_similarity,
        actual: metrics.similarity,
        passed: similarityPassed,
      },
    },
    failure_reasons,
    warnings,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
