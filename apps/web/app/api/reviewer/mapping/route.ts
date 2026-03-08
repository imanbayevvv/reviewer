import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PROJECT_ROOT = path.resolve(process.cwd(), '..', '..');
const SCREENS_YAML = path.join(PROJECT_ROOT, 'registry', 'screens.yaml');
const STORAGE_DIR = path.join(PROJECT_ROOT, 'storage');
const FIGMA_STORAGE = path.join(STORAGE_DIR, 'figma');
const FIGMA_FRAMES_FILE = path.join(STORAGE_DIR, 'figma_frames.json');
const EMBEDDINGS_DIR = path.join(STORAGE_DIR, 'embeddings');

// ── Safe YAML field updater ──────────────────────────────
//
// Strategy: targeted line-level replacement rather than full YAML
// parse/serialize, which would destroy comments, ordering, and formatting.
//
// We find the screen block by screen_id, then locate the figma.node_id
// line within that block and replace it. We also clear the
// unconfigured_reason field if present.

function updateScreenMapping(
  yamlContent: string,
  screenId: string,
  nodeId: string,
): { updated: string; changed: boolean; error?: string } {
  const lines = yamlContent.split('\n');

  // Find the screen block start: "  - screen_id: <screenId>"
  const screenIdPattern = new RegExp(`^\\s*-\\s*screen_id:\\s*${escapeRegex(screenId)}\\s*$`);
  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (screenIdPattern.test(lines[i])) {
      blockStart = i;
      break;
    }
  }

  if (blockStart === -1) {
    return { updated: yamlContent, changed: false, error: `Screen ${screenId} not found in registry` };
  }

  // Find block end (next screen entry or end of file)
  let blockEnd = lines.length;
  for (let i = blockStart + 1; i < lines.length; i++) {
    if (/^\s*-\s*screen_id:/.test(lines[i])) {
      blockEnd = i;
      break;
    }
  }

  // Find and replace node_id line within block
  let nodeIdUpdated = false;
  let unconfiguredCleared = false;

  for (let i = blockStart; i < blockEnd; i++) {
    const line = lines[i];

    // Replace node_id value
    if (/^\s+node_id:\s*"/.test(line)) {
      lines[i] = line.replace(/node_id:\s*"[^"]*"/, `node_id: "${nodeId}"`);
      nodeIdUpdated = true;
    }

    // Clear unconfigured_reason (set to null or remove)
    if (/^\s+unconfigured_reason:\s*"/.test(line) || /^\s+unconfigured_reason:\s*[^n]/.test(line)) {
      // Replace the value with null to indicate it's now configured
      lines[i] = line.replace(/unconfigured_reason:\s*"[^"]*"/, 'unconfigured_reason: null');
      lines[i] = lines[i].replace(/unconfigured_reason:\s*[^n\s].*/, 'unconfigured_reason: null');
      unconfiguredCleared = true;
    }
  }

  if (!nodeIdUpdated) {
    return { updated: yamlContent, changed: false, error: `Could not find figma.node_id field for screen ${screenId}` };
  }

  return {
    updated: lines.join('\n'),
    changed: true,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Post-save synchronization ─────────────────────────────
//
// Data flow after a manual mapping save:
// 1. screens.yaml updated with new node_id
// 2. Upsert frame into figma_frames.json catalog (so candidates route finds it)
// 3. Write/update metadata.json in storage/figma/{screen_id}/ (fallback source)
// 4. Compute visual embedding for figma.png if it exists
//
// This ensures the Mapping Assistant immediately includes the frame in
// candidate lists without requiring a full `pnpm reviewer:figma` re-import.

function getFileKeyForScreen(yamlContent: string, screenId: string): string {
  // Extract file_key from the screen block in YAML
  const lines = yamlContent.split('\n');
  const screenIdPattern = new RegExp(`^\\s*-\\s*screen_id:\\s*${escapeRegex(screenId)}\\s*$`);
  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (screenIdPattern.test(lines[i])) { blockStart = i; break; }
  }
  if (blockStart === -1) return '';
  for (let i = blockStart; i < lines.length; i++) {
    const m = lines[i].match(/file_key:\s*"([^"]+)"/);
    if (m) return m[1];
    if (i > blockStart && /^\s*-\s*screen_id:/.test(lines[i])) break;
  }
  return '';
}

