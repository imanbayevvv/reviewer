/**
 * Mapping Evaluation — measures ranking quality of the hybrid candidate scorer.
 *
 * Uses the labeled ground-truth from screens.yaml: screens that have a real
 * (non-TODO) figma.node_id are treated as labeled samples.
 *
 * For each labeled screen, we call the same scoring logic that the
 * /api/reviewer/figma-candidates route uses, and check where the correct
 * node_id lands in the ranked list.
 *
 * Metrics:
 *   - Top-1 accuracy: fraction where correct node is rank #1
 *   - Top-3 accuracy: fraction where correct node is in top 3
 *   - Top-5 accuracy: fraction where correct node is in top 5
 *   - MRR (Mean Reciprocal Rank): average of 1/rank across all samples
 *   - Common false positives: node_ids that frequently rank above the correct answer
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadScreens, type Screen } from './registry.js';
import { STORAGE_DIR, FIGMA_PLACEHOLDER_NODE_ID } from './config.js';

// ── Types ────────────────────────────────────────────────

interface EvalResult {
  screen_id: string;
  flow_id: string;
  correct_node_id: string;
  rank_of_correct: number | null; // null = not found in candidates
  top_candidates: Array<{ node_id: string; name: string; final_score: number; raw_visual: number | null }>;
  found_in_catalog: boolean;
}

export interface EvalReport {
  total_labeled: number;
  total_evaluated: number;
  top1_accuracy: number;
  top3_accuracy: number;
  top5_accuracy: number;
  mrr: number;
  results: EvalResult[];
  false_positives: Array<{ node_id: string; name: string; count: number }>;
  table: string;
}

// ── Inline scoring logic (mirrors route.ts) ──────────────
// We duplicate the scoring logic here to avoid importing from Next.js API routes.
// This is intentional: the evaluation runs in the CLI, not in the web app.

function bigrams(s: string): Set<string> {
  const lower = s.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const set = new Set<string>();
  for (let i = 0; i < lower.length - 1; i++) set.add(lower.slice(i, i + 2));
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

function extractKeywords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ').split(/[\s_-]+/).filter(w => w.length > 1);
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

const GENERIC_PATTERNS = [
  /^dashboard$/i, /^(home|main|landing)\s*(page)?$/i, /^(list|table|grid)\s*(view)?$/i,
  /^(form|edit|create|new)\s*(page)?$/i, /^(success|done|complete|confirmation)$/i,
  /^(error|404|500|not.found)$/i, /^(info|about|help)$/i,
  /^(empty|blank|placeholder)$/i, /^(loading|spinner|skeleton)$/i,
];

function isGenericLayoutName(name: string): boolean {
  return GENERIC_PATTERNS.some(p => p.test(name.trim()));
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

interface RawFrame {
  node_id: string;
  name: string;
  page_name: string;
  section_name: string | null;
  width: number;
  height: number;
}

function loadAllFrames(): RawFrame[] {
  const frames: RawFrame[] = [];
  const seen = new Set<string>();

  const treePath = path.join(STORAGE_DIR, 'figma_tree.json');
  if (fs.existsSync(treePath)) {
    try {
      const tree = JSON.parse(fs.readFileSync(treePath, 'utf-8'));
      for (const page of tree.document?.children || []) {
        for (const child of page.children || []) {
          if (child.type === 'SECTION') {
            for (const sc of child.children || []) {
              if (sc.type === 'FRAME' && !seen.has(sc.id)) {
                seen.add(sc.id);
                const bb = sc.absoluteBoundingBox;
                frames.push({ node_id: sc.id, name: sc.name || '', page_name: page.name || '', section_name: child.name || null, width: bb?.width || 0, height: bb?.height || 0 });
              }
            }
          } else if (child.type === 'FRAME' && !seen.has(child.id)) {
            seen.add(child.id);
            const bb = child.absoluteBoundingBox;
            frames.push({ node_id: child.id, name: child.name || '', page_name: page.name || '', section_name: null, width: bb?.width || 0, height: bb?.height || 0 });
          }
        }
      }
    } catch { /* ignore */ }
  }

  const sectionsPath = path.join(STORAGE_DIR, 'figma_sections.json');
  if (fs.existsSync(sectionsPath)) {
    try {
      const sec = JSON.parse(fs.readFileSync(sectionsPath, 'utf-8'));
      for (const nodeId of Object.keys(sec.nodes || {})) {
        const doc = sec.nodes[nodeId].document;
        if (!doc) continue;
        for (const child of doc.children || []) {
          if (child.type === 'FRAME' && !seen.has(child.id)) {
            seen.add(child.id);
            const bb = child.absoluteBoundingBox;
            frames.push({ node_id: child.id, name: child.name || '', page_name: '', section_name: doc.name || null, width: bb?.width || 0, height: bb?.height || 0 });
          }
        }
      }
    } catch { /* ignore */ }
  }

  const framesPath = path.join(STORAGE_DIR, 'figma_frames.json');
  if (fs.existsSync(framesPath)) {
    try {
      const frm = JSON.parse(fs.readFileSync(framesPath, 'utf-8'));
      for (const nodeId of Object.keys(frm.nodes || {})) {
        const doc = frm.nodes[nodeId].document;
        if (!doc || seen.has(nodeId)) continue;
        seen.add(nodeId);
        const bb = doc.absoluteBoundingBox;
        frames.push({ node_id: nodeId, name: doc.name || '', page_name: '', section_name: null, width: bb?.width || 0, height: bb?.height || 0 });
      }
    } catch { /* ignore */ }
  }

  // Source 4: local metadata
  const figmaDir = path.join(STORAGE_DIR, 'figma');
  if (fs.existsSync(figmaDir)) {
    try {
      for (const d of fs.readdirSync(figmaDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const mp = path.join(figmaDir, d.name, 'metadata.json');
        if (!fs.existsSync(mp)) continue;
        try {
          const m = JSON.parse(fs.readFileSync(mp, 'utf-8'));
          if (m.node_id && !seen.has(m.node_id)) {
            seen.add(m.node_id);
            frames.push({ node_id: m.node_id, name: m.name || d.name.replace(/_/g, ' '), page_name: m.page_name || '', section_name: m.section_name || null, width: m.width || 0, height: m.height || 0 });
          }
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }
  }

  return frames;
}

// ── Visual embeddings ────────────────────────────────────

interface EmbeddingEntry { id: string; embedding: number[]; image_hash: string; }

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i]; }
  const d = Math.sqrt(nA) * Math.sqrt(nB);
  return d === 0 ? 0 : dot / d;
}

