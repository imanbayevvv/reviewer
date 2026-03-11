# FlowCanvas Reviewer — demo-project

Visual regression review configuration for the **demo-project** project.

## How it works

1. **Figma fetch** — downloads design reference screenshots from Figma
2. **Runtime capture** — takes Playwright screenshots of the running app
3. **Diff** — compares Figma vs runtime pixel-by-pixel, generates an HTML report
4. **Baseline** — approve a passing run so future diffs detect regressions

## Source of truth

`screens.yaml` is the contract. Every reviewable screen must have an entry here.
The reviewer auto-skips screens with `node_id: TODO_FIGMA_NODE_ID`.

## Setup checklist

- [ ] Set `appBaseUrl` in `flowcanvas.config.ts` (or `export REVIEWER_APP_URL=…`)
- [ ] Set Figma token: `export FIGMA_TOKEN=your_personal_access_token`
- [ ] Fill in `figma.file_key` and `figma.node_id` for each screen in `screens.yaml`
- [ ] Start your dev server before running `runtime` or `full`

## Commands

```bash
# Fetch Figma design screenshots
pnpm reviewer --project demo-project figma

# Capture runtime screenshots (dev server must be running)
pnpm reviewer --project demo-project runtime

# Generate visual diff report
pnpm reviewer --project demo-project diff

# All phases in one go
pnpm reviewer --project demo-project full

# List all screens in the registry
pnpm reviewer --project demo-project list

# After a successful full run, approve it as the regression baseline
pnpm reviewer --project demo-project approve --latest

# Check approved baseline status
pnpm reviewer --project demo-project baseline-status
```

## Artifacts

All output is stored in `storage/demo-project/`:

```
storage/demo-project/
  figma/        — Figma reference screenshots
  runtime/      — Runtime Playwright screenshots
  runs/         — Diff output and HTML reports per run
  baselines/    — Approved regression baseline
```

## Adding a new screen

1. Add an entry to `screens.yaml` with `screen_id`, `route`, and `figma.node_id`
2. Fetch its Figma frame:  `pnpm reviewer --project demo-project figma --screen <id>`
3. Capture it at runtime:  `pnpm reviewer --project demo-project runtime --screen <id>`
4. View the diff:          `pnpm reviewer --project demo-project diff --screen <id>`

## Files

| File | Purpose |
|------|---------|
| `flowcanvas.config.ts` | Project config (URLs, Figma key, storage path) |
| `screens.yaml` | Screen registry — **edit this file** |
| `flows.yaml` | Flow groupings (optional) |
| `README.md` | This file |