function upsertFigmaFramesCatalog(nodeId: string, screenId: string): void {
  // Upsert a minimal entry into figma_frames.json so the candidates route
  // can find this frame via its Source 3 (detailed frame data) lookup.
  try {
    let data: { nodes: Record<string, { document: Record<string, unknown> }> } = { nodes: {} };
    if (fs.existsSync(FIGMA_FRAMES_FILE)) {
      data = JSON.parse(fs.readFileSync(FIGMA_FRAMES_FILE, 'utf-8'));
    }
    if (!data.nodes) data.nodes = {};

    // Only upsert if not already present
    if (!data.nodes[nodeId]) {
      data.nodes[nodeId] = {
        document: {
          id: nodeId,
          name: screenId.replace(/_/g, ' '),
          type: 'FRAME',
          absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 0 },
          _source: 'manual_mapping',
          _mapped_at: new Date().toISOString(),
        },
      };
      fs.writeFileSync(FIGMA_FRAMES_FILE, JSON.stringify(data, null, 2));
    }
  } catch { /* non-critical — fallback source 4 will cover it */ }
}

function ensureLocalMetadata(
  screenId: string,
  nodeId: string,
  fileKey: string,
): void {
  // Create/update metadata.json in storage/figma/{screen_id}/ so the
  // candidates route fallback (source 4) can reconstruct a candidate entry.
  const dir = path.join(FIGMA_STORAGE, screenId);
  const metaPath = path.join(dir, 'metadata.json');

  // If metadata already has this node_id, skip
  if (fs.existsSync(metaPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (existing.node_id === nodeId) return;
    } catch { /* overwrite bad file */ }
  }

  fs.mkdirSync(dir, { recursive: true });
  const meta = {
    screen_id: screenId,
    file_key: fileKey,
    node_id: nodeId,
    fetched_at: new Date().toISOString(),
    source_url: '',
    checksum: '',
    fetch_status: 'manual_mapping',
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

function refreshVisualEmbedding(screenId: string): boolean {
  // If figma.png exists for this screen, compute/update its embedding in
  // storage/embeddings/figma.json so visual similarity search includes it.
  // Uses pngjs if available; gracefully skips if not installed (embedding
  // will be generated next time `pnpm reviewer:embed-figma` runs).
  const pngPath = path.join(FIGMA_STORAGE, screenId, 'figma.png');
  if (!fs.existsSync(pngPath)) return false;

  let PNG: { sync: { read(buf: Buffer): { width: number; height: number; data: Buffer } } };
  try { PNG = require('pngjs').PNG; } catch { return false; /* pngjs not available */ }

  try {
    const fileBuffer = fs.readFileSync(pngPath);
    const png = PNG.sync.read(fileBuffer);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Check if already embedded with same hash
    const embPath = path.join(EMBEDDINGS_DIR, 'figma.json');
    let store: { version: number; created_at: string; entries: Array<{ id: string; embedding: number[]; image_hash: string; created_at: string }> } =
      { version: 1, created_at: new Date().toISOString(), entries: [] };

    if (fs.existsSync(embPath)) {
      try { store = JSON.parse(fs.readFileSync(embPath, 'utf-8')); } catch { /* reset */ }
    }

    const existingIdx = store.entries.findIndex(e => e.id === screenId);
    if (existingIdx >= 0 && store.entries[existingIdx].image_hash === hash) {
      return true; // Already up to date
    }

    // Compute embedding: downscale → 8×8 grid → 5 features per block = 320 dims
    const GRID = 8, THUMB = 64;
    const srcW = png.width, srcH = png.height;
    const srcData = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength);

    // Nearest-neighbor downscale
    const thumbData = new Uint8Array(THUMB * THUMB * 4);
    for (let y = 0; y < THUMB; y++) {
      const sy = Math.floor((y * srcH) / THUMB);
      for (let x = 0; x < THUMB; x++) {
        const sx = Math.floor((x * srcW) / THUMB);
        const si = (sy * srcW + sx) * 4;
        const di = (y * THUMB + x) * 4;
        thumbData[di] = srcData[si];
        thumbData[di + 1] = srcData[si + 1];
        thumbData[di + 2] = srcData[si + 2];
        thumbData[di + 3] = srcData[si + 3];
      }
    }

    const blockW = Math.floor(THUMB / GRID);
    const blockH = Math.floor(THUMB / GRID);
    const embedding: number[] = [];

    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        let sumR = 0, sumG = 0, sumB = 0, sumLum = 0, edgeSum = 0, count = 0;
        const startX = gx * blockW, startY = gy * blockH;

        for (let dy = 0; dy < blockH; dy++) {
          for (let dx = 0; dx < blockW; dx++) {
            const x = startX + dx, y = startY + dy;
            const idx = (y * THUMB + x) * 4;
            const r = thumbData[idx], g = thumbData[idx + 1], b = thumbData[idx + 2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            sumR += r; sumG += g; sumB += b; sumLum += lum; count++;
            if (dx < blockW - 1) {
              const ri = (y * THUMB + x + 1) * 4;
              edgeSum += Math.abs(lum - (0.299 * thumbData[ri] + 0.587 * thumbData[ri + 1] + 0.114 * thumbData[ri + 2]));
            }
            if (dy < blockH - 1) {
              const bi = ((y + 1) * THUMB + x) * 4;
              edgeSum += Math.abs(lum - (0.299 * thumbData[bi] + 0.587 * thumbData[bi + 1] + 0.114 * thumbData[bi + 2]));
            }
          }
        }

        const n = count || 1;
        const edgeCount = (blockW - 1) * blockH + blockW * (blockH - 1) || 1;
        embedding.push(sumLum / n / 255, sumR / n / 255, sumG / n / 255, sumB / n / 255, edgeSum / edgeCount / 255);
      }
    }

    const entry = { id: screenId, embedding, image_hash: hash, created_at: new Date().toISOString() };
    if (existingIdx >= 0) {
      store.entries[existingIdx] = entry;
    } else {
      store.entries.push(entry);
    }

    fs.mkdirSync(EMBEDDINGS_DIR, { recursive: true });
    fs.writeFileSync(embPath, JSON.stringify(store, null, 2));
    return true;
  } catch {
    return false;
  }
}

