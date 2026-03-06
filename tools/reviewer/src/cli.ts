import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { loadScreens, filterScreens } from './registry.js';
import { fetchAllFigmaScreens, type FigmaFetchResult } from './figma-fetcher.js';
import { captureAllScreens, type RuntimeCaptureResult } from './runtime-runner.js';
import { buildManifest, saveManifest } from './manifest.js';
import { diffAllScreens, buildDiffManifest, saveDiffManifest } from './diff-engine.js';
import { generateReport, saveReport } from './report-html.js';
import { generateRunId, isoNow, getGitCommit, getGitBranch } from './utils.js';
import { RUNS_STORAGE } from './config.js';

// ── Shared options ───────────────────────────────────────

interface FilterOpts {
  screen?: string;
  flow?: string;
  tag?: string;
  force?: boolean;
}

function addFilterOptions(cmd: Command): Command {
  return cmd
    .option('--screen <screen_id>', 'Run only a specific screen')
    .option('--flow <flow_id>', 'Run only screens in a specific flow')
    .option('--tag <tag>', 'Run only screens with a specific tag')
    .option('--force', 'Force refresh (skip cache)', false);
}

function getFilteredScreens(opts: FilterOpts) {
  const all = loadScreens();
  const filtered = filterScreens(all, {
    screenId: opts.screen,
    flowId: opts.flow,
    tag: opts.tag,
  });
  return filtered;
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
  .version('0.2.0');

// reviewer figma
const figmaCmd = new Command('figma')
  .description('Fetch Figma baseline screenshots')
  .action(async (opts: FilterOpts) => {
    const screens = getFilteredScreens(opts);
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
    const screens = getFilteredScreens(opts);
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
    const screens = getFilteredScreens(opts);
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
    const screens = getFilteredScreens(opts);
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
    const screens = getFilteredScreens(opts);
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

    console.log('\n--- Phase 3: Visual Diff ---');
    const diffResults = diffAllScreens(screens, runId);

    const diffManifest = buildDiffManifest(
      runId,
      captureManifestPath,
      isoNow(),
      diffResults,
      getGitCommit(),
      getGitBranch(),
    );
    const diffManifestPath = saveDiffManifest(diffManifest);

    console.log('\n--- Phase 4: HTML Report ---');
    const html = generateReport(diffManifest);
    const reportPath = saveReport(html, runId);

    printDiffSummary(diffManifest);
    console.log(`\nCapture manifest: ${captureManifestPath}`);
    console.log(`Diff manifest:    ${diffManifestPath}`);
    console.log(`HTML report:      ${reportPath}`);
  });
addFilterOptions(fullCmd);
program.addCommand(fullCmd);

// reviewer list — utility to show registry contents
program
  .command('list')
  .description('List screens from registry')
  .option('--flow <flow_id>', 'Filter by flow')
  .option('--tag <tag>', 'Filter by tag')
  .action((opts: { flow?: string; tag?: string }) => {
    const screens = getFilteredScreens(opts as FilterOpts);
    console.log(`\n${screens.length} screens:\n`);
    for (const s of screens) {
      const figmaStatus =
        s.figma.file_key === 'TODO_FIGMA_FILE_KEY' ? 'no-figma-ref' : 'has-figma-ref';
      console.log(
        `  ${s.screen_id.padEnd(40)} flow=${s.flow_id.padEnd(14)} [${figmaStatus}] ${s.tags.join(', ')}`,
      );
    }
  });

program.parse();
