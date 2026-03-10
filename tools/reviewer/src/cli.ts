import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { loadScreens, filterScreens, isScreenReady, getScreenReadiness, getRegistryCoverage, type RegistryCoverage } from './registry.js';
import { fetchAllFigmaScreens, type FigmaFetchResult } from './figma-fetcher.js';
import { captureAllScreens, type RuntimeCaptureResult } from './runtime-runner.js';
import { buildManifest, saveManifest } from './manifest.js';
import { diffAllScreens, buildDiffManifest, saveDiffManifest } from './diff-engine.js';
import { generateReport, saveReport } from './report-html.js';
import { generateRunId, isoNow, getGitCommit, getGitBranch } from './utils.js';
import { RUNS_STORAGE, STORAGE_DIR } from './config.js';
import { findLatestManifest, loadManifest, detectRegressions, saveRegressionReport } from './regression.js';
import { loadProjectConfig, activateProject, hasProjectsDir } from './project-config.js';
import {
  approveRun,
  hasApprovedBaseline,
  loadBaselineManifest,
  loadBaselineDiffManifest,
  getBaselineDir,
} from './baseline.js';
import { runPRCommentCLI } from './pr-comment.js';
import { embedAllFigmaFrames, embedRuntimeScreen, EMBEDDINGS_DIR } from './visual-embedding.js';
import { runEvaluation } from './evaluate-mapping.js';
import { getChangedFiles, getAffectedScreens, logPRImpact } from './pr-impact.js';

// ── Shared options ───────────────────────────────────────

interface FilterOpts {
  screen?: string;
  flow?: string;
  tag?: string;
  force?: boolean;
  all?: boolean;
  failOnRegression?: boolean;
}

function addFilterOptions(cmd: Command): Command {
  return cmd
    .option('--screen <screen_id>', 'Run only a specific screen')
    .option('--flow <flow_id>', 'Run only screens in a specific flow')
    .option('--tag <tag>', 'Run only screens with a specific tag')
    .option('--force', 'Force refresh (skip cache)', false)
    .option('--all', 'Include unconfigured/disabled screens (default: ready-only)', false);
}

function getFilteredScreens(opts: FilterOpts): { screens: ReturnType<typeof loadScreens>; coverage: RegistryCoverage } {
  const all = loadScreens();
  const filtered = filterScreens(all, {
    screenId: opts.screen,
    flowId: opts.flow,
    tag: opts.tag,
  });
  const coverage = getRegistryCoverage(filtered);

  // Default: ready-only. --all includes everything.
  // Exception: --screen targets a specific screen, always include it.
  const screens = (opts.all || opts.screen)
    ? filtered
    : filtered.filter(isScreenReady);

  return { screens, coverage };
}

function printCoverage(coverage: RegistryCoverage, processedCount: number) {
  console.log(`[registry] ${coverage.ready} ready / ${coverage.unconfigured} unconfigured / ${coverage.disabled} disabled (${coverage.total} total)`);
  if (processedCount < coverage.total) {
    console.log(`[registry] Processing ${processedCount} ready screens`);
  }
  if (coverage.unconfigured > 0 && processedCount === coverage.ready) {
    console.log(`[registry] Unconfigured: ${coverage.unconfigured_ids.join(', ')}`);
  }
}

function printCaptureSummary(
  figmaResults: FigmaFetchResult[],
  runtimeResults: RuntimeCaptureResult[],
) {
  console.log('\n' + '='.repeat(70));
  console.log('CAPTURE SUMMARY');
  console.log('='.repeat(70));

  if (figmaResults.length > 0) {
    const s = figmaResults.filter((r) => r.status === 'success').length;
    const sk = figmaResults.filter((r) => r.status.startsWith('skipped')).length;
    const f = figmaResults.filter((r) => r.status.startsWith('failed')).length;
    console.log(`Figma:   ${s} success, ${sk} skipped, ${f} failed (${figmaResults.length} total)`);
  }

  if (runtimeResults.length > 0) {
    const s = runtimeResults.filter((r) => r.status === 'success').length;
    const sk = runtimeResults.filter((r) => r.status.startsWith('skipped')).length;
    const f = runtimeResults.filter((r) => r.status.startsWith('failed')).length;
    console.log(`Runtime: ${s} success, ${sk} skipped, ${f} failed (${runtimeResults.length} total)`);
  }

  console.log('='.repeat(70));
}

