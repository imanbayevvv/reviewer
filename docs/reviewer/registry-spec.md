# Screen Registry Specification

## Purpose
The Screen Registry (`registry/screens.yaml` + `registry/flows.yaml`) is the **single source of truth** for all reviewable screens in the Resale platform. Every downstream module (Figma Fetcher, Playwright Snapshot Runner, Diff Engine, Report Viewer) reads from this registry.

## screens.yaml Schema

Each entry in `screens` is a review target:

| Field | Type | Required | Description |
|---|---|---|---|
| `screen_id` | string | yes | Unique ID. Convention: `{flow_id}_step_{n}_{variant}` or `{flow_id}_{name}_{variant}` |
| `flow_id` | string | yes | References a flow in `flows.yaml` |
| `step` | number | yes | Step number within the flow |
| `variant` | string | yes | `default`, `empty`, `populated`, `error`, `selected`, etc. |
| `route` | string | yes | Next.js route pattern. Use `{param}` for dynamic segments |
| `preconditions` | object | yes | What must be true for this screen to render |
| `preconditions.auth` | boolean | yes | Whether user must be authenticated |
| `preconditions.data` | string | no | Human-readable data requirement |
| `preconditions.trigger` | string | no | User action needed to reach this state |
| `figma.file_key` | string | yes | Figma file key (`TODO_FIGMA_FILE_KEY` if unknown) |
| `figma.node_id` | string | yes | Figma node ID (`TODO_FIGMA_NODE_ID` if unknown) |
| `viewport` | object | yes | `{ width, height }` in pixels |
| `masks` | array | yes | Regions to exclude from pixel diff (dynamic content) |
| `masks[].selector` | string | yes | CSS selector or `data-testid` |
| `masks[].reason` | string | yes | Why this region is masked |
| `thresholds` | object | yes | Diff sensitivity |
| `thresholds.pixel_diff_percent` | number | yes | Max allowed pixel difference (0-100) |
| `thresholds.structural_similarity` | number | yes | Min SSIM score (0-1) |
| `tags` | array | yes | Categorization tags |
| `notes` | string | no | Human-readable notes |

## flows.yaml Schema

Each entry in `flows`:

| Field | Type | Required | Description |
|---|---|---|---|
| `flow_id` | string | yes | Unique flow identifier |
| `title` | string | yes | Human-readable name |
| `entry_route` | string | yes | Starting route for this flow |
| `nodes` | array | yes | Screens in this flow |
| `nodes[].id` | string | yes | Node ID (unique within flow) |
| `nodes[].screen_id` | string | yes | References a screen in `screens.yaml` |
| `nodes[].route` | string | yes | Route for this node |
| `edges` | array | yes | Transitions between nodes |
| `edges[].from` | string | yes | Source node ID |
| `edges[].to` | string | yes | Target node ID |
| `edges[].trigger` | string | yes | What causes this transition |
| `edges[].type` | enum | yes | `next`, `alternate`, `error`, `data_variant` |
| `edges[].uncertain` | boolean | no | True if transition depends on browser history or timing |
| `edges[].notes` | string | no | Additional context |

## Naming Conventions

- `flow_id`: lowercase, underscore-separated (`shop_create`, `auth`, `dashboard`)
- `screen_id`: `{flow_id}_{descriptor}_{variant}` — always includes variant
- `variant`: one of `default`, `empty`, `populated`, `error`, `loading`, `selected`, `active`, `needs_setup`

## Placeholder Protocol

When Figma data is not yet available:
- `file_key`: use `"TODO_FIGMA_FILE_KEY"`
- `node_id`: use `"TODO_FIGMA_NODE_ID"`

These placeholders are machine-searchable. The Figma Fetcher module will validate that no TODOs remain before running.

## Future Modules

The registry is designed to support:
1. **Figma Fetcher** — reads `figma.file_key` + `figma.node_id` to export reference PNGs
2. **Playwright Snapshot Runner** — reads `route`, `preconditions`, `viewport`, `masks` to capture runtime screenshots
3. **Diff Engine** — reads `thresholds` to compare Figma vs Runtime
4. **Report Viewer** — reads `tags`, `flow_id`, `notes` for grouping and display
5. **AI Reviewer** — reads full screen context to provide design feedback
