/**
 * Visual Embedding Engine — lightweight, pure-JS image embeddings for similarity search.
 *
 * Approach: spatial grid features (no ML dependencies, no GPU).
 * - Downscales image to a grid of blocks
 * - Per block: mean luminance, mean R/G/B, edge density
 * - Produces a fixed-size embedding vector (~320 dimensions)
 * - Cosine similarity for matching
 */
import fs from 'node:fs';
import path from 'node:path';
import { readPng, resizeNearest, type ImageData } from './image-ops.js';
import { STORAGE_DIR } from './config.js';
import { computeFileHash } from './utils.js';

// ── Constants ────────────────────────────────────────────

/** Embedding dimensionality: GRID_SIZE² × FEATURES_PER_BLOCK */
const GRID_SIZE = 8;
const FEATURES_PER_BLOCK = 5; // luminance, R, G, B, edge_density
const EMBEDDING_DIM = GRID_SIZE * GRID_SIZE * FEATURES_PER_BLOCK; // 320

/** Downscale target before grid extraction */
const THUMB_SIZE = 64;

/** Embeddings storage */
export const EMBEDDINGS_DIR = path.join(STORAGE_DIR, 'embeddings');

// ── Types ────────────────────────────────────────────────

export interface EmbeddingEntry {
  id: string;            // node_id or screen_id
  embedding: number[];   // fixed-size vector
  image_hash: string;    // SHA-256 of source PNG, for cache invalidation
  created_at: string;
}

export interface SimilarityResult {
  id: string;
  score: number;         // cosine similarity 0..1
}

// ── Core: compute embedding from RGBA image data ────────

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function computeEmbedding(img: ImageData): number[] {
  // Downscale to THUMB_SIZE × THUMB_SIZE
  const thumb = resizeNearest(img, THUMB_SIZE, THUMB_SIZE);
  const { data, width, height } = thumb;

  const blockW = Math.floor(width / GRID_SIZE);
  const blockH = Math.floor(height / GRID_SIZE);

  const embedding: number[] = [];

  for (let gy = 0; gy < GRID_SIZE; gy++) {
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      let sumR = 0, sumG = 0, sumB = 0, sumLum = 0;
      let edgeSum = 0;
      let count = 0;

      const startX = gx * blockW;
      const startY = gy * blockH;

      for (let dy = 0; dy < blockH; dy++) {
        for (let dx = 0; dx < blockW; dx++) {
          const x = startX + dx;
          const y = startY + dy;
          const idx = (y * width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const lum = luminance(r, g, b);

          sumR += r;
          sumG += g;
          sumB += b;
          sumLum += lum;
          count++;

          // Simple edge detection: absolute difference with right and bottom neighbor
          if (dx < blockW - 1) {
            const rIdx = (y * width + x + 1) * 4;
            const rLum = luminance(data[rIdx], data[rIdx + 1], data[rIdx + 2]);
            edgeSum += Math.abs(lum - rLum);
          }
          if (dy < blockH - 1) {
            const bIdx = ((y + 1) * width + x) * 4;
            const bLum = luminance(data[bIdx], data[bIdx + 1], data[bIdx + 2]);
            edgeSum += Math.abs(lum - bLum);
          }
        }
      }

      // Normalize to 0..1 range
      const n = count || 1;
      const edgeCount = (blockW - 1) * blockH + blockW * (blockH - 1) || 1;

      embedding.push(
        sumLum / n / 255,           // mean luminance
        sumR / n / 255,             // mean red
        sumG / n / 255,             // mean green
        sumB / n / 255,             // mean blue
        edgeSum / edgeCount / 255,  // edge density
      );
    }
  }

  return embedding;
}

// ── Embedding from PNG file ─────────────────────────────

export function embedPng(filePath: string): number[] {
  const img = readPng(filePath);
  return computeEmbedding(img);
}

// ── Cosine similarity ───────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dotProduct / denom;
}