function loadVisualScoreMap(screenId: string): Map<string, number> {
  const result = new Map<string, number>();
  const runtimePath = path.join(STORAGE_DIR, 'embeddings', 'runtime', `${screenId}.json`);
  if (!fs.existsSync(runtimePath)) return result;

  let runtimeEmb: EmbeddingEntry;
  try { runtimeEmb = JSON.parse(fs.readFileSync(runtimePath, 'utf-8')); } catch { return result; }

  const figmaEmbPath = path.join(STORAGE_DIR, 'embeddings', 'figma.json');
  if (!fs.existsSync(figmaEmbPath)) return result;

  let figmaStore: { entries: EmbeddingEntry[] };
  try { figmaStore = JSON.parse(fs.readFileSync(figmaEmbPath, 'utf-8')); } catch { return result; }

  for (const fe of figmaStore.entries || []) {
    const score = cosineSimilarity(runtimeEmb.embedding, fe.embedding);
    // Resolve screen_id → node_id
    const metaPath = path.join(STORAGE_DIR, 'figma', fe.id, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (m.node_id) result.set(m.node_id, score);
    } catch { /* skip */ }
  }

  return result;
}

// ── Hybrid scoring (mirrors route.ts) ────────────────────

function scoreFrame(
  frame: RawFrame,
  screenId: string,
  flowId: string,
  viewport: { width: number; height: number } | null,
  rawVisual: number | null,
  visualAvailable: boolean = false,
  visualDominant: boolean = false,
  topVisualNodeId: string | null = null,
): { final: number; visual: number | null; lexical: number; context: number; score_profile: ScoreProfile | null } {
  const screenKw = extractKeywords(screenId);
  const flowKw = extractKeywords(flowId);
  const parts = screenId.split('_');
  const variantKw = parts.length > 0 ? [parts[parts.length - 1]] : [];

  // Lexical
  const nameSim = diceCoeff(screenId, frame.name);
  const kwOvlp = keywordOverlap(screenKw, frame.name);
  const lexical = Math.min(1, nameSim * 0.65 + kwOvlp * 0.35);

  // Context
  let ctxScore = 0, ctxSignals = 0;
  const flowInName = keywordOverlap(flowKw, frame.name);
  const flowInSec = frame.section_name ? keywordOverlap(flowKw, frame.section_name) : 0;
  ctxScore += Math.max(flowInName, flowInSec); ctxSignals++;
  if (viewport && frame.width > 0 && frame.height > 0) {
    if (frame.width === viewport.width && frame.height === viewport.height) ctxScore += 1;
    else if (Math.abs(frame.width - viewport.width) <= 100 && Math.abs(frame.height - viewport.height) <= 100) ctxScore += 0.5;
    ctxSignals++;
  }
  const pn = frame.page_name.toLowerCase(), fl = flowId.toLowerCase();
  if ((fl.includes('shop') && pn.includes('resale')) || (fl.includes('dashboard') && pn.includes('dashboard')) || (fl.includes('auth') && (pn.includes('auth') || pn.includes('login')))) ctxScore += 1;
  ctxSignals++;
  if (frame.section_name) { ctxScore += diceCoeff(flowId, frame.section_name); }
  ctxSignals++;
  if (variantKw.length > 0) { ctxScore += keywordOverlap(variantKw, frame.name); ctxSignals++; }
  const context = ctxSignals > 0 ? Math.min(1, ctxScore / ctxSignals) : 0;

  // Hybrid
  let final: number;
  let scoreProfile: ScoreProfile | null = null;

  if (rawVisual !== null) {
    const isTopVisualCandidate = frame.node_id === topVisualNodeId;
    let effectiveVisual = rawVisual;

    // False-positive suppression (relaxed in v0.6.2)
    // Skip suppression entirely when visual is dominant and this is the top visual match
    if (!(visualDominant && isTopVisualCandidate)) {
      if (rawVisual >= STRONG_SUPPRESSION.visual_min
          && lexical <= STRONG_SUPPRESSION.lexical_max
          && context <= STRONG_SUPPRESSION.context_max) {
        effectiveVisual = rawVisual * STRONG_SUPPRESSION.damping;
      } else if (rawVisual >= MILD_SUPPRESSION.visual_min
                 && lexical <= MILD_SUPPRESSION.lexical_max) {
        effectiveVisual = rawVisual * MILD_SUPPRESSION.damping;
      }

      // Generic layout penalty: only when NOT top visual AND both text signals disagree
      if (isGenericLayoutName(frame.name) && !isTopVisualCandidate
          && rawVisual > 0.6 && lexical < 0.25 && context < 0.25) {
        effectiveVisual *= 0.5;
      }
    }

    // Adaptive weights
    const weights = selectWeights(lexical, rawVisual);
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
  } else if (visualAvailable) {
    // v0.6.2: increased penalty from 0.85 to 0.75 to prioritize visually-confirmed frames
    final = (lexical * 0.55 + context * 0.35) * 0.75;
  } else {
    final = lexical * 0.60 + context * 0.40;
  }
  final = Math.min(final, 0.98);

  return { final, visual: rawVisual, lexical, context, score_profile: scoreProfile };
}

