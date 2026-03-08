import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(process.cwd(), '..', '..');
const RUNS_DIR = path.join(PROJECT_ROOT, 'storage', 'runs');

export interface RunSummaryEntry {
  run_id: string;
  timestamp: string;
  git_commit: string;
  git_branch: string;
  summary: { passed: number; failed: number; skipped: number; errored: number } | null;
  screen_count: number;
  has_regression_report: boolean;
}

export async function GET() {
  try {
    if (!fs.existsSync(RUNS_DIR)) {
      return NextResponse.json({ runs: [] });
    }

    const entries = fs.readdirSync(RUNS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort()
      .reverse();

    const runs: RunSummaryEntry[] = [];

    for (const dir of entries) {
      const manifestPath = path.join(RUNS_DIR, dir, 'diff-manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const hasRegression = fs.existsSync(path.join(RUNS_DIR, dir, 'regression-report.json'));

        runs.push({
          run_id: manifest.run_id || dir,
          timestamp: manifest.started_at || '',
          git_commit: manifest.git_commit || '',
          git_branch: manifest.git_branch || '',
          summary: manifest.summary || null,
          screen_count: manifest.total_screens || manifest.screens?.length || 0,
          has_regression_report: hasRegression,
        });
      } catch {
        continue;
      }
    }

    return NextResponse.json({ runs });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to list runs: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
