'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

// ── Types ────────────────────────────────────────────────

interface MaskInfo {
  selector: string;
  reason: string;
  pixels_masked?: number;
  source?: string;
}

interface ThresholdEval {
  pixel_diff_percent: { threshold: number; actual: number; passed: boolean };
  structural_similarity: { threshold: number; actual: number; passed: boolean };
}

interface ScreenData {
  screen_id: string;
  flow_id: string;
  step: number;
  variant: string;
  route: string;
  tags: string[];
  notes: string | null;
  readiness: 'ready' | 'unconfigured' | 'disabled';
  drift_classification: 'none' | 'noise' | 'real_drift';
  unconfigured_reason: string | null;
  thresholds: { pixel_diff_percent: number; structural_similarity: number };
  masks: MaskInfo[];
  diff_status: 'pass' | 'fail' | 'skipped' | 'error' | null;
  mismatch_percent: number | null;
  similarity: number | null;
  masked_ratio: number | null;
  threshold_eval: ThresholdEval | null;
  failure_reasons: string[];
  warnings: string[];
  masks_applied: MaskInfo[];
  has_figma_artifact: boolean;
  has_runtime_artifact: boolean;
  has_diff_artifact: boolean;
  has_overlay_artifact: boolean;
  timing: { started_at: string; finished_at: string; duration_ms: number } | null;
}

interface RunInfo {
  run_id: string;
  git_commit: string;
  git_branch: string;
  started_at: string;
  finished_at: string;
  summary: { passed: number; failed: number; skipped: number; errored: number };
  coverage: {
    total: number;
    ready: number;
    unconfigured: number;
    disabled: number;
  } | null;
}

interface ReviewerData {
  screens: ScreenData[];
  flows: string[];
  run: RunInfo | null;
  regression: {
    has_unexpected_regressions: boolean;
    regressions: any[];
    improvements: any[];
    baseline_run_id: string;
  } | null;
}

interface RunEntry {
  run_id: string;
  timestamp: string;
  git_commit: string;
  git_branch: string;
  summary: { passed: number; failed: number; skipped: number; errored: number } | null;
  screen_count: number;
  has_regression_report: boolean;
}

type FilterStatus = 'all' | 'failed' | 'unconfigured' | 'pass' | 'regression' | 'improved';

type RegressionLabel = 'REGRESSION' | 'IMPROVED' | 'NEW_SCREEN' | 'UNCHANGED';

interface ScreenComparison {
  screen_id: string;
  label: RegressionLabel;
  currentMismatch: number | null;
  baselineMismatch: number | null;
  delta: number | null;
}

type ViewMode = 'list' | 'graph';

// ── Mapping assistant types ──────────────────────────────

interface FigmaCandidate {
  node_id: string;
  name: string;
  type: string;
  page_name: string;
  section_name: string | null;
  width: number;
  height: number;
  score: number;
  final_score: number;
  raw_visual_score: number | null;
  lexical_score: number;
  context_score: number;
  match_confidence: 'high' | 'medium' | 'low';
  match_reasons: string[];
  rank: 'recommended' | 'similar' | 'other';
  already_mapped: boolean;
  visual_score?: number;
}

interface MappingSaveResult {
  status: 'saved' | 'patch_generated' | 'unchanged';
  message: string;
  screen_id?: string;
  node_id?: string;
}

// ── Flow graph types ─────────────────────────────────────

interface FlowNode {
  id: string;
  screen_id: string;
  route: string;
  step: number;
  variant: string;
  flow_id: string;
  is_external: boolean;
}

interface FlowEdge {
  from: string;
  to: string;
  trigger: string;
  type: 'next' | 'alternate' | 'error' | 'data_variant';
  notes?: string;
}

