import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(process.cwd(), '..', '..');
const STORAGE_DIR = path.join(PROJECT_ROOT, 'storage');
const FIGMA_TREE = path.join(STORAGE_DIR, 'figma_tree.json');
const FIGMA_SECTIONS = path.join(STORAGE_DIR, 'figma_sections.json');
const FIGMA_FRAMES = path.join(STORAGE_DIR, 'figma_frames.json');
const EMBEDDINGS_DIR = path.join(STORAGE_DIR, 'embeddings');
const REGISTRY_PATH = path.join(PROJECT_ROOT, 'registry', 'screens.yaml');

// ── Types ────────────────────────────────────────────────

export interface FigmaCandidate {
  node_id: string;
  name: string;
  type: string;
  page_name: string;
  section_name: string | null;
  width: number;
  height: number;
  final_score: number;
  raw_visual_score: number | null;
  lexical_score: number;
  context_score: number;
  match_confidence: 'high' | 'medium' | 'low';
  match_reasons: string[];     // e.g. ['visual', 'lexical', 'context', 'hybrid']
  rank: 'recommended' | 'similar' | 'other';
  already_mapped: boolean;
  score_profile: ScoreProfile | null;
  // v0.6 compat
  score: number;
  visual_score?: number;
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
    const yaml = fs.readFileSync(REGISTRY_PATH, 'utf-8');
    const re = /node_id:\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(yaml)) !== null) {
      if (m[1] !== 'TODO_FIGMA_NODE_ID') mapped.add(m[1]);
    }
  } catch { /* ignore */ }
  return mapped;
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
 * Build a map from figma screen_id → { node_id, visual_score }.
 * Compares runtime embedding for the given screen against all figma embeddings.
 */
