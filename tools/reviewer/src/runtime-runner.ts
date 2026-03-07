import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  DEFAULT_READINESS_TIMEOUT_MS,
  RUNTIME_STORAGE,
  getEnv,
} from './config.js';
import type { Screen } from './registry.js';
import { setupBrowserAuth, resolveRouteParams } from './auth-helper.js';
import { executeActions } from './actions.js';
import { computeFileHash, ensureDir, isoNow } from './utils.js';

// ── Types ────────────────────────────────────────────────

export type RuntimeCaptureStatus =
  | 'success'
  | 'skipped_no_auth_setup'
  | 'skipped_unresolvable_route'
  | 'skipped_manual_state_required'
  | 'failed_navigation'
  | 'failed_readiness_timeout'
  | 'failed_screenshot'
  | 'failed_actions'
  | 'failed_auth';

export interface RuntimeCaptureResult {
  screen_id: string;
  status: RuntimeCaptureStatus;
  route?: string;
  resolved_url?: string;
  viewport?: { width: number; height: number };
  captured_at: string;
  readiness_wait_ms?: number;
  checksum?: string;
  artifact_path?: string;
  error?: string;
  notes?: string;
  duration_ms: number;
}

export interface MaskBoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RuntimeMetadata {
  screen_id: string;
  route: string;
  resolved_url: string;
  viewport: { width: number; height: number };
  captured_at: string;
  readiness_wait_ms: number;
  runtime_status: RuntimeCaptureStatus;
  checksum: string;
  notes: string;
  /** Bounding boxes for mask selectors, keyed by CSS selector (array: one per matched element) */
  mask_boxes?: Record<string, MaskBoundingBox | MaskBoundingBox[]>;
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Determine if a screen needs manual intervention.
 * Screens with setup.strategy = 'action_sequence' + defined actions are now auto-capturable.
 * Only screens with a trigger but NO setup actions remain manual.
 */
function needsManualTrigger(screen: Screen): boolean {
  // If setup has actions defined, it's automated — not manual
  if (screen.setup?.actions && screen.setup.actions.length > 0) return false;
  // Legacy check: trigger in preconditions with no automation
  if (screen.preconditions.trigger) return true;
  return false;
}

function hasDynamicRoute(route: string): boolean {
  return route.includes('{') && route.includes('}');
}

function resolveRoute(
  route: string,
  params: Record<string, string>,
  screen: Screen,
): string | null {
  if (!hasDynamicRoute(route)) return route;

  let resolved = route;
  if (route.includes('{shopId}')) {
    // Determine which shopId based on variant / data needs
    let shopId: string | undefined;
    if (screen.variant === 'needs_setup') {
      shopId = params.draftShopId;
    } else if (screen.screen_id === 'shop_detail_products_empty') {
      // Empty products uses draft shop (no products seeded)
      shopId = params.draftShopId;
    } else {
      shopId = params.shopId;
    }
    if (!shopId) return null;
    resolved = resolved.replace('{shopId}', shopId);
  }

  // If there are still unresolved params, return null
  if (resolved.includes('{')) return null;

  return resolved;
}

/**
 * Build query string for snapshot mode, including setup.query_params.
 * Resolves template values like {shopId}, {analyzingShopId}, {themeId} from routeParams.
 */
function buildSnapshotQuery(
  screen: Screen,
  routeParams: Record<string, string>,
): string {
  const qp = new URLSearchParams({ snapshot: '1' });

  if (screen.setup?.query_params) {
    for (const [key, rawValue] of Object.entries(screen.setup.query_params)) {
      // Replace {paramName} templates with resolved values
      let value = rawValue;
      for (const [pk, pv] of Object.entries(routeParams)) {
        value = value.replace(`{${pk}}`, pv);
      }
      qp.set(key, value);
    }
  }

  return qp.toString();
}

function screenDir(screenId: string): string {
  return path.join(RUNTIME_STORAGE, screenId);
}

// ── Core ─────────────────────────────────────────────────

async function captureScreen(
  page: Page,
  screen: Screen,
  appUrl: string,
  routeParams: Record<string, string>,
): Promise<RuntimeCaptureResult> {
  const startTime = Date.now();

  // Check if screen requires a manual trigger
  if (needsManualTrigger(screen)) {
    return {
      screen_id: screen.screen_id,
      status: 'skipped_manual_state_required',
      captured_at: isoNow(),
      notes: `Variant "${screen.variant}" requires trigger: ${screen.preconditions.trigger || 'UI interaction'}`,
      duration_ms: Date.now() - startTime,
    };
  }

  // Resolve route
  const resolvedRoute = resolveRoute(screen.route, routeParams, screen);
  if (!resolvedRoute) {
    return {
      screen_id: screen.screen_id,
      status: 'skipped_unresolvable_route',
      route: screen.route,
      captured_at: isoNow(),
      notes: `Could not resolve dynamic params in route: ${screen.route}`,
      duration_ms: Date.now() - startTime,
    };
  }

  // Set viewport for this screen
  await page.setViewportSize(screen.viewport);

  // Navigate with snapshot mode + setup query params
  const qs = buildSnapshotQuery(screen, routeParams);
  const url = `${appUrl}${resolvedRoute}?${qs}`;

  try {
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: DEFAULT_NAVIGATION_TIMEOUT_MS,
    });
  } catch (err) {
    return {
      screen_id: screen.screen_id,
      status: 'failed_navigation',
      route: screen.route,
      resolved_url: url,
      viewport: screen.viewport,
      captured_at: isoNow(),
      error: (err as Error).message,
      duration_ms: Date.now() - startTime,
    };
  }

  // Wait for readiness signal
  const readinessStart = Date.now();
  try {
    await page.waitForFunction(
      () => (window as any).__SNAPSHOT_READY__ === true,
      { timeout: DEFAULT_READINESS_TIMEOUT_MS },
    );
  } catch {
    return {
      screen_id: screen.screen_id,
      status: 'failed_readiness_timeout',
      route: screen.route,
      resolved_url: url,
      viewport: screen.viewport,
      captured_at: isoNow(),
      readiness_wait_ms: Date.now() - readinessStart,
      error: `__SNAPSHOT_READY__ not set within ${DEFAULT_READINESS_TIMEOUT_MS}ms`,
      duration_ms: Date.now() - startTime,
    };
  }
  const readinessWaitMs = Date.now() - readinessStart;

  // Execute UI action sequence if defined
  if (screen.setup?.actions && screen.setup.actions.length > 0) {
    try {
      await executeActions(page, screen.setup.actions);
      // Allow UI to settle after actions
      await page.waitForTimeout(300);
    } catch (err) {
      return {
        screen_id: screen.screen_id,
        status: 'failed_actions',
        route: screen.route,
        resolved_url: url,
        viewport: screen.viewport,
        captured_at: isoNow(),
        readiness_wait_ms: readinessWaitMs,
        error: `Action sequence failed: ${(err as Error).message}`,
        duration_ms: Date.now() - startTime,
      };
    }
  }

  // Stabilization: move mouse to corner to avoid hover effects, wait for final paint
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);

  // Take screenshot
  const dir = screenDir(screen.screen_id);
  ensureDir(dir);
  const pngPath = path.join(dir, 'runtime.png');

  try {
    await page.screenshot({
      path: pngPath,
      fullPage: false, // Use viewport contract, not full page
    });
  } catch (err) {
    return {
      screen_id: screen.screen_id,
      status: 'failed_screenshot',
      route: screen.route,
      resolved_url: url,
      viewport: screen.viewport,
      captured_at: isoNow(),
      readiness_wait_ms: readinessWaitMs,
      error: (err as Error).message,
      duration_ms: Date.now() - startTime,
    };
  }

  const checksum = computeFileHash(pngPath);
  const capturedAt = isoNow();

  // Capture mask bounding boxes from CSS selectors (ALL matching elements)
  let maskBoxes: Record<string, MaskBoundingBox[]> | undefined;
  if (screen.masks.length > 0) {
    maskBoxes = {};
    for (const mask of screen.masks) {
      try {
        const locator = page.locator(mask.selector);
        const count = await locator.count();
        if (count > 0) {
          const boxes: MaskBoundingBox[] = [];
          for (let i = 0; i < count; i++) {
            const box = await locator.nth(i).boundingBox();
            if (box) {
              boxes.push({
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.width),
                h: Math.round(box.height),
              });
            }
          }
          if (boxes.length > 0) {
            maskBoxes[mask.selector] = boxes;
          }
        }
      } catch {
        // Selector not found — mask will be unresolved at diff time
      }
    }
  }

  // Save metadata
  const metadata: RuntimeMetadata = {
    screen_id: screen.screen_id,
    route: screen.route,
    resolved_url: url,
    viewport: screen.viewport,
    captured_at: capturedAt,
    readiness_wait_ms: readinessWaitMs,
    runtime_status: 'success',
    checksum,
    notes: '',
    mask_boxes: maskBoxes,
  };

  fs.writeFileSync(
    path.join(dir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
  );

  return {
    screen_id: screen.screen_id,
    status: 'success',
    route: screen.route,
    resolved_url: url,
    viewport: screen.viewport,
    captured_at: capturedAt,
    readiness_wait_ms: readinessWaitMs,
    checksum,
    artifact_path: pngPath,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Capture runtime snapshots for all given screens.
 */
export async function captureAllScreens(
  screens: Screen[],
): Promise<RuntimeCaptureResult[]> {
  const env = getEnv();
  const results: RuntimeCaptureResult[] = [];

  // Separate screens by auth requirement
  const noAuthScreens = screens.filter((s) => !s.preconditions.auth);
  const authScreens = screens.filter((s) => s.preconditions.auth);
  // Further split auth screens: those needing empty user vs populated user
  // Use setup.user_type if defined, fallback to legacy heuristic
  const emptyUserScreens = authScreens.filter(
    (s) => s.setup?.user_type === 'empty' || (!s.setup?.user_type && s.variant === 'empty' && s.flow_id === 'dashboard'),
  );
  const mainUserScreens = authScreens.filter(
    (s) => !emptyUserScreens.includes(s),
  );

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });

    // ── Capture no-auth screens ──────────────────────────
    if (noAuthScreens.length > 0) {
      console.log(`\n[runtime] Capturing ${noAuthScreens.length} unauthenticated screens...`);
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();

      for (const screen of noAuthScreens) {
        console.log(`[runtime] ${screen.screen_id}`);
        const result = await captureScreen(page, screen, env.appUrl, {});
        console.log(`  -> ${result.status}${result.error ? ` (${result.error})` : ''}`);
        results.push(result);
      }

      await ctx.close();
    }

    // ── Capture main-user auth screens ───────────────────
    if (mainUserScreens.length > 0) {
      console.log(`\n[runtime] Capturing ${mainUserScreens.length} authenticated screens (main user)...`);
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();

      let routeParams: Record<string, string> = {};
      try {
        const tokens = await setupBrowserAuth(
          page,
          env.appUrl,
          env.apiUrl,
          env.seedUserEmail,
          env.seedUserPassword,
        );
        routeParams = await resolveRouteParams(env.apiUrl, tokens.accessToken);
        console.log(`  Auth OK. Route params: ${JSON.stringify(routeParams)}`);
      } catch (err) {
        console.error(`  Auth FAILED: ${(err as Error).message}`);
        // Mark all auth screens as failed
        for (const screen of mainUserScreens) {
          results.push({
            screen_id: screen.screen_id,
            status: 'failed_auth',
            captured_at: isoNow(),
            error: (err as Error).message,
            duration_ms: 0,
          });
        }
        await ctx.close();
        // Still try empty user screens
        return await captureEmptyUserScreens(browser, emptyUserScreens, env, results);
      }

      for (const screen of mainUserScreens) {
        console.log(`[runtime] ${screen.screen_id}`);
        // Reset __SNAPSHOT_READY__ before each navigation
        await page.evaluate(() => {
          (window as any).__SNAPSHOT_READY__ = false;
        });
        const result = await captureScreen(page, screen, env.appUrl, routeParams);
        console.log(`  -> ${result.status}${result.error ? ` (${result.error})` : ''}`);
        results.push(result);
      }

      await ctx.close();
    }

    // ── Capture empty-user screens ───────────────────────
    await captureEmptyUserScreens(browser, emptyUserScreens, env, results);

  } finally {
    if (browser) await browser.close();
  }

  return results;
}