interface FlowGraph {
  flow_id: string;
  title: string;
  entry_route: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ── Graph layout constants ───────────────────────────────

const NODE_W = 186;
const NODE_H = 76;
const COL_GAP = 64;
const ROW_GAP = 28;
const PAD = 32;

interface LayoutNode {
  node: FlowNode;
  x: number;
  y: number;
}

interface LayoutEdge {
  edge: FlowEdge;
  fromPos: { x: number; y: number };
  toPos: { x: number; y: number };
  isSelfLoop: boolean;
}

// ── Helpers ──────────────────────────────────────────────

function getEffectiveStatus(s: ScreenData): string {
  if (s.readiness === 'disabled') return 'disabled';
  if (s.readiness === 'unconfigured') return 'unconfigured';
  if (s.diff_status) return s.diff_status;
  return 'no_run';
}

function statusColor(status: string): string {
  switch (status) {
    case 'pass': return '#22c55e';
    case 'fail': return '#ef4444';
    case 'error': return '#f97316';
    case 'skipped': return '#eab308';
    case 'unconfigured': return '#a1a1aa';
    case 'disabled': return '#d4d4d8';
    default: return '#6b7280';
  }
}

function statusBg(status: string): string {
  switch (status) {
    case 'pass': return '#f0fdf4';
    case 'fail': return '#fef2f2';
    case 'error': return '#fff7ed';
    case 'unconfigured': return '#fafafa';
    case 'disabled': return '#f5f5f5';
    default: return '#ffffff';
  }
}

function nodeStroke(status: string): string {
  switch (status) {
    case 'pass': return '#86efac';
    case 'fail': return '#fca5a5';
    case 'error': return '#fdba74';
    case 'unconfigured': return '#d4d4d8';
    case 'disabled': return '#e5e7eb';
    default: return '#e5e7eb';
  }
}

function driftLabel(d: string): string | null {
  if (d === 'real_drift') return 'REAL DRIFT';
  if (d === 'noise') return 'NOISE';
  return null;
}

function imgUrl(type: string, screenId: string, runId?: string): string {
  const params = new URLSearchParams({ type, screen: screenId });
  if (runId) params.set('run', runId);
  return `/api/reviewer/image?${params}`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatRunLabel(run: RunEntry): string {
  const d = run.timestamp ? new Date(run.timestamp) : null;
  const dateStr = d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : run.run_id;
  return `${dateStr}  (${run.git_commit.slice(0, 7)})`;
}

function regressionBadgeColor(label: RegressionLabel): { bg: string; fg: string } {
  switch (label) {
    case 'REGRESSION': return { bg: '#dc2626', fg: '#fff' };
    case 'IMPROVED': return { bg: '#16a34a', fg: '#fff' };
    case 'NEW_SCREEN': return { bg: '#2563eb', fg: '#fff' };
    case 'UNCHANGED': return { bg: '#e5e7eb', fg: '#6b7280' };
  }
}

function classifyScreen(
  currentScreen: ScreenData | undefined,
  baselineScreen: ScreenData | undefined,
): RegressionLabel {
  if (!baselineScreen) return 'NEW_SCREEN';
  if (!currentScreen) return 'UNCHANGED';

  const curStatus = currentScreen.diff_status;
  const baseStatus = baselineScreen.diff_status;

  if (baseStatus === 'pass' && curStatus === 'fail') return 'REGRESSION';
  if (baseStatus === 'fail' && curStatus === 'pass') return 'IMPROVED';

  const curMismatch = currentScreen.mismatch_percent ?? 0;
  const baseMismatch = baselineScreen.mismatch_percent ?? 0;
  const delta = curMismatch - baseMismatch;

  if (delta > 0.5) return 'REGRESSION';
  if (delta < -0.5) return 'IMPROVED';

  return 'UNCHANGED';
}

function edgeStroke(type: string): string {
  switch (type) {
    case 'next': return '#6b7280';
    case 'alternate': return '#a1a1aa';
    case 'error': return '#ef4444';
    case 'data_variant': return '#8b5cf6';
    default: return '#d4d4d8';
  }
}

function edgeDash(type: string): string {
  switch (type) {
    case 'next': return '';
    case 'alternate': return '6 3';
    case 'error': return '3 3';
    case 'data_variant': return '4 2';
    default: return '4 2';
  }
}

// ── Graph layout engine ──────────────────────────────────

function computeLayout(graph: FlowGraph): { nodes: LayoutNode[]; edges: LayoutEdge[]; width: number; height: number } {
  const { nodes, edges } = graph;
  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  // Assign columns using BFS from nodes with no incoming "next" edges.
  // This respects the DAG structure rather than relying solely on step numbers.
  const incomingNext = new Set<string>();
  const adjNext = new Map<string, string[]>();
  for (const e of edges) {
    if (e.type === 'next') {
      incomingNext.add(e.to);
      const list = adjNext.get(e.from) || [];
      list.push(e.to);
      adjNext.set(e.from, list);
    }
  }

  // Entry nodes: no incoming "next" edges
  const entryIds = nodes.filter(n => !incomingNext.has(n.id)).map(n => n.id);
  if (entryIds.length === 0) entryIds.push(nodes[0].id);

  const colMap = new Map<string, number>();
  const queue: string[] = [...entryIds];
  for (const id of entryIds) colMap.set(id, 0);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curCol = colMap.get(cur)!;
    const nexts = adjNext.get(cur) || [];
    for (const nxt of nexts) {
      const existing = colMap.get(nxt);
      if (existing === undefined || existing < curCol + 1) {
        colMap.set(nxt, curCol + 1);
        queue.push(nxt);
      }
    }
  }

  // Assign any unreached nodes to max_col + 1
  let maxCol = 0;
  colMap.forEach(c => { if (c > maxCol) maxCol = c; });
  for (const n of nodes) {
    if (!colMap.has(n.id)) colMap.set(n.id, maxCol + 1);
  }

  // Group nodes by column
  const columns = new Map<number, FlowNode[]>();
  for (const n of nodes) {
    const col = colMap.get(n.id)!;
    const list = columns.get(col) || [];
    list.push(n);
    columns.set(col, list);
  }

  // Sort columns
  const sortedCols = [...columns.keys()].sort((a, b) => a - b);

  // Compute positions
  const layoutNodes: LayoutNode[] = [];
  const posMap = new Map<string, { x: number; y: number }>();

  // Find max row count for vertical centering
  let maxRows = 0;
  for (const col of sortedCols) {
    const count = columns.get(col)!.length;
    if (count > maxRows) maxRows = count;
  }

  for (let ci = 0; ci < sortedCols.length; ci++) {
    const col = sortedCols[ci];
    const colNodes = columns.get(col)!;
    const x = PAD + ci * (NODE_W + COL_GAP);

    // Center vertically relative to the tallest column
    const totalH = colNodes.length * NODE_H + (colNodes.length - 1) * ROW_GAP;
    const maxTotalH = maxRows * NODE_H + (maxRows - 1) * ROW_GAP;
    const yOffset = PAD + (maxTotalH - totalH) / 2;

    for (let ri = 0; ri < colNodes.length; ri++) {
      const node = colNodes[ri];
      const y = yOffset + ri * (NODE_H + ROW_GAP);
      layoutNodes.push({ node, x, y });
      posMap.set(node.id, { x, y });
    }
  }

  // Compute edges
  const layoutEdges: LayoutEdge[] = [];
  for (const edge of edges) {
    const fromPos = posMap.get(edge.from);
    const toPos = posMap.get(edge.to);
    if (!fromPos || !toPos) continue;

    layoutEdges.push({
      edge,
      fromPos,
      toPos,
      isSelfLoop: edge.from === edge.to,
    });
  }

  const width = PAD * 2 + sortedCols.length * NODE_W + (sortedCols.length - 1) * COL_GAP;
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;

  return { nodes: layoutNodes, edges: layoutEdges, width, height };
}

// ── Components ───────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 4,
        background: statusColor(status),
        color: '#fff',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.02em',
      }}
    >
      {status === 'no_run' ? 'NO RUN' : status}
    </span>
  );
}

function DriftBadge({ drift }: { drift: string }) {
  const label = driftLabel(drift);
  if (!label) return null;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 4,
        background: drift === 'real_drift' ? '#7c3aed' : '#6b7280',
        color: '#fff',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

function RegressionBadge({ label }: { label: RegressionLabel }) {
  if (label === 'UNCHANGED') return null;
  const { bg, fg } = regressionBadgeColor(label);
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 4,
        background: bg,
        color: fg,
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {label.replace('_', ' ')}
    </span>
  );
}

function Sparkline({ values, width = 80, height = 24 }: { values: (number | null)[]; width?: number; height?: number }) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return null;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;

  const points = nums.map((v, i) => {
    const x = (i / (nums.length - 1)) * width;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const lastVal = nums[nums.length - 1];
  const prevVal = nums[nums.length - 2];
  const trending = lastVal > prevVal ? '#ef4444' : lastVal < prevVal ? '#22c55e' : '#6b7280';

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={trending}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={(nums.length - 1) / (nums.length - 1) * width}
        cy={height - 2 - ((lastVal - min) / range) * (height - 4)}
        r="2"
        fill={trending}
      />
    </svg>
  );
}