function normalizeVisualScores(visualMap: Map<string, number>): Map<string, number> {
  const normalized = new Map<string, number>();
  if (visualMap.size === 0) return normalized;

  const scores = Array.from(visualMap.values());
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore;

  if (range < 0.02) {
    for (const [nodeId] of visualMap) normalized.set(nodeId, 0.15);
    return normalized;
  }

  const spreadQuality = Math.min(1, range / 0.12);
  for (const [nodeId, score] of visualMap) {
    const relative = (score - minScore) / range;
    const floor = 0.10;
    const scaled = relative * spreadQuality * 0.85 + floor;
    normalized.set(nodeId, Math.min(scaled, 0.95));
  }
  return normalized;
}

// ── Evaluation runner ────────────────────────────────────

export function runEvaluation(): EvalReport {
  const screens = loadScreens();
  const allFrames = loadAllFrames();

  // Labeled samples: screens with real node_ids (not TODO)
  const labeled = screens.filter(s =>
    s.figma.node_id && s.figma.node_id !== FIGMA_PLACEHOLDER_NODE_ID && s.figma.node_id !== ''
  );

  const results: EvalResult[] = [];
  const fpCounter = new Map<string, { name: string; count: number }>();

  for (const screen of labeled) {
    const correctNodeId = screen.figma.node_id;
    const viewport = screen.viewport;

    // Load visual scores and normalize
    const visualMap = loadVisualScoreMap(screen.screen_id);
    const normalizedVisual = normalizeVisualScores(visualMap);

    // Score all frames
    const hasVisual = normalizedVisual.size > 0;

    // v0.6.2: Detect visual dominance — top-1 visual far ahead of top-2
    const sortedVisuals = Array.from(normalizedVisual.values()).sort((a, b) => b - a);
    const visualDominant = sortedVisuals.length >= 2
      && (sortedVisuals[0] - sortedVisuals[1]) > VISUAL_DOMINANCE_MARGIN;
    const topVisualNodeId = hasVisual
      ? Array.from(normalizedVisual.entries()).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null
      : null;

    const scored = allFrames.map(f => {
      const normVisual = normalizedVisual.get(f.node_id) ?? null;
      const displayVisual = visualMap.get(f.node_id) ?? null;

      const s = scoreFrame(f, screen.screen_id, screen.flow_id, viewport, normVisual, hasVisual, visualDominant, topVisualNodeId);
      return { ...f, ...s, displayVisual };
    }).sort((a, b) => b.final - a.final);

    // Find rank of correct answer
    const correctIdx = scored.findIndex(s => s.node_id === correctNodeId);
    const rank = correctIdx >= 0 ? correctIdx + 1 : null;

    // Track false positives: frames that ranked above the correct answer
    if (correctIdx > 0) {
      for (let i = 0; i < Math.min(correctIdx, 5); i++) {
        const fp = scored[i];
        const key = fp.node_id;
        const existing = fpCounter.get(key);
        if (existing) existing.count++;
        else fpCounter.set(key, { name: fp.name, count: 1 });
      }
    }

    results.push({
      screen_id: screen.screen_id,
      flow_id: screen.flow_id,
      correct_node_id: correctNodeId,
      rank_of_correct: rank,
      top_candidates: scored.slice(0, 5).map(s => ({
        node_id: s.node_id,
        name: s.name,
        final_score: Math.round(s.final * 1000) / 1000,
        raw_visual: s.displayVisual !== null ? Math.round(s.displayVisual * 1000) / 1000 : null,
      })),
      found_in_catalog: correctIdx >= 0,
    });
  }

  // Compute metrics
  const evaluated = results.filter(r => r.found_in_catalog);
  const n = evaluated.length;
  const top1 = n > 0 ? evaluated.filter(r => r.rank_of_correct === 1).length / n : 0;
  const top3 = n > 0 ? evaluated.filter(r => r.rank_of_correct !== null && r.rank_of_correct <= 3).length / n : 0;
  const top5 = n > 0 ? evaluated.filter(r => r.rank_of_correct !== null && r.rank_of_correct <= 5).length / n : 0;
  const mrr = n > 0
    ? evaluated.reduce((sum, r) => sum + (r.rank_of_correct !== null ? 1 / r.rank_of_correct : 0), 0) / n
    : 0;

  // False positives sorted by count
  const falsePositives = Array.from(fpCounter.entries())
    .map(([node_id, { name, count }]) => ({ node_id, name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Build table
  const lines: string[] = [];
  lines.push('');
  lines.push('='.repeat(80));
  lines.push('MAPPING EVALUATION REPORT');
  lines.push('='.repeat(80));
  lines.push('');
  lines.push(`Labeled samples:  ${labeled.length}`);
  lines.push(`Found in catalog: ${evaluated.length}`);
  lines.push(`Not in catalog:   ${labeled.length - evaluated.length}`);
  lines.push('');
  lines.push(`Top-1 accuracy:   ${(top1 * 100).toFixed(1)}%`);
  lines.push(`Top-3 accuracy:   ${(top3 * 100).toFixed(1)}%`);
  lines.push(`Top-5 accuracy:   ${(top5 * 100).toFixed(1)}%`);
  lines.push(`MRR:              ${mrr.toFixed(3)}`);
  lines.push('');
  lines.push('-'.repeat(80));
  lines.push('PER-SCREEN RESULTS');
  lines.push('-'.repeat(80));
  for (const r of results) {
    const rankStr = r.rank_of_correct !== null ? `#${r.rank_of_correct}` : 'NOT_FOUND';
    const marker = r.rank_of_correct === 1 ? ' OK' : r.rank_of_correct !== null && r.rank_of_correct <= 3 ? ' ~' : ' !!';
    lines.push(`  ${r.screen_id.padEnd(42)} correct=${r.correct_node_id.padEnd(12)} rank=${rankStr.padEnd(6)}${marker}`);
    if (r.rank_of_correct !== 1) {
      for (let i = 0; i < Math.min(3, r.top_candidates.length); i++) {
        const tc = r.top_candidates[i];
        const isCorrect = tc.node_id === r.correct_node_id ? ' <-- CORRECT' : '';
        const vis = tc.raw_visual !== null ? ` vis=${(tc.raw_visual * 100).toFixed(0)}` : '';
        lines.push(`    #${i + 1} ${tc.node_id.padEnd(12)} ${tc.name.padEnd(30)} final=${(tc.final_score * 100).toFixed(0)}${vis}${isCorrect}`);
      }
    }
  }

  if (falsePositives.length > 0) {
    lines.push('');
    lines.push('-'.repeat(80));
    lines.push('COMMON FALSE POSITIVES (ranked above correct answer)');
    lines.push('-'.repeat(80));
    for (const fp of falsePositives) {
      lines.push(`  ${fp.node_id.padEnd(12)} ${fp.name.padEnd(35)} appeared ${fp.count}x`);
    }
  }

  lines.push('');
  lines.push('='.repeat(80));

  return {
    total_labeled: labeled.length,
    total_evaluated: evaluated.length,
    top1_accuracy: Math.round(top1 * 1000) / 1000,
    top3_accuracy: Math.round(top3 * 1000) / 1000,
    top5_accuracy: Math.round(top5 * 1000) / 1000,
    mrr: Math.round(mrr * 1000) / 1000,
    results,
    false_positives: falsePositives,
    table: lines.join('\n'),
  };
}
