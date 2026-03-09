import { execSync } from 'node:child_process';
import type { Screen } from './registry.js';

// ── Types ────────────────────────────────────────────────

export interface PRImpactResult {
  changedFiles: string[];
  affectedScreenIds: string[];
  /** True when no heuristic matched and we fell back to the full screen set */
  isFallback: boolean;
}

// ── Git helpers ──────────────────────────────────────────

/**
 * Returns file paths changed in this branch relative to origin/main.
 * Falls back to an empty array when git is unavailable or the command fails.
 */
export function getChangedFiles(): string[] {
  const commands = [
    // Standard PR diff: branch divergence from origin/main
    'git diff --name-only origin/main...HEAD',
    // Fallback: just staged + unstaged changes (useful in local dev)
    'git diff --name-only HEAD',
  ];

  for (const cmd of commands) {
    try {
      const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (output.length > 0) {
        return output
          .split('\n')
          .map((f) => f.trim())
          .filter(Boolean);
      }
    } catch {
      // Try next command
    }
  }

  return [];
}

// ── Heuristics ───────────────────────────────────────────

/**
 * Normalise a route string to a set of meaningful path segments.
 *
 * Example:
 *   /shops/{shopId}/create  →  ['shops', 'create']
 *   /auth/login             →  ['auth', 'login']
 */
function routeSegments(route: string): string[] {
  return route
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('{'));
}

/**
 * Extract a "component hint" from a file path — the bare filename stem
 * in lower-case, stripped of common Next.js suffixes and extensions.
 *
 * Examples:
 *   apps/web/app/(auth)/login/page.tsx  →  'login'
 *   components/AuthForm.tsx             →  'authform'
 *   apps/web/app/shops/create/layout.tsx →  'create'
 */
function fileComponentHint(filePath: string): string {
  // Take the last meaningful segment before common Next.js filenames
  const parts = filePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);

  // Strip file extension from tail
  const tail = parts[parts.length - 1].replace(/\.[^.]+$/, '').toLowerCase();

  // Next.js special files — prefer the parent directory name
  const nextFiles = new Set(['page', 'layout', 'loading', 'error', 'not-found', 'route', 'template', 'default']);
  if (nextFiles.has(tail) && parts.length >= 2) {
    return parts[parts.length - 2].toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  return tail.replace(/[^a-z0-9]/g, '');
}

/**
 * Core heuristic function.
 *
 * A screen is considered AFFECTED by a changed file when ANY of:
 *
 *  1. Route segments — every non-dynamic route segment appears in the
 *     file path (order-independent substring match).
 *     e.g. route=/auth/login, file=apps/web/app/auth/login/page.tsx → match
 *
 *  2. Component name — the file's component hint is a substring of
 *     the screen_id (lowercased).
 *     e.g. file=AuthForm.tsx → hint="authform", screen_id="auth_login_default" → match
 *
 *  3. Partial path overlap — any route segment of 3+ chars appears
 *     verbatim in the lowercased file path.
 *     e.g. segment="shops", file=apps/web/app/shops/create/... → match
 */
function isScreenAffected(screen: Screen, changedFile: string): boolean {
  const lowerFile = changedFile.toLowerCase().replace(/\\/g, '/');
  const segments = routeSegments(screen.route);
  const hint = fileComponentHint(changedFile);
  const lowerScreenId = screen.screen_id.toLowerCase();

  // ── Heuristic 1: all route segments present in file path ─────────────
  if (segments.length > 0 && segments.every((seg) => lowerFile.includes(seg.toLowerCase()))) {
    return true;
  }

  // ── Heuristic 2: component name in screen_id ──────────────────────────
  if (hint.length >= 3 && lowerScreenId.includes(hint)) {
    return true;
  }

  // ── Heuristic 3: any meaningful route segment in file path ────────────
  const meaningfulSegments = segments.filter((s) => s.length >= 3);
  if (meaningfulSegments.some((seg) => lowerFile.includes(seg.toLowerCase()))) {
    return true;
  }

  return false;
}

/**
 * Given a list of changed files and the full screen registry, return the
 * subset of screen_ids that are potentially affected.
 *
 * Falls back to ALL screen_ids when no heuristic produces a match.
 */
export function getAffectedScreens(
  changedFiles: string[],
  screens: Screen[],
): PRImpactResult {
  if (changedFiles.length === 0) {
    // No diff info — safe to run everything
    return {
      changedFiles: [],
      affectedScreenIds: screens.map((s) => s.screen_id),
      isFallback: true,
    };
  }

  const matched = new Set<string>();

  for (const screen of screens) {
    for (const file of changedFiles) {
      if (isScreenAffected(screen, file)) {
        matched.add(screen.screen_id);
        break; // One match is enough per screen
      }
    }
  }

  if (matched.size === 0) {
    return {
      changedFiles,
      affectedScreenIds: screens.map((s) => s.screen_id),
      isFallback: true,
    };
  }

  return {
    changedFiles,
    affectedScreenIds: Array.from(matched),
    isFallback: false,
  };
}

// ── Logging ──────────────────────────────────────────────

/** Pretty-print the PR impact analysis to stdout. */
export function logPRImpact(result: PRImpactResult): void {
  console.log('\n' + '='.repeat(70));
  console.log('PR IMPACT ANALYSIS');
  console.log('='.repeat(70));

  if (result.changedFiles.length === 0) {
    console.log('Changed files: (none detected — falling back to full run)');
  } else {
    console.log(`Changed files (${result.changedFiles.length}):`);
    for (const f of result.changedFiles) {
      console.log(`  - ${f}`);
    }
  }

  console.log('');

  if (result.isFallback) {
    console.log('⚠  No heuristic matches found → running FULL screen set (safety fallback)');
  } else {
    console.log(`Affected screens (${result.affectedScreenIds.length}):`);
    for (const id of result.affectedScreenIds) {
      console.log(`  - ${id}`);
    }
  }

  console.log('='.repeat(70));
}
