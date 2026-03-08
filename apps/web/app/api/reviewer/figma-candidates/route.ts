import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(process.cwd(), '..', '..');
const STORAGE_DIR = path.join(PROJECT_ROOT, 'storage');
const FIGMA_TREE = path.join(STORAGE_DIR, 'figma_tree.json');
const FIGMA_SECTIONS = path.join(STORAGE_DIR, 'figma_sections.json');
const FIGMA_FRAMES = path.join(STORAGE_DIR, 'figma_frames.json');
const EMBEDDINGS_DIR = path.join(STORAGE_DIR, 'embeddings');

// ── Types ────────────────────────────────────────────────

export interface FigmaCandidate {
  node_id: string;
  name: string;
  type: string;
  page_name: string;
  section_name: string | null;
  width: number;
  height: number;
  score: number;
  rank: 'recommended' | 'similar' | 'other' | 'visual';
  already_mapped: boolean;
  visual_score?: number; // cosine similarity 0..1 (only for visual matches)
}

// ── String similarity (Dice coefficient on bigrams) ──────

function bigrams(s: string): Set<string> {
  const lower = s.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const set = new Set<string>();
  for (let i = 0; i < lower.length - 1; i++) {
    set.add(lower.slice(i, i + 2));
  }
  return set;
}

function diceCoeff(a: string, b: string): number {
  const biA = bigrams(a);
  const biB = bigrams(b);
  if (biA.size === 0 && biB.size === 0) return 1;
  if (biA.size === 0 || biB.size === 0) return 0;
  let intersection = 0;
  biA.forEach(bg => { if (biB.has(bg)) intersection++; });
  return (2 * intersection) / (biA.size + biB.size);
}

// ── Keywords extraction ──────────────────────────────────

function extractKeywords(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/[\s_-]+/)
    .filter(w => w.length > 1);
}

function keywordOverlap(keywords: string[], candidate: string): number {
  const candidateWords = extractKeywords(candidate);
  if (keywords.length === 0 || candidateWords.length === 0) return 0;
  let matches = 0;
  for (const kw of keywords) {
    if (candidateWords.some(cw => cw.includes(kw) || kw.includes(cw))) matches++;
  }
  return matches / keywords.length;
}

// ── Extract all candidate frames ─────────────────────────

interface RawFrame {
  node_id: string;
  name: string;
  type: string;
  page_name: string;
  section_name: string | null;
  width: number;
  height: number;
}

