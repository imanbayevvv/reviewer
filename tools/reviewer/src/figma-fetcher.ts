import fs from 'node:fs';
import path from 'node:path';
import {
  FIGMA_API_BASE,
  FIGMA_PLACEHOLDER_FILE_KEY,
  FIGMA_PLACEHOLDER_NODE_ID,
  FIGMA_STORAGE,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX,
  getEnv,
} from './config.js';
import type { Screen } from './registry.js';
import { computeBufferHash, ensureDir, isoNow, sleep } from './utils.js';

// ── Types ────────────────────────────────────────────────

export type FigmaFetchStatus =
  | 'success'
  | 'skipped_missing_figma_ref'
  | 'skipped_cached'
  | 'failed_api_error'
  | 'failed_download_error'
  | 'failed_no_token';

export interface FigmaFetchResult {
  screen_id: string;
  status: FigmaFetchStatus;
  file_key?: string;
  node_id?: string;
  fetched_at: string;
  source_url?: string;
  checksum?: string;
  artifact_path?: string;
  error?: string;
  duration_ms: number;
}

export interface FigmaMetadata {
  screen_id: string;
  file_key: string;
  node_id: string;
  fetched_at: string;
  source_url: string;
  checksum: string;
  fetch_status: FigmaFetchStatus;
}

// ── Helpers ──────────────────────────────────────────────

/** Maximum IDs per Figma export request */
const BATCH_CHUNK_SIZE = 50;

/** Maximum wait time for a single retry (10 seconds) */
const MAX_RETRY_DELAY_MS = 10_000;

function hasFigmaRef(screen: Screen): boolean {
  return (
    screen.figma.file_key !== FIGMA_PLACEHOLDER_FILE_KEY &&
    screen.figma.node_id !== FIGMA_PLACEHOLDER_NODE_ID
  );
}

function screenDir(screenId: string): string {
  return path.join(FIGMA_STORAGE, screenId);
}

function isCached(screenId: string): boolean {
  const dir = screenDir(screenId);
  return fs.existsSync(path.join(dir, 'figma.png')) && fs.existsSync(path.join(dir, 'metadata.json'));
}