function printDiffSummary(manifest: ReturnType<typeof buildDiffManifest>) {
  const { summary, worst_screens } = manifest;
  console.log('\n' + '='.repeat(70));
  console.log('DIFF SUMMARY');
  console.log('='.repeat(70));
  console.log(`Passed:  ${summary.passed}`);
  console.log(`Failed:  ${summary.failed}`);
  console.log(`Skipped: ${summary.skipped}`);
  console.log(`Errors:  ${summary.errored}`);
  console.log(`Total:   ${manifest.total_screens}`);

  if (worst_screens.length > 0) {
    console.log('\nWorst mismatch:');
    for (const w of worst_screens) {
      console.log(`  ${w.screen_id.padEnd(40)} ${w.mismatch_percent.toFixed(4)}%`);
    }
  }

  console.log('='.repeat(70));
}

// ── Commands ─────────────────────────────────────────────

const program = new Command()
  .name('reviewer')
  .description('Visual review pipeline for Resale platform')
  .version('0.2.0')
  .option('--project <projectId>', 'Project to run against (must exist in projects/<projectId>/)');

// ── Multi-project: resolve + activate config before any command runs ─────────
program.hook('preAction', async () => {
  const projectId: string | undefined = program.opts().project;
  if (!projectId) return; // no --project → backward-compat single-project mode

  const cfg = await loadProjectConfig(projectId);
  activateProject(cfg);
});

// reviewer figma
const figmaCmd = new Command('figma')
  .description('Fetch Figma baseline screenshots')
  .action(async (opts: FilterOpts) => {
    const { screens, coverage } = getFilteredScreens(opts);
    console.log('');
    printCoverage(coverage, screens.length);
    console.log(`\nFigma fetch: ${screens.length} targets\n`);

    const runId = generateRunId();
    const startedAt = isoNow();
    const results = await fetchAllFigmaScreens(screens, { force: opts.force });

    const manifest = buildManifest({
      runId,
      startedAt,
      mode: 'figma',
      filters: { screen_id: opts.screen, flow_id: opts.flow, tag: opts.tag },
      screenIds: screens.map((s) => s.screen_id),
      figmaResults: results,
      runtimeResults: [],
    });

    const manifestPath = saveManifest(manifest);
    printCaptureSummary(results, []);
    console.log(`\nManifest: ${manifestPath}`);
  });
addFilterOptions(figmaCmd);
program.addCommand(figmaCmd);

// reviewer runtime
const runtimeCmd = new Command('runtime')
  .description('Capture runtime screenshots via Playwright')
  .action(async (opts: FilterOpts) => {
    const { screens, coverage } = getFilteredScreens(opts);
    console.log('');
    printCoverage(coverage, screens.length);
    console.log(`\nRuntime capture: ${screens.length} targets\n`);

    const runId = generateRunId();
    const startedAt = isoNow();
    const results = await captureAllScreens(screens);

    const manifest = buildManifest({
      runId,
      startedAt,
      mode: 'runtime',
      filters: { screen_id: opts.screen, flow_id: opts.flow, tag: opts.tag },
      screenIds: screens.map((s) => s.screen_id),
      figmaResults: [],
      runtimeResults: results,
    });

    const manifestPath = saveManifest(manifest);
    printCaptureSummary([], results);
    console.log(`\nManifest: ${manifestPath}`);
  });
addFilterOptions(runtimeCmd);
program.addCommand(runtimeCmd);

