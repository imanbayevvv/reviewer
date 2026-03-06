# Runtime Snapshot Runner

## Overview

The runtime runner uses Playwright to capture deterministic screenshots of every screen in the platform. It reads from `registry/screens.yaml`, handles authentication, resolves dynamic routes, and produces PNG artifacts with metadata.

## Prerequisites

1. **App running**: Next.js web app at `http://localhost:3000`
2. **API running**: Fastify API at `http://localhost:4000`
3. **Database seeded**: Reviewer test users and data must exist (see test-data-contract.md)
4. **Playwright installed**: Run `pnpm --filter @resale/reviewer exec playwright install chromium`

## Environment Variables

```env
# Required for runtime capture
REVIEWER_APP_URL=http://localhost:3000      # Web app URL
REVIEWER_API_URL=http://localhost:4000      # API URL

# Auth credentials for reviewer test users
REVIEWER_SEED_USER_EMAIL=reviewer@resale.test
REVIEWER_SEED_USER_PASSWORD=Reviewer123!
REVIEWER_SEED_EMPTY_USER_EMAIL=reviewer-empty@resale.test
REVIEWER_SEED_EMPTY_USER_PASSWORD=Reviewer123!

# Required for Figma fetch only
FIGMA_TOKEN=                                # Figma personal access token
```

## Commands

From project root:

```bash
# List all registry screens
pnpm reviewer:list

# Capture runtime screenshots (all screens)
pnpm reviewer:runtime

# Fetch Figma baselines (all screens)
pnpm reviewer:figma

# Full run: Figma + runtime
pnpm reviewer:run

# Filter by screen, flow, or tag
pnpm reviewer:runtime -- --screen auth_login_default
pnpm reviewer:runtime -- --flow auth
pnpm reviewer:runtime -- --tag mvp

# Force refresh (skip cache)
pnpm reviewer:figma -- --force
```

Or from `tools/reviewer/`:

```bash
pnpm runtime
pnpm figma
pnpm run
pnpm cli list
```

## How Auth Works

1. Runner calls `POST /api/auth/login` directly with reviewer credentials
2. Gets JWT `accessToken` + `refreshToken`
3. Opens the browser to `/login?snapshot=1` (establishes origin context)
4. Sets tokens in `localStorage` via `page.evaluate()`
5. Navigates to target screen routes with `?snapshot=1`

Two users are used:
- **Main user** (`reviewer@resale.test`): Has shops + products. Used for dashboard-populated, shop-detail, wizard screens.
- **Empty user** (`reviewer-empty@resale.test`): Has zero shops. Used for dashboard-empty variant.

## How Snapshot Mode Works

1. Every URL gets `?snapshot=1` query parameter
2. Frontend detects this, adds `snapshot-mode` class to `<html>`
3. CSS overrides disable all animations, transitions, cursor blink
4. After fonts load and no `[data-loading]` elements remain, `window.__SNAPSHOT_READY__` is set
5. Runner waits for `__SNAPSHOT_READY__ === true` before taking screenshot
6. Small 200ms stabilization delay after readiness for final paint

## Screen Capture Behavior

| Condition | Status | Action |
|---|---|---|
| Normal screen, navigable by URL | `success` | Screenshot captured |
| Requires UI trigger (error state, theme selected) | `skipped_manual_state_required` | Skipped with note |
| Dynamic route `{shopId}` unresolvable | `skipped_unresolvable_route` | Skipped (no seeded shop found) |
| Auth fails | `failed_auth` | All auth screens fail |
| Page doesn't reach readiness in 15s | `failed_readiness_timeout` | Timeout error |
| Navigation fails | `failed_navigation` | Error captured |

## Viewport Contract

- Default: 1440x900 (matches Figma design frames)
- Per-screen viewport from `registry/screens.yaml` is applied before each capture
- `deviceScaleFactor: 1` for 1:1 pixel match with Figma export

## Artifact Structure

```
storage/
  runtime/
    {screen_id}/
      runtime.png       # Screenshot
      metadata.json     # Capture metadata
  figma/
    {screen_id}/
      figma.png         # Figma export
      metadata.json     # Fetch metadata
  runs/
    {run_id}/
      run-manifest.json # Full run results
```

## Current Limitations

1. **Screens requiring UI triggers** (error states, selected states, tab switches) are skipped. Future: add action sequences to screen registry.
2. **Wizard screens** (analyzing, theme, setup) require Zustand wizard state that can't be set via URL alone. They need either API-level precondition setup or injected store state.
3. **Seed data** must be manually created. Future: `seed-reviewer.ts` script.
4. **All Figma refs** are currently `TODO_*` placeholders. Figma fetcher will skip all screens until filled in.
5. **No diff engine yet** -- this step only captures artifacts.