// ── Top-K search ────────────────────────────────────────

export function findTopK(
  queryEmbedding: number[],
  corpus: EmbeddingEntry[],
  k: number = 5,
): SimilarityResult[] {
  const scored = corpus.map(entry => ({
    id: entry.id,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// ── Figma embeddings: compute & store ───────────────────

export interface FigmaEmbeddingStore {
  version: number;
  created_at: string;
  entries: EmbeddingEntry[];
}

const FIGMA_EMBEDDINGS_FILE = path.join(EMBEDDINGS_DIR, 'figma.json');

export function loadFigmaEmbeddings(): FigmaEmbeddingStore | null {
  if (!fs.existsSync(FIGMA_EMBEDDINGS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(FIGMA_EMBEDDINGS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveFigmaEmbeddings(store: FigmaEmbeddingStore): void {
  fs.mkdirSync(EMBEDDINGS_DIR, { recursive: true });
  fs.writeFileSync(FIGMA_EMBEDDINGS_FILE, JSON.stringify(store, null, 2));
}

/**
 * Compute embeddings for all Figma frame PNGs in storage/figma/.
 * Skips images that haven't changed (hash-based caching).
 */
export function embedAllFigmaFrames(force = false): {
  total: number;
  computed: number;
  cached: number;
  failed: number;
  store: FigmaEmbeddingStore;
} {
  const figmaDir = path.join(STORAGE_DIR, 'figma');
  if (!fs.existsSync(figmaDir)) {
    return { total: 0, computed: 0, cached: 0, failed: 0, store: { version: 1, created_at: new Date().toISOString(), entries: [] } };
  }

  const existing = force ? null : loadFigmaEmbeddings();
  const existingMap = new Map<string, EmbeddingEntry>();
  if (existing) {
    for (const e of existing.entries) {
      existingMap.set(e.id, e);
    }
  }

  const screenDirs = fs.readdirSync(figmaDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const entries: EmbeddingEntry[] = [];
  let computed = 0, cached = 0, failed = 0;

  for (const screenId of screenDirs) {
    const pngPath = path.join(figmaDir, screenId, 'figma.png');
    if (!fs.existsSync(pngPath)) continue;

    try {
      const hash = computeFileHash(pngPath);
      const prev = existingMap.get(screenId);

      if (prev && prev.image_hash === hash) {
        entries.push(prev);
        cached++;
        continue;
      }

      const embedding = embedPng(pngPath);
      entries.push({
        id: screenId,
        embedding,
        image_hash: hash,
        created_at: new Date().toISOString(),
      });
      computed++;
    } catch (err) {
      console.error(`[embed] Failed to embed ${screenId}: ${(err as Error).message}`);
      failed++;
    }
  }

  const store: FigmaEmbeddingStore = {
    version: 1,
    created_at: new Date().toISOString(),
    entries,
  };

  saveFigmaEmbeddings(store);
  return { total: screenDirs.length, computed, cached, failed, store };
}

// ── Runtime embeddings: compute & store per screen ──────

export function embedRuntimeScreen(screenId: string, pngPath: string): EmbeddingEntry {
  const hash = computeFileHash(pngPath);
  const embedding = embedPng(pngPath);

  const entry: EmbeddingEntry = {
    id: screenId,
    embedding,
    image_hash: hash,
    created_at: new Date().toISOString(),
  };

  // Save per-screen
  const runtimeEmbDir = path.join(EMBEDDINGS_DIR, 'runtime');
  fs.mkdirSync(runtimeEmbDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeEmbDir, `${screenId}.json`),
    JSON.stringify(entry, null, 2),
  );

  return entry;
}

export function loadRuntimeEmbedding(screenId: string): EmbeddingEntry | null {
  const filePath = path.join(EMBEDDINGS_DIR, 'runtime', `${screenId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

// ── Embedding dimensions info ───────────────────────────

export { EMBEDDING_DIM, GRID_SIZE, FEATURES_PER_BLOCK };
