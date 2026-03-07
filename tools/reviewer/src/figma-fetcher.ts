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

// ── Core ─────────────────────────────────────────────────

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

/** Maximum wait time for a single retry (10 seconds) */
const MAX_RETRY_DELAY_MS = 10_000;

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

/**
 * Fetch a single screen's Figma export.
 */
export async function fetchFigmaScreen(
  screen: Screen,
  options: { force?: boolean } = {},
): Promise<FigmaFetchResult> {
  const startTime = Date.now();
  const env = getEnv();

  // Check for missing token
  if (!env.figmaToken) {
    return {
      screen_id: screen.screen_id,
      status: 'failed_no_token',
      fetched_at: isoNow(),
      error: 'FIGMA_TOKEN env var not set',
      duration_ms: Date.now() - startTime,
    };
  }

  // Check for placeholder refs
  if (!hasFigmaRef(screen)) {
    return {
      screen_id: screen.screen_id,
      status: 'skipped_missing_figma_ref',
      file_key: screen.figma.file_key,
      node_id: screen.figma.node_id,
      fetched_at: isoNow(),
      duration_ms: Date.now() - startTime,
    };
  }

  // Check cache
  if (!options.force && isCached(screen.screen_id)) {
    return {
      screen_id: screen.screen_id,
      status: 'skipped_cached',
      file_key: screen.figma.file_key,
      node_id: screen.figma.node_id,
      fetched_at: isoNow(),
      artifact_path: path.join(screenDir(screen.screen_id), 'figma.png'),
      duration_ms: Date.now() - startTime,
    };
  }

  const headers = { 'X-Figma-Token': env.figmaToken };
  const { file_key, node_id } = screen.figma;

  try {
    // Step 1: Get image export URL from Figma API
    const exportUrl = `${FIGMA_API_BASE}/images/${file_key}?ids=${encodeURIComponent(node_id)}&format=png&scale=1`;
    console.log(`  Requesting export URL for ${screen.screen_id}...`);

    const exportRes = await fetchWithRetry(exportUrl, headers);
    const exportData = (await exportRes.json()) as {
      err: string | null;
      images: Record<string, string | null>;
    };

    if (exportData.err) {
      throw new Error(`Figma export error: ${exportData.err}`);
    }

    const imageUrl = exportData.images[node_id];
    if (!imageUrl) {
      throw new Error(`No image URL returned for node ${node_id}`);
    }

    // Step 2: Download the actual PNG
    console.log(`  Downloading PNG for ${screen.screen_id}...`);
    const imgRes = await fetchWithRetry(imageUrl, {});
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    // Step 3: Save artifacts
    const dir = screenDir(screen.screen_id);
    ensureDir(dir);

    const pngPath = path.join(dir, 'figma.png');
    fs.writeFileSync(pngPath, imgBuffer);

    const checksum = computeBufferHash(imgBuffer);

    const metadata: FigmaMetadata = {
      screen_id: screen.screen_id,
      file_key,
      node_id,
      fetched_at: isoNow(),
      source_url: imageUrl,
      checksum,
      fetch_status: 'success',
    };

    fs.writeFileSync(
      path.join(dir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
    );

    return {
      screen_id: screen.screen_id,
      status: 'success',
      file_key,
      node_id,
      fetched_at: metadata.fetched_at,
      source_url: imageUrl,
      checksum,
      artifact_path: pngPath,
      duration_ms: Date.now() - startTime,
    };
  } catch (err) {
    const error = err as Error;
    return {
      screen_id: screen.screen_id,
      status: error.message.includes('download')
        ? 'failed_download_error'
        : 'failed_api_error',
      file_key,
      node_id,
      fetched_at: isoNow(),
      error: error.message,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Fetch Figma exports for all given screens.
 */
export async function fetchAllFigmaScreens(
  screens: Screen[],
  options: { force?: boolean } = {},
): Promise<FigmaFetchResult[]> {
  const results: FigmaFetchResult[] = [];

  for (const screen of screens) {
    console.log(`[figma] ${screen.screen_id}`);
    const result = await fetchFigmaScreen(screen, options);
    console.log(`  -> ${result.status}${result.error ? ` (${result.error})` : ''}`);
    results.push(result);
  }

  return results;
}
