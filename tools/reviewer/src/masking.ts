/**
 * Mask normalization and pixel-level mask buffer generation.
 *
 * Masks come from two sources:
 * 1. Registry: selector-based masks (CSS selectors)
 * 2. Runtime metadata: pre-computed bounding boxes from Playwright
 *
 * At diff time, we resolve selectors to boxes via runtime metadata,
 * then generate a single-channel mask buffer where 255 = masked, 0 = compare.
 */

import type { ScreenMask } from './registry.js';

// ── Types ────────────────────────────────────────────────

export interface MaskBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ResolvedMask {
  selector: string;
  reason: string;
  box: MaskBox | null;
  source: 'runtime_metadata' | 'unresolved';
  pixels_masked: number;
}

export interface MaskDiagnostic {
  /** CSS selector string from registry */
  selector: string;
  /** Number of elements (bounding boxes) this selector resolved to */
  elements: number;
  /** Fraction of total image pixels that are masked by this selector (0..1) */
  coverage: number;
  /** Per-selector warning strings */
  warnings: string[];
}

export interface MaskResult {
  /** Single-channel buffer: 255 = masked, 0 = compare */
  buffer: Uint8Array;
  /** Total masked pixels */
  totalMaskedPixels: number;
  /** Per-mask resolution details */
  masks: ResolvedMask[];
  /** Warnings (e.g., unresolvable selectors) */
  warnings: string[];
  /** Structured per-selector diagnostics for reporting */
  diagnostics: MaskDiagnostic[];
}

// ── Resolve ──────────────────────────────────────────────

/**
 * Normalize legacy single-box format to array.
 * Runtime metadata may contain either a single MaskBox or MaskBox[] per selector.
 */
function normalizeBoxes(raw: MaskBox | MaskBox[] | undefined): MaskBox[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
}

/**
 * Paint a single box onto the mask buffer. Returns number of newly masked pixels.
 */
function paintBox(
  buffer: Uint8Array,
  box: MaskBox,
  imageWidth: number,
  imageHeight: number,
): number {
  const x0 = Math.max(0, Math.round(box.x));
  const y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(imageWidth, Math.round(box.x + box.w));
  const y1 = Math.min(imageHeight, Math.round(box.y + box.h));

  let pixelsMasked = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = y * imageWidth + x;
      if (buffer[idx] === 0) {
        buffer[idx] = 255;
        pixelsMasked++;
      }
    }
  }
  return pixelsMasked;
}

/**
 * Resolve registry masks to bounding boxes using runtime metadata.
 * Runtime metadata contains `mask_boxes` — either a single box or array of boxes per selector.
 */
export function resolveMasks(
  registryMasks: ScreenMask[],
  runtimeMaskBoxes: Record<string, MaskBox | MaskBox[]> | undefined,
  imageWidth: number,
  imageHeight: number,
): MaskResult {
  const totalPixels = imageWidth * imageHeight;
  const buffer = new Uint8Array(totalPixels); // initialized to 0
  const resolved: ResolvedMask[] = [];
  const warnings: string[] = [];
  const diagnostics: MaskDiagnostic[] = [];
  let totalMaskedPixels = 0;

  for (const mask of registryMasks) {
    const boxes = normalizeBoxes(runtimeMaskBoxes?.[mask.selector]);

    if (boxes.length === 0) {
      warnings.push(`Mask "${mask.selector}" unresolved — no bounding box in runtime metadata. Excluded from masking.`);
      resolved.push({
        selector: mask.selector,
        reason: mask.reason,
        box: null,
        source: 'unresolved',
        pixels_masked: 0,
      });
      // Zero-match diagnostic
      diagnostics.push({
        selector: mask.selector,
        elements: 0,
        coverage: 0,
        warnings: ['selector matched nothing'],
      });
      continue;
    }

    let pixelsMasked = 0;
    for (const box of boxes) {
      pixelsMasked += paintBox(buffer, box, imageWidth, imageHeight);
    }

    totalMaskedPixels += pixelsMasked;
    resolved.push({
      selector: mask.selector,
      reason: mask.reason,
      box: boxes[0], // primary box for report display
      source: 'runtime_metadata',
      pixels_masked: pixelsMasked,
    });

    if (boxes.length > 1) {
      warnings.push(`Mask "${mask.selector}" resolved to ${boxes.length} elements (${pixelsMasked}px total)`);
    }

    // Build per-selector diagnostic
    const coverage = totalPixels > 0 ? pixelsMasked / totalPixels : 0;
    const diagWarnings: string[] = [];
    if (coverage > 0.15) diagWarnings.push('selector covers large area (>15%)');
    if (boxes.length > 3) diagWarnings.push('selector matched many elements');
    diagnostics.push({
      selector: mask.selector,
      elements: boxes.length,
      coverage,
      warnings: diagWarnings,
    });
  }

  return { buffer, totalMaskedPixels, masks: resolved, warnings, diagnostics };
}

/**
 * Create a mask buffer from explicit box array (no selector resolution needed).
 * Useful for testing or manual box-based masks.
 */
export function maskFromBoxes(
  boxes: MaskBox[],
  imageWidth: number,
  imageHeight: number,
): Uint8Array {
  const buffer = new Uint8Array(imageWidth * imageHeight);
  for (const box of boxes) {
    const x0 = Math.max(0, Math.round(box.x));
    const y0 = Math.max(0, Math.round(box.y));
    const x1 = Math.min(imageWidth, Math.round(box.x + box.w));
    const y1 = Math.min(imageHeight, Math.round(box.y + box.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        buffer[y * imageWidth + x] = 255;
      }
    }
  }
  return buffer;
}
