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

export interface MaskResult {
  /** Single-channel buffer: 255 = masked, 0 = compare */
  buffer: Uint8Array;
  /** Total masked pixels */
  totalMaskedPixels: number;
  /** Per-mask resolution details */
  masks: ResolvedMask[];
  /** Warnings (e.g., unresolvable selectors) */
  warnings: string[];
}

// ── Resolve ──────────────────────────────────────────────

/**
 * Resolve registry masks to bounding boxes using runtime metadata.
 * Runtime metadata should contain `mask_boxes` array captured during screenshot.
 */
export function resolveMasks(
  registryMasks: ScreenMask[],
  runtimeMaskBoxes: Record<string, MaskBox> | undefined,
  imageWidth: number,
  imageHeight: number,
): MaskResult {
  const totalPixels = imageWidth * imageHeight;
  const buffer = new Uint8Array(totalPixels); // initialized to 0
  const resolved: ResolvedMask[] = [];
  const warnings: string[] = [];
  let totalMaskedPixels = 0;

  for (const mask of registryMasks) {
    const box = runtimeMaskBoxes?.[mask.selector] ?? null;

    if (!box) {
      warnings.push(`Mask "${mask.selector}" unresolved — no bounding box in runtime metadata. Excluded from masking.`);
      resolved.push({
        selector: mask.selector,
        reason: mask.reason,
        box: null,
        source: 'unresolved',
        pixels_masked: 0,
      });
      continue;
    }

    // Clamp box to image bounds
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

    totalMaskedPixels += pixelsMasked;
    resolved.push({
      selector: mask.selector,
      reason: mask.reason,
      box,
      source: 'runtime_metadata',
      pixels_masked: pixelsMasked,
    });
  }

  return { buffer, totalMaskedPixels, masks: resolved, warnings };
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