/**
 * Split an array into chunks of a given size.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Parse the Retry-After header value.
 * Figma sends it as an integer in seconds.
 * Returns delay in milliseconds, or null if the header is missing/invalid.
 */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds * 1000;
}

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const res = await fetch(url, { headers });

      if (res.ok) return res;

      // Retry on 429 (rate limit) and 5xx (server error)
      if (res.status === 429 || res.status >= 500) {
        const fallbackDelay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
        const rawDelay = retryAfterMs ?? fallbackDelay;
        const delayMs = Math.min(rawDelay, MAX_RETRY_DELAY_MS);
        const source = retryAfterMs != null ? 'Retry-After header' : 'fallback backoff';

        console.log(
          `  Retry ${attempt + 1}/${RETRY_MAX} | status=${res.status} | delay=${delayMs}ms (${source})`,
        );
        await sleep(delayMs);
        continue;
      }

      // Non-retryable error
      throw new Error(`Figma API returned ${res.status}: ${await res.text()}`);
    } catch (err) {
      lastError = err as Error;
      if (attempt < RETRY_MAX - 1) {
        const delay = Math.min(
          RETRY_BASE_DELAY_MS * Math.pow(2, attempt),
          MAX_RETRY_DELAY_MS,
        );
        console.log(
          `  Retry ${attempt + 1}/${RETRY_MAX} | network error | delay=${delay}ms (fallback backoff)`,
        );
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Fetch failed after retries');
}

// ── Single-screen fetch (kept for backwards compat) ─────

/**
 * Fetch a single screen's Figma export.
 * Prefer fetchAllFigmaScreens() for batched requests.
 */
export async function fetchFigmaScreen(
  screen: Screen,
  options: { force?: boolean } = {},
): Promise<FigmaFetchResult> {
  const results = await fetchAllFigmaScreens([screen], options);
  return results[0];
}

// ── Batched fetch ────────────────────────────────────────

/**
 * Fetch Figma exports for all given screens using batched API requests.
 *
 * Groups screens by file_key, batches node_ids into chunks of 50,
 * makes one export API call per chunk, then downloads images individually.
 * Chunks are processed sequentially to avoid rate limits.
 */
export async function fetchAllFigmaScreens(
  screens: Screen[],
  options: { force?: boolean } = {},
): Promise<FigmaFetchResult[]> {
  const env = getEnv();
  const results: FigmaFetchResult[] = [];

  // ── Phase 1: Triage screens into skip/fetch buckets ────

  // Screens that need fetching, keyed by file_key for grouping
  const toFetch: Map<string, Screen[]> = new Map();

  for (const screen of screens) {
    const startTime = Date.now();

    // No token → fail all
    if (!env.figmaToken) {
      results.push({
        screen_id: screen.screen_id,
        status: 'failed_no_token',
        fetched_at: isoNow(),
        error: 'FIGMA_TOKEN env var not set',
        duration_ms: Date.now() - startTime,
      });
      continue;
    }

    // Missing figma ref → skip
    if (!hasFigmaRef(screen)) {
      console.log(`[figma] ${screen.screen_id} -> skipped_missing_figma_ref`);
      results.push({
        screen_id: screen.screen_id,
        status: 'skipped_missing_figma_ref',
        file_key: screen.figma.file_key,
        node_id: screen.figma.node_id,
        fetched_at: isoNow(),
        duration_ms: Date.now() - startTime,
      });
      continue;
    }

    // Cached → skip (unless --force)
    if (!options.force && isCached(screen.screen_id)) {
      console.log(`[figma] ${screen.screen_id} -> skipped_cached`);
      results.push({
        screen_id: screen.screen_id,
        status: 'skipped_cached',
        file_key: screen.figma.file_key,
        node_id: screen.figma.node_id,
        fetched_at: isoNow(),
        artifact_path: path.join(screenDir(screen.screen_id), 'figma.png'),
        duration_ms: Date.now() - startTime,
      });
      continue;
    }

    // Group by file_key for batching
    const key = screen.figma.file_key;
    if (!toFetch.has(key)) toFetch.set(key, []);
    toFetch.get(key)!.push(screen);
  }

  // ── Phase 2: Batch export requests per file_key ────────

  for (const [fileKey, fileScreens] of toFetch) {
    const headers = { 'X-Figma-Token': env.figmaToken };

    // Build lookup: node_id → screen (for mapping results back)
    const nodeToScreen = new Map<string, Screen>();
    for (const s of fileScreens) {
      nodeToScreen.set(s.figma.node_id, s);
    }

    const nodeIds = fileScreens.map((s) => s.figma.node_id);
    const chunks = chunk(nodeIds, BATCH_CHUNK_SIZE);

    console.log(
      `[figma] Batching ${nodeIds.length} nodes for file ${fileKey} ` +
      `(${chunks.length} request${chunks.length > 1 ? 's' : ''})`,
    );

    // Process chunks sequentially
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunkIds = chunks[ci];
      const chunkLabel = chunks.length > 1 ? ` [chunk ${ci + 1}/${chunks.length}]` : '';

      // ── Step A: Batch export URL request ────
      const idsParam = chunkIds.map(encodeURIComponent).join(',');
      const exportUrl = `${FIGMA_API_BASE}/images/${fileKey}?ids=${idsParam}&format=png&scale=1`;

      console.log(`[figma]${chunkLabel} Requesting export URLs for ${chunkIds.length} nodes...`);
      const chunkStartTime = Date.now();

      let imageUrls: Record<string, string | null>;

      try {
        const exportRes = await fetchWithRetry(exportUrl, headers);
        const exportData = (await exportRes.json()) as {
          err: string | null;
          images: Record<string, string | null>;
        };

        if (exportData.err) {
          // Entire chunk failed — mark all screens in this chunk as failed
          for (const nodeId of chunkIds) {
            const screen = nodeToScreen.get(nodeId)!;
            results.push({
              screen_id: screen.screen_id,
              status: 'failed_api_error',
              file_key: fileKey,
              node_id: nodeId,
              fetched_at: isoNow(),
              error: `Figma export error: ${exportData.err}`,
              duration_ms: Date.now() - chunkStartTime,
            });
          }
          continue;
        }

        imageUrls = exportData.images;
      } catch (err) {
        // Network/retry failure for entire chunk
        for (const nodeId of chunkIds) {
          const screen = nodeToScreen.get(nodeId)!;
          results.push({
            screen_id: screen.screen_id,
            status: 'failed_api_error',
            file_key: fileKey,
            node_id: nodeId,
            fetched_at: isoNow(),
            error: (err as Error).message,
            duration_ms: Date.now() - chunkStartTime,
          });
        }
        continue;
      }

      // ── Step B: Download each image individually ────
      for (const nodeId of chunkIds) {
        const screen = nodeToScreen.get(nodeId)!;
        const screenStart = Date.now();
        const imageUrl = imageUrls[nodeId];

        if (!imageUrl) {
          console.log(`[figma]   ${screen.screen_id} -> no image URL returned`);
          results.push({
            screen_id: screen.screen_id,
            status: 'failed_api_error',
            file_key: fileKey,
            node_id: nodeId,
            fetched_at: isoNow(),
            error: `No image URL returned for node ${nodeId}`,
            duration_ms: Date.now() - screenStart,
          });
          continue;
        }

        try {
          console.log(`[figma]   ${screen.screen_id} -> downloading...`);
          const imgRes = await fetchWithRetry(imageUrl, {});
          const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

          // Save artifacts
          const dir = screenDir(screen.screen_id);
          ensureDir(dir);

          const pngPath = path.join(dir, 'figma.png');
          fs.writeFileSync(pngPath, imgBuffer);

          const checksum = computeBufferHash(imgBuffer);

          const metadata: FigmaMetadata = {
            screen_id: screen.screen_id,
            file_key: fileKey,
            node_id: nodeId,
            fetched_at: isoNow(),
            source_url: imageUrl,
            checksum,
            fetch_status: 'success',
          };

          fs.writeFileSync(
            path.join(dir, 'metadata.json'),
            JSON.stringify(metadata, null, 2),
          );

          console.log(`[figma]   ${screen.screen_id} -> success`);
          results.push({
            screen_id: screen.screen_id,
            status: 'success',
            file_key: fileKey,
            node_id: nodeId,
            fetched_at: metadata.fetched_at,
            source_url: imageUrl,
            checksum,
            artifact_path: pngPath,
            duration_ms: Date.now() - screenStart,
          });
        } catch (err) {
          console.log(`[figma]   ${screen.screen_id} -> failed_download_error`);
          results.push({
            screen_id: screen.screen_id,
            status: 'failed_download_error',
            file_key: fileKey,
            node_id: nodeId,
            fetched_at: isoNow(),
            error: (err as Error).message,
            duration_ms: Date.now() - screenStart,
          });
        }
      }
    }
  }

  return results;
}