function extractFramesFromTree(): RawFrame[] {
  const frames: RawFrame[] = [];
  const seen = new Set<string>();

  // Source 1: figma_tree.json (document tree with pages)
  if (fs.existsSync(FIGMA_TREE)) {
    try {
      const tree = JSON.parse(fs.readFileSync(FIGMA_TREE, 'utf-8'));
      const pages = tree.document?.children || [];
      for (const page of pages) {
        for (const child of page.children || []) {
          if (child.type === 'SECTION') {
            // Frames inside sections
            for (const sc of child.children || []) {
              if (sc.type === 'FRAME' && !seen.has(sc.id)) {
                seen.add(sc.id);
                const bb = sc.absoluteBoundingBox;
                frames.push({
                  node_id: sc.id,
                  name: sc.name || '',
                  type: sc.type,
                  page_name: page.name || '',
                  section_name: child.name || null,
                  width: bb?.width || 0,
                  height: bb?.height || 0,
                });
              }
            }
          } else if (child.type === 'FRAME' && !seen.has(child.id)) {
            seen.add(child.id);
            const bb = child.absoluteBoundingBox;
            frames.push({
              node_id: child.id,
              name: child.name || '',
              type: child.type,
              page_name: page.name || '',
              section_name: null,
              width: bb?.width || 0,
              height: bb?.height || 0,
            });
          }
        }
      }
    } catch { /* ignore parse errors */ }
  }

  // Source 2: figma_sections.json (detailed section children)
  if (fs.existsSync(FIGMA_SECTIONS)) {
    try {
      const sec = JSON.parse(fs.readFileSync(FIGMA_SECTIONS, 'utf-8'));
      for (const nodeId of Object.keys(sec.nodes || {})) {
        const doc = sec.nodes[nodeId].document;
        if (!doc) continue;
        for (const child of doc.children || []) {
          if (child.type === 'FRAME' && !seen.has(child.id)) {
            seen.add(child.id);
            const bb = child.absoluteBoundingBox;
            frames.push({
              node_id: child.id,
              name: child.name || '',
              type: child.type,
              page_name: '',
              section_name: doc.name || null,
              width: bb?.width || 0,
              height: bb?.height || 0,
            });
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Source 3: figma_frames.json (detailed frame data)
  if (fs.existsSync(FIGMA_FRAMES)) {
    try {
      const frm = JSON.parse(fs.readFileSync(FIGMA_FRAMES, 'utf-8'));
      for (const nodeId of Object.keys(frm.nodes || {})) {
        const doc = frm.nodes[nodeId].document;
        if (!doc || seen.has(nodeId)) continue;
        seen.add(nodeId);
        const bb = doc.absoluteBoundingBox;
        frames.push({
          node_id: nodeId,
          name: doc.name || '',
          type: doc.type || 'FRAME',
          page_name: '',
          section_name: null,
          width: bb?.width || 0,
          height: bb?.height || 0,
        });
      }
    } catch { /* ignore */ }
  }

  // Source 4: local figma metadata fallback
  // Mapped frames that were fetched via the reviewer pipeline have metadata.json
  // in storage/figma/{screen_id}/. If their node_id isn't already in the catalog
  // from sources 1-3, reconstruct a candidate entry so manually-mapped frames
  // always appear in the candidate list.
  const figmaStorageDir = path.join(STORAGE_DIR, 'figma');
  if (fs.existsSync(figmaStorageDir)) {
    try {
      const screenDirs = fs.readdirSync(figmaStorageDir, { withFileTypes: true })
        .filter(d => d.isDirectory());
      for (const dir of screenDirs) {
        const metaPath = path.join(figmaStorageDir, dir.name, 'metadata.json');
        if (!fs.existsSync(metaPath)) continue;
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          const nodeId = meta.node_id || '';
          if (!nodeId || seen.has(nodeId)) continue;
          seen.add(nodeId);
          // Use screen_id as display name since we don't have the Figma tree name
          frames.push({
            node_id: nodeId,
            name: meta.name || dir.name.replace(/_/g, ' '),
            type: 'FRAME',
            page_name: meta.page_name || '',
            section_name: meta.section_name || null,
            width: meta.width || 0,
            height: meta.height || 0,
          });
        } catch { /* skip bad metadata */ }
      }
    } catch { /* ignore */ }
  }

  return frames;
}

// ── Identify already-mapped node IDs from registry ───────

function getMappedNodeIds(): Set<string> {
  const mapped = new Set<string>();
  try {
    const yaml = fs.readFileSync(path.join(PROJECT_ROOT, 'registry', 'screens.yaml'), 'utf-8');
    // Simple regex extraction of node_id values
    const re = /node_id:\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(yaml)) !== null) {
      if (m[1] !== 'TODO_FIGMA_NODE_ID') mapped.add(m[1]);
    }
  } catch { /* ignore */ }
  return mapped;
}

// ── Score + rank candidates ──────────────────────────────

function scoreCandidates(
  frames: RawFrame[],
  screenId: string,
  flowId: string,
  viewport: { width: number; height: number } | null,
): FigmaCandidate[] {
  const mapped = getMappedNodeIds();

  const screenKeywords = extractKeywords(screenId);
  const flowKeywords = extractKeywords(flowId);

  return frames.map(f => {
    let score = 0;

    // 1. Name similarity to screen_id (0-1, weight 40)
    const nameSim = diceCoeff(screenId, f.name);
    score += nameSim * 40;

    // 2. Keyword overlap with screen_id (0-1, weight 20)
    const kwOverlap = keywordOverlap(screenKeywords, f.name);
    score += kwOverlap * 20;

    // 3. Flow-related keywords in frame name or section (weight 15)
    const flowInName = keywordOverlap(flowKeywords, f.name);
    const flowInSection = f.section_name ? keywordOverlap(flowKeywords, f.section_name) : 0;
    score += Math.max(flowInName, flowInSection) * 15;

    // 4. Viewport match (weight 15)
    if (viewport && f.width > 0 && f.height > 0) {
      if (f.width === viewport.width && f.height === viewport.height) {
        score += 15;
      } else if (Math.abs(f.width - viewport.width) <= 100 && Math.abs(f.height - viewport.height) <= 100) {
        score += 8;
      }
    }

    // 5. Page relevance: "Creating a ReSale shop" page bonus for shop flows
    if (flowId.includes('shop') && f.page_name.toLowerCase().includes('resale')) {
      score += 5;
    }
    if (flowId.includes('dashboard') && f.page_name.toLowerCase().includes('dashboard')) {
      score += 5;
    }

    // 6. Section relevance
    if (f.section_name) {
      const secSim = diceCoeff(flowId, f.section_name);
      score += secSim * 5;
    }

    // Determine rank
    let rank: 'recommended' | 'similar' | 'other';
    if (score >= 30) rank = 'recommended';
    else if (score >= 15) rank = 'similar';
    else rank = 'other';

    return {
      node_id: f.node_id,
      name: f.name,
      type: f.type,
      page_name: f.page_name,
      section_name: f.section_name,
      width: f.width,
      height: f.height,
      score: Math.round(score * 10) / 10,
      rank,
      already_mapped: mapped.has(f.node_id),
    };
  }).sort((a, b) => b.score - a.score);
}

// ── Visual similarity helpers ────────────────────────────

interface EmbeddingEntry {
  id: string;
  embedding: number[];
  image_hash: string;
  created_at: string;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function loadFigmaEmbeddings(): EmbeddingEntry[] {
  const fp = path.join(EMBEDDINGS_DIR, 'figma.json');
  if (!fs.existsSync(fp)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    return data.entries || [];
  } catch { return []; }
}

function loadRuntimeEmbedding(screenId: string): EmbeddingEntry | null {
  const fp = path.join(EMBEDDINGS_DIR, 'runtime', `${screenId}.json`);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch { return null; }
}

/**
 * Build a map of figma screen_id -> visual similarity score
 * by comparing a runtime embedding against all figma embeddings.
 */
function computeVisualMatches(
  screenId: string,
  topK: number = 10,
): Map<string, number> {
  const result = new Map<string, number>();
  const runtimeEmb = loadRuntimeEmbedding(screenId);
  if (!runtimeEmb) return result;

  const figmaEmbs = loadFigmaEmbeddings();
  if (figmaEmbs.length === 0) return result;

  const scored = figmaEmbs
    .map(fe => ({ id: fe.id, score: cosineSimilarity(runtimeEmb.embedding, fe.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  for (const s of scored) {
    result.set(s.id, s.score);
  }
  return result;
}

// ── Route handler ────────────────────────────────────────

export async function GET(req: NextRequest) {
  const screenId = req.nextUrl.searchParams.get('screen_id') || '';
  const flowId = req.nextUrl.searchParams.get('flow_id') || '';
  const search = req.nextUrl.searchParams.get('search') || '';
  const vpWidth = parseInt(req.nextUrl.searchParams.get('viewport_width') || '0');
  const vpHeight = parseInt(req.nextUrl.searchParams.get('viewport_height') || '0');

  try {
    const allFrames = extractFramesFromTree();

    // If search query is provided, filter first
    let frames = allFrames;
    if (search) {
      const q = search.toLowerCase();
      frames = allFrames.filter(f =>
        f.name.toLowerCase().includes(q) ||
        f.node_id.includes(q) ||
        (f.section_name && f.section_name.toLowerCase().includes(q))
      );
    }

    const viewport = vpWidth > 0 && vpHeight > 0 ? { width: vpWidth, height: vpHeight } : null;
    const candidates = scoreCandidates(frames, screenId, flowId, viewport);

    // Visual similarity: match runtime embedding against figma embeddings
    const visualScores = computeVisualMatches(screenId);
    const visualCandidates: FigmaCandidate[] = [];

    if (visualScores.size > 0) {
      const mapped = getMappedNodeIds();

      // Match visual scores to figma frames by screen_id → find frames that
      // share the same screen_id key in figma storage
      for (const [figmaScreenId, score] of visualScores) {
        // Look up the figma frame's node_id from its metadata
        const metadataPath = path.join(STORAGE_DIR, 'figma', figmaScreenId, 'metadata.json');
        if (!fs.existsSync(metadataPath)) continue;

        let nodeId: string;
        try {
          const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
          nodeId = meta.node_id || meta.figma_node_id || '';
        } catch { continue; }

        if (!nodeId) continue;

        // Check if already in candidates (avoid duplicates)
        const existing = candidates.find(c => c.node_id === nodeId);
        if (existing) {
          // Augment existing candidate with visual score
          existing.visual_score = Math.round(score * 1000) / 1000;
          if (score >= 0.7 && existing.rank !== 'recommended') {
            existing.rank = 'visual';
          }
          continue;
        }

        // Find frame info from allFrames
        const frame = allFrames.find(f => f.node_id === nodeId);
        if (frame) {
          visualCandidates.push({
            node_id: frame.node_id,
            name: frame.name,
            type: frame.type,
            page_name: frame.page_name,
            section_name: frame.section_name,
            width: frame.width,
            height: frame.height,
            score: Math.round(score * 100),
            rank: 'visual',
            already_mapped: mapped.has(frame.node_id),
            visual_score: Math.round(score * 1000) / 1000,
          });
        }
      }
    }

    // Merge: visual candidates first (if score >= 0.7), then string-based
    const highVisual = visualCandidates.filter(c => (c.visual_score || 0) >= 0.7);
    const merged = [...highVisual, ...candidates];

    return NextResponse.json({
      candidates: merged,
      total_frames: allFrames.length,
      search_applied: !!search,
      visual_matches: visualScores.size,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to load Figma candidates: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
