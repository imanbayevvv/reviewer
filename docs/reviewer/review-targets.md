# Review Targets

## 1. Primary Screens (MVP)

These are the core screens included in MVP review runs.

| Screen ID | Why MVP | Auth | Seed Data | Dynamic Zones |
|---|---|---|---|---|
| `auth_login_default` | Entry point, first impression | no | none | none |
| `auth_register_default` | Core auth flow | no | none | none |
| `dashboard_home_empty` | Key empty state, CTA visibility | yes | user with 0 shops | none |
| `dashboard_home_populated` | Primary workspace view | yes | user with 1+ shops | shop list (mask) |
| `shop_create_step_1_default` | Wizard entry, form layout | yes | none | none |
| `shop_create_step_3_theme` | Theme grid, selection UI | yes | wizard state + themes | theme images (mask) |
| `shop_create_step_4_setup` | Complex form (upload, colors) | yes | wizard state | logo preview, color pickers (mask) |
| `shop_detail_overview_active` | Shop management primary view | yes | active shop | shop name (mask) |
| `shop_detail_products_empty` | Empty products tab | yes | shop, 0 products | none |

## 2. Branch States

Alternate states of primary screens that provide additional review coverage.

| Screen ID | Why Included | Dependencies |
|---|---|---|
| `auth_login_error` | Error handling UX validation | trigger: failed login attempt |
| `shop_create_step_3_theme_selected` | Selection feedback, Continue button | trigger: click a theme card |
| `shop_detail_overview_needs_setup` | Setup banner visibility | shop with status != ACTIVE |
| `shop_detail_products_populated` | Product list rendering | shop with seeded products |
| `dashboard_home_populated` | Data-dependent variant of dashboard | seeded shops |

## 3. Overlay States

Currently **none** exist in the codebase. No modals, drawers, or popovers are implemented.

The only overlay-like behavior is the `confirm()` dialog for shop deletion, which is a native browser dialog and cannot be screenshotted deterministically.

## 4. Excluded for MVP

| Screen / State | Why Excluded |
|---|---|
| `settings_default` | Placeholder page, not designed in Figma |
| `shop_create_step_2_analyzing` | Polling animation + auto-redirect make it extremely flaky. Will need API mocking or frozen analysis state to snapshot reliably |
| Loading states (all pages) | Transient, sub-second, require intercepting API calls |
| `/ (root redirect)` | No visual content, just redirect |
| `shop_detail_not_found` | Edge case, no Figma frame |

## 5. Risky / Flaky Targets

| Screen ID | Risk | Mitigation |
|---|---|---|
| `shop_create_step_2_analyzing` | `animate-pulse`, polling every 2s, auto-redirect after 1s delay | Snapshot mode disables animation. Need mock API or pre-completed analysis for deterministic state |
| `dashboard_home_populated` | Shop list order depends on API | Seed with fixed data, ensure stable sort |
| `shop_detail_products_populated` | Product list depends on seeded data | Fixed seed with predictable product titles/prices |
| `shop_create_step_3_theme` | Theme preview images from S3/MinIO | Use deterministic seeded theme preview URLs, mask image regions |
| `shop_create_step_4_setup` | Native `<input type="color">` renders differently per OS | Mask color picker inputs |
| All sidebar screens | Sidebar shows shop names from API | Seed with fixed shop names, or mask sidebar |
