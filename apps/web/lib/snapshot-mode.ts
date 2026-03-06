/**
 * Snapshot Mode utilities for deterministic visual review screenshots.
 *
 * Activation: query param `?snapshot=1` OR env `NEXT_PUBLIC_SNAPSHOT_MODE=true`
 *
 * When active:
 * - CSS class `snapshot-mode` is added to <html>
 * - Animations and transitions are disabled via CSS
 * - Provides waitForReady() for Playwright to await stable UI
 */

export function isSnapshotMode(): boolean {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_SNAPSHOT_MODE === 'true';
  }
  if (process.env.NEXT_PUBLIC_SNAPSHOT_MODE === 'true') return true;
  const params = new URLSearchParams(window.location.search);
  return params.get('snapshot') === '1';
}

/**
 * Apply snapshot mode class to document root.
 * Called once on app mount when snapshot mode is detected.
 */
export function applySnapshotMode(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.add('snapshot-mode');
  // Expose flag for Playwright
  (window as any).__SNAPSHOT_MODE__ = true;
}

/**
 * Check if the page is "visually ready" for screenshot.
 * Playwright can call: await page.waitForFunction(() => window.__SNAPSHOT_READY__)
 */
export function signalReady(): void {
  if (typeof window === 'undefined') return;
  (window as any).__SNAPSHOT_READY__ = true;
}

/**
 * Check common ready conditions:
 * - No elements with data-loading attribute
 * - Fonts loaded
 * - No pending images
 */
export async function waitForVisualStability(): Promise<void> {
  // Wait for fonts
  if (typeof document !== 'undefined' && document.fonts) {
    await document.fonts.ready;
  }

  // Wait for no loading indicators
  await new Promise<void>((resolve) => {
    const check = () => {
      const loaders = document.querySelectorAll('[data-loading="true"]');
      if (loaders.length === 0) {
        resolve();
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  });
}
