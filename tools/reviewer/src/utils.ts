import crypto from 'node:crypto';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

/** Generate a run ID: YYYYMMDD-HHmmss-shortHash */
export function generateRunId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14); // 20250106123456
  const hash = crypto.randomBytes(3).toString('hex'); // 6 chars
  return `${ts}-${hash}`;
}

/** ISO timestamp */
export function isoNow(): string {
  return new Date().toISOString();
}

/** Compute SHA-256 hash of a file */
export function computeFileHash(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Compute SHA-256 hash of a buffer */
export function computeBufferHash(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Ensure directory exists */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Sleep for ms */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Get git commit hash (short), or 'unknown' */
export function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Get git branch name, or 'unknown' */
export function getGitBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}