// reviewer diff — compare existing figma + runtime artifacts
const diffCmd = new Command('diff')
  .description('Run visual diff on existing figma/runtime artifacts')
  .action(async (opts: FilterOpts) => {
    const { screens, coverage } = getFilteredScreens(opts);
    console.log('');
    printCoverage(coverage, screens.length);
    console.log(`\nDiff: ${screens.length} targets\n`);

    const runId = generateRunId();
    const startedAt = isoNow();

    const diffResults = diffAllScreens(screens, runId);

    const diffManifest = buildDiffManifest(
      runId,
      'existing-artifacts',
      startedAt,
      diffResults,
      getGitCommit(),
      getGitBranch(),
      coverage,
    );
    const manifestPath = saveDiffManifest(diffManifest);

    const html = generateReport(diffManifest);
    const reportPath = saveReport(html, runId);

    printDiffSummary(diffManifest);
    console.log(`\nDiff manifest: ${manifestPath}`);
    console.log(`HTML report:   ${reportPath}`);
  });
addFilterOptions(diffCmd);
program.addCommand(diffCmd);

// reviewer report — regenerate HTML report from existing diff manifest
const reportCmd = new Command('report')
  .description('Regenerate HTML report from a diff-manifest.json')
  .requiredOption('--run <run_id>', 'Run ID to generate report for')
  .action((opts: { run: string }) => {
    const manifestPath = path.join(RUNS_STORAGE, opts.run, 'diff-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      console.error(`Diff manifest not found: ${manifestPath}`);
      process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const html = generateReport(manifest);
    const reportPath = saveReport(html, opts.run);
    console.log(`HTML report: ${reportPath}`);
  });
program.addCommand(reportCmd);

// reviewer run (capture only — existing behavior)
const runCmd = new Command('run')
  .description('Run capture pipeline: Figma fetch + runtime capture')
  .action(async (opts: FilterOpts) => {
    const { screens, coverage } = getFilteredScreens(opts);
    console.log('');
    printCoverage(coverage, screens.length);
    console.log(`\nCapture run: ${screens.length} targets\n`);

    const runId = generateRunId();
    const startedAt = isoNow();

    console.log('--- Phase 1: Figma Fetch ---');
    const figmaResults = await fetchAllFigmaScreens(screens, { force: opts.force });

    console.log('\n--- Phase 2: Runtime Capture ---');
    const runtimeResults = await captureAllScreens(screens);

    const manifest = buildManifest({
      runId,
      startedAt,
      mode: 'full',
      filters: { screen_id: opts.screen, flow_id: opts.flow, tag: opts.tag },
      screenIds: screens.map((s) => s.screen_id),
      figmaResults,
      runtimeResults,
    });

    const manifestPath = saveManifest(manifest);
    printCaptureSummary(figmaResults, runtimeResults);
    console.log(`\nManifest: ${manifestPath}`);
  });
addFilterOptions(runCmd);
program.addCommand(runCmd);

// reviewer full — capture + diff + report
const fullCmd = new Command('full')
  .description('Full pipeline: Figma fetch + runtime capture + diff + HTML report')
  .action(async (opts: FilterOpts) => {
    const { screens, coverage } = getFilteredScreens(opts);
    console.log('');
    printCoverage(coverage, screens.length);
    console.log(`\nFull pipeline: ${screens.length} targets\n`);

    const runId = generateRunId();
    const startedAt = isoNow();

    console.log('--- Phase 1: Figma Fetch ---');
    const figmaResults = await fetchAllFigmaScreens(screens, { force: opts.force });

    console.log('\n--- Phase 2: Runtime Capture ---');
    const runtimeResults = await captureAllScreens(screens);

    const captureManifest = buildManifest({
      runId,
      startedAt,
      mode: 'full',
      filters: { screen_id: opts.screen, flow_id: opts.flow, tag: opts.tag },
      screenIds: screens.map((s) => s.screen_id),
      figmaResults,
      runtimeResults,
    });
    const captureManifestPath = saveManifest(captureManifest);
    printCaptureSummary(figmaResults, runtimeResults);

    // ── Phase 2b: Visual Embeddings ──
    console.log('\n--- Phase 2b: Visual Embeddings ---');
    const embFigma = embedAllFigmaFrames();
    console.log(`  Figma embeddings: ${embFigma.computed} computed, ${embFigma.cached} cached`);
    let embRuntime = 0;
    const runtimeDir = path.join(STORAGE_DIR, 'runtime');
    for (const r of runtimeResults) {
      if (r.status === 'success') {
        const pngPath = path.join(runtimeDir, r.screen_id, 'runtime.png');
        if (fs.existsSync(pngPath)) {
          try { embedRuntimeScreen(r.screen_id, pngPath); embRuntime++; } catch { /* skip */ }
        }
      }
    }
    console.log(`  Runtime embeddings: ${embRuntime} computed`);

    console.log('\n--- Phase 3: Visual Diff ---');
    const diffResults = diffAllScreens(screens, runId);

    const diffManifest = buildDiffManifest(
      runId,
      captureManifestPath,
      isoNow(),
      diffResults,
      getGitCommit(),
      getGitBranch(),
      coverage,
    );
    const diffManifestPath = saveDiffManifest(diffManifest);

    console.log('\n--- Phase 4: HTML Report ---');
    const html = generateReport(diffManifest);
    const reportPath = saveReport(html, runId);

    printDiffSummary(diffManifest);
    console.log(`\nCapture manifest: ${captureManifestPath}`);
    console.log(`Diff manifest:    ${diffManifestPath}`);
    console.log(`HTML report:      ${reportPath}`);

    // ── Phase 5: Regression Detection ──
    console.log('\n--- Phase 5: Regression Detection ---');
    const approvedBaseline = loadBaselineDiffManifest();
    const baseline = approvedBaseline ?? findLatestManifest(runId);
    if (baseline) {
      if (approvedBaseline) {
        console.log(`[regress] using approved baseline from ${getBaselineDir()}`);
      }
      console.log(`[regress] Baseline: ${baseline.run_id} (${baseline.git_commit})`);
      const regressionReport = detectRegressions(baseline, diffManifest);
      const regressionPath = saveRegressionReport(regressionReport, runId);
      console.log(regressionReport.summary_table);
      console.log(`Regression report: ${regressionPath}`);

      if (opts.failOnRegression && regressionReport.has_unexpected_regressions) {
        console.error(`\n!! ${regressionReport.unexpected_regressions.length} unexpected regression(s) — failing`);
        process.exit(1);
      }
    } else {
      console.log('[regress] No approved baseline and no previous run — skipping regression detection.');
      console.log('[regress] Tip: run "reviewer approve --latest" after a successful run to set the baseline.');
    }
  });
addFilterOptions(fullCmd);
fullCmd.option('--fail-on-regression', 'Exit with code 1 if unexpected regressions found', false);
program.addCommand(fullCmd);

// reviewer regress — compare a run against its baseline for regressions
const regressCmd = new Command('regress')
  .description('Detect regressions by comparing current run against previous baseline')
  .option('--run <run_id>', 'Current run ID to check (default: latest)')
  .option('--baseline <run_id>', 'Baseline run ID to compare against (default: second-latest)')
  .option('--fail-on-regression', 'Exit with code 1 if unexpected regressions found', false)
  .action((opts: { run?: string; baseline?: string; failOnRegression?: boolean }) => {
    // Resolve current manifest
    let current: ReturnType<typeof loadManifest>;
    if (opts.run) {
      current = loadManifest(opts.run);
      if (!current) {
        console.error(`Diff manifest not found for run: ${opts.run}`);
        process.exit(1);
      }
    } else {
      current = findLatestManifest();
      if (!current) {
        console.error('No diff manifests found in storage/runs/');
        process.exit(1);
      }
    }

    // Resolve baseline manifest: explicit > approved baseline > latest run
    let baseline: ReturnType<typeof loadManifest>;
    let usingApproved = false;
    if (opts.baseline) {
      baseline = loadManifest(opts.baseline);
      if (!baseline) {
        console.error(`Baseline diff manifest not found for run: ${opts.baseline}`);
        process.exit(1);
      }
    } else {
      const approved = loadBaselineDiffManifest();
      if (approved) {
        baseline = approved;
        usingApproved = true;
      } else {
        baseline = findLatestManifest(current!.run_id);
        if (!baseline) {
          console.log('[regress] No approved baseline and no previous run — no regressions to detect.');
          console.log('[regress] Tip: run "reviewer approve --latest" after a successful run.');
          process.exit(0);
        }
      }
    }

    if (usingApproved) {
      console.log(`[regress] using approved baseline from ${getBaselineDir()}`);
    }
    console.log(`\n[regress] Comparing: ${current!.run_id} (current) vs ${baseline!.run_id} (baseline)\n`);

    const report = detectRegressions(baseline!, current!);
    const reportPath = saveRegressionReport(report, current!.run_id);

    console.log(report.summary_table);
    console.log(`\nRegression report: ${reportPath}`);

    if (opts.failOnRegression && report.has_unexpected_regressions) {
      console.error(`\n!! ${report.unexpected_regressions.length} unexpected regression(s) detected — failing CI`);
      process.exit(1);
    }
  });
program.addCommand(regressCmd);

// reviewer pr-comment — generate PR comment markdown from a run
program
  .command('pr-comment')
  .description('Generate GitHub PR comment markdown from a diff run')
  .requiredOption('--run <run_id>', 'Run ID to generate comment for')
  .option('--output <path>', 'Write to file instead of stdout')
  .option('--artifact-url <url>', 'Link to downloadable artifact')
  .action((opts: { run: string; output?: string; artifactUrl?: string }) => {
    runPRCommentCLI(opts.run, opts.output, opts.artifactUrl);
  });

// reviewer embed-figma — compute visual embeddings for Figma frame PNGs
program
  .command('embed-figma')
  .description('Compute visual embeddings for all Figma frame screenshots')
  .option('--force', 'Recompute all embeddings (ignore cache)', false)
  .action((opts: { force?: boolean }) => {
    console.log('\n--- Visual Embedding: Figma Frames ---\n');
    const result = embedAllFigmaFrames(opts.force);
    console.log(`Total screens:  ${result.total}`);
    console.log(`Computed:       ${result.computed}`);
    console.log(`Cached:         ${result.cached}`);
    console.log(`Failed:         ${result.failed}`);
    console.log(`Embeddings dim: ${result.store.entries[0]?.embedding.length || 0}`);
    console.log(`\nStored: ${EMBEDDINGS_DIR}/figma.json`);
  });

// reviewer embed-runtime — compute visual embeddings for runtime screenshots
program
  .command('embed-runtime')
  .description('Compute visual embeddings for runtime screenshots')
  .action(async (opts: FilterOpts) => {
    const { screens, coverage } = getFilteredScreens(opts);
    console.log('');
    printCoverage(coverage, screens.length);
    console.log('\n--- Visual Embedding: Runtime Screenshots ---\n');

    const runtimeDir = path.join(STORAGE_DIR, 'runtime');
    let computed = 0, skipped = 0;

    for (const screen of screens) {
      const pngPath = path.join(runtimeDir, screen.screen_id, 'runtime.png');
      if (!fs.existsSync(pngPath)) {
        skipped++;
        continue;
      }
      try {
        embedRuntimeScreen(screen.screen_id, pngPath);
        computed++;
        console.log(`  [ok] ${screen.screen_id}`);
      } catch (err) {
        console.error(`  [fail] ${screen.screen_id}: ${(err as Error).message}`);
      }
    }

    console.log(`\nComputed: ${computed}, Skipped (no PNG): ${skipped}`);
    console.log(`Stored: ${EMBEDDINGS_DIR}/runtime/`);
  });
addFilterOptions(program.commands[program.commands.length - 1] as Command);

// reviewer evaluate-mapping — measure ranking quality against labeled data
program
  .command('evaluate-mapping')
  .description('Evaluate hybrid ranking quality against labeled screen mappings')
  .option('--json', 'Output JSON instead of table')
  .action((opts: { json?: boolean }) => {
    const report = runEvaluation();
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(report.table);
    }
  });

