import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Seed themes (from Figma)
  const themes = [
    { name: 'Core Resale', slug: 'core-resale', isDefault: true },
    { name: 'Archive', slug: 'archive' },
    { name: 'Minimal', slug: 'minimal' },
    { name: 'Active', slug: 'active' },
    { name: 'Circular', slug: 'circular' },
  ];

  for (const theme of themes) {
    await prisma.theme.upsert({
      where: { slug: theme.slug },
      create: theme,
      update: theme,
    });
  }
  console.log('Seeded 5 themes');

  // Seed test user
  const passwordHash = await bcrypt.hash('password123', 10);
  await prisma.user.upsert({
    where: { email: 'seller@resale.dev' },
    create: {
      email: 'seller@resale.dev',
      passwordHash,
      name: 'Test Seller',
      role: 'SELLER',
    },
    update: {},
  });
  console.log('Seeded test user: seller@resale.dev / password123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
