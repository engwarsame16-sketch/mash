// Standalone database migration / seed script.
//
// Usage (local):
//   1. vercel env pull .env.local      # fetch the Postgres connection string
//   2. npm run setup-db
//
// This creates the required tables and seeds the default workstream / category
// option lists. It is idempotent — running it again will not duplicate data.
//
// Alternatively, after deploying you can simply visit  /api/setup  once in the
// browser, which runs exactly the same logic against the production database.

import { config } from 'dotenv';

// Load .env.local (preferred) then fall back to .env
config({ path: '.env.local' });
config();

if (!process.env.POSTGRES_URL) {
  console.error(
    '\n  Missing POSTGRES_URL.\n' +
      '  Run `vercel env pull .env.local` first, or set POSTGRES_URL in your environment.\n'
  );
  process.exit(1);
}

const { ensureSchema } = await import('../lib/db.js');

try {
  console.log('Creating tables and seeding default options...');
  await ensureSchema();
  console.log('Database setup complete. ✅');
  process.exit(0);
} catch (err) {
  console.error('Database setup failed:', err);
  process.exit(1);
}