// reviewer list — utility to show registry contents (always shows all)
program
  .command('list')
  .description('List screens from registry')
  .option('--flow <flow_id>', 'Filter by flow')
  .option('--tag <tag>', 'Filter by tag')
  .action((opts: { flow?: string; tag?: string }) => {
    const allScreens = loadScreens();
    const filtered = filterScreens(allScreens, {
      screenId: undefined,
      flowId: opts.flow,
      tag: opts.tag,
    });
    const coverage = getRegistryCoverage(filtered);
    console.log('');
    printCoverage(coverage, coverage.ready);
    console.log(`\n${filtered.length} screens:\n`);
    for (const s of filtered) {
      const readiness = getScreenReadiness(s);
      const badge = readiness === 'ready' ? 'READY' : readiness === 'disabled' ? 'DISABLED' : 'UNCONF';
      const color = readiness === 'ready' ? '' : '  ';
      console.log(
        `  ${color}[${badge.padEnd(8)}] ${s.screen_id.padEnd(40)} flow=${s.flow_id.padEnd(14)} ${s.tags.join(', ')}`,
      );
    }
  });

// reviewer pr-check — selective run based on changed files in a PR
const prCheckCmd = new Command('pr-check')
  .description(
    'Selective PR visual check: detect changed files, run only affected screens (v0.7)',
  )
  .option('--fail-on-regression', 'Exit with code 1 if unexpected regressions found', false)
  .option('--all', 'Include unconfigured/disabled screens (default: ready-only)', false)
  .action(async (opts: { failOnRegression?: boolean; all?: boolean }) => {
    // ── Step 1: Detect changed files ──────────────────────────────────────
    const changedFiles = getChangedFiles();

    // ── Step 2: Load full registry ────────────────────────────────────────
    const { screens: allScreens, coverage } = getFilteredScreens({ all: opts.all });
    console.log('');
    printCoverage(coverage, allScreens.length);

    // ── Step 3: Determine affected screens via heuristics ─────────────────
    const impact = getAffectedScreens(changedFiles, allScreens);
    logPRImpact(impact);

    // ── Step 4: Resolve the screens to actually run ───────────────────────
    const affectedScreenIdSet = new Set(impact.affectedScreenIds);
    const screens = allScreens.filter((s) => affectedScreenIdSet.has(s.screen_id));

    if (screens.length === 0) {
      console.log('\n[pr-check] No screens selected — nothing to run.');
      return;
    }

    console.log(`\n[pr-check] Running pipeline for ${screens.length} screen(s)${impact.isFallback ? ' (full fallback)' : ''}...\n`);

    const runId = generateRunId();
    const startedAt = isoNow();

    // ── Phase 1: Figma Fetch ──
    console.log('--- Phase 1: Figma Fetch ---');
    const figmaResults = await fetchAllFigmaScreens(screens, { force: false });

    // ── Phase 2: Runtime Capture ──
    console.log('\n--- Phase 2: Runtime Capture ---');
    const runtimeResults = await captureAllScreens(screens);

    const captureManifest = buildManifest({
      runId,
      startedAt,
      mode: 'full',
      filters: {},
      screenIds: screens.map((s) => s.screen_id),
      figmaResults,
      runtimeResults,
    });
    const captureManifestPath = saveManifest(captureManifest);
    printCaptureSummary(figmaResults, runtimeResults);

    // ── Phase 2b: Visual Embeddings ──
    console.log('\n--- Phase 2b: Visual Embeddings ---');
    const embFigma = embedAllFigmaFrames();
    console.log(`  Figma embeddings: ${embFigma.computed} computed, ${embFigma.cached} cached`);
    let embRuntime = 0;
    const runtimeDir = path.join(STORAGE_DIR, 'runtime');
    for (const r of runtimeResults) {
      if (r.status === 'success') {
        const pngPath = path.join(runtimeDir, r.screen_id, 'runtime.png');
        if (fs.existsSync(pngPath)) {
          try { embedRuntimeScreen(r.screen_id, pngPath); embRuntime++; } catch { /* skip */ }
        }
      }
    }
    console.log(`  Runtime embeddings: ${embRuntime} computed`);

    // ── Phase 3: Visual Diff ──
    console.log('\n--- Phase 3: Visual Diff ---');
    const diffResults = diffAllScreens(screens, runId);

    const diffManifest = buildDiffManifest(
      runId,
      captureManifestPath,
      isoNow(),
      diffResults,
      getGitCommit(),
      getGitBranch(),
      coverage,
    );
    const diffManifestPath = saveDiffManifest(diffManifest);

    // ── Phase 4: HTML Report ──
    console.log('\n--- Phase 4: HTML Report ---');
    const html = generateReport(diffManifest);
    const reportPath = saveReport(html, runId);

    printDiffSummary(diffManifest);
    console.log(`\nCapture manifest: ${captureManifestPath}`);
    console.log(`Diff manifest:    ${diffManifestPath}`);
    console.log(`HTML report:      ${reportPath}`);

    // ── Phase 5: Regression Detection ──
    console.log('\n--- Phase 5: Regression Detection ---');
    const approvedBaseline = loadBaselineDiffManifest();
    const baseline = approvedBaseline ?? findLatestManifest(runId);
    if (baseline) {
      if (approvedBaseline) {
        console.log(`[regress] using approved baseline from ${getBaselineDir()}`);
      }
      console.log(`[regress] Baseline: ${baseline.run_id} (${baseline.git_commit})`);
      const regressionReport = detectRegressions(baseline, diffManifest);
      const regressionPath = saveRegressionReport(regressionReport, runId);
      console.log(regressionReport.summary_table);
      console.log(`Regression report: ${regressionPath}`);

      if (opts.failOnRegression && regressionReport.has_unexpected_regressions) {
        console.error(`\n!! ${regressionReport.unexpected_regressions.length} unexpected regression(s) — failing`);
        process.exit(1);
      }
    } else {
      console.log('[regress] No approved baseline and no previous run — skipping regression detection.');
      console.log('[regress] Tip: run "reviewer approve --latest" after a successful run to set the baseline.');
    }
  });
