# Test Data Contract

Defines the deterministic data fixtures required for reproducible visual review runs.

## Test Users

| ID | Email | Password | Name | Purpose |
|---|---|---|---|---|
| `reviewer-user-01` | `reviewer@resale.test` | `Reviewer123!` | `Test Reviewer` | Primary user for all authenticated screenshots |
| `reviewer-user-02` | `reviewer-empty@resale.test` | `Reviewer123!` | `Empty User` | User with zero shops (empty dashboard variant) |

## Test Shops

| Seed ID | Name | Website | Status | Owner | Purpose |
|---|---|---|---|---|---|
| `reviewer-shop-01` | `Acme Vintage` | `https://acme-vintage.example.com` | `ACTIVE` | user-01 | Primary active shop for detail page |
| `reviewer-shop-02` | `Brand Outlet` | `https://brand-outlet.example.com` | `DRAFT` | user-01 | Needs-setup variant |

## Test Products

| Seed ID | Shop | Title | Price | Status | Purpose |
|---|---|---|---|---|---|
| `reviewer-product-01` | shop-01 | `Vintage Denim Jacket` | `89.00` | `ACTIVE` | Products tab populated variant |
| `reviewer-product-02` | shop-01 | `Retro Sneakers` | `65.00` | `ACTIVE` | Second product in list |
| `reviewer-product-03` | shop-01 | `Classic Leather Belt` | `34.50` | `DRAFT` | Draft status variant |

## Test Themes

Use the 5 themes already defined in `apps/api/prisma/seed.ts`. These are deterministic as long as seed is run consistently.

## Media / Assets

| Asset | Description | Strategy |
|---|---|---|
| Shop logos | Not needed for MVP screenshots (masked or empty) | Skip |
| Theme previews | Seeded URLs in themes table | Use placeholder images or mask regions |
| Product images | Not displayed in current product list UI | Not needed |

## Environment Variables (additions to .env)

```env
# Reviewer / Snapshot mode
NEXT_PUBLIC_SNAPSHOT_MODE=false
REVIEWER_SEED_USER_EMAIL=reviewer@resale.test
REVIEWER_SEED_USER_PASSWORD=Reviewer123!
```

## Seed Script Requirements

Future `prisma/seed-reviewer.ts` should:
1. Create test users (idempotent, upsert by email)
2. Create test shops linked to user-01
3. Create test products linked to shop-01
4. Ensure themes exist (use existing seed)
5. Set predictable UUIDs or use slug-based lookups
6. Be runnable independently: `pnpm db:seed:reviewer`

## Determinism Rules

1. **Timestamps**: All seeded records should use fixed `createdAt`/`updatedAt` (e.g., `2025-01-01T00:00:00Z`)
2. **UUIDs**: Use deterministic UUIDs derived from seed IDs (e.g., UUID v5 from name)
3. **Ordering**: API responses must return stable sort (e.g., `ORDER BY createdAt ASC`)
4. **No randomness**: No faker/random data in reviewer seed — all values are hardcoded

## TODO

- [ ] Create `apps/api/prisma/seed-reviewer.ts`
- [ ] Add `db:seed:reviewer` script to `apps/api/package.json`
- [ ] Validate that existing API endpoints return stable sort order
- [ ] Add deterministic UUID generation utility
- [ ] Create placeholder theme preview images in MinIO seed