function computeVisualScoreMap(screenId: string): Map<string, { nodeId: string; score: number }> {
  const result = new Map<string, { nodeId: string; score: number }>();
  const runtimeEmb = loadRuntimeEmbedding(screenId);
  if (!runtimeEmb) return result;

  const figmaEmbs = loadFigmaEmbeddings();
  if (figmaEmbs.length === 0) return result;

  for (const fe of figmaEmbs) {
    const score = cosineSimilarity(runtimeEmb.embedding, fe.embedding);
    // Resolve figma screen_id → node_id from metadata
    const metadataPath = path.join(STORAGE_DIR, 'figma', fe.id, 'metadata.json');
    if (!fs.existsSync(metadataPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      const nodeId = meta.node_id || '';
      if (nodeId) result.set(nodeId, { nodeId, score });
    } catch { /* skip */ }
  }

  return result;
}

// ── Generic-layout detection ────────────────────────────
// These patterns match common generic screens that produce false-positive
// visual matches because they share similar structural layouts.

const GENERIC_PATTERNS = [
  /^dashboard$/i,
  /^(home|main|landing)\s*(page)?$/i,
  /^(list|table|grid)\s*(view)?$/i,
  /^(form|edit|create|new)\s*(page)?$/i,
  /^(success|done|complete|confirmation)$/i,
  /^(error|404|500|not.found)$/i,
  /^(info|about|help)$/i,
  /^(empty|blank|placeholder)$/i,
  /^(loading|spinner|skeleton)$/i,
];

function isGenericLayoutName(name: string): boolean {
  const trimmed = name.trim();
  return GENERIC_PATTERNS.some(p => p.test(trimmed));
}

// ── v0.6.2 Ranking Recovery Constants ────────────────────

/** Minimum gap between top-1 and top-2 normalized visual scores to trust visual strongly */
const VISUAL_DOMINANCE_MARGIN = 0.10;

/** Adaptive hybrid weight profiles */
const WEIGHTS = {
  lexical_dominant:  { visual: 0.35, lexical: 0.45, context: 0.20 },
  visual_dominant:   { visual: 0.60, lexical: 0.15, context: 0.25 },
  balanced:          { visual: 0.40, lexical: 0.35, context: 0.25 },
} as const;

/** Strong suppression thresholds (relaxed from v0.6.1) */
const STRONG_SUPPRESSION = { visual_min: 0.85, lexical_max: 0.20, context_max: 0.20, damping: 0.35 };
/** Mild suppression thresholds */
const MILD_SUPPRESSION = { visual_min: 0.60, lexical_max: 0.15, damping: 0.75 };

type ScoreProfile = 'visual-dominant' | 'hybrid-balanced' | 'lexical-dominant';

function selectWeights(lexical: number, visual: number | null): {
  visual: number; lexical: number; context: number; profile: ScoreProfile;
} {
  if (lexical >= 0.7) return { ...WEIGHTS.lexical_dominant, profile: 'lexical-dominant' };
  if (visual !== null && visual >= 0.8 && lexical < 0.3) return { ...WEIGHTS.visual_dominant, profile: 'visual-dominant' };
  return { ...WEIGHTS.balanced, profile: 'hybrid-balanced' };
}

// ── Hybrid scoring engine ────────────────────────────────
//
// Produces a unified final_score from three signal channels:
//
//   lexical_score  (0-1): string similarity between screen_id and frame name/keywords
//   context_score  (0-1): flow/page/section/variant/viewport alignment
//   visual_score   (0-1): cosine similarity of image embeddings
//
// v0.6.2: Adaptive weights based on signal strength:
//   Lexical-dominant (lex>=0.7): visual 0.35, lexical 0.45, context 0.20
//   Visual-dominant  (vis>=0.8): visual 0.60, lexical 0.15, context 0.25
//   Balanced (default):          visual 0.40, lexical 0.35, context 0.25
//   Without visual:              lexical 0.60, context 0.40
//
// False-positive suppression (relaxed in v0.6.2):
//   Strong: visual >= 0.85, lexical <= 0.20, context <= 0.20
//   Mild: visual >= 0.60, lexical <= 0.15
//   Skipped when visual is dominant and this is the top visual candidate.

interface ScoringContext {
  screenId: string;
  flowId: string;
  screenKeywords: string[];
  flowKeywords: string[];
  viewport: { width: number; height: number } | null;
  variantKeywords: string[];
}

interface ScoreBreakdown {
  lexical: number;     // 0-1
  context: number;     // 0-1
  visual: number | null; // 0-1 or null if unavailable
  final: number;       // 0-1
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  score_profile: ScoreProfile | null;
}

function computeLexicalScore(frame: RawFrame, ctx: ScoringContext): number {
  // Name similarity to screen_id (dice coefficient)
  const nameSim = diceCoeff(ctx.screenId, frame.name);

  // Keyword overlap: screen_id keywords in frame name
  const kwOverlap = keywordOverlap(ctx.screenKeywords, frame.name);

  // Combined: name similarity is most important, keywords add specificity
  return Math.min(1, nameSim * 0.65 + kwOverlap * 0.35);
}

function computeContextScore(frame: RawFrame, ctx: ScoringContext): number {
  let score = 0;
  let signals = 0;

  // Flow keywords in frame name or section name
  const flowInName = keywordOverlap(ctx.flowKeywords, frame.name);
  const flowInSection = frame.section_name ? keywordOverlap(ctx.flowKeywords, frame.section_name) : 0;
  const flowMatch = Math.max(flowInName, flowInSection);
  score += flowMatch;
  signals++;

  // Viewport match
  if (ctx.viewport && frame.width > 0 && frame.height > 0) {
    if (frame.width === ctx.viewport.width && frame.height === ctx.viewport.height) {
      score += 1;
    } else if (Math.abs(frame.width - ctx.viewport.width) <= 100 && Math.abs(frame.height - ctx.viewport.height) <= 100) {
      score += 0.5;
    }
    signals++;
  }

  // Page relevance
  const pageName = frame.page_name.toLowerCase();
  const flowId = ctx.flowId.toLowerCase();
  if (
    (flowId.includes('shop') && pageName.includes('resale')) ||
    (flowId.includes('dashboard') && pageName.includes('dashboard')) ||
    (flowId.includes('auth') && (pageName.includes('auth') || pageName.includes('login')))
  ) {
    score += 1;
  }
  signals++;

  // Section relevance (dice coefficient between flowId and section name)
  if (frame.section_name) {
    const secSim = diceCoeff(ctx.flowId, frame.section_name);
    score += secSim;
  }
  signals++;

  // Variant keywords in frame name
  if (ctx.variantKeywords.length > 0) {
    const variantMatch = keywordOverlap(ctx.variantKeywords, frame.name);
    score += variantMatch;
    signals++;
  }

  return signals > 0 ? Math.min(1, score / signals) : 0;
}

function computeHybridScore(
  frame: RawFrame,
  ctx: ScoringContext,
  normalizedVisual: number | null,
  visualAvailable: boolean,
  visualDominant: boolean = false,
  topVisualNodeId: string | null = null,
): ScoreBreakdown {
  const lexical = computeLexicalScore(frame, ctx);
  const context = computeContextScore(frame, ctx);

  const reasons: string[] = [];
  let final: number;
  let scoreProfile: ScoreProfile | null = null;

  if (normalizedVisual !== null) {
    const isTopVisualCandidate = frame.node_id === topVisualNodeId;
    let effectiveVisual = normalizedVisual;

    // ── False-positive suppression (relaxed in v0.6.2) ──
    // Skip suppression entirely when visual is dominant and this is the top visual match
    if (!(visualDominant && isTopVisualCandidate)) {
      if (normalizedVisual >= STRONG_SUPPRESSION.visual_min
          && lexical <= STRONG_SUPPRESSION.lexical_max
          && context <= STRONG_SUPPRESSION.context_max) {
        effectiveVisual = normalizedVisual * STRONG_SUPPRESSION.damping;
      } else if (normalizedVisual >= MILD_SUPPRESSION.visual_min
                 && lexical <= MILD_SUPPRESSION.lexical_max) {
        effectiveVisual = normalizedVisual * MILD_SUPPRESSION.damping;
      }

      // Generic layout penalty: only when NOT top visual AND both text signals disagree
      if (isGenericLayoutName(frame.name) && !isTopVisualCandidate
          && normalizedVisual > 0.6 && lexical < 0.25 && context < 0.25) {
        effectiveVisual *= 0.5;
      }
    }

    // Adaptive weights (v0.6.2)
    const weights = selectWeights(lexical, normalizedVisual);
    scoreProfile = weights.profile;

    // Visual-dominant override: when visual clearly leads, trust it fully
    if (visualDominant && isTopVisualCandidate) {
      scoreProfile = 'visual-dominant';
      final = effectiveVisual * WEIGHTS.visual_dominant.visual
            + lexical * WEIGHTS.visual_dominant.lexical
            + context * WEIGHTS.visual_dominant.context;
    } else {
      final = effectiveVisual * weights.visual + lexical * weights.lexical + context * weights.context;
    }

    // Reason labels
    if (normalizedVisual >= 0.5) reasons.push('visual');
    if (lexical >= 0.3) reasons.push('lexical');
    if (context >= 0.3) reasons.push('context');
    if (reasons.length >= 2) reasons.push('hybrid');
    if (reasons.length === 0) {
      if (normalizedVisual >= lexical && normalizedVisual >= context) reasons.push('visual');
      else if (lexical >= context) reasons.push('lexical');
      else reasons.push('context');
    }
  } else if (visualAvailable) {
    // Visual data exists for other candidates but NOT this one — penalize
    // v0.6.2: increased penalty from 0.85 to 0.75 to prioritize visually-confirmed frames
    final = lexical * 0.55 + context * 0.35;
    final *= 0.75;

    if (lexical >= 0.3) reasons.push('lexical');
    if (context >= 0.3) reasons.push('context');
    if (reasons.length === 0) {
      reasons.push(lexical >= context ? 'lexical' : 'context');
    }
  } else {
    // No visual data at all: lexical 0.60, context 0.40
    final = lexical * 0.60 + context * 0.40;

    if (lexical >= 0.3) reasons.push('lexical');
    if (context >= 0.3) reasons.push('context');
    if (reasons.length === 0) {
      reasons.push(lexical >= context ? 'lexical' : 'context');
    }
  }

  // Score calibration: cap at 0.98
  final = Math.min(final, 0.98);

  // Confidence classification
  let confidence: 'high' | 'medium' | 'low';
  if (final >= 0.5 && reasons.length >= 2) {
    confidence = 'high';
  } else if (final >= 0.3) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    lexical,
    context,
    visual: normalizedVisual,
    final: Math.round(final * 1000) / 1000,
    confidence,
    reasons,
    score_profile: scoreProfile,
  };
}