program.addCommand(prCheckCmd);

// reviewer approve — promote a run to the approved baseline
program
  .command('approve')
  .description('Approve a completed run as the current baseline for regression comparison')
  .option('--run <runId>', 'Run ID to approve')
  .option('--latest', 'Approve the most recent completed run (default when no --run given)')
  .action(async (opts: { run?: string; latest?: boolean }) => {
    // Resolve which run to approve
    let runId: string;
    if (opts.run) {
      runId = opts.run;
    } else {
      // Default: latest run (same behaviour as --latest)
      const latestManifest = findLatestManifest();
      if (!latestManifest) {
        console.error('[baseline] No completed runs found. Run "reviewer full" or "reviewer diff" first.');
        process.exit(1);
      }
      runId = latestManifest.run_id;
    }

    const projectId: string = program.opts().project ?? 'default';
    console.log(`[baseline] approving run ${runId} for project ${projectId}`);

    try {
      const manifest = approveRun({ runId, projectId });
      console.log(`[baseline] copied ${manifest.approvedScreens.length} screen baseline(s)`);
      console.log(`[baseline] baseline updated successfully`);
      console.log(`[baseline] location: ${getBaselineDir()}`);
    } catch (err) {
      console.error(`[baseline] approval failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// reviewer baseline-status — show current approved baseline info
program
  .command('baseline-status')
  .description('Show status of the current approved baseline')
  .action(() => {
    console.log('');
    if (!hasApprovedBaseline()) {
      console.log('No approved baseline found.');
      console.log(`Expected location: ${getBaselineDir()}`);
      console.log('\nRun "reviewer approve --latest" after a successful run to create one.');
      return;
    }

    const meta = loadBaselineManifest();
    const diff = loadBaselineDiffManifest();

    console.log('─'.repeat(60));
    console.log('Approved Baseline');
    console.log('─'.repeat(60));
    if (meta) {
      console.log(`Project       : ${meta.projectId}`);
      console.log(`Approved at   : ${meta.approvedAt}`);
      console.log(`Source run    : ${meta.sourceRunId}`);
      console.log(`Screens       : ${meta.approvedScreens.length}`);
      if (meta.approvedScreens.length > 0) {
        for (const s of meta.approvedScreens) {
          console.log(`  - ${s}`);
        }
      }
    }
    if (diff) {
      console.log(`Git commit    : ${diff.git_commit} (${diff.git_branch})`);
      console.log(`Diff summary  : ${diff.summary.passed} passed / ${diff.summary.failed} failed`);
    }
    console.log(`Location      : ${getBaselineDir()}`);
    console.log('─'.repeat(60));
  });

program.parse();
