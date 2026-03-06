/**
 * Reviewer seed layer — deterministic test data for visual regression snapshots.
 *
 * Creates:
 * - 2 users: reviewer@resale.test (main, with shops) + reviewer-empty@resale.test (empty dashboard)
 * - 3 shops: ACTIVE (with products), DRAFT (needs_setup), ANALYZING (analysis in progress)
 * - 3 products on the active shop
 * - Analysis steps on the analyzing shop (2 DONE, 1 RUNNING, 1 PENDING)
 *
 * All slugs/emails are stable — safe to re-run (upsert-based).
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ── Constants (deterministic, referenced by reviewer config) ──

const MAIN_USER = {
  email: 'reviewer@resale.test',
  password: 'Reviewer123!',
  name: 'Reviewer Main',
};

const EMPTY_USER = {
  email: 'reviewer-empty@resale.test',
  password: 'Reviewer123!',
  name: 'Reviewer Empty',
};

const ACTIVE_SHOP = {
  name: 'Vintage Threads',
  slug: 'reviewer-vintage-threads',
  websiteUrl: 'https://vintage-threads.example.com',
};

const DRAFT_SHOP = {
  name: 'Draft Store',
  slug: 'reviewer-draft-store',
  websiteUrl: 'https://draft-store.example.com',
};

const ANALYZING_SHOP = {
  name: 'Analyzing Store',
  slug: 'reviewer-analyzing-store',
  websiteUrl: 'https://analyzing-store.example.com',
};

const PRODUCTS = [
  { title: 'Vintage Denim Jacket', price: 89.99, status: 'PUBLISHED' as const },
  { title: 'Retro Sneakers', price: 65.0, status: 'PUBLISHED' as const },
  { title: 'Classic Leather Belt', price: 35.0, status: 'DRAFT' as const },
];

const ANALYSIS_STEPS = [
  { step: 'FONTS', status: 'DONE' as const },
  { step: 'COLORS', status: 'DONE' as const },
  { step: 'LOGO', status: 'RUNNING' as const },
  { step: 'WEBSITE', status: 'PENDING' as const },
];

// ── Seed ──

async function main() {
  console.log('[reviewer-seed] Starting...');

  const passwordHash = await bcrypt.hash(MAIN_USER.password, 10);
  const emptyPasswordHash = await bcrypt.hash(EMPTY_USER.password, 10);

  // ── Users ──
  const mainUser = await prisma.user.upsert({
    where: { email: MAIN_USER.email },
    create: {
      email: MAIN_USER.email,
      passwordHash,
      name: MAIN_USER.name,
      role: 'SELLER',
    },
    update: { passwordHash, name: MAIN_USER.name },
  });
  console.log(`[reviewer-seed] Main user: ${mainUser.email} (${mainUser.id})`);

  const emptyUser = await prisma.user.upsert({
    where: { email: EMPTY_USER.email },
    create: {
      email: EMPTY_USER.email,
      passwordHash: emptyPasswordHash,
      name: EMPTY_USER.name,
      role: 'SELLER',
    },
    update: { passwordHash: emptyPasswordHash, name: EMPTY_USER.name },
  });
  console.log(`[reviewer-seed] Empty user: ${emptyUser.email} (${emptyUser.id})`);

  // ── Themes (ensure they exist) ──
  const coreTheme = await prisma.theme.upsert({
    where: { slug: 'core-resale' },
    create: { name: 'Core Resale', slug: 'core-resale', isDefault: true },
    update: {},
  });

  // ── Active Shop ──
  const activeShop = await prisma.shop.upsert({
    where: { slug: ACTIVE_SHOP.slug },
    create: {
      name: ACTIVE_SHOP.name,
      slug: ACTIVE_SHOP.slug,
      websiteUrl: ACTIVE_SHOP.websiteUrl,
      ownerId: mainUser.id,
      themeId: coreTheme.id,
      status: 'ACTIVE',
      primaryColor: '#000000',
      secondaryColor: '#686868',
      headlineFont: 'Google Sans',
      bodyFont: 'Google Sans',
    },
    update: {
      status: 'ACTIVE',
      ownerId: mainUser.id,
      themeId: coreTheme.id,
    },
  });
  console.log(`[reviewer-seed] Active shop: ${activeShop.slug} (${activeShop.id})`);

  // ── Products on active shop ──
  for (const prod of PRODUCTS) {
    await prisma.product.upsert({
      where: {
        id: `reviewer-${prod.title.toLowerCase().replace(/\s+/g, '-')}`,
      },
      create: {
        id: `reviewer-${prod.title.toLowerCase().replace(/\s+/g, '-')}`,
        shopId: activeShop.id,
        title: prod.title,
        price: prod.price,
        status: prod.status,
      },
      update: {
        shopId: activeShop.id,
        title: prod.title,
        price: prod.price,
        status: prod.status,
      },
    });
  }
  console.log(`[reviewer-seed] ${PRODUCTS.length} products on active shop`);

  // ── Draft Shop ──
  const draftShop = await prisma.shop.upsert({
    where: { slug: DRAFT_SHOP.slug },
    create: {
      name: DRAFT_SHOP.name,
      slug: DRAFT_SHOP.slug,
      websiteUrl: DRAFT_SHOP.websiteUrl,
      ownerId: mainUser.id,
      status: 'DRAFT',
    },
    update: {
      status: 'DRAFT',
      ownerId: mainUser.id,
    },
  });
  console.log(`[reviewer-seed] Draft shop: ${draftShop.slug} (${draftShop.id})`);

  // ── Analyzing Shop ──
  const analyzingShop = await prisma.shop.upsert({
    where: { slug: ANALYZING_SHOP.slug },
    create: {
      name: ANALYZING_SHOP.name,
      slug: ANALYZING_SHOP.slug,
      websiteUrl: ANALYZING_SHOP.websiteUrl,
      ownerId: mainUser.id,
      status: 'ANALYZING',
    },
    update: {
      status: 'ANALYZING',
      ownerId: mainUser.id,
    },
  });
  console.log(`[reviewer-seed] Analyzing shop: ${analyzingShop.slug} (${analyzingShop.id})`);

  // ── Analysis steps on analyzing shop ──
  for (const as of ANALYSIS_STEPS) {
    await prisma.shopAnalysisStep.upsert({
      where: {
        shopId_step: { shopId: analyzingShop.id, step: as.step },
      },
      create: {
        shopId: analyzingShop.id,
        step: as.step,
        status: as.status,
        result: as.status === 'DONE' ? { detected: true } : undefined,
      },
      update: {
        status: as.status,
        result: as.status === 'DONE' ? { detected: true } : undefined,
      },
    });
  }
  console.log(`[reviewer-seed] ${ANALYSIS_STEPS.length} analysis steps on analyzing shop`);

  // ── Summary ──
  console.log('\n[reviewer-seed] Done. Seeded data:');
  console.log(`  Main user:      ${MAIN_USER.email} / ${MAIN_USER.password}`);
  console.log(`  Empty user:     ${EMPTY_USER.email} / ${EMPTY_USER.password}`);
  console.log(`  Active shop:    ${ACTIVE_SHOP.slug} (id: ${activeShop.id})`);
  console.log(`  Draft shop:     ${DRAFT_SHOP.slug} (id: ${draftShop.id})`);
  console.log(`  Analyzing shop: ${ANALYZING_SHOP.slug} (id: ${analyzingShop.id})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