// ── POST handler ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { screen_id, node_id, mode } = body as {
      screen_id: string;
      node_id: string;
      mode?: 'save' | 'patch';
    };

    if (!screen_id || !node_id) {
      return NextResponse.json(
        { error: 'screen_id and node_id are required' },
        { status: 400 },
      );
    }

    // Validate node_id format (Figma uses "N:N" format)
    if (!/^\d+:\d+$/.test(node_id)) {
      return NextResponse.json(
        { error: `Invalid node_id format: ${node_id}. Expected format like "24:45"` },
        { status: 400 },
      );
    }

    const yamlContent = fs.readFileSync(SCREENS_YAML, 'utf-8');

    const result = updateScreenMapping(yamlContent, screen_id, node_id);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (!result.changed) {
      return NextResponse.json({ status: 'unchanged', message: 'No changes needed' });
    }

    if (mode === 'patch') {
      // Return the patch content without saving
      return NextResponse.json({
        status: 'patch_generated',
        screen_id,
        node_id,
        patch: result.updated,
        message: 'Patch generated. Review and apply manually.',
      });
    }

    // Default: save directly
    // Create backup first
    const backupPath = SCREENS_YAML + '.bak';
    fs.copyFileSync(SCREENS_YAML, backupPath);

    // Write updated YAML
    fs.writeFileSync(SCREENS_YAML, result.updated, 'utf-8');

    // ── Post-save synchronization ──
    // Ensures the mapped frame immediately appears in Mapping Assistant
    // candidate lists without requiring a full re-import.
    const syncStatus: string[] = [];

    // 1. Upsert into figma_frames.json catalog
    upsertFigmaFramesCatalog(node_id, screen_id);
    syncStatus.push('catalog_upserted');

    // 2. Ensure local metadata exists (fallback candidate source)
    const fileKey = getFileKeyForScreen(result.updated, screen_id);
    ensureLocalMetadata(screen_id, node_id, fileKey);
    syncStatus.push('metadata_ensured');

    // 3. Refresh visual embedding if figma.png exists
    const embeddingUpdated = refreshVisualEmbedding(screen_id);
    if (embeddingUpdated) syncStatus.push('embedding_refreshed');

    return NextResponse.json({
      status: 'saved',
      screen_id,
      node_id,
      backup_path: backupPath,
      sync: syncStatus,
      message: `Mapped ${screen_id} → ${node_id}. Backup saved. Run diff to verify.`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to save mapping: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
