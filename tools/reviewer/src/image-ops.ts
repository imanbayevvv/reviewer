/**
 * Image operations: PNG read/write, pixelmatch wrapper, overlay composition.
 */
import fs from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { DIFF_PIXELMATCH_THRESHOLD, DIFF_INCLUDE_AA } from './config.js';

// ── Types ────────────────────────────────────────────────

export interface ImageData {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface DiffResult {
  /** Number of mismatched pixels (after masking) */
  mismatchCount: number;
  /** Raw diff RGBA buffer (same dimensions as inputs) */
  diffBuffer: Uint8Array;
  /** Width of the compared images */
  width: number;
  /** Height of the compared images */
  height: number;
}

// ── PNG I/O ──────────────────────────────────────────────

export function readPng(filePath: string): ImageData {
  const fileBuffer = fs.readFileSync(filePath);
  const png = PNG.sync.read(fileBuffer);
  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
  };
}

export function writePng(filePath: string, width: number, height: number, data: Uint8Array): void {
  const png = new PNG({ width, height });
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(png.data);
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

// ── Resize ───────────────────────────────────────────────

/**
 * Nearest-neighbor resize of RGBA image data.
 * Used only when dimensions don't match and we need controlled normalization.
 */
export function resizeNearest(src: ImageData, targetW: number, targetH: number): ImageData {
  const dst = new Uint8Array(targetW * targetH * 4);
  for (let y = 0; y < targetH; y++) {
    const srcY = Math.floor((y * src.height) / targetH);
    for (let x = 0; x < targetW; x++) {
      const srcX = Math.floor((x * src.width) / targetW);
      const srcIdx = (srcY * src.width + srcX) * 4;
      const dstIdx = (y * targetW + x) * 4;
      dst[dstIdx] = src.data[srcIdx];
      dst[dstIdx + 1] = src.data[srcIdx + 1];
      dst[dstIdx + 2] = src.data[srcIdx + 2];
      dst[dstIdx + 3] = src.data[srcIdx + 3];
    }
  }
  return { width: targetW, height: targetH, data: dst };
}

// ── Pixel Diff ───────────────────────────────────────────

/**
 * Compare two RGBA images of the same dimensions.
 * Optionally applies a mask buffer (0 = compare, 255 = skip).
 * Returns mismatch count and diff image buffer.
 */
export function compareImages(
  img1: ImageData,
  img2: ImageData,
  maskBuffer?: Uint8Array,
): DiffResult {
  if (img1.width !== img2.width || img1.height !== img2.height) {
    throw new Error(
      `Dimension mismatch: ${img1.width}x${img1.height} vs ${img2.width}x${img2.height}`,
    );
  }

  const { width, height } = img1;
  const totalPixels = width * height;

  // If we have a mask, we need to pre-process: set masked pixels to identical
  // so pixelmatch ignores them. We work on copies to avoid mutating originals.
  let data1 = img1.data;
  let data2 = img2.data;

  if (maskBuffer) {
    data1 = new Uint8Array(img1.data);
    data2 = new Uint8Array(img2.data);
    for (let i = 0; i < totalPixels; i++) {
      if (maskBuffer[i] === 255) {
        // Set both to same color so pixelmatch treats them as matching
        const idx = i * 4;
        data1[idx] = data2[idx] = 0;
        data1[idx + 1] = data2[idx + 1] = 0;
        data1[idx + 2] = data2[idx + 2] = 0;
        data1[idx + 3] = data2[idx + 3] = 255;
      }
    }
  }

  const diffBuffer = new Uint8Array(width * height * 4);

  const mismatchCount = pixelmatch(
    data1,
    data2,
    diffBuffer,
    width,
    height,
    {
      threshold: DIFF_PIXELMATCH_THRESHOLD,
      includeAA: DIFF_INCLUDE_AA,
      alpha: 0.1,
      diffColor: [255, 0, 0],       // red for mismatch
      diffColorAlt: [255, 170, 0],   // orange for anti-aliased diff
    },
  );

  return { mismatchCount, diffBuffer, width, height };
}

// ── Overlay ──────────────────────────────────────────────

/**
 * Create an overlay: runtime screenshot with red highlight on mismatched areas.
 * maskBuffer marks masked regions (painted as blue tint).
 */
export function createOverlay(
  runtime: ImageData,
  diffBuffer: Uint8Array,
  maskBuffer?: Uint8Array,
): Uint8Array {
  const { width, height } = runtime;
  const overlay = new Uint8Array(runtime.data);

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const diffR = diffBuffer[idx];
    const diffG = diffBuffer[idx + 1];

    // Check if this pixel is a mismatch (red or orange in diff)
    if (diffR > 200 && diffG < 50) {
      // Strong red mismatch — paint red overlay at 60% opacity
      overlay[idx] = Math.min(255, Math.round(overlay[idx] * 0.4 + 255 * 0.6));
      overlay[idx + 1] = Math.round(overlay[idx + 1] * 0.4);
      overlay[idx + 2] = Math.round(overlay[idx + 2] * 0.4);
    } else if (diffR > 200 && diffG > 100) {
      // Orange AA diff — paint orange overlay at 40% opacity
      overlay[idx] = Math.min(255, Math.round(overlay[idx] * 0.6 + 255 * 0.4));
      overlay[idx + 1] = Math.min(255, Math.round(overlay[idx + 1] * 0.6 + 170 * 0.4));
      overlay[idx + 2] = Math.round(overlay[idx + 2] * 0.6);
    }

    // Blue tint for masked regions
    if (maskBuffer && maskBuffer[i] === 255) {
      overlay[idx] = Math.round(overlay[idx] * 0.7);
      overlay[idx + 1] = Math.round(overlay[idx + 1] * 0.7);
      overlay[idx + 2] = Math.min(255, Math.round(overlay[idx + 2] * 0.7 + 100 * 0.3));
      overlay[idx + 3] = 200;
    }
  }

  return overlay;
}