async function captureEmptyUserScreens(
  browser: Browser,
  screens: Screen[],
  env: ReturnType<typeof getEnv>,
  results: RuntimeCaptureResult[],
): Promise<RuntimeCaptureResult[]> {
  if (screens.length === 0) return results;

  console.log(`\n[runtime] Capturing ${screens.length} authenticated screens (empty user)...`);
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  try {
    await setupBrowserAuth(
      page,
      env.appUrl,
      env.apiUrl,
      env.seedEmptyUserEmail,
      env.seedEmptyUserPassword,
    );
    console.log(`  Auth OK (empty user).`);
  } catch (err) {
    console.error(`  Auth FAILED (empty user): ${(err as Error).message}`);
    for (const screen of screens) {
      results.push({
        screen_id: screen.screen_id,
        status: 'failed_auth',
        captured_at: isoNow(),
        error: (err as Error).message,
        duration_ms: 0,
      });
    }
    await ctx.close();
    return results;
  }

  for (const screen of screens) {
    console.log(`[runtime] ${screen.screen_id}`);
    await page.evaluate(() => {
      (window as any).__SNAPSHOT_READY__ = false;
    });
    const result = await captureScreen(page, screen, env.appUrl, {});
    console.log(`  -> ${result.status}${result.error ? ` (${result.error})` : ''}`);
    results.push(result);
  }

  await ctx.close();
  return results;
}
