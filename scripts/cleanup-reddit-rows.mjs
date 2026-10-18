// /home/z/my-project/scripts/cleanup-reddit-rows.mjs
// Delete old REDDIT + REDDIT_COOKIE connection rows from the database
// using raw SQL (bypasses Prisma's enum validation that chokes on
// removed enum values).
//
// Usage:
//   cd /home/neeraj/Downloads/NetAmplify-main3/NetAmplify-main
//   node scripts/cleanup-reddit-rows.mjs
//
// Or copy this file to the project root and run it.

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Load .env from the project root
dotenv.config();

const prisma = new PrismaClient();

async function cleanup() {
  console.log('=== Cleaning up old Reddit connection rows ===\n');

  try {
    // Use raw SQL to bypass Prisma's enum validation
    // $executeRaw runs the SQL directly without validating enum values
    const result = await prisma.$executeRaw`
      DELETE FROM "Connection" WHERE platform IN ('REDDIT', 'REDDIT_COOKIE')
    `;

    console.log(`✅ Deleted ${result} row(s) with platform = REDDIT or REDDIT_COOKIE`);
    console.log('\nThe database is now clean. Restart your backend — the errors will be gone.');
  } catch (e) {
    console.error('❌ Cleanup failed:', e.message);
    console.error('\nFull error:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanup();
