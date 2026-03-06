import type { Page } from '@playwright/test';
import { getEnv } from './config.js';

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Login to the API and get JWT tokens.
 * Calls the backend directly — does not go through the browser.
 */
export async function loginViaApi(
  apiUrl: string,
  email: string,
  password: string,
): Promise<AuthTokens> {
  const res = await fetch(`${apiUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Auth failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as AuthTokens;
  return data;
}

/**
 * Set auth tokens in the browser's localStorage.
 * Must be called after navigating to the app origin at least once.
 */
export async function setAuthInBrowser(
  page: Page,
  tokens: AuthTokens,
): Promise<void> {
  await page.evaluate(
    ({ accessToken, refreshToken }) => {
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
    },
    tokens,
  );
}

/**
 * Full auth setup: login via API, then inject tokens into the browser.
 * Navigates to a minimal page on the app origin first to establish localStorage context.
 */
export async function setupBrowserAuth(
  page: Page,
  appUrl: string,
  apiUrl: string,
  email: string,
  password: string,
): Promise<AuthTokens> {
  const tokens = await loginViaApi(apiUrl, email, password);

  // Navigate to a page on the app origin to set localStorage
  await page.goto(`${appUrl}/login?snapshot=1`, { waitUntil: 'domcontentloaded' });
  await setAuthInBrowser(page, tokens);

  return tokens;
}

// Well-known reviewer seed slugs for deterministic resolution
const SEED_SLUGS = {
  active: 'reviewer-vintage-threads',
  draft: 'reviewer-draft-store',
  analyzing: 'reviewer-analyzing-store',
};

/**
 * Query the API to resolve dynamic route parameters.
 * Uses well-known slugs from the reviewer seed layer for deterministic resolution.
 * Returns a map like { shopId: 'actual-uuid', draftShopId: '...', analyzingShopId: '...' }.
 */
export async function resolveRouteParams(
  apiUrl: string,
  accessToken: string,
): Promise<Record<string, string>> {
  const params: Record<string, string> = {};

  try {
    const res = await fetch(`${apiUrl}/api/shops`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = (await res.json()) as { items: Array<{ id: string; slug: string; status: string }> };
      const shops = data.items || [];

      // Resolve by well-known seed slugs (deterministic)
      const activeShop = shops.find((s) => s.slug === SEED_SLUGS.active);
      if (activeShop) params.shopId = activeShop.id;

      const draftShop = shops.find((s) => s.slug === SEED_SLUGS.draft);
      if (draftShop) params.draftShopId = draftShop.id;

      const analyzingShop = shops.find((s) => s.slug === SEED_SLUGS.analyzing);
      if (analyzingShop) params.analyzingShopId = analyzingShop.id;

      // Fallback: if seed slugs not found, use status-based lookup
      if (!params.shopId) {
        const fallback = shops.find((s) => s.status === 'ACTIVE');
        if (fallback) params.shopId = fallback.id;
      }
      if (!params.draftShopId) {
        const fallback = shops.find((s) => s.status === 'DRAFT');
        if (fallback) params.draftShopId = fallback.id;
      }
    }
  } catch {
    // Route params unresolvable — screens with {shopId} will be skipped
  }

  return params;
}