function RunSelector({
  runs,
  currentRunId,
  baselineRunId,
  onCurrentChange,
  onBaselineChange,
}: {
  runs: RunEntry[];
  currentRunId: string;
  baselineRunId: string;
  onCurrentChange: (id: string) => void;
  onBaselineChange: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#6b7280', fontWeight: 500 }}>Current Run:</span>
        <select
          value={currentRunId}
          onChange={e => onCurrentChange(e.target.value)}
          style={{
            fontSize: 12,
            padding: '4px 8px',
            border: '1px solid #e5e7eb',
            borderRadius: 4,
            background: '#fff',
            fontFamily: 'monospace',
            minWidth: 240,
          }}
        >
          {runs.map(r => (
            <option key={r.run_id} value={r.run_id}>{formatRunLabel(r)}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#6b7280', fontWeight: 500 }}>Baseline Run:</span>
        <select
          value={baselineRunId}
          onChange={e => onBaselineChange(e.target.value)}
          style={{
            fontSize: 12,
            padding: '4px 8px',
            border: '1px solid #e5e7eb',
            borderRadius: 4,
            background: '#fff',
            fontFamily: 'monospace',
            minWidth: 240,
          }}
        >
          {runs.map(r => (
            <option key={r.run_id} value={r.run_id}>{formatRunLabel(r)}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function RegressionSummary({
  comparisons,
  onFilter,
}: {
  comparisons: Map<string, ScreenComparison>;
  onFilter: (f: FilterStatus) => void;
}) {
  let regressions = 0;
  let improvements = 0;
  let stable = 0;
  let newScreens = 0;

  comparisons.forEach(c => {
    switch (c.label) {
      case 'REGRESSION': regressions++; break;
      case 'IMPROVED': improvements++; break;
      case 'NEW_SCREEN': newScreens++; break;
      case 'UNCHANGED': stable++; break;
    }
  });

  return (
    <div style={{
      display: 'flex',
      gap: 16,
      padding: '8px 16px',
      background: regressions > 0 ? '#fef2f2' : '#f0fdf4',
      borderRadius: 8,
      fontSize: 13,
      alignItems: 'center',
      border: `1px solid ${regressions > 0 ? '#fecaca' : '#bbf7d0'}`,
    }}>
      <span style={{ fontWeight: 600, color: '#374151' }}>Run Comparison</span>
      <button onClick={() => onFilter('regression')} style={summaryLinkStyle}>
        <span style={{ fontWeight: 700, color: '#dc2626' }}>{regressions}</span>
        <span style={{ color: '#6b7280' }}> Regressions</span>
      </button>
      <button onClick={() => onFilter('improved')} style={summaryLinkStyle}>
        <span style={{ fontWeight: 700, color: '#16a34a' }}>{improvements}</span>
        <span style={{ color: '#6b7280' }}> Improvements</span>
      </button>
      <span>
        <span style={{ fontWeight: 700, color: '#6b7280' }}>{stable}</span>
        <span style={{ color: '#9ca3af' }}> Stable</span>
      </span>
      {newScreens > 0 && (
        <span>
          <span style={{ fontWeight: 700, color: '#2563eb' }}>{newScreens}</span>
          <span style={{ color: '#9ca3af' }}> New</span>
        </span>
      )}
    </div>
  );
}

const summaryLinkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 'inherit',
  padding: 0,
  textDecoration: 'underline',
  textDecorationStyle: 'dotted',
  textUnderlineOffset: '2px',
};

// ── Flow Graph SVG ───────────────────────────────────────

function FlowGraphSVG({
  graph,
  screenMap,
  comparisons,
  selectedId,
  onSelect,
  filterFn,
}: {
  graph: FlowGraph;
  screenMap: Map<string, ScreenData>;
  comparisons: Map<string, ScreenComparison>;
  selectedId: string | null;
  onSelect: (screenId: string) => void;
  filterFn: (screenId: string) => boolean;
}) {
  const layout = useMemo(() => computeLayout(graph), [graph]);
  if (layout.nodes.length === 0) return null;

  const svgW = Math.max(layout.width, 300);
  const svgH = Math.max(layout.height, 120);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 14,
        fontWeight: 700,
        color: '#374151',
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        {graph.title}
        <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>{graph.flow_id}</span>
      </div>
      <div style={{ overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
        <svg
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          style={{ display: 'block' }}
        >
          <defs>
            <marker
              id={`arrow-next-${graph.flow_id}`}
              viewBox="0 0 10 6"
              refX="10"
              refY="3"
              markerWidth="8"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 3 L 0 6 z" fill="#6b7280" />
            </marker>
            <marker
              id={`arrow-alt-${graph.flow_id}`}
              viewBox="0 0 10 6"
              refX="10"
              refY="3"
              markerWidth="8"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 3 L 0 6 z" fill="#a1a1aa" />
            </marker>
            <marker
              id={`arrow-err-${graph.flow_id}`}
              viewBox="0 0 10 6"
              refX="10"
              refY="3"
              markerWidth="8"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 3 L 0 6 z" fill="#ef4444" />
            </marker>
          </defs>

          {/* Edges */}
          {layout.edges.map((le, i) => {
            const { fromPos, toPos, edge, isSelfLoop } = le;
            const markerEnd = edge.type === 'error'
              ? `url(#arrow-err-${graph.flow_id})`
              : edge.type === 'alternate' || edge.type === 'data_variant'
                ? `url(#arrow-alt-${graph.flow_id})`
                : `url(#arrow-next-${graph.flow_id})`;

            if (isSelfLoop) {
              // Draw a loop arc above the node
              const cx = fromPos.x + NODE_W / 2;
              const cy = fromPos.y;
              return (
                <path
                  key={`edge-${i}`}
                  d={`M ${cx - 12} ${cy} C ${cx - 12} ${cy - 36}, ${cx + 12} ${cy - 36}, ${cx + 12} ${cy}`}
                  fill="none"
                  stroke={edgeStroke(edge.type)}
                  strokeWidth="1.5"
                  strokeDasharray={edgeDash(edge.type)}
                  markerEnd={markerEnd}
                />
              );
            }

            // Is it a back-edge (going left)?
            const isBack = toPos.x < fromPos.x;

            if (isBack) {
              // Route the edge below the nodes
              const fromRight = fromPos.x;
              const fromMid = fromPos.y + NODE_H / 2;
              const toLeft = toPos.x + NODE_W;
              const toMid = toPos.y + NODE_H / 2;
              const belowY = Math.max(fromPos.y, toPos.y) + NODE_H + 20;

              return (
                <path
                  key={`edge-${i}`}
                  d={`M ${fromRight} ${fromMid} C ${fromRight - 20} ${belowY}, ${toLeft + 20} ${belowY}, ${toLeft} ${toMid}`}
                  fill="none"
                  stroke={edgeStroke(edge.type)}
                  strokeWidth="1.5"
                  strokeDasharray={edgeDash(edge.type)}
                  markerEnd={markerEnd}
                />
              );
            }

            // Forward edge: right side of from -> left side of to
            const x1 = fromPos.x + NODE_W;
            const y1 = fromPos.y + NODE_H / 2;
            const x2 = toPos.x;
            const y2 = toPos.y + NODE_H / 2;
            const cpOffset = Math.min(Math.abs(x2 - x1) * 0.4, 60);

            return (
              <path
                key={`edge-${i}`}
                d={`M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={edgeStroke(edge.type)}
                strokeWidth="1.5"
                strokeDasharray={edgeDash(edge.type)}
                markerEnd={markerEnd}
              />
            );
          })}

          {/* Nodes */}
          {layout.nodes.map(ln => {
            const { node, x, y } = ln;
            const screen = screenMap.get(node.screen_id);
            const status = screen ? getEffectiveStatus(screen) : 'no_run';
            const isSelected = selectedId === node.screen_id;
            const dimmed = !filterFn(node.screen_id);
            const comparison = comparisons.get(node.screen_id);
            const pct = screen?.mismatch_percent;

            return (
              <g
                key={node.id}
                onClick={() => onSelect(node.screen_id)}
                style={{ cursor: 'pointer' }}
                opacity={dimmed ? 0.35 : 1}
              >
                {/* Node background */}
                <rect
                  x={x}
                  y={y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill={isSelected ? '#eff6ff' : statusBg(status)}
                  stroke={isSelected ? '#2563eb' : nodeStroke(status)}
                  strokeWidth={isSelected ? 2 : 1.5}
                />

                {/* Status color bar (left edge) */}
                <rect
                  x={x}
                  y={y}
                  width={4}
                  height={NODE_H}
                  rx={2}
                  fill={statusColor(status)}
                />

                {/* Node ID label */}
                <text
                  x={x + 12}
                  y={y + 18}
                  fontSize={11}
                  fontWeight={600}
                  fill="#111"
                  style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}
                >
                  {node.id}
                </text>

                {/* Screen ID (smaller) */}
                <text
                  x={x + 12}
                  y={y + 32}
                  fontSize={9}
                  fill="#9ca3af"
                  style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}
                >
                  {node.screen_id.length > 28 ? node.screen_id.slice(0, 26) + '..' : node.screen_id}
                </text>

                {/* Status badge */}
                <rect
                  x={x + 12}
                  y={y + 40}
                  width={statusLabel(status).length * 6.2 + 10}
                  height={16}
                  rx={3}
                  fill={statusColor(status)}
                />
                <text
                  x={x + 17}
                  y={y + 52}
                  fontSize={9}
                  fontWeight={600}
                  fill="#fff"
                  style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', textTransform: 'uppercase' as const, letterSpacing: '0.02em' }}
                >
                  {statusLabel(status)}
                </text>

                {/* Mismatch % */}
                {pct !== null && pct !== undefined && (
                  <text
                    x={x + NODE_W - 10}
                    y={y + 52}
                    fontSize={10}
                    fill="#6b7280"
                    textAnchor="end"
                    style={{ fontFamily: 'monospace' }}
                  >
                    {pct.toFixed(2)}%
                  </text>
                )}

                {/* Regression badge (top-right corner) */}
                {comparison && comparison.label !== 'UNCHANGED' && (
                  <>
                    <rect
                      x={x + NODE_W - regBadgeWidth(comparison.label) - 6}
                      y={y + 6}
                      width={regBadgeWidth(comparison.label)}
                      height={14}
                      rx={3}
                      fill={regressionBadgeColor(comparison.label).bg}
                    />
                    <text
                      x={x + NODE_W - 10}
                      y={y + 16}
                      fontSize={8}
                      fontWeight={700}
                      fill={regressionBadgeColor(comparison.label).fg}
                      textAnchor="end"
                      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', textTransform: 'uppercase' as const, letterSpacing: '0.03em' }}
                    >
                      {comparison.label.replace('_', ' ')}
                    </text>
                  </>
                )}

                {/* External node indicator */}
                {node.is_external && (
                  <text
                    x={x + NODE_W - 10}
                    y={y + 32}
                    fontSize={8}
                    fill="#a1a1aa"
                    textAnchor="end"
                    style={{ fontStyle: 'italic' }}
                  >
                    ext
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function statusLabel(status: string): string {
  return status === 'no_run' ? 'NO RUN' : status;
}

function regBadgeWidth(label: RegressionLabel): number {
  switch (label) {
    case 'REGRESSION': return 62;
    case 'IMPROVED': return 52;
    case 'NEW_SCREEN': return 62;
    default: return 0;
  }
}

// ── Edge legend ──────────────────────────────────────────

function EdgeLegend() {
  const items: { type: string; label: string; color: string; dash: string }[] = [
    { type: 'next', label: 'Next (primary)', color: '#6b7280', dash: '' },
    { type: 'alternate', label: 'Alternate', color: '#a1a1aa', dash: '6 3' },
    { type: 'error', label: 'Error', color: '#ef4444', dash: '3 3' },
    { type: 'data_variant', label: 'Data variant', color: '#8b5cf6', dash: '4 2' },
  ];

  return (
    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#6b7280', alignItems: 'center', padding: '4px 0' }}>
      {items.map(item => (
        <div key={item.type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="24" height="8">
            <line
              x1="0" y1="4" x2="24" y2="4"
              stroke={item.color}
              strokeWidth="1.5"
              strokeDasharray={item.dash}
            />
          </svg>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Screen list card ─────────────────────────────────────

function ScreenCard({
  screen,
  isSelected,
  onClick,
  regressionLabel,
  sparklineValues,
}: {
  screen: ScreenData;
  isSelected: boolean;
  onClick: () => void;
  regressionLabel?: RegressionLabel;
  sparklineValues?: (number | null)[];
}) {
  const status = getEffectiveStatus(screen);
  const pct = screen.mismatch_percent;

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        width: '100%',
        textAlign: 'left',
        border: isSelected ? '2px solid #2563eb' : '1px solid #e5e7eb',
        borderRadius: 8,
        background: isSelected ? '#eff6ff' : statusBg(status),
        cursor: 'pointer',
        transition: 'border-color 0.1s',
        fontFamily: 'inherit',
        fontSize: 13,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <StatusBadge status={status} />
          <DriftBadge drift={screen.drift_classification} />
          {regressionLabel && <RegressionBadge label={regressionLabel} />}
          {pct !== null && (
            <span style={{ fontSize: 11, color: '#6b7280' }}>
              {pct.toFixed(2)}%
            </span>
          )}
        </div>
        <div
          style={{
            marginTop: 4,
            fontWeight: 500,
            fontSize: 13,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {screen.screen_id}
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
          {screen.flow_id} / step {screen.step} / {screen.variant}
        </div>
      </div>
      {sparklineValues && sparklineValues.length >= 2 && (
        <div style={{ flexShrink: 0 }}>
          <Sparkline values={sparklineValues} />
        </div>
      )}
    </button>
  );
}

// ── Inspector (unchanged) ────────────────────────────────

function ImagePanel({
  screen,
  runId,
}: {
  screen: ScreenData;
  runId: string | undefined;
}) {
  const [activeTab, setActiveTab] = useState<'compare' | 'diff' | 'overlay'>('compare');

  const tabs: { key: typeof activeTab; label: string; available: boolean }[] = [
    { key: 'compare', label: 'Compare', available: screen.has_figma_artifact || screen.has_runtime_artifact },
    { key: 'diff', label: 'Diff', available: screen.has_diff_artifact },
    { key: 'overlay', label: 'Overlay', available: screen.has_overlay_artifact },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 2, marginBottom: 12 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            disabled={!t.available}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '6px 16px',
              fontSize: 12,
              fontWeight: activeTab === t.key ? 600 : 400,
              border: 'none',
              borderBottom: activeTab === t.key ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              color: !t.available ? '#d4d4d8' : activeTab === t.key ? '#2563eb' : '#6b7280',
              cursor: t.available ? 'pointer' : 'default',
              fontFamily: 'inherit',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'compare' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>Figma</div>
            {screen.has_figma_artifact ? (
              <img
                src={imgUrl('figma', screen.screen_id)}
                alt="Figma"
                style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 4 }}
                loading="lazy"
              />
            ) : (
              <div style={{ padding: 40, textAlign: 'center', color: '#a1a1aa', background: '#fafafa', borderRadius: 4 }}>
                No Figma artifact
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>Runtime</div>
            {screen.has_runtime_artifact ? (
              <img
                src={imgUrl('runtime', screen.screen_id)}
                alt="Runtime"
                style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 4 }}
                loading="lazy"
              />
            ) : (
              <div style={{ padding: 40, textAlign: 'center', color: '#a1a1aa', background: '#fafafa', borderRadius: 4 }}>
                No Runtime artifact
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'diff' && screen.has_diff_artifact && runId && (
        <div>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>
            Pixel Diff (red = mismatch)
          </div>
          <img
            src={imgUrl('diff', screen.screen_id, runId)}
            alt="Diff"
            style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 4 }}
            loading="lazy"
          />
        </div>
      )}

      {activeTab === 'overlay' && screen.has_overlay_artifact && runId && (
        <div>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>
            Overlay (diff on runtime)
          </div>
          <img
            src={imgUrl('overlay', screen.screen_id, runId)}
            alt="Overlay"
            style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 4 }}
            loading="lazy"
          />
        </div>
      )}
    </div>
  );
}

function Inspector({
  screen,
  runId,
  comparison,
}: {
  screen: ScreenData;
  runId: string | undefined;
  comparison?: ScreenComparison;
}) {
  const status = getEffectiveStatus(screen);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <StatusBadge status={status} />
          <DriftBadge drift={screen.drift_classification} />
          {comparison && <RegressionBadge label={comparison.label} />}
          <span style={{ fontWeight: 700, fontSize: 16 }}>{screen.screen_id}</span>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
          {screen.flow_id} / step {screen.step} / {screen.variant} &mdash; <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>{screen.route}</code>
        </div>
      </div>

      {comparison && comparison.delta !== null && comparison.label !== 'UNCHANGED' && (
        <div style={{
          padding: '6px 12px',
          background: comparison.label === 'REGRESSION' ? '#fef2f2' : '#f0fdf4',
          borderRadius: 6,
          fontSize: 12,
          border: `1px solid ${comparison.label === 'REGRESSION' ? '#fecaca' : '#bbf7d0'}`,
        }}>
          <span style={{ fontWeight: 600, color: comparison.label === 'REGRESSION' ? '#dc2626' : '#16a34a' }}>
            {comparison.label === 'REGRESSION' ? 'Mismatch increased' : 'Mismatch decreased'}
          </span>
          {' '}
          <span style={{ color: '#6b7280' }}>
            {comparison.baselineMismatch?.toFixed(2)}% &rarr; {comparison.currentMismatch?.toFixed(2)}%
            ({comparison.delta > 0 ? '+' : ''}{comparison.delta.toFixed(2)}pp)
          </span>
        </div>
      )}

      {screen.mismatch_percent !== null && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
          fontSize: 12,
        }}>
          <MetricBox label="Mismatch" value={`${screen.mismatch_percent.toFixed(4)}%`} warn={screen.diff_status === 'fail'} />
          <MetricBox label="Similarity" value={screen.similarity?.toFixed(4) ?? 'n/a'} />
          <MetricBox label="Masked" value={screen.masked_ratio !== null ? `${(screen.masked_ratio * 100).toFixed(1)}%` : 'n/a'} />
          <MetricBox label="Duration" value={screen.timing ? `${screen.timing.duration_ms}ms` : 'n/a'} />
        </div>
      )}

      {screen.threshold_eval && (
        <div style={{ fontSize: 12, padding: '8px 12px', background: '#f9fafb', borderRadius: 6 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Thresholds</div>
          <div style={{ display: 'flex', gap: 24 }}>
            <span>
              pixel_diff: {screen.threshold_eval.pixel_diff_percent.passed ? <G>PASS</G> : <R>FAIL</R>}
              {' '}({screen.threshold_eval.pixel_diff_percent.actual.toFixed(4)}% / {screen.threshold_eval.pixel_diff_percent.threshold}%)
            </span>
            <span>
              similarity: {screen.threshold_eval.structural_similarity.passed ? <G>PASS</G> : <R>FAIL</R>}
              {' '}({screen.threshold_eval.structural_similarity.actual.toFixed(4)} / {screen.threshold_eval.structural_similarity.threshold})
            </span>
          </div>
        </div>
      )}

      {screen.failure_reasons.length > 0 && (
        <div style={{ padding: '8px 12px', background: '#fef2f2', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Failure reasons</div>
          {screen.failure_reasons.map((f, i) => <div key={i}>{f}</div>)}
        </div>
      )}

      {(screen.drift_classification === 'real_drift' || screen.notes || screen.unconfigured_reason) && (
        <div style={{ padding: '8px 12px', background: screen.drift_classification === 'real_drift' ? '#f5f3ff' : '#f9fafb', borderRadius: 6, fontSize: 12 }}>
          {screen.drift_classification === 'real_drift' && (
            <div style={{ color: '#7c3aed', fontWeight: 600, marginBottom: 4 }}>Known Design Drift</div>
          )}
          {screen.unconfigured_reason && (
            <div style={{ color: '#92400e', marginBottom: 4 }}><strong>Why unconfigured:</strong> {screen.unconfigured_reason}</div>
          )}
          {screen.notes && (
            <div style={{ color: '#374151', whiteSpace: 'pre-wrap' }}>{screen.notes}</div>
          )}
        </div>
      )}

      {screen.masks_applied.length > 0 && (
        <div style={{ fontSize: 12, padding: '8px 12px', background: '#f9fafb', borderRadius: 6 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Masks applied</div>
          {screen.masks_applied.map((m, i) => (
            <div key={i} style={{ marginBottom: 2 }}>
              <code style={{ background: '#e5e7eb', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>{m.selector}</code>
              {' '}&mdash; {m.reason}
              {m.pixels_masked ? ` (${m.pixels_masked}px)` : ''}
            </div>
          ))}
        </div>
      )}

      {screen.warnings.length > 0 && (
        <div style={{ padding: '8px 12px', background: '#fffbeb', borderRadius: 6, fontSize: 12, color: '#92400e' }}>
          {screen.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {screen.tags.map(t => (
          <span key={t} style={{ padding: '1px 8px', background: '#f3f4f6', borderRadius: 9999, fontSize: 11, color: '#6b7280' }}>{t}</span>
        ))}
      </div>

      <ImagePanel screen={screen} runId={runId} />
    </div>
  );
}

function MetricBox({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{
      padding: '6px 10px',
      background: warn ? '#fef2f2' : '#f9fafb',
      borderRadius: 6,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: warn ? '#dc2626' : '#111' }}>{value}</div>
    </div>
  );
}

function G({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#16a34a', fontWeight: 600 }}>{children}</span>;
}
function R({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#dc2626', fontWeight: 600 }}>{children}</span>;
}

// ── Mapping Assistant ────────────────────────────────────

function MappingAssistant({
  screen,
  onSaved,
  onClose,
}: {
  screen: ScreenData;
  onSaved: (result: MappingSaveResult) => void;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<FigmaCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [manualNodeId, setManualNodeId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<MappingSaveResult | null>(null);
  const [totalFrames, setTotalFrames] = useState(0);

  // Load candidates
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      screen_id: screen.screen_id,
      flow_id: screen.flow_id,
    });
    if (search) params.set('search', search);

    fetch(`/api/reviewer/figma-candidates?${params}`)
      .then(r => r.json())
      .then(d => {
        setCandidates(d.candidates || []);
        setTotalFrames(d.total_frames || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [screen.screen_id, screen.flow_id, search]);

  const handleSave = async (nodeId: string) => {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/reviewer/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screen_id: screen.screen_id, node_id: nodeId }),
      });
      const result = await res.json();
      if (res.ok) {
        setSaveResult(result);
        onSaved(result);
      } else {
        setSaveResult({ status: 'unchanged', message: result.error || 'Save failed' });
      }
    } catch (err) {
      setSaveResult({ status: 'unchanged', message: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const recommended = candidates.filter(c => c.rank === 'recommended');
  const similar = candidates.filter(c => c.rank === 'similar');
  const other = candidates.filter(c => c.rank === 'other');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Mapping Assistant</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            Map <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 3 }}>{screen.screen_id}</code> to a Figma frame
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            padding: '4px 12px', fontSize: 12, border: '1px solid #e5e7eb',
            borderRadius: 4, background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Close
        </button>
      </div>

      {/* Screen context */}
      <div style={{ padding: '10px 14px', background: '#f9fafb', borderRadius: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span><strong>Flow:</strong> {screen.flow_id}</span>
          <span><strong>Step:</strong> {screen.step}</span>
          <span><strong>Variant:</strong> {screen.variant}</span>
          <span><strong>Route:</strong> <code>{screen.route}</code></span>
        </div>
        {screen.unconfigured_reason && (
          <div style={{ marginTop: 6, color: '#92400e', fontStyle: 'italic' }}>
            {screen.unconfigured_reason}
          </div>
        )}
      </div>

      {/* Runtime preview (if available) */}
      {screen.has_runtime_artifact && (
        <div>
          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 4 }}>Runtime Screenshot</div>
          <img
            src={imgUrl('runtime', screen.screen_id)}
            alt="Runtime"
            style={{ width: '100%', maxWidth: 600, border: '1px solid #e5e7eb', borderRadius: 4 }}
            loading="lazy"
          />
        </div>
      )}

      {/* Save result */}
      {saveResult && (
        <div style={{
          padding: '10px 14px',
          borderRadius: 8,
          fontSize: 12,
          background: saveResult.status === 'saved' ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${saveResult.status === 'saved' ? '#bbf7d0' : '#fecaca'}`,
          color: saveResult.status === 'saved' ? '#166534' : '#991b1b',
        }}>
          <div style={{ fontWeight: 600 }}>
            {saveResult.status === 'saved' ? 'Mapping saved!' : 'Error'}
          </div>
          <div style={{ marginTop: 2 }}>{saveResult.message}</div>
          {saveResult.status === 'saved' && (
            <div style={{ marginTop: 6, padding: '6px 10px', background: '#ecfdf5', borderRadius: 4, color: '#065f46' }}>
              Next step: run <code>pnpm reviewer:run --screen {screen.screen_id}</code> to generate the diff.
            </div>
          )}
        </div>
      )}

      {/* Manual node_id input */}
      <div style={{
        padding: '10px 14px', background: '#f9fafb', borderRadius: 8,
        display: 'flex', gap: 8, alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500, whiteSpace: 'nowrap' }}>Paste node_id:</span>
        <input
          type="text"
          placeholder="e.g. 24:45"
          value={manualNodeId}
          onChange={e => setManualNodeId(e.target.value)}
          style={{
            flex: 1, fontSize: 12, padding: '4px 8px', border: '1px solid #e5e7eb',
            borderRadius: 4, fontFamily: 'monospace',
          }}
        />
        <button
          onClick={() => { if (manualNodeId.trim()) handleSave(manualNodeId.trim()); }}
          disabled={saving || !manualNodeId.trim()}
          style={{
            padding: '4px 14px', fontSize: 12, fontWeight: 600,
            border: 'none', borderRadius: 4, background: '#2563eb', color: '#fff',
            cursor: saving || !manualNodeId.trim() ? 'default' : 'pointer',
            opacity: saving || !manualNodeId.trim() ? 0.5 : 1,
            fontFamily: 'inherit',
          }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          placeholder="Search frames by name, node_id, or section..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', fontSize: 12, padding: '6px 10px', border: '1px solid #e5e7eb',
            borderRadius: 4, fontFamily: 'inherit',
          }}
        />
        <div style={{ fontSize: 10, color: '#a1a1aa', marginTop: 2 }}>
          {totalFrames} frames in Figma file{candidates.length < totalFrames ? ` / ${candidates.length} matching` : ''}
        </div>
      </div>

      {/* Candidate groups */}
      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
          Loading candidates...
        </div>
      ) : (
        <>
          {recommended.length > 0 && (
            <CandidateGroup
              title="Recommended"
              color="#16a34a"
              candidates={recommended}
              onSelect={handleSave}
              saving={saving}
            />
          )}
          {similar.length > 0 && (
            <CandidateGroup
              title="Similar"
              color="#ca8a04"
              candidates={similar}
              onSelect={handleSave}
              saving={saving}
            />
          )}
          {other.length > 0 && (
            <CandidateGroup
              title="All Frames"
              color="#6b7280"
              candidates={other}
              onSelect={handleSave}
              saving={saving}
              defaultCollapsed
            />
          )}
          {candidates.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>
              No Figma frames found. Ensure figma_tree.json exists in storage/.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CandidateGroup({
  title,
  color,
  candidates,
  onSelect,
  saving,
  defaultCollapsed = false,
}: {
  title: string;
  color: string;
  candidates: FigmaCandidate[];
  onSelect: (nodeId: string) => void;
  saving: boolean;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0',
          background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 12, fontWeight: 600, color,
        }}
      >
        <span style={{ fontSize: 10 }}>{collapsed ? '\u25B6' : '\u25BC'}</span>
        {title} ({candidates.length})
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          {candidates.map(c => (
            <CandidateRow key={c.node_id} candidate={c} onSelect={onSelect} saving={saving} />
          ))}
        </div>
      )}
    </div>
  );
}

const REASON_COLORS: Record<string, string> = {
  visual: '#7c3aed',
  lexical: '#2563eb',
  context: '#059669',
  hybrid: '#d97706',
};

const CONFIDENCE_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  high: { bg: '#f0fdf4', fg: '#166534', border: '#bbf7d0' },
  medium: { bg: '#fffbeb', fg: '#92400e', border: '#fde68a' },
  low: { bg: '#fff', fg: '#9ca3af', border: '#e5e7eb' },
};

function CandidateRow({
  candidate,
  onSelect,
  saving,
}: {
  candidate: FigmaCandidate;
  onSelect: (nodeId: string) => void;
  saving: boolean;
}) {
  const c = candidate;
  const conf = CONFIDENCE_COLORS[c.match_confidence] || CONFIDENCE_COLORS.low;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', borderRadius: 6,
        border: `1px solid ${c.already_mapped ? '#e5e7eb' : conf.border}`,
        background: c.already_mapped ? '#fafafa' : conf.bg,
        fontSize: 12,
        opacity: c.already_mapped ? 0.6 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>{c.name}</span>
          {c.already_mapped && (
            <span style={{
              fontSize: 9, padding: '1px 5px', borderRadius: 3,
              background: '#e5e7eb', color: '#6b7280', fontWeight: 600,
            }}>
              MAPPED
            </span>
          )}
          {/* Reason tags */}
          {c.match_reasons && c.match_reasons.filter(r => r !== 'hybrid').map(r => (
            <span key={r} style={{
              fontSize: 9, padding: '1px 5px', borderRadius: 3,
              background: `${REASON_COLORS[r] || '#6b7280'}18`,
              color: REASON_COLORS[r] || '#6b7280',
              fontWeight: 600,
            }}>
              {r}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
          <code>{c.node_id}</code>
          {' '}&middot;{' '}{c.width}x{c.height}
          {c.section_name && <>{' '}&middot;{' '}{c.section_name}</>}
          {c.page_name && <>{' '}&middot;{' '}{c.page_name}</>}
        </div>
        {/* Score breakdown */}
        <div style={{ fontSize: 10, color: '#a1a1aa', marginTop: 2, display: 'flex', gap: 8, fontFamily: 'monospace' }}>
          <span>final:{(c.final_score * 100).toFixed(0)}</span>
          {c.raw_visual_score != null && <span style={{ color: '#7c3aed' }}>vis:{(c.raw_visual_score * 100).toFixed(0)}</span>}
          <span style={{ color: '#2563eb' }}>lex:{(c.lexical_score * 100).toFixed(0)}</span>
          <span style={{ color: '#059669' }}>ctx:{(c.context_score * 100).toFixed(0)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 10, fontFamily: 'monospace', fontWeight: 600,
          color: c.match_confidence === 'high' ? '#166534' : c.match_confidence === 'medium' ? '#92400e' : '#9ca3af',
        }}>
          {(c.final_score * 100).toFixed(0)}%
        </span>
        <button
          onClick={() => onSelect(c.node_id)}
          disabled={saving}
          style={{
            padding: '3px 10px', fontSize: 11, fontWeight: 600,
            border: 'none', borderRadius: 4,
            background: c.already_mapped ? '#e5e7eb' : c.match_confidence === 'high' ? '#16a34a' : '#2563eb',
            color: c.already_mapped ? '#6b7280' : '#fff',
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.5 : 1,
            fontFamily: 'inherit',
          }}
        >
          Select
        </button>
      </div>
    </div>
  );
}

// ── Data fetching hooks ──────────────────────────────────

function useRuns() {
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reviewer/runs')
      .then(r => r.json())
      .then(d => setRuns(d.runs || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { runs, loading };
}

function useRunData(runId: string | null) {
  const [data, setData] = useState<ReviewerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    const url = `/api/reviewer/data?run=${encodeURIComponent(runId)}`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [runId]);

  return { data, error, loading };
}

function useFlowGraphs() {
  const [flows, setFlows] = useState<FlowGraph[]>([]);

  useEffect(() => {
    fetch('/api/reviewer/flows')
      .then(r => r.json())
      .then(d => setFlows(d.flows || []))
      .catch(() => {});
  }, []);

  return flows;
}

function useSparklineData(runs: RunEntry[]) {
  const [sparklines, setSparklines] = useState<Map<string, (number | null)[]>>(new Map());

  useEffect(() => {
    if (runs.length < 2) return;

    const recentRuns = runs.slice(0, 10).reverse();

    Promise.all(
      recentRuns.map(r =>
        fetch(`/api/reviewer/data?run=${encodeURIComponent(r.run_id)}`)
          .then(res => res.json())
          .then(d => ({ runId: r.run_id, screens: (d.screens || []) as ScreenData[] }))
          .catch(() => ({ runId: r.run_id, screens: [] as ScreenData[] }))
      )
    ).then(results => {
      const map = new Map<string, (number | null)[]>();
      const allScreenIds = new Set<string>();
      results.forEach(r => r.screens.forEach(s => allScreenIds.add(s.screen_id)));

      allScreenIds.forEach(sid => {
        const values = results.map(r => {
          const screen = r.screens.find(s => s.screen_id === sid);
          return screen?.mismatch_percent ?? null;
        });
        map.set(sid, values);
      });

      setSparklines(map);
    });
  }, [runs]);

  return sparklines;
}

// ── Main Page ────────────────────────────────────────────

export default function ReviewerPage() {
  const { runs, loading: runsLoading } = useRuns();
  const flowGraphs = useFlowGraphs();

  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [baselineRunId, setBaselineRunId] = useState<string | null>(null);

  useEffect(() => {
    if (runs.length > 0 && !currentRunId) {
      setCurrentRunId(runs[0].run_id);
      if (runs.length > 1) setBaselineRunId(runs[1].run_id);
      else setBaselineRunId(runs[0].run_id);
    }
  }, [runs, currentRunId]);

  const { data: currentData, error: currentError, loading: currentLoading } = useRunData(currentRunId);
  const { data: baselineData } = useRunData(baselineRunId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterFlow, setFilterFlow] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [mappingScreenId, setMappingScreenId] = useState<string | null>(null);

  const sparklines = useSparklineData(runs);

  // Screen lookup map
  const screenMap = useMemo(() => {
    const map = new Map<string, ScreenData>();
    currentData?.screens.forEach(s => map.set(s.screen_id, s));
    return map;
  }, [currentData]);

  // Build comparison map
  const comparisons = useMemo(() => {
    const map = new Map<string, ScreenComparison>();
    if (!currentData || !baselineData || currentRunId === baselineRunId) return map;

    const baselineMap = new Map<string, ScreenData>();
    baselineData.screens.forEach(s => baselineMap.set(s.screen_id, s));

    currentData.screens.forEach(s => {
      const baseline = baselineMap.get(s.screen_id);
      const label = classifyScreen(s, baseline);
      map.set(s.screen_id, {
        screen_id: s.screen_id,
        label,
        currentMismatch: s.mismatch_percent,
        baselineMismatch: baseline?.mismatch_percent ?? null,
        delta: (s.mismatch_percent ?? 0) - (baseline?.mismatch_percent ?? 0),
      });
    });

    return map;
  }, [currentData, baselineData, currentRunId, baselineRunId]);

  // Filter function
  const filterFn = useCallback((screenId: string): boolean => {
    const s = screenMap.get(screenId);
    if (!s) return false;
    if (filterFlow !== 'all' && s.flow_id !== filterFlow) return false;
    if (filterStatus === 'failed') return s.diff_status === 'fail' || s.diff_status === 'error';
    if (filterStatus === 'unconfigured') return s.readiness === 'unconfigured';
    if (filterStatus === 'pass') return s.diff_status === 'pass';
    if (filterStatus === 'regression') return comparisons.get(s.screen_id)?.label === 'REGRESSION';
    if (filterStatus === 'improved') return comparisons.get(s.screen_id)?.label === 'IMPROVED';
    return true;
  }, [screenMap, filterFlow, filterStatus, comparisons]);

  const filteredScreens = currentData?.screens.filter(s => filterFn(s.screen_id)) ?? [];

  // Filter flows for graph view
  const visibleFlows = useMemo(() => {
    if (filterFlow === 'all') return flowGraphs;
    return flowGraphs.filter(f => f.flow_id === filterFlow);
  }, [flowGraphs, filterFlow]);

  const selected = currentData?.screens.find(s => s.screen_id === selectedId) ?? null;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!filteredScreens.length) return;
    const idx = filteredScreens.findIndex(s => s.screen_id === selectedId);
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      const next = idx < filteredScreens.length - 1 ? idx + 1 : 0;
      setSelectedId(filteredScreens[next].screen_id);
    }
    if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      const prev = idx > 0 ? idx - 1 : filteredScreens.length - 1;
      setSelectedId(filteredScreens[prev].screen_id);
    }
  }, [filteredScreens, selectedId]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (currentError) {
    return (
      <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ color: '#dc2626' }}>Error</h1>
        <pre style={{ marginTop: 8, background: '#fef2f2', padding: 16, borderRadius: 8 }}>{currentError}</pre>
      </div>
    );
  }

  if (runsLoading || currentLoading || !currentData) {
    return (
      <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif', color: '#6b7280' }}>
        Loading reviewer data...
      </div>
    );
  }

  const run = currentData.run;
  const summary = run?.summary;
  const cov = run?.coverage;
  const hasComparison = currentRunId !== baselineRunId && comparisons.size > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: '#111', background: '#fafafa' }}>
      {/* Top bar */}
      <header style={{ padding: '12px 20px', borderBottom: '1px solid #e5e7eb', background: '#fff', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>FlowCanvas Reviewer</span>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>v0.4</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* View toggle */}
            <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
              <button
                onClick={() => setViewMode('graph')}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  border: 'none',
                  background: viewMode === 'graph' ? '#2563eb' : '#fff',
                  color: viewMode === 'graph' ? '#fff' : '#6b7280',
                  fontWeight: viewMode === 'graph' ? 600 : 400,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Graph
              </button>
              <button
                onClick={() => setViewMode('list')}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  border: 'none',
                  borderLeft: '1px solid #e5e7eb',
                  background: viewMode === 'list' ? '#2563eb' : '#fff',
                  color: viewMode === 'list' ? '#fff' : '#6b7280',
                  fontWeight: viewMode === 'list' ? 600 : 400,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                List
              </button>
            </div>
            {run && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: '#6b7280' }}>
                <span>Branch: <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{run.git_branch}</code></span>
                <span>Commit: <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{run.git_commit}</code></span>
                <span>{formatTime(run.started_at)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Run selector */}
        {runs.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <RunSelector
              runs={runs}
              currentRunId={currentRunId || ''}
              baselineRunId={baselineRunId || ''}
              onCurrentChange={setCurrentRunId}
              onBaselineChange={setBaselineRunId}
            />
          </div>
        )}

        {/* Regression summary panel */}
        {hasComparison && (
          <div style={{ marginTop: 10 }}>
            <RegressionSummary comparisons={comparisons} onFilter={setFilterStatus} />
          </div>
        )}

        {/* Summary stats + filters */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
            {summary && (
              <>
                <Stat label="Passed" value={summary.passed} color="#16a34a" />
                <Stat label="Failed" value={summary.failed} color="#dc2626" />
                <Stat label="Skipped" value={summary.skipped} color="#ca8a04" />
                <Stat label="Errors" value={summary.errored} color="#ea580c" />
              </>
            )}
            {cov && (
              <>
                <div style={{ borderLeft: '1px solid #e5e7eb', height: 20 }} />
                <Stat label="Ready" value={cov.ready} color="#16a34a" />
                <Stat label="Unconfigured" value={cov.unconfigured} color="#a1a1aa" />
                <Stat label="Disabled" value={cov.disabled} color="#d4d4d8" />
              </>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <FilterButton label="All" active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} />
            <FilterButton label="Failed" active={filterStatus === 'failed'} onClick={() => setFilterStatus('failed')} />
            <FilterButton label="Passing" active={filterStatus === 'pass'} onClick={() => setFilterStatus('pass')} />
            {hasComparison && (
              <>
                <FilterButton label="Regressions" active={filterStatus === 'regression'} onClick={() => setFilterStatus('regression')} />
                <FilterButton label="Improved" active={filterStatus === 'improved'} onClick={() => setFilterStatus('improved')} />
              </>
            )}
            <FilterButton label="Unconfigured" active={filterStatus === 'unconfigured'} onClick={() => setFilterStatus('unconfigured')} />
            <select
              value={filterFlow}
              onChange={e => setFilterFlow(e.target.value)}
              style={{
                fontSize: 12,
                padding: '4px 8px',
                border: '1px solid #e5e7eb',
                borderRadius: 4,
                background: '#fff',
                fontFamily: 'inherit',
              }}
            >
              <option value="all">All flows</option>
              {currentData.flows.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>

        {/* Regression alert */}
        {currentData.regression?.has_unexpected_regressions && (
          <div style={{
            marginTop: 8,
            padding: '6px 12px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            fontSize: 12,
            color: '#991b1b',
            fontWeight: 500,
          }}>
            {currentData.regression.regressions.filter((r: any) => !r.is_expected_drift).length} unexpected regression(s) detected vs baseline {currentData.regression.baseline_run_id}
          </div>
        )}
      </header>

      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left panel: graph or list */}
        {viewMode === 'graph' ? (
          <div style={{
            flex: selected ? '0 0 55%' : '1',
            overflow: 'auto',
            padding: 20,
            background: '#fafafa',
          }}>
            <EdgeLegend />
            {visibleFlows.map(flow => (
              <FlowGraphSVG
                key={flow.flow_id}
                graph={flow}
                screenMap={screenMap}
                comparisons={comparisons}
                selectedId={selectedId}
                onSelect={setSelectedId}
                filterFn={filterFn}
              />
            ))}
            {visibleFlows.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>
                No flows match the selected filter
              </div>
            )}
          </div>
        ) : (
          <div style={{
            width: 380,
            flexShrink: 0,
            borderRight: '1px solid #e5e7eb',
            overflow: 'auto',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: '#fff',
          }}>
            <div style={{ fontSize: 11, color: '#9ca3af', padding: '0 4px 4px', fontWeight: 500 }}>
              {filteredScreens.length} screen{filteredScreens.length !== 1 ? 's' : ''}
              <span style={{ float: 'right', color: '#d4d4d8' }}>j/k to navigate</span>
            </div>
            {filteredScreens.map(s => (
              <ScreenCard
                key={s.screen_id}
                screen={s}
                isSelected={selectedId === s.screen_id}
                onClick={() => setSelectedId(s.screen_id)}
                regressionLabel={comparisons.get(s.screen_id)?.label}
                sparklineValues={sparklines.get(s.screen_id)}
              />
            ))}
            {filteredScreens.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>
                No screens match filters
              </div>
            )}
          </div>
        )}

        {/* Inspector / Mapping Assistant */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20, minWidth: 0 }}>
          {mappingScreenId && screenMap.get(mappingScreenId) ? (
            <MappingAssistant
              screen={screenMap.get(mappingScreenId)!}
              onSaved={() => {
                // Reload data after save
                setMappingScreenId(null);
                setCurrentRunId(prev => prev); // trigger refresh
              }}
              onClose={() => setMappingScreenId(null)}
            />
          ) : selected ? (
            <>
              <Inspector
                screen={selected}
                runId={run?.run_id}
                comparison={comparisons.get(selected.screen_id)}
              />
              {/* Map Figma button for unconfigured screens */}
              {selected.readiness === 'unconfigured' && (
                <div style={{ marginTop: 16, padding: '12px 16px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0369a1' }}>This screen needs a Figma mapping</div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                        Use the Mapping Assistant to connect this screen to a Figma frame.
                      </div>
                    </div>
                    <button
                      onClick={() => setMappingScreenId(selected.screen_id)}
                      style={{
                        padding: '6px 16px', fontSize: 12, fontWeight: 600,
                        border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff',
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      Map Figma Frame
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#a1a1aa',
              fontSize: 14,
            }}>
              {viewMode === 'graph' ? 'Click a node to inspect' : 'Select a screen to inspect'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontWeight: 700, color }}>{value}</span>
      <span style={{ color: '#9ca3af' }}>{label}</span>
    </span>
  );
}

function FilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12,
        padding: '4px 12px',
        border: active ? '1px solid #2563eb' : '1px solid #e5e7eb',
        borderRadius: 4,
        background: active ? '#eff6ff' : '#fff',
        color: active ? '#2563eb' : '#6b7280',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}