// ── Visual score normalization ───────────────────────────
// Raw cosine similarity on spatial grid embeddings clusters at the high end
// (0.95-1.0) for structurally similar screens. We normalize visual scores
// into a relative ranking that measures how much a candidate stands out from
// the visual baseline. This:
// - Preserves discriminative power (visual #1 stays ahead of visual #2)
// - Prevents saturated visual from dominating when all scores are similar
// - Keeps visual as a useful tiebreaker even in saturated conditions

function normalizeVisualScores(
  visualScoreMap: Map<string, { nodeId: string; score: number }>,
): Map<string, number> {
  const normalized = new Map<string, number>();
  if (visualScoreMap.size === 0) return normalized;

  const scores = Array.from(visualScoreMap.values()).map(v => v.score);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore;

  // If the range is truly flat (<0.02), visual is not discriminative at all
  // → compress all visual to a low baseline value
  if (range < 0.02) {
    for (const [nodeId] of visualScoreMap) {
      normalized.set(nodeId, 0.15); // minimal tiebreaker
    }
    return normalized;
  }

  // Normalize to 0..1 based on min-max within the visual score distribution
  // spreadQuality scales trust: full credit at range >= 0.12
  const spreadQuality = Math.min(1, range / 0.12);

  for (const [nodeId, { score }] of visualScoreMap) {
    const relative = (score - minScore) / range; // 0..1 within distribution
    // Constant floor of 0.10 prevents over-compression of low-spread signals
    const floor = 0.10;
    const scaled = relative * spreadQuality * 0.85 + floor;
    normalized.set(nodeId, Math.min(scaled, 0.95));
  }

  return normalized;
}

