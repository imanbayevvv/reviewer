/**
 * Static HTML report generator for diff results.
 *
 * Produces a self-contained HTML file with embedded base64 images.
 * Opens locally, no server needed. Suitable as CI artifact.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RUNS_STORAGE } from './config.js';
import type { DiffManifest, ScreenDiffResult } from './diff-engine.js';
import { ensureDir } from './utils.js';

function imgToBase64(filePath: string | null): string | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const data = fs.readFileSync(filePath);
  return `data:image/png;base64,${data.toString('base64')}`;
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    pass: '#22c55e',
    fail: '#ef4444',
    skipped: '#eab308',
    error: '#f97316',
  };
  const bg = colors[status] ?? '#6b7280';
  return `<span style="display:inline-block;padding:2px 10px;border-radius:4px;background:${bg};color:#fff;font-size:12px;font-weight:600;text-transform:uppercase">${status}</span>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function screenCard(r: ScreenDiffResult): string {
  const figmaB64 = imgToBase64(r.figma_artifact);
  const runtimeB64 = imgToBase64(r.runtime_artifact);
  const diffB64 = imgToBase64(r.diff_artifact);
  const overlayB64 = imgToBase64(r.overlay_artifact);

  const pct = r.metrics ? `${r.metrics.mismatch_percent.toFixed(4)}%` : 'n/a';
  const sim = r.metrics ? r.metrics.similarity.toFixed(4) : 'n/a';
  const masked = r.metrics ? `${(r.metrics.masked_ratio * 100).toFixed(1)}%` : 'n/a';

  const imgs = [figmaB64, runtimeB64, diffB64, overlayB64]
    .filter(Boolean)
    .map((b64, i) => {
      const label = ['Figma', 'Runtime', 'Diff', 'Overlay'][i];
      return `<div style="flex:1;min-width:200px">
        <div style="font-size:11px;color:#666;margin-bottom:4px">${label}</div>
        <img src="${b64}" style="width:100%;border:1px solid #e5e7eb;border-radius:4px" loading="lazy"/>
      </div>`;
    });

  const failReasons = r.failure_reasons.length > 0
    ? `<div style="margin-top:8px;padding:8px;background:#fef2f2;border-radius:4px;font-size:12px;color:#991b1b">
        ${r.failure_reasons.map((f) => `<div>${escHtml(f)}</div>`).join('')}
      </div>`
    : '';

  const warningsList = r.warnings.length > 0
    ? `<div style="margin-top:8px;padding:8px;background:#fffbeb;border-radius:4px;font-size:12px;color:#92400e">
        ${r.warnings.map((w) => `<div>${escHtml(w)}</div>`).join('')}
      </div>`
    : '';

  const masksInfo = r.masks_applied.length > 0
    ? `<div style="margin-top:4px;font-size:11px;color:#6b7280">
        Masks: ${r.masks_applied.map((m) => `<code>${escHtml(m.selector)}</code> (${m.pixels_masked}px, ${m.source})`).join(', ')}
      </div>`
    : '';

  const thresholdInfo = r.threshold_eval
    ? `<div style="margin-top:4px;font-size:11px;color:#6b7280">
        Thresholds: pixel_diff ${r.threshold_eval.pixel_diff_percent.passed ? 'PASS' : 'FAIL'} (${r.threshold_eval.pixel_diff_percent.actual.toFixed(4)}% / ${r.threshold_eval.pixel_diff_percent.threshold}%), similarity ${r.threshold_eval.structural_similarity.passed ? 'PASS' : 'FAIL'} (${r.threshold_eval.structural_similarity.actual.toFixed(4)} / ${r.threshold_eval.structural_similarity.threshold})
      </div>`
    : '';

  return `
  <div id="${r.screen_id}" style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px;${r.status === 'fail' ? 'border-left:4px solid #ef4444' : ''}">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      ${statusBadge(r.status)}
      <span style="font-weight:600;font-size:14px">${escHtml(r.screen_id)}</span>
      <span style="font-size:12px;color:#6b7280">mismatch: ${pct} | similarity: ${sim} | masked: ${masked} | ${r.timing.duration_ms}ms</span>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${imgs.join('\n')}
    </div>
    ${failReasons}
    ${warningsList}
    ${masksInfo}
    ${thresholdInfo}
  </div>`;
}

export function generateReport(manifest: DiffManifest): string {
  const { summary } = manifest;
  const total = manifest.total_screens;
  const passRate = total > 0 ? ((summary.passed / total) * 100).toFixed(1) : '0';

  // Sort: fail first, then error, then pass, then skipped
  const sortOrder: Record<string, number> = { fail: 0, error: 1, pass: 2, skipped: 3 };
  const sorted = [...manifest.screens].sort(
    (a, b) => (sortOrder[a.status] ?? 4) - (sortOrder[b.status] ?? 4),
  );

  const worstList = manifest.worst_screens
    .map((w) => `<li><a href="#${w.screen_id}" style="color:#2563eb">${escHtml(w.screen_id)}</a> — ${w.mismatch_percent.toFixed(4)}%</li>`)
    .join('');

  const screenCards = sorted.map(screenCard).join('\n');

  const tocItems = sorted
    .map((r) => {
      const color = r.status === 'fail' ? '#ef4444' : r.status === 'error' ? '#f97316' : r.status === 'pass' ? '#22c55e' : '#eab308';
      return `<a href="#${r.screen_id}" style="display:block;padding:4px 8px;font-size:12px;color:${color};text-decoration:none;border-radius:4px" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='transparent'">${escHtml(r.screen_id)}</a>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual Diff Report — ${manifest.run_id}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111; background: #fafafa; }
  code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
</style>
</head>
<body>
<div style="max-width:1400px;margin:0 auto;padding:24px">

  <!-- Header -->
  <div style="margin-bottom:24px">
    <h1 style="font-size:24px;font-weight:700">Visual Diff Report</h1>
    <div style="font-size:13px;color:#6b7280;margin-top:4px">
      Run: <code>${escHtml(manifest.run_id)}</code> |
      Branch: <code>${escHtml(manifest.git_branch)}</code> |
      Commit: <code>${escHtml(manifest.git_commit)}</code> |
      ${escHtml(manifest.started_at)}
    </div>
  </div>

  <!-- Summary -->
  <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
    <div style="flex:1;min-width:120px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:700">${total}</div>
      <div style="font-size:12px;color:#6b7280">Total</div>
    </div>
    <div style="flex:1;min-width:120px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:700;color:#16a34a">${summary.passed}</div>
      <div style="font-size:12px;color:#6b7280">Passed</div>
    </div>
    <div style="flex:1;min-width:120px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:700;color:#dc2626">${summary.failed}</div>
      <div style="font-size:12px;color:#6b7280">Failed</div>
    </div>
    <div style="flex:1;min-width:120px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:700;color:#ca8a04">${summary.skipped}</div>
      <div style="font-size:12px;color:#6b7280">Skipped</div>
    </div>
    <div style="flex:1;min-width:120px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:700;color:#ea580c">${summary.errored}</div>
      <div style="font-size:12px;color:#6b7280">Errors</div>
    </div>
    <div style="flex:1;min-width:120px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:700">${passRate}%</div>
      <div style="font-size:12px;color:#6b7280">Pass Rate</div>
    </div>
  </div>

  <div style="display:flex;gap:24px">
    <!-- TOC sidebar -->
    <div style="width:260px;flex-shrink:0;position:sticky;top:24px;align-self:flex-start;max-height:calc(100vh - 48px);overflow-y:auto">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:#374151">Screens</div>
      ${tocItems}
      ${worstList ? `<div style="margin-top:16px;font-size:13px;font-weight:600;color:#374151">Worst Mismatch</div><ol style="margin-top:4px;padding-left:16px;font-size:12px">${worstList}</ol>` : ''}
    </div>

    <!-- Screen cards -->
    <div style="flex:1;min-width:0">
      ${screenCards}
    </div>
  </div>

</div>
</body>
</html>`;
}

export function saveReport(html: string, runId: string): string {
  const dir = path.join(RUNS_STORAGE, runId);
  ensureDir(dir);
  const filePath = path.join(dir, 'report.html');
  fs.writeFileSync(filePath, html);
  return filePath;
}
