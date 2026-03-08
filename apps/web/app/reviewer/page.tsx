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

  // PASS -> FAIL = REGRESSION
  if (baseStatus === 'pass' && curStatus === 'fail') return 'REGRESSION';
  // FAIL -> PASS = IMPROVED
  if (baseStatus === 'fail' && curStatus === 'pass') return 'IMPROVED';

  const curMismatch = currentScreen.mismatch_percent ?? 0;
  const baseMismatch = baselineScreen.mismatch_percent ?? 0;
  const delta = curMismatch - baseMismatch;

  // Mismatch increase > 0.5pp = REGRESSION
  if (delta > 0.5) return 'REGRESSION';
  // Mismatch decrease > 0.5pp = IMPROVED
  if (delta < -0.5) return 'IMPROVED';

  return 'UNCHANGED';
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
      {/* Last point dot */}
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
      {/* Header */}
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

      {/* Comparison delta */}
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

      {/* Metrics bar */}
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

      {/* Thresholds */}
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

      {/* Failure reasons */}
      {screen.failure_reasons.length > 0 && (
        <div style={{ padding: '8px 12px', background: '#fef2f2', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Failure reasons</div>
          {screen.failure_reasons.map((f, i) => <div key={i}>{f}</div>)}
        </div>
      )}

      {/* Drift / Notes */}
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

      {/* Masks */}
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

      {/* Warnings */}
      {screen.warnings.length > 0 && (
        <div style={{ padding: '8px 12px', background: '#fffbeb', borderRadius: 6, fontSize: 12, color: '#92400e' }}>
          {screen.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      {/* Tags */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {screen.tags.map(t => (
          <span key={t} style={{ padding: '1px 8px', background: '#f3f4f6', borderRadius: 9999, fontSize: 11, color: '#6b7280' }}>{t}</span>
        ))}
      </div>

      {/* Images */}
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
    const url = runId ? `/api/reviewer/data?run=${encodeURIComponent(runId)}` : '/api/reviewer/data';
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

// ── Sparkline data: collect mismatch values across runs ──

function useSparklineData(runs: RunEntry[]) {
  const [sparklines, setSparklines] = useState<Map<string, (number | null)[]>>(new Map());

  useEffect(() => {
    if (runs.length < 2) return;

    // Take last 10 runs (chronological order, oldest first)
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
      // Collect all screen IDs
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

  // Default: current = latest, baseline = previous
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

  const sparklines = useSparklineData(runs);

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

  const filteredScreens = currentData?.screens.filter(s => {
    if (filterFlow !== 'all' && s.flow_id !== filterFlow) return false;
    if (filterStatus === 'failed') return s.diff_status === 'fail' || s.diff_status === 'error';
    if (filterStatus === 'unconfigured') return s.readiness === 'unconfigured';
    if (filterStatus === 'pass') return s.diff_status === 'pass';
    if (filterStatus === 'regression') return comparisons.get(s.screen_id)?.label === 'REGRESSION';
    if (filterStatus === 'improved') return comparisons.get(s.screen_id)?.label === 'IMPROVED';
    return true;
  }) ?? [];

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
            <span style={{ fontSize: 11, color: '#9ca3af' }}>v0.2</span>
          </div>
          {run && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: '#6b7280' }}>
              <span>Branch: <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{run.git_branch}</code></span>
              <span>Commit: <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{run.git_commit}</code></span>
              <span>{formatTime(run.started_at)}</span>
            </div>
          )}
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

      {/* Main content: list + inspector */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Screen list */}
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

        {/* Inspector */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {selected ? (
            <Inspector
              screen={selected}
              runId={run?.run_id}
              comparison={comparisons.get(selected.screen_id)}
            />
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#a1a1aa',
              fontSize: 14,
            }}>
              Select a screen to inspect
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