// ── Unified candidate scoring ────────────────────────────

function scoreAllCandidates(
  frames: RawFrame[],
  screenId: string,
  flowId: string,
  viewport: { width: number; height: number } | null,
  visualScoreMap: Map<string, { nodeId: string; score: number }>,
): FigmaCandidate[] {
  const mapped = getMappedNodeIds();

  // Extract variant from screen_id (e.g. "shop_create_step_1_default" → "default")
  const parts = screenId.split('_');
  const variantKeywords = parts.length > 0 ? [parts[parts.length - 1]] : [];

  const ctx: ScoringContext = {
    screenId,
    flowId,
    screenKeywords: extractKeywords(screenId),
    flowKeywords: extractKeywords(flowId),
    viewport,
    variantKeywords,
  };

  // Normalize visual scores: relative ranking instead of raw cosine
  const normalizedVisual = normalizeVisualScores(visualScoreMap);
  const visualAvailable = normalizedVisual.size > 0;

  // v0.6.2: Detect visual dominance — top-1 visual far ahead of top-2
  const sortedVisuals = Array.from(normalizedVisual.values()).sort((a, b) => b - a);
  const visualDominant = sortedVisuals.length >= 2
    && (sortedVisuals[0] - sortedVisuals[1]) > VISUAL_DOMINANCE_MARGIN;
  const topVisualNodeId = visualAvailable
    ? Array.from(normalizedVisual.entries()).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null
    : null;

  return frames.map(f => {
    const normVisual = normalizedVisual.get(f.node_id) ?? null;

    const breakdown = computeHybridScore(f, ctx, normVisual, visualAvailable, visualDominant, topVisualNodeId);

    // Rank based on final score
    let rank: 'recommended' | 'similar' | 'other';
    if (breakdown.final >= 0.4) rank = 'recommended';
    else if (breakdown.final >= 0.2) rank = 'similar';
    else rank = 'other';

    // Display the raw visual score (before normalization) for transparency
    const displayVisual = visualScoreMap.get(f.node_id)?.score ?? null;

    return {
      node_id: f.node_id,
      name: f.name,
      type: f.type,
      page_name: f.page_name,
      section_name: f.section_name,
      width: f.width,
      height: f.height,
      final_score: breakdown.final,
      raw_visual_score: displayVisual !== null ? Math.round(displayVisual * 1000) / 1000 : null,
      lexical_score: Math.round(breakdown.lexical * 1000) / 1000,
      context_score: Math.round(breakdown.context * 1000) / 1000,
      match_confidence: breakdown.confidence,
      match_reasons: breakdown.reasons,
      rank,
      already_mapped: mapped.has(f.node_id),
      score_profile: breakdown.score_profile,
      // v0.6 compat fields
      score: Math.round(breakdown.final * 100),
      visual_score: displayVisual !== null ? Math.round(displayVisual * 1000) / 1000 : undefined,
    };
  }).sort((a, b) => b.final_score - a.final_score);
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

    // Apply search filter
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

    // Build visual score map (node_id → score)
    const visualScoreMap = computeVisualScoreMap(screenId);

    // Score all candidates with hybrid ranking
    const candidates = scoreAllCandidates(frames, screenId, flowId, viewport, visualScoreMap);

    return NextResponse.json({
      candidates,
      total_frames: allFrames.length,
      search_applied: !!search,
      visual_available: visualScoreMap.size > 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to load Figma candidates: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
